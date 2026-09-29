package auth

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// Middleware is the gate. ValidateToken is already covered, including alg=none;
// what was untested is everything around it — how a token is found, when a
// request is let through without one, and the one place a token is allowed to
// travel in a URL.

// sentinel is the handler behind the gate. It records whether it was reached and
// what identity the request arrived with.
type sentinel struct {
	reached bool
	claims  *Claims
}

func (s *sentinel) handler() http.Handler {
	return http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		s.reached = true
		s.claims = UserFromContext(r.Context())
	})
}

// call runs a request through the middleware and reports the response plus
// whether the protected handler was reached.
func call(cfg Config, r *http.Request) (*httptest.ResponseRecorder, *sentinel) {
	s := &sentinel{}
	w := httptest.NewRecorder()
	Middleware(cfg)(s.handler()).ServeHTTP(w, r)
	return w, s
}

func token(t *testing.T, role string) string {
	t.Helper()
	tok, err := GenerateToken(testSecret, "u1", "u1@example.com", role)
	if err != nil {
		t.Fatalf("GenerateToken: %v", err)
	}
	return tok
}

// TestMiddleware_DisabledLetsEveryoneThroughAsAdmin pins the behaviour main.go
// warns about at startup: with AUTH_ENABLED unset, every request is served as a
// cluster admin. That is deliberate for a local or embedded deployment, but it is
// the single most consequential switch in the product, so it is written down as a
// test rather than left as an implementation detail.
func TestMiddleware_DisabledLetsEveryoneThroughAsAdmin(t *testing.T) {
	w, s := call(Config{Enabled: false}, httptest.NewRequest(http.MethodGet, "/api/v1/pods", nil))

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 with auth disabled", w.Code)
	}
	if !s.reached {
		t.Fatal("the request never reached the handler")
	}
	if s.claims == nil {
		t.Fatal("no claims in context — downstream authz would see no role at all")
	}
	if s.claims.Role != "admin" {
		t.Errorf("role = %q, want admin", s.claims.Role)
	}
	if s.claims.UserID != "anonymous" {
		t.Errorf("user = %q, want anonymous so the audit log does not invent a person", s.claims.UserID)
	}
}

// TestMiddleware_AcceptsAValidBearerToken, and carries the role through — authz
// reads it from the context, so losing it here would silently downgrade or
// upgrade every request.
func TestMiddleware_AcceptsAValidBearerToken(t *testing.T) {
	r := httptest.NewRequest(http.MethodGet, "/api/v1/pods", nil)
	r.Header.Set("Authorization", "Bearer "+token(t, "viewer"))

	w, s := call(Config{Enabled: true, JWTSecret: testSecret}, r)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", w.Code, w.Body.String())
	}
	if s.claims == nil || s.claims.Role != "viewer" {
		t.Errorf("claims = %+v, want the viewer role carried through", s.claims)
	}
}

// TestMiddleware_AcceptsALowercaseScheme: the scheme comparison is deliberately
// case-insensitive, since clients send "bearer" as well as "Bearer".
func TestMiddleware_AcceptsALowercaseScheme(t *testing.T) {
	r := httptest.NewRequest(http.MethodGet, "/api/v1/pods", nil)
	r.Header.Set("Authorization", "bearer "+token(t, "admin"))

	if w, s := call(Config{Enabled: true, JWTSecret: testSecret}, r); w.Code != http.StatusOK || !s.reached {
		t.Errorf("status = %d, reached = %v; a lowercase scheme should be accepted", w.Code, s.reached)
	}
}

// TestMiddleware_RejectsEveryBadCredential. Each case must 401 AND must not reach
// the handler — a gate that returns 401 after running the request has not gated
// anything.
func TestMiddleware_RejectsEveryBadCredential(t *testing.T) {
	valid := token(t, "admin")

	cases := []struct {
		name   string
		header string
	}{
		{"no header at all", ""},
		{"scheme with no token", "Bearer"},
		{"empty token after the scheme", "Bearer "},
		{"wrong scheme", "Basic " + valid},
		{"token with no scheme", valid},
		{"garbage token", "Bearer not-a-jwt"},
		{"token signed with another secret", "Bearer " + mustSign(t, "a-different-secret")},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodGet, "/api/v1/pods", nil)
			if c.header != "" {
				r.Header.Set("Authorization", c.header)
			}
			w, s := call(Config{Enabled: true, JWTSecret: testSecret}, r)
			if w.Code != http.StatusUnauthorized {
				t.Errorf("status = %d, want 401", w.Code)
			}
			if s.reached {
				t.Error("the request reached the handler despite being rejected")
			}
		})
	}
}

// TestMiddleware_WebSocketMayCarryTheTokenInTheQuery: browsers cannot set headers
// on a WebSocket handshake, so the upgrade path accepts ?token=. This is the one
// sanctioned place a credential travels in a URL.
func TestMiddleware_WebSocketMayCarryTheTokenInTheQuery(t *testing.T) {
	r := httptest.NewRequest(http.MethodGet, "/ws/exec?token="+token(t, "admin"), nil)
	r.Header.Set("Upgrade", "websocket")
	r.Header.Set("Connection", "Upgrade")

	w, s := call(Config{Enabled: true, JWTSecret: testSecret}, r)
	if w.Code != http.StatusOK || !s.reached {
		t.Fatalf("status = %d, reached = %v; a websocket upgrade should accept ?token=", w.Code, s.reached)
	}
	if s.claims == nil || s.claims.Role != "admin" {
		t.Errorf("claims = %+v, want the role from the query token", s.claims)
	}
}

// TestMiddleware_OrdinaryRequestsCannotUseTheQueryToken is the security property
// that makes the exception above acceptable.
//
// A URL-borne credential ends up in access logs, proxy logs, browser history and
// Referer headers. If the query-parameter path ever applied to ordinary requests,
// every client could — and eventually some would — authenticate that way, and the
// token would leak into all of those places. It must work ONLY for a genuine
// upgrade handshake.
func TestMiddleware_OrdinaryRequestsCannotUseTheQueryToken(t *testing.T) {
	valid := token(t, "admin")

	cases := []struct {
		name    string
		upgrade string
		conn    string
	}{
		{"plain request", "", ""},
		{"Upgrade header only", "websocket", ""},
		{"Connection header only", "", "Upgrade"},
		{"upgrade to something else", "h2c", "Upgrade"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodGet, "/api/v1/pods?token="+valid, nil)
			if c.upgrade != "" {
				r.Header.Set("Upgrade", c.upgrade)
			}
			if c.conn != "" {
				r.Header.Set("Connection", c.conn)
			}
			w, s := call(Config{Enabled: true, JWTSecret: testSecret}, r)
			if w.Code != http.StatusUnauthorized {
				t.Errorf("status = %d, want 401 — a query token must not authenticate a non-upgrade request", w.Code)
			}
			if s.reached {
				t.Error("a query token authenticated an ordinary request")
			}
		})
	}
}

// TestMiddleware_WebSocketStillNeedsAValidToken: the upgrade path is an exception
// for where the token is carried, not for whether it is checked.
func TestMiddleware_WebSocketStillNeedsAValidToken(t *testing.T) {
	for _, q := range []string{"", "?token=", "?token=garbage", "?token=" + mustSign(t, "wrong-secret")} {
		r := httptest.NewRequest(http.MethodGet, "/ws/exec"+q, nil)
		r.Header.Set("Upgrade", "websocket")
		r.Header.Set("Connection", "Upgrade")

		w, s := call(Config{Enabled: true, JWTSecret: testSecret}, r)
		if w.Code != http.StatusUnauthorized || s.reached {
			t.Errorf("query %q: status = %d, reached = %v; want 401 and no handler", q, w.Code, s.reached)
		}
	}
}

// TestIsWebSocketUpgrade requires BOTH headers, case-insensitively. Connection is
// often sent as "keep-alive, Upgrade", so it is matched as a substring.
func TestIsWebSocketUpgrade(t *testing.T) {
	cases := []struct {
		upgrade string
		conn    string
		want    bool
	}{
		{"websocket", "Upgrade", true},
		{"WebSocket", "upgrade", true},
		{"websocket", "keep-alive, Upgrade", true},
		{"websocket", "", false},
		{"", "Upgrade", false},
		{"h2c", "Upgrade", false},
		{"", "", false},
	}
	for _, c := range cases {
		r := httptest.NewRequest(http.MethodGet, "/ws", nil)
		if c.upgrade != "" {
			r.Header.Set("Upgrade", c.upgrade)
		}
		if c.conn != "" {
			r.Header.Set("Connection", c.conn)
		}
		if got := isWebSocketUpgrade(r); got != c.want {
			t.Errorf("isWebSocketUpgrade(Upgrade=%q, Connection=%q) = %v, want %v", c.upgrade, c.conn, got, c.want)
		}
	}
}

// TestUserFromContext_ReturnsNilWhenAbsent: callers dereference this, so it must
// not panic on a request that never went through the middleware.
func TestUserFromContext_ReturnsNilWhenAbsent(t *testing.T) {
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	if got := UserFromContext(r.Context()); got != nil {
		t.Errorf("UserFromContext on a bare context = %+v, want nil", got)
	}
}

// mustSign returns a well-formed token signed with the wrong secret.
func mustSign(t *testing.T, secret string) string {
	t.Helper()
	tok, err := GenerateToken(secret, "u1", "u1@example.com", "admin")
	if err != nil {
		t.Fatalf("GenerateToken: %v", err)
	}
	return tok
}
