package save

import (
	"encoding/json"
	"os"
	"testing"
)

func TestSupportedSaveVersions(t *testing.T) {
	for _, version := range []int{9, 10, 11, 12, 13, 14} {
		world, _ := json.Marshal(map[string]any{"id": "version-check", "version": version})
		personal, _ := json.Marshal(map[string]any{"id": "player", "version": version})
		data, _ := json.Marshal(legacySave{V: 1, World: string(world), Players: map[string]legacyPlayer{
			"player-key": {Name: "player", Look: json.RawMessage(`{"character":"courier"}`), Slice: string(personal)},
		}})
		_, _, err := decode(data)
		if supported := version >= 10 && version <= 13; supported != (err == nil) {
			t.Fatalf("version %d: unexpected result %v", version, err)
		}
	}
}

func TestLegacyFixture(t *testing.T) {
	data, err := os.ReadFile("testdata/world-v1.json")
	if err != nil {
		t.Fatal(err)
	}
	old, h, err := decode(data)
	if err != nil || h.ID != "migration" || len(old.Players) != 2 || old.Players["fixture-one"].Name != "甲" {
		t.Fatalf("unexpected decoded fixture: header=%+v players=%d error=%v", h, len(old.Players), err)
	}
}
