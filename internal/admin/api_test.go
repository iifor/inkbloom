package admin

import (
	"database/sql"
	"encoding/json"
	"inkbloom/internal/traveller"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"strings"
	"testing"

	_ "github.com/jackc/pgx/v5/stdlib"
)

func TestAdminSession(t *testing.T) {
	dsn := os.Getenv("INKBLOOM_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("requires a test database")
	}
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	_, err = db.Exec("CREATE TEMP TABLE admin_accounts(name text PRIMARY KEY); CREATE TEMP TABLE admin_sessions(token_hash bytea PRIMARY KEY,account text,csrf text,expires_at timestamptz)")
	if err != nil {
		t.Fatal(err)
	}
	schema, err := os.ReadFile("../save/migrations/003_traveller_traces.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec("SET search_path=pg_temp"); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(string(schema)); err != nil {
		t.Fatal(err)
	}
	api := API{DB: func() *sql.DB { return db }, User: "operator", Password: "test-password"}
	var cookie *http.Cookie
	request := func(method, path, body, csrf string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, "/api/admin/v1/"+path, strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("X-CSRF-Token", csrf)
		if cookie != nil {
			r.AddCookie(cookie)
		}
		w := httptest.NewRecorder()
		api.ServeHTTP(w, r)
		return w
	}
	if request("GET", "traces", "", "").Code != 401 {
		t.Fatal("anonymous traces accessible")
	}
	if request("POST", "login", `{"user":"operator","password":"invalid"}`, "").Code != 401 {
		t.Fatal("accepted invalid password")
	}
	login := request("POST", "login", `{"user":"operator","password":"test-password"}`, "")
	if login.Code != 200 {
		t.Fatal(login.Code)
	}
	cookie = login.Result().Cookies()[0]
	var session struct{ CSRF string }
	if err = json.Unmarshal(login.Body.Bytes(), &session); err != nil || session.CSRF == "" || !cookie.HttpOnly {
		t.Fatal("invalid session")
	}
	if request("POST", "logout", "{}", "wrong").Code != 403 {
		t.Fatal("accepted invalid CSRF")
	}
	if request("GET", "traces", "", "").Code != 200 {
		t.Fatal("session not recognized")
	}
	// Produce a real single-player trace, then replace all model-side state.
	const input = `{"world":"sample","trail":"spawn","options":[{"kind":"bridge","place":"bridge:0","metres":10,"onward":true}],"memory":[{"place":"spawn","kind":"spawn","at":1}]}`
	calls := make(chan string, 2)
	model := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		calls <- string(body)
		io.WriteString(w, `{"choices":[{"message":{"content":"{\"stop\":0}"}}]}`)
	}))
	defer model.Close()
	first := traveller.New(model.URL, "test", "")
	first.UseDatabase(db)
	req := httptest.NewRequest("POST", "/api/traveller-plan", strings.NewReader(input))
	req.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	first.ServeHTTP(response, req)
	if response.Code != 200 {
		t.Fatal(response.Code)
	}
	var list []traveller.Trace
	if err := json.Unmarshal(request("GET", "traces", "", "").Body.Bytes(), &list); err != nil || len(list) != 1 || string(list[0].Input) != "null" {
		t.Fatal("persisted summary", list, err)
	}
	original := list[0].ID
	var saved traveller.Trace
	if err := json.Unmarshal(request("GET", "traces/"+original, "", "").Body.Bytes(), &saved); err != nil || saved.World != "sample" || saved.Applied == "" || saved.Stop == nil {
		t.Fatal("detail unavailable without model", saved, err)
	}
	api.Planner = traveller.New(model.URL, "test", "")
	api.Planner.UseDatabase(db)
	replay := request("POST", "replay", `{"target":"`+original+`"}`, session.CSRF)
	if replay.Code != 200 {
		t.Fatal("historical replay", replay.Code, replay.Body.String())
	}
	if <-calls != <-calls {
		t.Fatal("model request changed on replay")
	}
	api.Planner = nil
	list = nil
	if err := json.Unmarshal(request("GET", "traces?mode=调试", "", "").Body.Bytes(), &list); err != nil || len(list) != 1 || list[0].Parent != original {
		t.Fatal("debug record lost after restart", list, err)
	}
	var child traveller.Trace
	if err := json.Unmarshal(request("GET", "traces/"+list[0].ID, "", "").Body.Bytes(), &child); err != nil || !reflect.DeepEqual(child.Input, saved.Input) || child.Prompt != saved.Prompt {
		t.Fatal("debug context mismatch")
	}
	// The oldest entry remains selectable outside the first page.
	if _, err = db.Exec(`INSERT INTO traveller_traces(id,mode,record) SELECT 'history-'||i, mode, record||jsonb_build_object('ID','history-'||i) FROM traveller_traces CROSS JOIN generate_series(1,55) i WHERE id=$1`, original); err != nil {
		t.Fatal(err)
	}
	page := request("GET", "traces?mode=单机", "", "")
	cursor := page.Header().Get("X-Next-Cursor")
	if cursor == "" || json.Unmarshal(page.Body.Bytes(), &list) != nil || len(list) != 50 {
		t.Fatal("missing next page")
	}
	page = request("GET", "traces?mode=单机&before="+cursor, "", "")
	if json.Unmarshal(page.Body.Bytes(), &list) != nil || len(list) != 6 || list[5].ID != original || page.Header().Get("X-Next-Cursor") != "" {
		t.Fatal("oldest trace missing")
	}
	if request("POST", "logout", "{}", session.CSRF).Code != 204 || request("GET", "traces", "", "").Code != 401 {
		t.Fatal("logout did not revoke session")
	}
}
