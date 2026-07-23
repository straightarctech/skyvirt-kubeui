package auth

import (
	"encoding/base64"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const testSecret = "test-secret-please-ignore"

func TestGenerateAndValidateToken(t *testing.T) {
	tok, err := GenerateToken(testSecret, "u1", "u1@example.com", "admin")
	if err != nil {
		t.Fatalf("GenerateToken: %v", err)
	}
	claims, err := ValidateToken(testSecret, tok)
	if err != nil {
		t.Fatalf("ValidateToken: %v", err)
	}
	if claims.UserID != "u1" {
		t.Errorf("UserID = %q, want u1", claims.UserID)
	}
	if claims.Role != "admin" {
		t.Errorf("Role = %q, want admin", claims.Role)
	}
	if claims.Email != "u1@example.com" {
		t.Errorf("Email = %q, want u1@example.com", claims.Email)
	}
}

func TestValidateToken_WrongSecret(t *testing.T) {
	tok, err := GenerateToken(testSecret, "u1", "", "admin")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := ValidateToken("a-different-secret", tok); err == nil {
		t.Fatal("expected error validating with the wrong secret, got nil")
	}
}

func TestValidateToken_Expired(t *testing.T) {
	claims := &Claims{
		UserID: "u1",
		Role:   "admin",
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(-1 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now().Add(-2 * time.Hour)),
		},
	}
	tok, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(testSecret))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := ValidateToken(testSecret, tok); err == nil {
		t.Fatal("expected error validating an expired token, got nil")
	}
}

// TestValidateToken_AlgNone guards the alg-confusion defense: a token with
// "alg":"none" must be rejected, not accepted as unsigned.
func TestValidateToken_AlgNone(t *testing.T) {
	b64 := func(s string) string { return base64.RawURLEncoding.EncodeToString([]byte(s)) }
	noneToken := b64(`{"alg":"none","typ":"JWT"}`) + "." +
		b64(`{"uid":"attacker","role":"admin","exp":9999999999}`) + "."
	if _, err := ValidateToken(testSecret, noneToken); err == nil {
		t.Fatal("expected alg=none token to be rejected, got nil")
	}
}

func TestValidateToken_Garbage(t *testing.T) {
	if _, err := ValidateToken(testSecret, "not-a-jwt"); err == nil {
		t.Fatal("expected error on garbage token")
	}
}
