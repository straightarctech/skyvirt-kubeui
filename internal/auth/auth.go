package auth

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

type contextKey string

const userContextKey contextKey = "user"

// Claims represents JWT token claims.
// Fields match the engine's JWT format: uid, tid, role (with sub = user ID).
type Claims struct {
	UserID   string `json:"uid"`
	TenantID string `json:"tid"`
	Role     string `json:"role"`
	Email    string `json:"email,omitempty"`
	jwt.RegisteredClaims
}

// Config holds authentication configuration.
type Config struct {
	JWTSecret string
	Enabled   bool
}

// GenerateToken creates a JWT token for the given user.
func GenerateToken(secret, userID, email, role string) (string, error) {
	claims := &Claims{
		UserID: userID,
		Email:  email,
		Role:   role,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(24 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			Issuer:    "skyvirthci-kubeui",
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(secret))
}

// ValidateToken parses and validates a JWT token.
func ValidateToken(secret, tokenStr string) (*Claims, error) {
	token, err := jwt.ParseWithClaims(tokenStr, &Claims{}, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return []byte(secret), nil
	})
	if err != nil {
		return nil, err
	}
	claims, ok := token.Claims.(*Claims)
	if !ok || !token.Valid {
		return nil, fmt.Errorf("invalid token claims")
	}
	return claims, nil
}

// Middleware returns an HTTP middleware that validates JWT tokens.
// When auth is disabled, it passes requests through with a default user context.
func Middleware(cfg Config) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !cfg.Enabled {
				// Auth disabled — set default context and pass through.
				ctx := context.WithValue(r.Context(), userContextKey, &Claims{
					UserID: "anonymous",
					Email:  "anonymous@local",
					Role:   "admin",
				})
				next.ServeHTTP(w, r.WithContext(ctx))
				return
			}

			tokenStr := ""
			authHeader := r.Header.Get("Authorization")
			switch {
			case authHeader != "":
				parts := strings.SplitN(authHeader, " ", 2)
				if len(parts) != 2 || strings.ToLower(parts[0]) != "bearer" {
					http.Error(w, `{"error":"invalid authorization header"}`, http.StatusUnauthorized)
					return
				}
				tokenStr = parts[1]
			case isWebSocketUpgrade(r):
				// Browsers cannot set headers on WebSocket connections, so
				// upgrade requests may carry the token as a query parameter.
				tokenStr = r.URL.Query().Get("token")
			}
			if tokenStr == "" {
				http.Error(w, `{"error":"missing authorization"}`, http.StatusUnauthorized)
				return
			}

			claims, err := ValidateToken(cfg.JWTSecret, tokenStr)
			if err != nil {
				http.Error(w, `{"error":"invalid token"}`, http.StatusUnauthorized)
				return
			}

			ctx := context.WithValue(r.Context(), userContextKey, claims)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// isWebSocketUpgrade reports whether the request is a WebSocket handshake.
func isWebSocketUpgrade(r *http.Request) bool {
	return strings.EqualFold(r.Header.Get("Upgrade"), "websocket") &&
		strings.Contains(strings.ToLower(r.Header.Get("Connection")), "upgrade")
}

// UserFromContext extracts claims from context.
func UserFromContext(ctx context.Context) *Claims {
	claims, _ := ctx.Value(userContextKey).(*Claims)
	return claims
}
