// Package save imports archived TypeScript world-server saves into PostgreSQL.
package save

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
)

type legacyPlayer struct {
	Name  string          `json:"name"`
	Look  json.RawMessage `json:"look"`
	Slice string          `json:"slice"`
	Seen  float64         `json:"seen"`
}
type legacySave struct {
	V       int                     `json:"v"`
	World   string                  `json:"world"`
	Players map[string]legacyPlayer `json:"players"`
}
type header struct {
	ID      string
	Version int
}

func decode(data []byte) (legacySave, header, error) {
	var s legacySave
	var h header
	if err := json.Unmarshal(data, &s); err != nil {
		return s, h, err
	}
	if s.V != 1 || s.Players == nil {
		return s, h, errors.New("unsupported world envelope or missing players")
	}
	if err := json.Unmarshal([]byte(s.World), &h); err != nil {
		return s, h, err
	}
	if h.Version != 10 || h.ID == "" {
		return s, h, errors.New("import requires a v10 world with an ID")
	}
	for _, p := range s.Players {
		var personal header
		var look map[string]any
		if json.Unmarshal([]byte(p.Slice), &personal) != nil || personal.Version != 10 || json.Unmarshal(p.Look, &look) != nil || look == nil {
			return s, h, errors.New("invalid player appearance or v10 personal save")
		}
	}
	return s, h, nil
}

// Import inserts an entire world once. A repeated file never replaces newer progress.
func Import(ctx context.Context, db *sql.DB, data []byte) error {
	s, h, err := decode(data)
	if err != nil {
		return err
	}
	digest := sha256.Sum256(data)
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	result, err := tx.ExecContext(ctx, `INSERT INTO world_saves(world_id,world_type,format_version,save_sequence,shared_state)
 VALUES($1,'persistent',$2,1,$3) ON CONFLICT(world_id) DO NOTHING`, h.ID, h.Version, s.World)
	if err != nil {
		return err
	}
	n, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		var prior []byte
		err = tx.QueryRowContext(ctx, "SELECT source_digest FROM legacy_imports WHERE world_id=$1", h.ID).Scan(&prior)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		if !bytes.Equal(prior, digest[:]) {
			return fmt.Errorf("existing world %q conflicts with import", h.ID)
		}
		return tx.Commit()
	}
	for token, p := range s.Players {
		key := sha256.Sum256([]byte(token))
		_, err = tx.ExecContext(ctx, `INSERT INTO player_saves(world_id,identity_key,name,appearance,personal_state,last_seen)
  VALUES($1,$2,$3,$4,$5,$6)`, h.ID, key[:], p.Name, string(p.Look), p.Slice, p.Seen)
		if err != nil {
			return err
		}
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO legacy_imports(world_id,source_digest) VALUES($1,$2)", h.ID, digest[:]); err != nil {
		return err
	}
	return tx.Commit()
}
