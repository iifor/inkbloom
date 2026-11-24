package save

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
)

// LoadLive reads the world and all player slices at one database revision.
// WorldHost uses the hexadecimal identity digest internally, never the bearer token.
func LoadLive(ctx context.Context, db *sql.DB, id string) (string, int64, error) {
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	if err != nil {
		return "", 0, err
	}
	defer tx.Rollback()
	s := legacySave{V: 1, Players: map[string]legacyPlayer{}}
	var seq int64
	err = tx.QueryRowContext(ctx, "SELECT shared_state,save_sequence FROM world_saves WHERE world_id=$1 AND world_type='persistent'", id).Scan(&s.World, &seq)
	if errors.Is(err, sql.ErrNoRows) {
		return "", 0, nil
	}
	if err != nil {
		return "", 0, err
	}
	rows, err := tx.QueryContext(ctx, "SELECT encode(identity_key,'hex'),name,appearance,personal_state,last_seen FROM player_saves WHERE world_id=$1", id)
	if err != nil {
		return "", 0, err
	}
	defer rows.Close()
	for rows.Next() {
		var key string
		var p legacyPlayer
		if err := rows.Scan(&key, &p.Name, &p.Look, &p.Slice, &p.Seen); err != nil {
			return "", 0, err
		}
		s.Players[key] = p
	}
	if err := rows.Err(); err != nil {
		return "", 0, err
	}
	// The legacy envelope uses lowercase property names.
	data, err := json.Marshal(s)
	if err != nil {
		return "", 0, err
	}
	return string(data), seq, tx.Commit()
}

func StoreLive(ctx context.Context, db *sql.DB, id, kind, archive string, sequence int64) error {
	s, h, err := decode([]byte(archive))
	if err != nil {
		return err
	}
	if h.ID != id {
		return errors.New("world ID mismatch")
	}
	players, err := json.Marshal(s.Players)
	if err != nil {
		return err
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	result, err := tx.ExecContext(ctx, `INSERT INTO world_saves(world_id,world_type,format_version,save_sequence,shared_state)
 SELECT $1,$2,$3,$4,$5 WHERE $4::bigint=1 OR EXISTS(SELECT 1 FROM world_saves WHERE world_id=$1)
 ON CONFLICT(world_id) DO UPDATE SET save_sequence=excluded.save_sequence,shared_state=excluded.shared_state,format_version=excluded.format_version
 WHERE world_saves.save_sequence=excluded.save_sequence-1 AND world_saves.world_type=excluded.world_type`, id, kind, h.Version, sequence, s.World)
	if err != nil {
		return err
	}
	n, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if n != 1 {
		var identical bool
		// A lost commit acknowledgement is safe to replay only if the whole
		// checkpoint, including the player roster, already matches.
		err = tx.QueryRowContext(ctx, `SELECT save_sequence=$2 AND shared_state=$3::jsonb AND world_type=$4
        AND NOT EXISTS (
          SELECT 1 FROM
            (SELECT encode(identity_key,'hex') AS key,name,appearance,personal_state,last_seen
             FROM player_saves WHERE world_id=$1) live
            FULL JOIN jsonb_each($5::jsonb) input USING (key)
          WHERE live.name IS DISTINCT FROM input.value->>'name'
             OR live.appearance IS DISTINCT FROM input.value->'look'
             OR live.personal_state IS DISTINCT FROM (input.value->>'slice')::jsonb
             OR live.last_seen IS DISTINCT FROM (input.value->>'seen')::double precision
        ) FROM world_saves WHERE world_id=$1`, id, sequence, s.World, kind, string(players)).Scan(&identical)
		if err != nil {
			return err
		}
		if !identical {
			return fmt.Errorf("stale world revision %d", sequence)
		}
		return tx.Commit()
	}
	// Batch the full roster in two statements. Unchanged offline players do
	// not need an UPDATE on every clock checkpoint.
	_, err = tx.ExecContext(ctx, `INSERT INTO player_saves AS live(world_id,identity_key,name,appearance,personal_state,last_seen)
 SELECT $1,decode(key,'hex'),value->>'name',value->'look',(value->>'slice')::jsonb,(value->>'seen')::double precision
 FROM jsonb_each($2::jsonb)
 ON CONFLICT(world_id,identity_key) DO UPDATE SET name=excluded.name,appearance=excluded.appearance,
 personal_state=excluded.personal_state,last_seen=excluded.last_seen
 WHERE (live.name,live.appearance,live.personal_state,live.last_seen)
 IS DISTINCT FROM (excluded.name,excluded.appearance,excluded.personal_state,excluded.last_seen)`, id, string(players))
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `DELETE FROM player_saves WHERE world_id=$1 AND NOT ($2::jsonb ? encode(identity_key,'hex'))`, id, string(players))
	if err != nil {
		return err
	}
	return tx.Commit()
}
