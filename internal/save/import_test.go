package save

import (
	"os"
	"testing"
)

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
