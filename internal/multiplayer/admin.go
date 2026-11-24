package multiplayer

import (
	"context"
	"database/sql"
	"errors"
	"sort"
	"time"
)

type RoomInfo struct {
	ID, Code                   string
	Count, Max                 int
	Locked, Closed, SaveFailed bool
}
type WorldInfo struct {
	ID, Kind         string
	Sequence         int64
	Version, Players int
	Clock            float64
	Seed             int64
}
type BackupInfo struct {
	ID, World, Digest string
	Sequence          int64
	Created           time.Time
}
type Overview struct {
	Online  int
	Rooms   []RoomInfo
	Worlds  []WorldInfo
	Backups []BackupInfo
	Sample  time.Time
}

func (s *Server) Overview(ctx context.Context) (Overview, error) {
	out := Overview{Sample: time.Now(), Rooms: []RoomInfo{}, Worlds: []WorldInfo{}, Backups: []BackupInfo{}}
	s.mu.Lock()
	rooms := []*room{s.lobby}
	for _, r := range s.rooms {
		rooms = append(rooms, r)
	}
	for _, r := range rooms {
		r.mu.Lock()
		out.Rooms = append(out.Rooms, RoomInfo{r.id, r.code, len(r.peers), s.max, r.password != "", r.admissionClosed, r.paused})
		out.Online += len(r.peers)
		r.mu.Unlock()
	}
	s.mu.Unlock()
	sort.Slice(out.Rooms, func(i, j int) bool { return out.Rooms[i].Code < out.Rooms[j].Code })
	rows, err := s.db.QueryContext(ctx, `SELECT world_id,world_type,save_sequence,format_version,(SELECT count(*) FROM player_saves p WHERE p.world_id=w.world_id),coalesce((shared_state->>'clock')::float8,0),coalesce((shared_state->>'seed')::bigint,0) FROM world_saves w ORDER BY world_type,world_id`)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var w WorldInfo
		if err = rows.Scan(&w.ID, &w.Kind, &w.Sequence, &w.Version, &w.Players, &w.Clock, &w.Seed); err != nil {
			return out, err
		}
		out.Worlds = append(out.Worlds, w)
	}
	if err = rows.Err(); err != nil {
		return out, err
	}
	rows, err = s.db.QueryContext(ctx, `SELECT b.id,b.world_id,b.digest,b.save_sequence,o.created_at FROM world_backups b JOIN admin_operations o USING(id) ORDER BY o.created_at DESC LIMIT 100`)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var b BackupInfo
		if err = rows.Scan(&b.ID, &b.World, &b.Digest, &b.Sequence, &b.Created); err != nil {
			return out, err
		}
		out.Backups = append(out.Backups, b)
	}
	return out, rows.Err()
}

var ErrTarget = errors.New("目标不存在或操作编号冲突")

func operation(ctx context.Context, tx *sql.Tx, id, user, action, target string) (bool, error) {
	res, err := tx.ExecContext(ctx, "INSERT INTO admin_operations(id,account,action,target) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING", id, user, action, target)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	if n == 1 || err != nil {
		return true, err
	}
	var matches bool
	err = tx.QueryRowContext(ctx, "SELECT account=$2 AND action=$3 AND target=$4 FROM admin_operations WHERE id=$1", id, user, action, target).Scan(&matches)
	if err == nil && !matches {
		return false, ErrTarget
	}
	return false, err
}
func (s *Server) Admission(ctx context.Context, id, user, target string, closed bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	var selected *room
	for _, r := range s.rooms {
		if r.id == target {
			selected = r
			break
		}
	}
	if selected == nil {
		return ErrTarget
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	action := "open"
	if closed {
		action = "pause"
	}
	fresh, err := operation(ctx, tx, id, user, action, target)
	if err != nil {
		return err
	}
	if err = tx.Commit(); err != nil {
		return err
	}
	if fresh {
		selected.mu.Lock()
		selected.admissionClosed = closed
		selected.mu.Unlock()
		s.publish()
	}
	return nil
}
func (s *Server) Backup(ctx context.Context, id, user, target string) error {
	// For the running persistent world include the latest play since autosave.
	if target == s.lobby.id {
		if err := s.lobby.flush(); err != nil {
			return err
		}
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	fresh, err := operation(ctx, tx, id, user, "backup", target)
	if err != nil {
		return err
	}
	if fresh {
		result, err := tx.ExecContext(ctx, `WITH archive AS (
 SELECT w.*,jsonb_build_object('world',shared_state,'players',coalesce((SELECT jsonb_object_agg(encode(identity_key,'hex'),jsonb_build_object('name',name,'look',appearance,'slice',personal_state,'seen',last_seen)) FROM player_saves p WHERE p.world_id=w.world_id),'{}'::jsonb)) AS body
 FROM world_saves w WHERE world_id=$2 AND world_type='persistent')
 INSERT INTO world_backups SELECT $1,world_id,save_sequence,format_version,body,encode(sha256(convert_to(body::text,'UTF8')),'hex') FROM archive`, id, target)
		if err != nil {
			return err
		}
		n, err := result.RowsAffected()
		if err != nil {
			return err
		}
		if n != 1 {
			return ErrTarget
		}
	}
	return tx.Commit()
}
