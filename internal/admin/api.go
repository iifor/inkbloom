// Package admin exposes same-origin operator endpoints for the game process.
package admin

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"inkbloom/internal/multiplayer"
	"inkbloom/internal/traveller"
)

type API struct {
	DB             func() *sql.DB
	Live           func() *multiplayer.Server
	Planner        *traveller.Planner
	User, Password string
}

func secret() string { var b [32]byte; rand.Read(b[:]); return hex.EncodeToString(b[:]) }
func equal(a, b string) bool {
	x, y := sha256.Sum256([]byte(a)), sha256.Sum256([]byte(b))
	return subtle.ConstantTimeCompare(x[:], y[:]) == 1
}
func respond(w http.ResponseWriter, value any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(value)
}

var uuid = regexp.MustCompile(`^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$`)

func (a API) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	path := strings.TrimPrefix(r.URL.Path, "/api/admin/v1/")
	if r.Method != http.MethodGet && r.Method != http.MethodPost {
		w.WriteHeader(405)
		return
	}
	if r.Method == "POST" {
		origin := r.Header.Get("Origin")
		if origin != "" {
			u, err := url.Parse(origin)
			if err != nil || !strings.EqualFold(u.Host, r.Host) {
				w.WriteHeader(403)
				return
			}
		}
		if r.Header.Get("Sec-Fetch-Site") == "cross-site" || r.Header.Get("Content-Type") != "application/json" {
			w.WriteHeader(403)
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, 8192)
	}
	db := a.DB()
	if db == nil || a.Password == "" {
		http.Error(w, "管理服务未就绪，请检查数据库与管理员配置", 503)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	if path == "login" && r.Method == "POST" {
		var creds struct{ User, Password string }
		if json.NewDecoder(r.Body).Decode(&creds) != nil || !equal(creds.Password, a.Password) || !equal(creds.User, a.User) {
			http.Error(w, "账号或密码错误", 401)
			return
		}
		token, csrf := secret(), secret()
		digest := sha256.Sum256([]byte(token))
		tx, err := db.BeginTx(ctx, nil)
		if err == nil {
			defer tx.Rollback()
			_, err = tx.ExecContext(ctx, "INSERT INTO admin_accounts(name) VALUES($1) ON CONFLICT DO NOTHING", a.User)
			if err == nil {
				_, err = tx.ExecContext(ctx, "DELETE FROM admin_sessions WHERE expires_at<=now()")
			}
			if err == nil {
				_, err = tx.ExecContext(ctx, "INSERT INTO admin_sessions VALUES($1,$2,$3,now()+interval '8 hours')", digest[:], a.User, csrf)
			}
			if err == nil {
				err = tx.Commit()
			}
		}
		if err != nil {
			http.Error(w, "无法建立会话，请检查管理数据库迁移", 503)
			return
		}
		http.SetCookie(w, &http.Cookie{Name: "ink_admin", Value: token, Path: "/api/admin/v1/", HttpOnly: true, Secure: r.TLS != nil, SameSite: http.SameSiteStrictMode, MaxAge: 28800})
		respond(w, map[string]string{"csrf": csrf})
		return
	}
	cookie, err := r.Cookie("ink_admin")
	if err != nil {
		w.WriteHeader(401)
		return
	}
	digest := sha256.Sum256([]byte(cookie.Value))
	var user, csrf string
	err = db.QueryRowContext(ctx, "SELECT account,csrf FROM admin_sessions WHERE token_hash=$1 AND expires_at>now()", digest[:]).Scan(&user, &csrf)
	if errors.Is(err, sql.ErrNoRows) {
		w.WriteHeader(401)
		return
	}
	if err != nil {
		w.WriteHeader(503)
		return
	}
	if r.Method == "POST" && !equal(r.Header.Get("X-CSRF-Token"), csrf) {
		w.WriteHeader(403)
		return
	}
	if r.Method == "GET" {
		switch path {
		case "session":
			respond(w, map[string]string{"user": user, "csrf": csrf})
		case "overview":
			s := a.Live()
			if s == nil {
				w.WriteHeader(503)
				return
			}
			out, err := s.Overview(ctx)
			if err != nil {
				http.Error(w, "读取存档失败，请检查数据库迁移", 503)
				return
			}
			respond(w, out)
		case "traces":
			before := int64(0)
			if raw := r.URL.Query().Get("before"); raw != "" {
				var err error
				before, err = strconv.ParseInt(raw, 10, 64)
				if err != nil || before < 0 {
					w.WriteHeader(400)
					return
				}
			}
			records, next, err := traveller.ListTraces(ctx, db, r.URL.Query().Get("mode"), before)
			if err != nil {
				http.Error(w, "无法读取调用历史，请检查数据库及 003 迁移", 503)
				return
			}
			if next != 0 {
				w.Header().Set("X-Next-Cursor", strconv.FormatInt(next, 10))
			}
			respond(w, records)
		default:
			if id, ok := strings.CutPrefix(path, "traces/"); ok {
				record, err := traveller.ReadTrace(ctx, db, id)
				if err == nil {
					respond(w, record)
					return
				}
				if !errors.Is(err, sql.ErrNoRows) {
					http.Error(w, "读取调用详情失败", 503)
					return
				}
			}
			w.WriteHeader(404)
		}
		return
	}
	if path == "logout" {
		_, err = db.ExecContext(ctx, "DELETE FROM admin_sessions WHERE token_hash=$1", digest[:])
		if err != nil {
			w.WriteHeader(503)
			return
		}
		w.WriteHeader(204)
		return
	}
	var in struct {
		ID, Target string
		Closed     *bool
	}
	if json.NewDecoder(r.Body).Decode(&in) != nil {
		w.WriteHeader(400)
		return
	}
	if path == "replay" {
		if a.Planner == nil {
			http.Error(w, "当前未配置模型，无法重新调试", 503)
			return
		}
		record, err := traveller.ReadTrace(ctx, db, in.Target)
		if errors.Is(err, sql.ErrNoRows) {
			w.WriteHeader(404)
			return
		}
		if err != nil {
			http.Error(w, "读取原调用失败", 503)
			return
		}
		id, err := a.Planner.Replay(ctx, record)
		if err != nil {
			http.Error(w, "无法完成调试记录，请检查原调用及数据库", 503)
			return
		}
		respond(w, map[string]string{"id": id})
		return
	}
	if !uuid.MatchString(in.ID) || in.Target == "" {
		w.WriteHeader(400)
		return
	}
	s := a.Live()
	if s == nil {
		w.WriteHeader(503)
		return
	}
	switch path {
	case "admission":
		if in.Closed == nil {
			w.WriteHeader(400)
			return
		}
		err = s.Admission(ctx, in.ID, user, in.Target, *in.Closed)
	case "backup":
		err = s.Backup(ctx, in.ID, user, in.Target)
	default:
		w.WriteHeader(404)
		return
	}
	if errors.Is(err, multiplayer.ErrTarget) {
		http.Error(w, "目标已失效或操作编号冲突", 409)
		return
	}
	if err != nil {
		http.Error(w, "操作失败，请检查数据库", 503)
		return
	}
	respond(w, map[string]string{"id": in.ID})
}
