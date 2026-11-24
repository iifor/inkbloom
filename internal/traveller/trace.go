package traveller

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log"
	"time"
)

type modelUsage struct {
	Prompt     int `json:"prompt_tokens"`
	Completion int `json:"completion_tokens"`
}

type Trace struct {
	ID, Parent, World, Trail, Mode, Model, Status, Applied string
	Started                                                time.Time
	DurationMS                                             int64
	HTTP                                                   int
	Input                                                  json.RawMessage
	Prompt, Reply                                          string
	Stop                                                   *int
	Usage                                                  *modelUsage
}

// SaveCompleted stores game calls after the simulator has decided how to apply them.
func (p *Planner) SaveCompleted(t *Trace, result string) {
	if t == nil || p.db == nil {
		return
	}
	t.Applied = result
	if err := writeTrace(p.db, t); err != nil {
		log.Printf("save traveller trace %s: %v", t.ID, err)
	}
}

func writeTrace(db *sql.DB, t *Trace) error {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	data, err := json.Marshal(t)
	if err != nil {
		return err
	}
	_, err = db.ExecContext(ctx, "INSERT INTO traveller_traces(id,parent_id,mode,record) VALUES($1,NULLIF($2,''),$3,$4)", t.ID, t.Parent, t.Mode, string(data))
	return err
}

func ReadTrace(ctx context.Context, db *sql.DB, id string) (Trace, error) {
	var b []byte
	var t Trace
	err := db.QueryRowContext(ctx, "SELECT record FROM traveller_traces WHERE id=$1", id).Scan(&b)
	if err == nil {
		err = json.Unmarshal(b, &t)
	}
	return t, err
}

// Return a cursor only when another page exists; concurrent inserts never shift older pages.
func ListTraces(ctx context.Context, db *sql.DB, mode string, before int64) ([]Trace, int64, error) {
	const size = 50
	rows, err := db.QueryContext(ctx, `SELECT seq, record - ARRAY['Input','Prompt','Reply'] FROM traveller_traces
 WHERE ($1='' OR mode=$1) AND ($2::bigint=0 OR seq<$2) ORDER BY seq DESC LIMIT $3`, mode, before, size+1)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []Trace{}
	var last int64
	for rows.Next() {
		if len(out) == size {
			return out, last, nil
		}
		var b []byte
		var t Trace
		if err := rows.Scan(&last, &b); err != nil {
			return nil, 0, err
		}
		if err := json.Unmarshal(b, &t); err != nil {
			return nil, 0, err
		}
		out = append(out, t)
	}
	return out, 0, rows.Err()
}

func (p *Planner) Replay(ctx context.Context, original Trace) (string, error) {
	var f facts
	if json.Unmarshal(original.Input, &f) != nil || !f.valid() {
		return "", errors.New("invalid saved traveller context")
	}
	_, next := p.run(ctx, f, "调试", original.World, original.Trail, original.ID, original.Prompt)
	next.Applied = "仅调试，无游戏状态写入"
	return next.ID, writeTrace(p.db, next)
}
func traceID() string { var b [16]byte; rand.Read(b[:]); return hex.EncodeToString(b[:]) }
