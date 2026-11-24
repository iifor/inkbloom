package multiplayer

import (
	"context"
	"database/sql"
	"encoding/json"
	"log"
	"sync"
	"time"

	"inkbloom/internal/save"
)

type room struct {
	mu                     sync.Mutex
	game                   *engine
	id, code, password     string
	peers                  map[int]*peer
	emptySince             time.Time
	seq                    int64
	admissionClosed        bool
	retired, dirty, paused bool
	pending                string
	db                     *sql.DB
	writes                 sync.Mutex
	done                   chan struct{}
	stopped                chan struct{}
}

func (r *room) broadcast(message any, except int) {
	for id, p := range r.peers {
		if id != except {
			p.send(message)
		}
	}
}
func (r *room) deliver(fn string, args ...any) {
	raw, err := r.game.call(fn, args...)
	if err != nil {
		log.Printf("room %s %s: %v", r.id, fn, err)
		return
	}
	var out []delivery
	if err = json.Unmarshal([]byte(raw), &out); err != nil {
		log.Print(err)
		return
	}
	r.route(out)
}

func (r *room) route(out []delivery) {
	for _, d := range out {
		for _, id := range d.IDs {
			if p := r.peers[id]; p != nil {
				p.send(d.Message)
			}
		}
	}
}

// Send reliable events in order. A slow connection only needs its latest motion view.
func (r *room) tick(dt float64, directory bool) {
	raw, err := r.game.call("tick", dt, directory)
	if err != nil {
		log.Print(err)
		return
	}
	var frame struct {
		Clock  float64
		Events []delivery
		Views  []struct {
			ID                      int
			Players, Friends, Keeps json.RawMessage
		}
	}
	if err = json.Unmarshal([]byte(raw), &frame); err != nil {
		log.Print(err)
		return
	}
	r.route(frame.Events)
	for _, view := range frame.Views {
		p := r.peers[view.ID]
		if p == nil {
			continue
		}
		if len(view.Friends) > 0 {
			p.send(map[string]any{"t": "friends", "players": view.Friends})
		}
		data, err := json.Marshal(map[string]any{"t": "snap", "clock": frame.Clock, "players": view.Players, "keeps": view.Keeps})
		if err == nil {
			p.snapshot(data)
		}
	}
}

// Capture under the simulation lock, then release it before database I/O.
// An uncertain commit always retries the exact same snapshot and revision.
func (r *room) flush() error {
	r.writes.Lock()
	defer r.writes.Unlock()
	r.mu.Lock()
	if r.retired {
		r.mu.Unlock()
		return nil
	}
	if r.pending == "" {
		if !r.dirty {
			r.mu.Unlock()
			return nil
		}
		raw, err := r.game.call("checkpoint")
		if err != nil {
			r.mu.Unlock()
			return err
		}
		r.pending = raw
		r.dirty = false
	}
	raw, seq := r.pending, r.seq+1
	r.mu.Unlock()
	kind := "persistent"
	if r.code != "" {
		kind = "temporary"
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	err := save.StoreLive(ctx, r.db, r.id, kind, raw, seq)
	r.mu.Lock()
	defer r.mu.Unlock()
	if err != nil {
		if !r.paused {
			for _, p := range r.peers {
				p.refuse("数据库暂不可用，进度待保存")
			}
		}
		r.paused = true
		return err
	}
	r.seq = seq
	r.pending = ""
	r.paused = false
	return nil
}
func (r *room) run() {
	go func() {
		defer close(r.stopped)
		t := time.NewTicker(2 * time.Second)
		defer t.Stop()
		for {
			select {
			case <-r.done:
				return
			case <-t.C:
				if err := r.flush(); err != nil {
					log.Printf("save %s: %v", r.id, err)
				}
			}
		}
	}()
	go func() {
		t := time.NewTicker(50 * time.Millisecond)
		defer t.Stop()
		last := time.Now()
		next := last
		for {
			select {
			case <-r.done:
				return
			case now := <-t.C:
				r.mu.Lock()
				if !r.retired && !r.paused && len(r.peers) > 0 {
					directory := !now.Before(next)
					if directory {
						next = now.Add(time.Second)
					}
					r.tick(min(0.5, now.Sub(last).Seconds()), directory)
					r.dirty = true
				}
				r.mu.Unlock()
				last = now
			}
		}
	}()
}
