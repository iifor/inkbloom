// Package traveller selects among game-generated reachable stops using recent sightings.
package traveller

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"
)

type option struct {
	Kind   string `json:"kind"`
	Place  string `json:"place,omitempty"`
	Metres *int   `json:"metres"`
	Onward *bool  `json:"onward"`
}
type sighting struct {
	Place string   `json:"place"`
	Kind  string   `json:"kind"`
	At    *float64 `json:"at"`
}
type facts struct {
	Options []option   `json:"options"`
	Memory  []sighting `json:"memory"`
}

var placeID = regexp.MustCompile(`^(c-?[0-9]{1,9}_-?[0-9]{1,9}|bridge:[0-9]{1,5}|spawn|ruin|roadside)$`)

func (f facts) valid() bool {
	if len(f.Options) == 0 || len(f.Options) > 10 || f.Memory == nil || len(f.Memory) > 12 {
		return false
	}
	for _, o := range f.Options {
		switch o.Kind {
		case "peaceful", "infected", "recovering", "restored", "bridge", "spawn", "ruin", "roadside":
		default:
			return false
		}
		if o.Metres == nil || *o.Metres < 0 || *o.Metres > 20000 || o.Onward == nil || (o.Place != "" && !placeID.MatchString(o.Place)) {
			return false
		}
	}
	for _, s := range f.Memory {
		if s.At == nil || *s.At < 0 || !placeID.MatchString(s.Place) {
			return false
		}
		switch s.Kind {
		case "peaceful", "infected", "restored":
			if !strings.HasPrefix(s.Place, "c") {
				return false
			}
		case "bridge":
			if !strings.HasPrefix(s.Place, "bridge:") {
				return false
			}
		case "spawn", "ruin":
			if s.Place != s.Kind {
				return false
			}
		default:
			return false
		}
	}
	return true
}

type Planner struct {
	endpoint, model, key string
	client               http.Client
	mu                   sync.Mutex
	db                   *sql.DB
	busy                 bool
	next                 time.Time
}

// UseDatabase is called during startup, before accepting requests.
func (p *Planner) UseDatabase(db *sql.DB) { p.db = db }

func New(base, model, key string) *Planner {
	if base == "" || model == "" {
		return nil
	}
	return &Planner{endpoint: strings.TrimRight(base, "/") + "/chat/completions", model: model, key: key, client: http.Client{Timeout: 10 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}
}

// Choose returns nil when the existing journey should continue.
func (p *Planner) Choose(ctx context.Context, raw []byte) *int {
	var f facts
	if p == nil || json.Unmarshal(raw, &f) != nil || !f.valid() {
		return nil
	}
	index, tr := p.run(ctx, f, "单机", "", "", "", "")
	p.SaveCompleted(tr, "已返回单机客户端")
	return index
}
func (p *Planner) RoomChoice(ctx context.Context, raw []byte, world, trail string) (*int, *Trace) {
	var f facts
	if json.Unmarshal(raw, &f) != nil || !f.valid() {
		return nil, nil
	}
	return p.run(ctx, f, "联机", world, trail, "", "")
}
func (p *Planner) run(ctx context.Context, f facts, mode, world, trail, parent, prompt string) (stop *int, trace *Trace) {
	data, _ := json.Marshal(f)
	tr := Trace{ID: traceID(), Parent: parent, Mode: mode, World: world, Trail: trail, Model: p.model, Started: time.Now(), Input: data, Status: "准备请求"}
	defer func() {
		tr.DurationMS = time.Since(tr.Started).Milliseconds()
		tr.Stop = stop
	}()
	p.mu.Lock()
	if p.busy || time.Now().Before(p.next) {
		p.mu.Unlock()
		tr.Status = "请求频率受限"
		return nil, &tr
	}
	p.busy = true
	p.next = time.Now().Add(5 * time.Second)
	p.mu.Unlock()
	defer func() { p.mu.Lock(); p.busy = false; p.mu.Unlock() }()

	if prompt == "" {
		prompt = `你是一名步行旅行者。options 是从当前位置可到达的候选站点，metres 是沿路距离，onward 表示继续向前。memory 是最近在前的亲身见闻，at 是世界时间，place 可与候选地点匹配。结合去过的村子、当时的村况、桥与遗迹、当前距离和风险，决定探索还是重访。只返回 {"stop":整数}，从 0 开始索引 options。`
	}
	tr.Prompt = prompt
	body, _ := json.Marshal(map[string]any{"model": p.model, "max_tokens": 80, "messages": []map[string]string{
		{"role": "system", "content": tr.Prompt}, {"role": "user", "content": string(data)}}})
	req, err := http.NewRequestWithContext(ctx, "POST", p.endpoint, bytes.NewReader(body))
	if err != nil {
		tr.Status = "模型地址无效"
		return nil, &tr
	}
	req.Header.Set("Content-Type", "application/json")
	if p.key != "" {
		req.Header.Set("Authorization", "Bearer "+p.key)
	}
	resp, err := p.client.Do(req)
	if err != nil {
		tr.Status = "模型连接失败"
		if errors.Is(err, context.DeadlineExceeded) {
			tr.Status = "模型请求超时"
		} else if errors.Is(err, context.Canceled) {
			tr.Status = "请求已取消"
		}
		return nil, &tr
	}
	defer resp.Body.Close()
	tr.HTTP = resp.StatusCode
	if resp.StatusCode/100 != 2 {
		tr.Status = "供应商返回错误"
		return nil, &tr
	}
	var answer struct {
		Usage   *modelUsage
		Choices []struct{ Message struct{ Content string } }
	}
	b, err := io.ReadAll(io.LimitReader(resp.Body, 64*1024+1))
	if err != nil || len(b) > 64*1024 || json.Unmarshal(b, &answer) != nil || len(answer.Choices) == 0 {
		tr.Status = "响应格式无效"
		return nil, &tr
	}
	tr.Usage = answer.Usage
	tr.Reply = strings.ReplaceAll(answer.Choices[0].Message.Content, "\x00", "")
	if p.key != "" {
		tr.Reply = strings.ReplaceAll(tr.Reply, p.key, "[redacted]")
	}
	reply := strings.TrimSpace(answer.Choices[0].Message.Content)
	if strings.HasPrefix(reply, "```") && strings.HasSuffix(reply, "```") && len(reply) >= 6 {
		reply = strings.TrimPrefix(strings.TrimSpace(reply[3:len(reply)-3]), "json")
	}
	var decision struct{ Stop *int }
	if json.Unmarshal([]byte(reply), &decision) != nil || decision.Stop == nil || *decision.Stop < 0 || *decision.Stop >= len(f.Options) {
		tr.Status = "选站序号无效"
		return nil, &tr
	}
	tr.Status = "选站通过"
	return decision.Stop, &tr
}

func (p *Planner) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if p == nil {
		w.WriteHeader(204)
		return
	}
	ct, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
	origin := r.Header.Get("Origin")
	if origin != "" {
		u, err := url.Parse(origin)
		if err != nil || !strings.EqualFold(u.Host, r.Host) {
			w.WriteHeader(403)
			return
		}
	}
	if r.Method != "POST" || ct != "application/json" || r.Header.Get("Sec-Fetch-Site") == "cross-site" {
		w.WriteHeader(403)
		return
	}
	b, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 4096))
	if err != nil {
		w.WriteHeader(413)
		return
	}
	var f facts
	var originInfo struct{ World, Trail string }
	b = bytes.TrimSpace(b)
	if len(b) > 0 && b[0] == '[' {
		err = json.Unmarshal(b, &f.Options)
		f.Memory = []sighting{}
	} else {
		err = json.Unmarshal(b, &f)
		if err == nil {
			err = json.Unmarshal(b, &originInfo)
		}
	}
	if err != nil || len(originInfo.World) > 256 || len(originInfo.Trail) > 256 || !f.valid() {
		w.WriteHeader(400)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	stop, tr := p.run(r.Context(), f, "单机", originInfo.World, originInfo.Trail, "", "")
	p.SaveCompleted(tr, "已返回单机客户端")
	json.NewEncoder(w).Encode(map[string]any{"stop": stop})
}
