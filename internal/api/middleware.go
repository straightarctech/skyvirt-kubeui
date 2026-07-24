package api

import (
	"bufio"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	apierrors "k8s.io/apimachinery/pkg/api/errors"

	"go.uber.org/zap"
)

// RequestLogger returns a chi-compatible middleware that logs each HTTP request.
func RequestLogger(logger *zap.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			ww := &statusWriter{ResponseWriter: w, status: http.StatusOK}
			next.ServeHTTP(ww, r)
			logger.Info("http request",
				zap.String("method", r.Method),
				zap.String("path", r.URL.Path),
				zap.Int("status", ww.status),
				zap.Duration("duration", time.Since(start)),
				zap.String("remote", r.RemoteAddr),
			)
		})
	}
}

// statusWriter wraps http.ResponseWriter to capture the status code.
type statusWriter struct {
	http.ResponseWriter
	status int
}

func (w *statusWriter) WriteHeader(code int) {
	w.status = code
	w.ResponseWriter.WriteHeader(code)
}

// Hijack lets WebSocket upgrades (pod exec) work through the logging wrapper —
// gorilla type-asserts http.Hijacker directly and fails the handshake with a
// 500 otherwise.
func (w *statusWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	hj, ok := w.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, fmt.Errorf("underlying ResponseWriter does not support hijacking")
	}
	return hj.Hijack()
}

func (w *statusWriter) Flush() {
	if f, ok := w.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

// originAllowed reports whether the request Origin may access the API.
// With CORS_ORIGINS set, only the listed origins are allowed; otherwise only
// the request's own host (same-origin) is — arbitrary origins are never
// reflected.
func originAllowed(origin string, r *http.Request) bool {
	allowed := os.Getenv("CORS_ORIGINS") // e.g. "https://kubeui.example.com,https://admin.example.com"
	if allowed != "" {
		for _, o := range strings.Split(allowed, ",") {
			if strings.TrimSpace(o) == origin {
				return true
			}
		}
		return false
	}
	// No allowlist configured — same-host only.
	if u, err := url.Parse(origin); err == nil && u.Host == r.Host {
		return true
	}
	return false
}

// CORSMiddleware adds CORS headers. Set CORS_ORIGINS env to allow cross-origin
// callers (comma-separated). Unset means same-origin only.
func CORSMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" && originAllowed(origin, r) {
			w.Header().Set("Access-Control-Allow-Origin", origin)
		}
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With")
		w.Header().Set("Access-Control-Max-Age", "86400")
		w.Header().Set("Vary", "Origin")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// IsAllowedOrigin checks if a WebSocket origin is permitted. Same policy as
// CORS: explicit allowlist when CORS_ORIGINS is set, else same-host only.
func IsAllowedOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true // non-browser client
	}
	return originAllowed(origin, r)
}

// writeJSON serialises data as JSON and writes it with the given status code.
func writeJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if data != nil {
		_ = json.NewEncoder(w).Encode(data)
	}
}

// writeError writes a JSON error response.
func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

// writeK8sError maps a Kubernetes API error to the closest HTTP status so
// clients (and monitoring) can distinguish a client mistake — not-found,
// conflict, bad request — from a genuine server fault, instead of a blanket 500.
func writeK8sError(w http.ResponseWriter, err error) {
	switch {
	case apierrors.IsNotFound(err):
		writeError(w, http.StatusNotFound, err.Error())
	case apierrors.IsAlreadyExists(err), apierrors.IsConflict(err):
		writeError(w, http.StatusConflict, err.Error())
	case apierrors.IsBadRequest(err), apierrors.IsInvalid(err):
		writeError(w, http.StatusBadRequest, err.Error())
	case apierrors.IsForbidden(err):
		writeError(w, http.StatusForbidden, err.Error())
	case apierrors.IsUnauthorized(err):
		writeError(w, http.StatusUnauthorized, err.Error())
	default:
		writeError(w, http.StatusInternalServerError, err.Error())
	}
}
