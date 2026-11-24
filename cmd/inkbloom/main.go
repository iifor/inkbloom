// Command inkbloom serves the browser game from a built frontend directory.
package main

import (
	"context"
	"database/sql"
	"errors"
	"flag"
	"fmt"
	_ "github.com/jackc/pgx/v5/stdlib"
	"inkbloom/internal/admin"
	"inkbloom/internal/multiplayer"
	"inkbloom/internal/traveller"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"sync/atomic"
	"syscall"
	"time"
)

func frontend(dir string) (http.Handler, error) {
	root, err := os.OpenRoot(dir)
	if err != nil {
		return nil, err
	}
	files := root.FS()
	if info, err := fs.Stat(files, "index.html"); err != nil || !info.Mode().IsRegular() {
		root.Close()
		return nil, fmt.Errorf("frontend entry missing in %s", dir)
	}
	static := http.FileServerFS(files)
	mux := http.NewServeMux()
	mux.HandleFunc("GET /", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/admin" || r.URL.Path == "/admin/" {
			http.ServeFileFS(w, r, files, "admin/index.html")
			return
		}
		if r.URL.Path != "/" {
			info, err := fs.Stat(files, r.URL.Path[1:])
			if err != nil || !info.Mode().IsRegular() {
				http.NotFound(w, r)
				return
			}
		}
		static.ServeHTTP(w, r)
	})
	return mux, nil
}

func main() {
	addr := flag.String("listen", "127.0.0.1:5195", "HTTP listen address")
	dir := flag.String("assets", "dist", "built frontend directory")
	world := flag.String("world", "default", "persistent world ID")
	maxPlayers := flag.Int("max", 10, "players per room (1..32)")
	flag.Parse()
	handler, err := frontend(*dir)
	if err != nil {
		log.Fatal(err)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	var live atomic.Pointer[multiplayer.Server]
	mux := http.NewServeMux()
	serveSocket := func(w http.ResponseWriter, r *http.Request) {
		if s := live.Load(); s != nil {
			s.ServeHTTP(w, r)
			return
		}
		http.Error(w, "联机服务暂不可用", http.StatusServiceUnavailable)
	}
	planner := traveller.New(os.Getenv("INKBLOOM_AI_BASE_URL"), os.Getenv("INKBLOOM_AI_MODEL"), os.Getenv("INKBLOOM_AI_API_KEY"))
	var db *sql.DB
	if dsn := os.Getenv("DATABASE_URL"); dsn != "" {
		db, err = sql.Open("pgx", dsn)
		if err != nil {
			log.Fatal("invalid database configuration")
		}
		defer db.Close()
		if planner != nil {
			planner.UseDatabase(db)
		}
	}
	user := os.Getenv("INKBLOOM_ADMIN_USER")
	if user == "" {
		user = "admin"
	}
	mux.Handle("/api/admin/v1/", admin.API{DB: func() *sql.DB { return db }, Live: live.Load, Planner: planner, User: user, Password: os.Getenv("INKBLOOM_ADMIN_PASSWORD")})
	mux.Handle("/api/traveller-plan", planner)
	mux.HandleFunc("/multiplayer", serveSocket)
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/" && strings.EqualFold(r.Header.Get("Upgrade"), "websocket") {
			serveSocket(w, r)
			return
		}
		handler.ServeHTTP(w, r)
	})
	listener, err := net.Listen("tcp", *addr)
	if err != nil {
		log.Fatal(err)
	}
	var done = make(chan struct{})
	go func() {
		defer close(done)
		if db == nil {
			return
		}
		for ctx.Err() == nil {
			attempt, cancel := context.WithTimeout(ctx, 8*time.Second)
			s, err := multiplayer.New(attempt, db, *world, os.Getenv("INKBLOOM_PASSWORD"), *maxPlayers, planner)
			cancel()
			if err == nil {
				live.Store(s)
				log.Printf("multiplayer ready: %s", *world)
				<-ctx.Done()
				live.Store(nil)
				if err = s.Close(); err != nil {
					log.Printf("final save: %v", err)
				}
				return
			}
			log.Printf("multiplayer unavailable: %v", err)
			select {
			case <-ctx.Done():
				return
			case <-time.After(5 * time.Second):
			}
		}
	}()
	server := http.Server{Addr: *addr, Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	drained := make(chan struct{})
	go func() {
		defer close(drained)
		<-ctx.Done()
		deadline, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		if err := server.Shutdown(deadline); err != nil {
			server.Close()
		}
	}()
	log.Printf("serving %s at %s", *dir, *addr)
	err = server.Serve(listener)
	stop()
	<-done
	<-drained
	if !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}
