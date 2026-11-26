package multiplayer

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"github.com/coder/websocket"

	_ "github.com/jackc/pgx/v5/stdlib"
	"inkbloom/internal/save"
	"inkbloom/internal/traveller"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"
)

type object = map[string]any

func sendTest(t *testing.T, c *websocket.Conn, m object) {
	t.Helper()
	data, _ := json.Marshal(m)
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	if err := c.Write(ctx, websocket.MessageText, data); err != nil {
		t.Fatal(err)
	}
}
func receive(t *testing.T, c *websocket.Conn, kind string) object {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
	defer cancel()
	for {
		_, b, err := c.Read(ctx)
		if err != nil {
			t.Fatalf("waiting for %s: %v", kind, err)
		}
		var m object
		if err = json.Unmarshal(b, &m); err != nil {
			t.Fatal(err)
		}
		if m["t"] == kind {
			return m
		}
		if m["t"] == "refused" || m["t"] == "rejected" {
			t.Fatalf("unexpected refusal: %v", m)
		}
	}
}

// Requires an empty disposable database for the startup and restart checks.
func TestLivePostgres(t *testing.T) {
	dsn := os.Getenv("INKBLOOM_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set INKBLOOM_TEST_DATABASE_URL to an empty test database")
	}
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	schema, err := os.ReadFile("../save/migrations/001_world_saves.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(string(schema)); err != nil {
		t.Fatal(err)
	}
	adminSchema, err := os.ReadFile("../save/migrations/002_admin.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(string(adminSchema)); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec("INSERT INTO admin_accounts VALUES('operator')"); err != nil {
		t.Fatal(err)
	}
	fixture, err := os.ReadFile("../save/testdata/world-v1.json")
	if err != nil {
		t.Fatal(err)
	}
	if err = save.Import(context.Background(), db, fixture); err != nil {
		t.Fatal(err)
	}
	var active *Server
	var planner *traveller.Planner
	start := func() (string, func()) {
		s, err := New(context.Background(), db, "migration", "", 3, planner)
		if err != nil {
			t.Fatal(err)
		}
		active = s
		h := httptest.NewServer(s)
		stop := sync.OnceFunc(func() {
			if err := s.Close(); err != nil {
				t.Error(err)
			}
			h.Close()
		})
		t.Cleanup(stop)
		return "ws" + strings.TrimPrefix(h.URL, "http"), stop
	}
	dial := func(url, token string, extra object) *websocket.Conn {
		c, _, err := websocket.Dial(context.Background(), url, nil)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { c.CloseNow() })
		m := object{"t": "hello", "v": 11, "token": token, "name": token, "look": object{"character": "courier", "skin": 0, "hair": 1, "accent": 5}}
		for k, v := range extra {
			m[k] = v
		}
		sendTest(t, c, m)
		return c
	}
	url, stop := start()
	a := dial(url, "fixture-one", nil)
	receive(t, a, "welcome")
	b := dial(url, "fixture-two", nil)
	receive(t, b, "welcome")
	for i, c := range []*websocket.Conn{a, b} {
		sendTest(t, c, object{"t": "move", "p": []int{i - 298, 5, -298}, "v": []int{0, 0, 0}, "yaw": 0, "pitch": 0, "f": 1, "scene": object{"kind": "wild"}})
	}
	for len(receive(t, b, "snap")["players"].([]any)) == 0 {
	}
	patch := object{"t": "patch", "seq": 1, "patch": object{"kind": "harvest", "source": "-3,-3:0"}}
	sendTest(t, a, patch)
	accepted := receive(t, a, "ok")
	receive(t, b, "applied")
	sendTest(t, b, patch)
	receive(t, b, "rejected")
	var persisted bool
	deadline := time.Now().Add(8 * time.Second)
	for !persisted && time.Now().Before(deadline) {
		err = db.QueryRow("SELECT shared_state->'harvested' ? '-3,-3:0' FROM world_saves WHERE world_id='migration'").Scan(&persisted)
		if err != nil {
			t.Fatal(err)
		}
		if !persisted {
			time.Sleep(50 * time.Millisecond)
		}
	}
	if !persisted {
		t.Fatal("missing in-game checkpoint")
	}
	newer := dial(url, "fixture-one", nil)
	welcome := receive(t, newer, "welcome")
	if len(welcome["players"].([]any)) != 1 {
		t.Fatal("replacement roster")
	}
	newer.CloseNow()
	a.CloseNow()
	b.CloseNow()

	private := dial(url, "private-owner", object{"room": object{"action": "create"}, "roomPassword": "secret"})
	code := receive(t, private, "welcome")["room"]
	observer := dial(url, "", object{"t": "listRooms", "password": ""})
	if len(receive(t, observer, "rooms")["rooms"].([]any)) != 1 {
		t.Fatal("missing room")
	}
	observer.CloseNow()
	bad := dial(url, "wrong-password", object{"room": object{"action": "join", "code": code}})
	receive(t, bad, "refused")
	bad.CloseNow()
	ctx := context.Background()
	overview, err := active.Overview(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var instance string
	for _, r := range overview.Rooms {
		if r.Code == code {
			instance = r.ID
		}
	}
	if err = active.Admission(ctx, "00000000-0000-4000-8000-000000000001", "operator", instance, true); err != nil {
		t.Fatal(err)
	}
	denied := dial(url, "paused-test", object{"room": object{"action": "join", "code": code}, "roomPassword": "secret"})
	if receive(t, denied, "refused")["reason"] != "房间已暂停加入" {
		t.Fatal("pause not enforced")
	}
	denied.CloseNow()
	receive(t, private, "snap")
	if err = active.Admission(ctx, "00000000-0000-4000-8000-000000000002", "operator", instance, false); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if err = active.Backup(ctx, "00000000-0000-4000-8000-000000000003", "operator", "migration"); err != nil {
			t.Fatal(err)
		}
	}
	overview, err = active.Overview(ctx)
	if err != nil || len(overview.Backups) != 1 {
		t.Fatal("duplicate backup", err)
	}
	guest := dial(url, "room-guest", object{"room": object{"action": "join", "code": code}, "roomPassword": "secret"})
	welcome = receive(t, guest, "welcome")
	if len(welcome["players"].([]any)) != 1 {
		t.Fatal("private room roster")
	}
	guest.CloseNow()
	private.CloseNow()
	stop()
	archive, seq, err := save.LoadLive(context.Background(), db, "migration")
	if err != nil {
		t.Fatal(err)
	}
	if err = save.StoreLive(context.Background(), db, "migration", "persistent", archive, seq); err != nil {
		t.Fatalf("repeat checkpoint: %v", err)
	}
	var altered struct {
		V       int                        `json:"v"`
		World   string                     `json:"world"`
		Players map[string]json.RawMessage `json:"players"`
	}
	if err = json.Unmarshal([]byte(archive), &altered); err != nil {
		t.Fatal(err)
	}
	for key := range altered.Players {
		delete(altered.Players, key)
		break
	}
	conflict, _ := json.Marshal(altered)
	if err = save.StoreLive(context.Background(), db, "migration", "persistent", string(conflict), seq); err == nil {
		t.Fatal("conflicting revision accepted")
	}
	// A player-row failure occurs after the world row update. Both changes must roll back.
	altered.Players["invalid-identity"] = json.RawMessage(`{"name":"invalid","look":{},"slice":"{\"version\":10}","seen":0}`)
	broken, err := json.Marshal(altered)
	if err != nil {
		t.Fatal(err)
	}
	if err = save.StoreLive(context.Background(), db, "migration", "persistent", string(broken), seq+1); err == nil {
		t.Fatal("invalid checkpoint accepted")
	}
	restored, revision, err := save.LoadLive(context.Background(), db, "migration")
	if err != nil || revision != seq || restored != archive {
		t.Fatal("failed save changed committed checkpoint", revision, err)
	}
	url, stop = start()
	defer stop()
	for _, token := range []string{"fixture-one", "fixture-two"} {
		c := dial(url, token, nil)
		m := receive(t, c, "welcome")
		var got, want struct{ Inventory map[string]any }
		json.Unmarshal([]byte(m["you"].(string)), &got)
		if token == "fixture-one" {
			json.Unmarshal([]byte(accepted["you"].(string)), &want)
			if !reflect.DeepEqual(got.Inventory, want.Inventory) {
				t.Fatal("inventory not restored")
			}
		} else {
			if got.Inventory["generic"] != float64(63) {
				t.Fatal("wrong player inventory")
			}
		}
		c.CloseNow()
	}
	stop()
	// Fixed seed and clock: the spawn traveller has crossed the first bridge.
	_, err = db.Exec(`UPDATE world_saves SET shared_state=shared_state || '{"seed":4242,"clock":25}'::jsonb WHERE world_id='migration'`)
	if err != nil {
		t.Fatal(err)
	}
	model := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request struct{ Messages []struct{ Content string } }
		if json.NewDecoder(r.Body).Decode(&request) != nil || len(request.Messages) != 2 {
			t.Error("missing model context")
			return
		}
		var facts struct{ Options, Memory []struct{ Kind string } }
		json.Unmarshal([]byte(request.Messages[1].Content), &facts)
		seenBridge := false
		for _, m := range facts.Memory {
			if m.Kind == "bridge" {
				seenBridge = true
			}
		}
		if !seenBridge {
			t.Error("missing bridge sighting")
		}
		for i, o := range facts.Options {
			if o.Kind == "peaceful" {
				json.NewEncoder(w).Encode(object{"choices": []object{{"message": object{"content": fmt.Sprintf(`{"stop":%d}`, i)}}}})
				return
			}
		}
		t.Error("missing village candidate")
	}))
	defer model.Close()
	planner = traveller.New(model.URL, "test", "")
	url, stop = start()
	a = dial(url, "fixture-one", nil)
	b = dial(url, "fixture-two", nil)
	for _, c := range []*websocket.Conn{a, b} {
		if receive(t, c, "welcome")["travellerAI"] != true {
			t.Fatal("AI not advertised")
		}
		sendTest(t, c, object{"t": "move", "p": []int{65, 2, 65}, "v": []int{0, 0, 0}, "yaw": 0, "pitch": 0, "f": 1, "scene": object{"kind": "wild"}})
	}
	for _, c := range []*websocket.Conn{a, b} {
		sendTest(t, c, object{"t": "traveller", "trail": "spawn"})
	}
	leg := receive(t, a, "traveller")["leg"]
	if !reflect.DeepEqual(leg, receive(t, b, "traveller")["leg"]) {
		t.Fatal("players received different journeys")
	}
	a.CloseNow()
	b.CloseNow()
	stop()
	url, stop = start()
	defer stop()
	c := dial(url, "fixture-one", nil)
	welcome = receive(t, c, "welcome")
	var world struct{ TravellerLegs map[string]any }
	if err := json.Unmarshal([]byte(welcome["world"].(string)), &world); err != nil || !reflect.DeepEqual(leg, world.TravellerLegs["spawn"]) {
		t.Fatal("traveller journey and sightings not restored")
	}
	c.CloseNow()

}

func TestHarvestWithBrowserRules(t *testing.T) {
	e, err := newEngine()
	if err != nil {
		t.Fatal(err)
	}
	defer e.close()
	raw, err := e.call("validate", `{"t":"patch","seq":1,"patch":{"kind":"harvest","source":"-3,-3:0"}}`)
	if err != nil || raw == "null" {
		t.Fatalf("%s %v", raw, err)
	}
	archive, err := os.ReadFile("../save/testdata/world-v1.json")
	if err != nil {
		t.Fatal(err)
	}
	_, err = e.call("init", "migration", 7, 3, string(archive))
	if err != nil {
		t.Fatal(err)
	}
	hello, err := os.ReadFile("../save/testdata/hello.json")
	if err != nil {
		t.Fatal(err)
	}
	_, err = e.call("join", strings.Repeat("a", 64), string(hello), "")
	if err != nil {
		t.Fatal(err)
	}
	_, err = e.call("command", 1, `{"t":"move","p":[-298,5,-298],"v":[0,0,0],"yaw":0,"pitch":0,"f":1,"scene":{"kind":"wild"},"town":null}`)
	if err != nil {
		t.Fatal(err)
	}
	out, err := e.call("command", 1, raw)
	if err != nil || !strings.Contains(out, `"ok"`) {
		t.Fail()
	}
}
