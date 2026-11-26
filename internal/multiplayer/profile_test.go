package multiplayer

import (
	"encoding/json"
	"strings"
	"testing"
)

// Exercise the embedded rules shipped by the Go server, without touching a live database.
func TestProfileWithBrowserRules(t *testing.T) {
	e, err := newEngine()
	if err != nil {
		t.Fatal(err)
	}
	defer e.close()
	call := func(name string, args ...any) string {
		t.Helper()
		out, err := e.call(name, args...)
		if err != nil {
			t.Fatal(err)
		}
		return out
	}
	call("init", "profile-test", 7, 3, "")
	hello := `{"name":"before","look":{"character":"courier","skin":0,"hair":1,"accent":5}}`
	call("join", strings.Repeat("a", 64), hello, "")
	call("join", strings.Repeat("b", 64), hello, "")
	raw := call("validate", `{"t":"profile","id":2,"name":"after","look":{"character":"ranger","skin":1,"hair":2,"accent":3}}`)
	var deliveries []struct {
		IDs     []int `json:"ids"`
		Message struct {
			Type   string `json:"t"`
			Player struct {
				ID   int    `json:"id"`
				Name string `json:"name"`
				Look struct {
					Character string `json:"character"`
				} `json:"look"`
			} `json:"player"`
		} `json:"message"`
	}
	if err := json.Unmarshal([]byte(call("command", 1, raw)), &deliveries); err != nil {
		t.Fatal(err)
	}
	if len(deliveries) != 1 || len(deliveries[0].IDs) != 1 || deliveries[0].IDs[0] != 2 {
		t.Fatalf("unexpected recipients: %+v", deliveries)
	}
	m := deliveries[0].Message
	if m.Type != "profile" || m.Player.ID != 1 || m.Player.Name != "after" || m.Player.Look.Character != "ranger" {
		t.Fatalf("unexpected profile: %+v", m)
	}
	if out := call("command", 1, raw); out != "[]" {
		t.Fatalf("unchanged profile was rebroadcast: %s", out)
	}
	var arrival struct {
		Welcome struct {
			Players []struct {
				ID   int    `json:"id"`
				Name string `json:"name"`
				Look struct {
					Character string `json:"character"`
				} `json:"look"`
			} `json:"players"`
		} `json:"welcome"`
	}
	if err := json.Unmarshal([]byte(call("join", strings.Repeat("c", 64), hello, "")), &arrival); err != nil {
		t.Fatal(err)
	}
	if len(arrival.Welcome.Players) != 2 || arrival.Welcome.Players[0].Name != "after" || arrival.Welcome.Players[0].Look.Character != "ranger" {
		t.Fatalf("late arrival saw old profile: %+v", arrival)
	}
	if raw := call("validate", `{"t":"profile","name":"bad","look":{"character":"missing"}}`); raw != "null" {
		t.Fatalf("invalid look accepted: %s", raw)
	}
}
