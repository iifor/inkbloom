package main

import (
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestFrontend(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "index.html"), []byte("inkbloom"), 0600); err != nil {
		t.Fatal(err)
	}
	handler, err := frontend(dir)
	if err != nil {
		t.Fatal(err)
	}
	for path, status := range map[string]int{"/?world=test": 200, "/multiplayer": 404, "/missing.png": 404} {
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, httptest.NewRequest("GET", path, nil))
		if w.Code != status {
			t.Errorf("%s: got %d, want %d", path, w.Code, status)
		}
		if status == 200 && w.Body.String() != "inkbloom" {
			t.Errorf("unexpected entry body %q", w.Body)
		}
	}
}
