package api

import (
	"net/http"
	"strings"

	"github.com/straightarctech/skyvirt-kubeui/internal/auth"
)

// AuthzConfig controls write authorization for the API.
type AuthzConfig struct {
	// ReadOnly disables every mutating endpoint (and pod exec) regardless of role.
	ReadOnly bool
	// WriteRoles is the set of lowercase role names allowed to mutate resources.
	WriteRoles map[string]struct{}
}

// ParseWriteRoles builds the write-role set from a comma-separated env value.
// Empty input yields the default of "admin,operator".
func ParseWriteRoles(s string) map[string]struct{} {
	if strings.TrimSpace(s) == "" {
		s = "admin,operator"
	}
	roles := make(map[string]struct{})
	for _, r := range strings.Split(s, ",") {
		if r = strings.ToLower(strings.TrimSpace(r)); r != "" {
			roles[r] = struct{}{}
		}
	}
	return roles
}

// isMutating reports whether the request can change cluster state.
// Pod exec upgrades over GET but spawns a shell, so it counts as mutating.
func isMutating(r *http.Request) bool {
	switch r.Method {
	case http.MethodGet, http.MethodHead, http.MethodOptions:
		return strings.HasSuffix(r.URL.Path, "/exec")
	default:
		return true
	}
}

// isRawSecretRead reports whether the request reads a raw Secret manifest via
// the generic resource getter (/resources/{kind}/...). That path returns the
// object verbatim — including the base64 `data` — unlike the dedicated /secrets
// endpoint, which redacts values. Gating it to write roles keeps read-only
// users from dumping secret values.
func isRawSecretRead(r *http.Request) bool {
	if r.Method != http.MethodGet {
		return false
	}
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	for i := 0; i+1 < len(parts); i++ {
		if parts[i] == "resources" {
			k := strings.ToLower(parts[i+1])
			return k == "secret" || k == "secrets"
		}
	}
	return false
}

// hasWriteRole reports whether the request's identity is in the write-role set.
func hasWriteRole(cfg AuthzConfig, r *http.Request) bool {
	claims := auth.UserFromContext(r.Context())
	role := ""
	if claims != nil {
		role = strings.ToLower(claims.Role)
	}
	_, ok := cfg.WriteRoles[role]
	return ok
}

// AuthzMiddleware enforces read-only mode and role-based write access on API
// routes. It must run after auth.Middleware so user claims are in context.
func AuthzMiddleware(cfg AuthzConfig) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !isMutating(r) {
				// Reads are open — except raw Secret values, which require the
				// same privilege as editing a secret. Read-only users get the
				// redacted /secrets endpoint instead.
				if isRawSecretRead(r) && !hasWriteRole(cfg, r) {
					writeError(w, http.StatusForbidden, "reading raw Secret data requires write access")
					return
				}
				next.ServeHTTP(w, r)
				return
			}
			if cfg.ReadOnly {
				writeError(w, http.StatusForbidden, "read-only mode: create/edit/delete operations are disabled")
				return
			}
			if !hasWriteRole(cfg, r) {
				writeError(w, http.StatusForbidden, "insufficient role: write access is restricted")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
