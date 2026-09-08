package api

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/straightarctech/skyvirt-kubeui/internal/auth"
)

func TestIsMutating(t *testing.T) {
	cases := []struct {
		method, path string
		want         bool
	}{
		{http.MethodGet, "/api/v1/pods", false},
		{http.MethodHead, "/api/v1/pods", false},
		{http.MethodPost, "/api/v1/namespaces/x/pods", true},
		{http.MethodPut, "/api/v1/resources/ConfigMap/x", true},
		{http.MethodDelete, "/api/v1/x", true},
		{http.MethodGet, "/api/v1/namespaces/x/pods/y/exec", true}, // exec spawns a shell
	}
	for _, c := range cases {
		r := httptest.NewRequest(c.method, c.path, nil)
		if got := isMutating(r); got != c.want {
			t.Errorf("isMutating(%s %s) = %v, want %v", c.method, c.path, got, c.want)
		}
	}
}

func TestIsRawSecretRead(t *testing.T) {
	cases := []struct {
		method, path string
		want         bool
	}{
		{http.MethodGet, "/api/v1/resources/Secret/namespaces/x/y", true},
		{http.MethodGet, "/api/v1/resources/secret/x", true},   // case-insensitive
		{http.MethodGet, "/api/v1/resources/secrets/x", true},  // plural
		{http.MethodGet, "/api/v1/resources/ConfigMap/x", false},
		{http.MethodGet, "/api/v1/secrets", false},             // dedicated (redacted) endpoint
		{http.MethodGet, "/api/v1/namespaces/x/secrets/y", false},
		{http.MethodPost, "/api/v1/resources/Secret/x", false}, // not a GET
	}
	for _, c := range cases {
		r := httptest.NewRequest(c.method, c.path, nil)
		if got := isRawSecretRead(r); got != c.want {
			t.Errorf("isRawSecretRead(%s %s) = %v, want %v", c.method, c.path, got, c.want)
		}
	}
}

// chain wires auth.Middleware (real token verification) in front of
// AuthzMiddleware, then a sentinel handler that returns 200 when reached.
func chain(t *testing.T, readOnly bool) http.Handler {
	t.Helper()
	authCfg := auth.Config{Enabled: true, JWTSecret: "s"}
	authzCfg := AuthzConfig{ReadOnly: readOnly, WriteRoles: ParseWriteRoles("")}
	final := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	return auth.Middleware(authCfg)(AuthzMiddleware(authzCfg)(final))
}

func do(t *testing.T, h http.Handler, method, path, role string) int {
	t.Helper()
	tok, err := auth.GenerateToken("s", "u", "", role)
	if err != nil {
		t.Fatal(err)
	}
	r := httptest.NewRequest(method, path, nil)
	r.Header.Set("Authorization", "Bearer "+tok)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w.Code
}

func TestAuthzMiddleware_Roles(t *testing.T) {
	h := chain(t, false)

	if code := do(t, h, http.MethodGet, "/api/v1/pods", "viewer"); code != http.StatusOK {
		t.Errorf("viewer read: got %d, want 200", code)
	}
	if code := do(t, h, http.MethodPost, "/api/v1/namespaces/x/pods", "viewer"); code != http.StatusForbidden {
		t.Errorf("viewer write: got %d, want 403", code)
	}
	if code := do(t, h, http.MethodPost, "/api/v1/namespaces/x/pods", "admin"); code != http.StatusOK {
		t.Errorf("admin write: got %d, want 200", code)
	}
	if code := do(t, h, http.MethodPost, "/api/v1/namespaces/x/pods", "operator"); code != http.StatusOK {
		t.Errorf("operator write: got %d, want 200", code)
	}
}

func TestAuthzMiddleware_ReadOnly(t *testing.T) {
	h := chain(t, true)
	if code := do(t, h, http.MethodGet, "/api/v1/pods", "admin"); code != http.StatusOK {
		t.Errorf("read in read-only mode: got %d, want 200", code)
	}
	if code := do(t, h, http.MethodPost, "/api/v1/namespaces/x/pods", "admin"); code != http.StatusForbidden {
		t.Errorf("admin write in read-only mode: got %d, want 403", code)
	}
}

// TestAuthzMiddleware_RawSecretGate is the regression guard for the secret
// read-exposure fix: only write roles may read raw Secret manifests.
func TestAuthzMiddleware_RawSecretGate(t *testing.T) {
	h := chain(t, false)
	secretPath := "/api/v1/resources/Secret/namespaces/x/y"

	if code := do(t, h, http.MethodGet, secretPath, "viewer"); code != http.StatusForbidden {
		t.Errorf("viewer raw-secret read: got %d, want 403", code)
	}
	if code := do(t, h, http.MethodGet, secretPath, "admin"); code != http.StatusOK {
		t.Errorf("admin raw-secret read: got %d, want 200", code)
	}
	// A non-secret read stays open to viewers.
	if code := do(t, h, http.MethodGet, "/api/v1/resources/ConfigMap/namespaces/x/y", "viewer"); code != http.StatusOK {
		t.Errorf("viewer configmap read: got %d, want 200", code)
	}
}
