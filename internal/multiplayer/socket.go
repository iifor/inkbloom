package multiplayer

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"net"
	"net/http"
	"time"

	"github.com/coder/websocket"
)

type packet struct {
	data []byte
	last bool
}
type peer struct {
	ws     *websocket.Conn
	ctx    context.Context
	cancel context.CancelFunc
	out    chan packet
	motion chan packet
}

func (p *peer) queue(m any, last bool) {
	data, err := json.Marshal(m)
	if err != nil {
		return
	}
	select {
	case p.out <- packet{data, last}:
	default:
		p.cancel()
	}
}
func (p *peer) send(m any)           { p.queue(m, false) }
func (p *peer) refuse(reason string) { p.queue(map[string]any{"t": "refused", "reason": reason}, true) }

// The room mutex serializes producers. Keep only the newest unsent snapshot.
func (p *peer) snapshot(data []byte) {
	select {
	case <-p.motion:
	default:
	}
	p.motion <- packet{data: data}
}
func (p *peer) write() {
	defer p.cancel()
	for {
		var pkt packet
		select {
		case pkt = <-p.out:
		default:
			select {
			case <-p.ctx.Done():
				return
			case pkt = <-p.out:
			case pkt = <-p.motion:
			}
		}
		ctx, cancel := context.WithTimeout(p.ctx, 3*time.Second)
		err := p.ws.Write(ctx, websocket.MessageText, pkt.data)
		cancel()
		if err != nil || pkt.last {
			return
		}
	}
}
func password(a, b string) bool { return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1 }
func (s *Server) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	ip, _, _ := net.SplitHostPort(req.RemoteAddr)
	// The local development proxy overwrites X-Real-IP with its actual peer.
	if peerIP := net.ParseIP(ip); peerIP.IsLoopback() {
		if client := net.ParseIP(req.Header.Get("X-Real-IP")); client != nil {
			ip = client.String()
		}
	}
	s.mu.Lock()
	if s.closing || s.addresses[ip] >= 4 {
		s.mu.Unlock()
		http.Error(w, "unavailable", 503)
		return
	}
	s.addresses[ip]++
	s.handlers.Add(1)
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		s.addresses[ip]--
		if s.addresses[ip] == 0 {
			delete(s.addresses, ip)
		}
		s.mu.Unlock()
		s.handlers.Done()
	}()
	ws, err := websocket.Accept(w, req, nil)
	if err != nil {
		return
	}
	defer ws.CloseNow()
	ctx, cancel := context.WithCancel(s.ctx)
	defer cancel()
	p := &peer{ws, ctx, cancel, make(chan packet, 128), make(chan packet, 1)}
	ws.SetReadLimit(32 * 1024)
	go p.write()
	go func() {
		ticker := time.NewTicker(15 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				c, stop := context.WithTimeout(ctx, 5*time.Second)
				err := ws.Ping(c)
				stop()
				if err != nil {
					cancel()
					return
				}
			}
		}
	}()
	first, stop := context.WithTimeout(ctx, 5*time.Second)
	_, data, err := ws.Read(first)
	stop()
	if err != nil {
		return
	}
	r, id, ok := s.handshake(p, string(data))
	if !ok {
		<-ctx.Done()
		return
	}
	defer s.leave(p, r, id)
	last := time.Now()
	budget := 120.0
	strikes := 0
	for {
		typ, data, err := ws.Read(ctx)
		if err != nil {
			return
		}
		now := time.Now()
		budget = min(120, budget+60*now.Sub(last).Seconds())
		last = now
		if budget < 1 {
			strikes++
			if strikes >= 200 {
				return
			}
			continue
		}
		budget--
		if r == nil || typ != websocket.MessageText {
			continue
		}
		r.mu.Lock()
		if !r.paused && r.peers[id] == p {
			raw, err := r.game.call("validate", string(data))
			if err == nil && raw != "null" {
				var msg struct{ T, Trail string }
				if s.planner != nil && json.Unmarshal([]byte(raw), &msg) == nil && msg.T == "traveller" {
					s.requestPlan(r, id, msg.Trail)
				} else {
					r.deliver("command", id, raw)
					r.dirty = true
				}
			}
		}
		r.mu.Unlock()
	}
}

// Called under r.mu. The model sees only facts from the authoritative room.
func (s *Server) requestPlan(r *room, id int, trail string) {
	facts, err := r.game.call("beginPlan", id, trail)
	if err != nil || facts == "null" {
		return
	}
	s.plans.Add(1)
	go func() {
		defer s.plans.Done()
		choice, trace := s.planner.RoomChoice(s.ctx, []byte(facts), r.id, trail)
		result := r.applyPlan(s.ctx, trail, choice)
		s.planner.SaveCompleted(trace, result)
	}()
}
func (r *room) applyPlan(ctx context.Context, trail string, choice *int) string {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.retired {
		return "房间已结束"
	}
	index := -1
	if choice != nil && !r.paused && ctx.Err() == nil {
		index = *choice
	}
	leg, err := r.game.call("finishPlan", index)
	if err != nil || leg == "null" {
		return "沿用原行程"
	}
	r.dirty = true
	r.broadcast(map[string]any{"t": "traveller", "trail": trail, "leg": json.RawMessage(leg)}, 0)
	return "已更新行程并广播"
}
