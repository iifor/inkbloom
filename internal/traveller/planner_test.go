package traveller

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

const journey = `{"options":[{"kind":"infected","place":"c1_2","onward":true,"metres":30},{"kind":"bridge","place":"bridge:1","onward":false,"metres":12}],"memory":[{"kind":"infected","place":"c1_2","at":2},{"kind":"bridge","place":"bridge:1","at":1}]}`

func TestSinglePlayerContext(t *testing.T) {
	requests := 0
	model := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		if r.URL.Path != "/v1/chat/completions" || r.Header.Get("Authorization") != "Bearer test-key" {
			t.Error("unexpected upstream request")
		}
		var m struct {
			Model    string
			Messages []struct{ Role, Content string }
		}
		if err := json.NewDecoder(r.Body).Decode(&m); err != nil || m.Model != "test-model" || len(m.Messages) != 2 {
			t.Error("missing model or messages")
			return
		}
		var f facts
		if json.Unmarshal([]byte(m.Messages[1].Content), &f) != nil || !f.valid() || len(f.Memory) != 2 || f.Memory[0].Place != f.Options[0].Place {
			t.Error("missing village history or landmarks")
			return
		}
		w.Write([]byte(`{"choices":[{"message":{"content":"{\"stop\":1}"}}]}`))
	}))
	defer model.Close()
	p := New(model.URL+"/v1", "test-model", "test-key")
	call := func(body string) *httptest.ResponseRecorder {
		r := httptest.NewRequest("POST", "/api/traveller-plan", strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		p.ServeHTTP(w, r)
		return w
	}
	if w := call(strings.Replace(journey, "c1_2", "invented", 1)); w.Code != 400 {
		t.Fatal(w.Code)
	}
	if w := call(journey); w.Code != 200 || strings.TrimSpace(w.Body.String()) != `{"stop":1}` {
		t.Fatal(w.Code, w.Body.String())
	}
	if p.Choose(context.Background(), []byte(journey)) != nil || requests != 1 {
		t.Fatal("shared request budget")
	}
}
func TestInvalidOutputKeepsCurrentRoute(t *testing.T) {
	for _, reply := range []string{`{"stop":2}`, `{"stop":null}`, `{"stop":0.5}`, `new destination`} {
		model := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"message": map[string]string{"content": reply}}}})
		}))
		if New(model.URL, "model", "").Choose(context.Background(), []byte(journey)) != nil {
			t.Errorf("accepted %s", reply)
		}
		model.Close()
	}
}
