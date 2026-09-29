package k8s

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"encoding/pem"
	"math/big"
	"strconv"
	"testing"
	"time"
)

// refNow is a fixed clock for every expiry assertion in this file. Cert expiry
// is pure arithmetic against a caller-supplied `now`, so tests must never read
// the wall clock — that is what makes a suite pass in the morning and fail in
// the evening.
var refNow = time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)

// selfSignedPEM returns a parsed cert and its PEM encoding. Generated per-run
// rather than checked in, so no fixture can silently expire and break the suite.
func selfSignedPEM(t *testing.T, cn string, notAfter time.Time) (*x509.Certificate, []byte) {
	t.Helper()
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("ed25519.GenerateKey: %v", err)
	}
	tmpl := &x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject:      pkix.Name{CommonName: cn},
		NotBefore:    notAfter.Add(-24 * time.Hour),
		NotAfter:     notAfter,
		DNSNames:     []string{cn},
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, pub, priv)
	if err != nil {
		t.Fatalf("x509.CreateCertificate: %v", err)
	}
	cert, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatalf("x509.ParseCertificate: %v", err)
	}
	return cert, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
}

// makeJWT builds a three-segment token with the given raw JSON claims.
func makeJWT(t *testing.T, claims string) []byte {
	t.Helper()
	enc := base64.RawURLEncoding.EncodeToString
	return []byte(enc([]byte(`{"alg":"RS256"}`)) + "." + enc([]byte(claims)) + "." + enc([]byte("sig")))
}

// TestCertFromX509_ExpiryMath pins the truncation rule. DaysLeft truncates
// toward zero, so a cert that expired 12 hours ago reports DaysLeft == 0 —
// identical to one expiring in 11 hours. Only Expired separates them, and any
// caller (or UI) reading "DaysLeft > 0 means fine" is wrong. This asymmetry is
// the whole reason both fields exist.
func TestCertFromX509_ExpiryMath(t *testing.T) {
	cases := []struct {
		name     string
		notAfter time.Time
		daysLeft int
		expired  bool
	}{
		{"47h left truncates down to 1 day", refNow.Add(47 * time.Hour), 1, false},
		{"48h left is exactly 2 days", refNow.Add(48 * time.Hour), 2, false},
		{"11h left is 0 days but not expired", refNow.Add(11 * time.Hour), 0, false},
		{"expired 12h ago is also 0 days", refNow.Add(-12 * time.Hour), 0, true},
		{"expired 25h ago goes negative", refNow.Add(-25 * time.Hour), -1, true},
		{"expiring exactly now is not yet expired", refNow, 0, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			cert := &x509.Certificate{
				Subject:  pkix.Name{CommonName: "svc.example"},
				Issuer:   pkix.Name{CommonName: "test-ca"},
				NotAfter: c.notAfter,
			}
			got := certFromX509("default", "tls-secret", "tls", cert, refNow)
			if got.DaysLeft != c.daysLeft {
				t.Errorf("DaysLeft = %d, want %d", got.DaysLeft, c.daysLeft)
			}
			if got.Expired != c.expired {
				t.Errorf("Expired = %v, want %v", got.Expired, c.expired)
			}
		})
	}
}

// TestCertFromX509_NormalizesToUTC guards the RFC3339 UTC contract: a cert whose
// NotAfter carries a non-UTC offset must still serialize with a Z suffix, or two
// clusters in different zones report the same cert with different timestamps.
func TestCertFromX509_NormalizesToUTC(t *testing.T) {
	ist := time.FixedZone("IST", 5*3600+1800)
	cert := &x509.Certificate{
		Subject:  pkix.Name{CommonName: "svc.example"},
		Issuer:   pkix.Name{CommonName: "test-ca"},
		NotAfter: time.Date(2026, 3, 1, 10, 0, 0, 0, ist),
		DNSNames: []string{"a.example", "b.example"},
	}
	got := certFromX509("kube-system", "label", "tls", cert, refNow)
	if want := "2026-03-01T04:30:00Z"; got.NotAfter != want {
		t.Errorf("NotAfter = %q, want %q", got.NotAfter, want)
	}
	if got.CommonName != "svc.example" || got.Issuer != "test-ca" {
		t.Errorf("CommonName/Issuer = %q/%q, want svc.example/test-ca", got.CommonName, got.Issuer)
	}
	if len(got.DNSNames) != 2 {
		t.Errorf("DNSNames = %v, want 2 entries", got.DNSNames)
	}
	if got.Kind != "tls" {
		t.Errorf("Kind = %q, want tls", got.Kind)
	}
}

// TestSaTokenInfo_Malformed: anything that is not a decodable three-segment JWT
// must yield nil rather than a zero-valued CertInfo, which would otherwise show
// up on the dashboard as a credential expiring at the epoch.
func TestSaTokenInfo_Malformed(t *testing.T) {
	cases := []struct {
		name string
		tok  []byte
	}{
		{"empty", []byte("")},
		{"two segments", []byte("aaa.bbb")},
		{"four segments", []byte("aaa.bbb.ccc.ddd")},
		{"payload is not base64", []byte("aaa.!!!not-base64!!!.ccc")},
		{"payload is not JSON", makeJWT(t, "not json at all")},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := saTokenInfo("default", "sa-token", c.tok, refNow); got != nil {
				t.Errorf("saTokenInfo(%q) = %+v, want nil", c.tok, got)
			}
		})
	}
}

// TestSaTokenInfo_LegacyTokenHasNoExpiry pins the legacy branch: a token with no
// exp claim is flagged NoExpiry and returns early, so NotAfter stays empty and
// Expired stays false. Reporting such a token as "expired at 1970" would be the
// obvious regression here.
func TestSaTokenInfo_LegacyTokenHasNoExpiry(t *testing.T) {
	got := saTokenInfo("default", "legacy", makeJWT(t, `{"sub":"system:serviceaccount:default:builder"}`), refNow)
	if got == nil {
		t.Fatal("saTokenInfo returned nil, want a CertInfo")
	}
	if !got.NoExpiry {
		t.Error("NoExpiry = false, want true for a token with no exp claim")
	}
	if got.NotAfter != "" {
		t.Errorf("NotAfter = %q, want empty", got.NotAfter)
	}
	if got.Expired {
		t.Error("Expired = true, want false — a non-expiring token has not expired")
	}
	if got.DaysLeft != 0 {
		t.Errorf("DaysLeft = %d, want 0", got.DaysLeft)
	}
	if got.CommonName != "system:serviceaccount:default:builder" {
		t.Errorf("CommonName = %q, want the sub claim", got.CommonName)
	}
	if got.Kind != "sa-token" || got.Secret != "legacy (token)" {
		t.Errorf("Kind/Secret = %q/%q, want sa-token/\"legacy (token)\"", got.Kind, got.Secret)
	}
}

// TestSaTokenInfo_BoundTokenExpiry covers the modern projected token: exp is
// honoured, and the same truncate-toward-zero rule as certFromX509 applies.
func TestSaTokenInfo_BoundTokenExpiry(t *testing.T) {
	exp := refNow.Add(47 * time.Hour)
	got := saTokenInfo("default", "bound", makeJWT(t, `{"sub":"sa","exp":`+strconv.FormatInt(exp.Unix(), 10)+`}`), refNow)
	if got == nil {
		t.Fatal("saTokenInfo returned nil, want a CertInfo")
	}
	if got.NoExpiry {
		t.Error("NoExpiry = true, want false for a token carrying exp")
	}
	if got.DaysLeft != 1 {
		t.Errorf("DaysLeft = %d, want 1 (47h truncates to 1)", got.DaysLeft)
	}
	if got.Expired {
		t.Error("Expired = true, want false")
	}
	if got.NotAfter != exp.UTC().Format(time.RFC3339) {
		t.Errorf("NotAfter = %q, want %q", got.NotAfter, exp.UTC().Format(time.RFC3339))
	}
}

// TestSaTokenInfo_AcceptsPaddedBase64 guards the fallback decode path. Raw
// (unpadded) URL base64 is the JWT norm, but padded tokens exist in the wild and
// must not be silently dropped.
func TestSaTokenInfo_AcceptsPaddedBase64(t *testing.T) {
	enc := base64.URLEncoding.EncodeToString // padded
	tok := []byte(enc([]byte(`{"alg":"RS256"}`)) + "." + enc([]byte(`{"sub":"padded"}`)) + "." + enc([]byte("sig")))
	got := saTokenInfo("default", "p", tok, refNow)
	if got == nil {
		t.Fatal("saTokenInfo returned nil for a padded-base64 token, want a CertInfo")
	}
	if got.CommonName != "padded" {
		t.Errorf("CommonName = %q, want padded", got.CommonName)
	}
}

// TestFirstCert walks the PEM block handling: non-CERTIFICATE blocks are
// skipped, an unparsable CERTIFICATE block does NOT abort the walk, and
// undecodable input yields nil.
func TestFirstCert(t *testing.T) {
	_, certPEM := selfSignedPEM(t, "real.example", refNow.Add(720*time.Hour))
	keyBlock := pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: []byte("not-a-key")})
	junkCert := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: []byte("not-a-certificate")})

	if got := firstCert(nil); got != nil {
		t.Errorf("firstCert(nil) = %v, want nil", got)
	}
	if got := firstCert([]byte("plain text, no PEM here")); got != nil {
		t.Errorf("firstCert(garbage) = %v, want nil", got)
	}
	if got := firstCert(certPEM); got == nil || got.Subject.CommonName != "real.example" {
		t.Errorf("firstCert(certPEM) = %v, want the real.example cert", got)
	}
	// A key block ahead of the cert must be stepped over, not treated as a stop.
	if got := firstCert(append(append([]byte{}, keyBlock...), certPEM...)); got == nil {
		t.Error("firstCert(key+cert) = nil, want the cert — a leading non-CERTIFICATE block must be skipped")
	}
	// An unparsable CERTIFICATE block must not abort the walk either.
	if got := firstCert(append(append([]byte{}, junkCert...), certPEM...)); got == nil {
		t.Error("firstCert(badcert+cert) = nil, want the cert — an unparsable block must not stop the scan")
	}
	// A CERTIFICATE block that never parses yields nil rather than panicking.
	if got := firstCert(junkCert); got != nil {
		t.Errorf("firstCert(badcert) = %v, want nil", got)
	}
}

// TestLooksLikeKubeconfig pins the purely lexical sniff. It is deliberately
// loose — either the client-certificate-data key, or both "clusters:" and
// "users:" anywhere in the blob.
func TestLooksLikeKubeconfig(t *testing.T) {
	cases := []struct {
		in   string
		want bool
	}{
		{"client-certificate-data: abc", true},
		{"clusters:\nusers:\n", true},
		{"clusters:\n", false},      // needs both keys
		{"users:\n", false},         // needs both keys
		{"apiVersion: v1\n", false}, // a plain manifest is not a kubeconfig
		{"", false},
	}
	for _, c := range cases {
		if got := looksLikeKubeconfig([]byte(c.in)); got != c.want {
			t.Errorf("looksLikeKubeconfig(%q) = %v, want %v", c.in, got, c.want)
		}
	}
}

// TestKubeconfigCerts parses an embedded client cert out of a kubeconfig. Only
// ONE user is defined on purpose: kubeconfigCerts ranges a map, so a multi-user
// fixture would produce a non-deterministic slice order.
func TestKubeconfigCerts(t *testing.T) {
	_, certPEM := selfSignedPEM(t, "admin.example", refNow.Add(47*time.Hour))
	b64 := base64.StdEncoding.EncodeToString(certPEM)
	kubeconfig := []byte(`apiVersion: v1
kind: Config
clusters:
- name: c1
  cluster:
    server: https://example:6443
users:
- name: admin
  user:
    client-certificate-data: ` + b64 + `
contexts:
- name: ctx
  context:
    cluster: c1
    user: admin
current-context: ctx
`)
	got := kubeconfigCerts("default", "kubeconfig-secret", kubeconfig, refNow)
	if len(got) != 1 {
		t.Fatalf("kubeconfigCerts returned %d entries, want 1: %+v", len(got), got)
	}
	if got[0].Kind != "kubeconfig" {
		t.Errorf("Kind = %q, want kubeconfig", got[0].Kind)
	}
	if got[0].CommonName != "admin.example" {
		t.Errorf("CommonName = %q, want admin.example", got[0].CommonName)
	}
	if got[0].DaysLeft != 1 {
		t.Errorf("DaysLeft = %d, want 1", got[0].DaysLeft)
	}
	if want := "kubeconfig-secret · user:admin"; got[0].Secret != want {
		t.Errorf("Secret = %q, want %q", got[0].Secret, want)
	}
	// Unparsable input is reported as no certs, not as an error or a panic.
	if got := kubeconfigCerts("default", "l", []byte("{{{not yaml"), refNow); got != nil {
		t.Errorf("kubeconfigCerts(garbage) = %+v, want nil", got)
	}
}
