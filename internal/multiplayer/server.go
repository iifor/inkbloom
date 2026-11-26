// Package multiplayer serves the browser's multiplayer protocol inside the Go game process.
package multiplayer

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"

	"inkbloom/internal/save"
	"inkbloom/internal/traveller"
	"log"
	"math/big"
	"sort"
	"strings"
	"sync"
	"time"
)

type Server struct {
	mu sync.Mutex
	db *sql.DB

	planner   *traveller.Planner
	parser    *engine
	lobby     *room
	rooms     map[string]*room
	watchers  map[*peer]bool
	addresses map[string]int
	secret    string
	max       int
	ctx       context.Context
	cancel    context.CancelFunc
	closing   bool
	plans     sync.WaitGroup
	handlers  sync.WaitGroup
	sweeper   sync.WaitGroup
}

func New(ctx context.Context, db *sql.DB, world, secret string, max int, planner *traveller.Planner) (*Server, error) {
	if max < 1 || max > 32 {
		return nil, errors.New("room capacity must be 1..32")
	}
	archive, rev, err := save.LoadLive(ctx, db, world)
	if err != nil {
		return nil, err
	}
	if _, err = db.ExecContext(ctx, "DELETE FROM world_saves WHERE world_type='temporary'"); err != nil {
		return nil, err
	}
	parser, err := newEngine()
	if err != nil {
		return nil, err
	}
	life, cancel := context.WithCancel(context.Background())
	s := &Server{planner: planner, db: db, parser: parser, rooms: map[string]*room{}, watchers: map[*peer]bool{}, addresses: map[string]int{}, secret: secret, max: max, ctx: life, cancel: cancel}
	s.lobby, err = s.makeRoom(world, "", "", archive, rev)
	if err != nil {
		cancel()
		parser.close()
		return nil, err
	}
	s.sweeper.Add(1)
	go s.sweep()
	return s, nil
}
func (s *Server) makeRoom(id, code, password, archive string, rev int64) (*room, error) {
	e, err := newEngine()
	if err != nil {
		return nil, err
	}
	seed, err := rand.Int(rand.Reader, big.NewInt(0x7fffffff))
	if err != nil {
		return nil, err
	}
	if _, err = e.call("init", id, seed.Int64(), s.max, archive); err != nil {
		e.close()
		return nil, err
	}
	r := &room{db: s.db, game: e, id: id, code: code, password: password, seq: rev, peers: map[int]*peer{}, emptySince: time.Now(), done: make(chan struct{}), stopped: make(chan struct{})}
	r.run()
	return r, nil
}
func (s *Server) list() any {
	rooms := []map[string]any{}
	for code, r := range s.rooms {
		r.mu.Lock()
		rooms = append(rooms, map[string]any{"code": code, "count": len(r.peers), "max": s.max, "locked": r.password != "", "paused": r.admissionClosed})
		r.mu.Unlock()
	}
	sort.Slice(rooms, func(i, j int) bool { return rooms[i]["code"].(string) < rooms[j]["code"].(string) })
	return map[string]any{"t": "rooms", "rooms": rooms}
}
func (s *Server) publish() {
	if len(s.watchers) > 0 {
		m := s.list()
		for p := range s.watchers {
			p.send(m)
		}
	}
}
func (s *Server) handshake(p *peer, text string) (*room, int, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var m struct {
		T, Password, RoomPassword, Token string
		V                                int
		Room                             struct{ Action, Code string }
	}
	raw, err := s.parser.call("validate", text)
	if err != nil || json.Unmarshal([]byte(raw), &m) != nil || (m.T != "listRooms" && m.T != "hello") || m.V != 11 || s.closing {
		p.refuse("协议不兼容或服务暂不可用")
		return nil, 0, false
	}
	if !password(m.Password, s.secret) && s.secret != "" {
		p.queue(map[string]any{"t": "refused", "reason": "服务器密码不对", "password": true}, true)
		return nil, 0, false
	}
	if m.T == "listRooms" {
		s.watchers[p] = true
		p.send(s.list())
		return nil, 0, true
	}
	r := s.lobby
	switch m.Room.Action {
	case "create":
		if len(s.rooms) >= 64 {
			p.refuse("房间已满")
			return nil, 0, false
		}
		for {
			var b [16]byte
			rand.Read(b[:])
			code := strings.ToUpper(hex.EncodeToString(b[:3]))
			if s.rooms[code] != nil {
				continue
			}
			r, err = s.makeRoom("room-"+hex.EncodeToString(b[:]), code, m.RoomPassword, "", 0)
			if err != nil {
				log.Print(err)
				p.refuse("创建房间失败")
				return nil, 0, false
			}
			s.rooms[code] = r
			break
		}
	case "join":
		r = s.rooms[m.Room.Code]
		if r == nil {
			p.refuse("房间不存在或已关闭")
			return nil, 0, false
		}
		if r.password != "" && !password(r.password, m.RoomPassword) {
			p.queue(map[string]any{"t": "refused", "reason": "请输入正确的房间密码", "roomPassword": true}, true)
			return nil, 0, false
		}
	}
	r.mu.Lock()
	if r.admissionClosed {
		r.mu.Unlock()
		p.refuse("房间已暂停加入")
		return nil, 0, false
	}
	if r.paused {
		r.mu.Unlock()
		p.refuse("数据库暂不可用")
		return nil, 0, false
	}
	key := sha256.Sum256([]byte(m.Token))
	joined, err := r.game.call("join", hex.EncodeToString(key[:]), raw, r.code, s.planner != nil)
	var j struct {
		OK                     bool
		ID                     int
		Replaced               *int
		Reason                 string
		Welcome, Player, Arena json.RawMessage
	}
	if err != nil || json.Unmarshal([]byte(joined), &j) != nil || !j.OK {
		r.mu.Unlock()
		if j.Reason == "" {
			j.Reason = "无法加入房间"
		}
		p.refuse(j.Reason)
		return nil, 0, false
	}
	if j.Replaced != nil {
		if old := r.peers[*j.Replaced]; old != nil {
			delete(r.peers, *j.Replaced)
			old.cancel()
			r.broadcast(map[string]any{"t": "left", "id": *j.Replaced}, 0)
		}
	}
	r.peers[j.ID] = p
	r.dirty = true
	p.send(j.Welcome)
	r.broadcast(map[string]any{"t": "joined", "player": j.Player}, j.ID)
	if len(j.Arena) > 0 {
		p.send(j.Arena)
	}
	r.mu.Unlock()
	if r.code != "" {
		s.publish()
	}
	return r, j.ID, true
}
func (s *Server) leave(p *peer, r *room, id int) {
	s.mu.Lock()
	delete(s.watchers, p)
	if r == nil {
		s.mu.Unlock()
		return
	}
	r.mu.Lock()
	if r.peers[id] != p {
		r.mu.Unlock()
		s.mu.Unlock()
		return
	}
	delete(r.peers, id)
	r.game.call("leave", id)
	r.dirty = true
	r.emptySince = time.Now()
	r.broadcast(map[string]any{"t": "left", "id": id}, 0)
	r.mu.Unlock()
	if r.code != "" {
		s.publish()
	}
	s.mu.Unlock()
	if err := r.flush(); err != nil {
		log.Print(err)
	}
}
func (s *Server) sweep() {
	defer s.sweeper.Done()
	t := time.NewTicker(time.Second)
	defer t.Stop()
	for {
		select {
		case <-s.ctx.Done():
			return
		case now := <-t.C:
			s.mu.Lock()
			for code, r := range s.rooms {
				r.mu.Lock()
				expired := len(r.peers) == 0 && now.Sub(r.emptySince) >= 5*time.Minute
				r.mu.Unlock()
				if expired {
					r.writes.Lock()
					ctx, cancel := context.WithTimeout(s.ctx, 2*time.Second)
					_, err := s.db.ExecContext(ctx, "DELETE FROM world_saves WHERE world_id=$1 AND world_type='temporary'", r.id)
					cancel()
					if err == nil {
						close(r.done)
						r.mu.Lock()
						r.retired = true
						r.game.close()
						r.mu.Unlock()
						delete(s.rooms, code)
					}
					r.writes.Unlock()
					if err == nil {
						s.publish()
					}
				}
			}
			s.mu.Unlock()
		}
	}
}
func (s *Server) Close() error {
	s.mu.Lock()
	s.closing = true
	s.cancel()
	s.mu.Unlock()
	s.handlers.Wait()
	s.plans.Wait()
	s.sweeper.Wait()
	rooms := []*room{s.lobby}
	for _, r := range s.rooms {
		rooms = append(rooms, r)
	}
	var errs []error
	for _, r := range rooms {
		close(r.done)
		<-r.stopped
		for {
			if err := r.flush(); err != nil {
				errs = append(errs, fmt.Errorf("%s: %w", r.id, err))
				break
			}
			r.mu.Lock()
			dirty := r.dirty
			r.mu.Unlock()
			if !dirty {
				break
			}
		}
		r.mu.Lock()
		r.retired = true
		r.game.close()
		r.mu.Unlock()
	}
	s.parser.close()
	return errors.Join(errs...)
}
