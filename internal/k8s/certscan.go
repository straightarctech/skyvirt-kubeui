package k8s

import (
	"bytes"
	"context"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/tools/clientcmd"
)

// CertInfo describes an expiring credential found in a Secret — a TLS
// certificate, a kubeconfig's embedded client cert, or a ServiceAccount token.
type CertInfo struct {
	Namespace  string   `json:"namespace"`
	Secret     string   `json:"secret"`
	CommonName string   `json:"common_name"`
	DNSNames   []string `json:"dns_names"`
	Issuer     string   `json:"issuer"`
	NotAfter   string   `json:"not_after"` // RFC3339 UTC ("" if it never expires)
	DaysLeft   int      `json:"days_left"`
	Expired    bool     `json:"expired"`
	Kind       string   `json:"kind"`                // tls | kubeconfig | sa-token
	NoExpiry   bool     `json:"no_expiry,omitempty"` // long-lived credential (no exp) — a hygiene flag
}

// ScanCertExpiry finds expiring credentials stored in Secrets and reports their
// remaining life: TLS certificates (kubernetes.io/tls and any Secret carrying
// tls.crt/ca.crt), client certs embedded in kubeconfig Secrets, and
// ServiceAccount-token JWTs (their exp, or a "long-lived" flag for the legacy
// non-expiring kind). Only public certs / token metadata are read — never a
// private key. The radar that catches a silently-expiring credential before it
// takes a service (or an admin's access) down.
func (c *Client) ScanCertExpiry(ctx context.Context) ([]CertInfo, error) {
	list, err := c.Clientset.CoreV1().Secrets("").List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	now := time.Now()
	out := make([]CertInfo, 0)
	for i := range list.Items {
		s := &list.Items[i]

		// 1. TLS certificates
		for _, key := range []string{"tls.crt", "ca.crt"} {
			if cert := firstCert(s.Data[key]); cert != nil {
				out = append(out, certFromX509(s.Namespace, s.Name+" ("+key+")", "tls", cert, now))
				break // tls.crt preferred over ca.crt
			}
		}

		// 2. ServiceAccount-token secrets — decode the JWT's exp
		if s.Type == corev1.SecretTypeServiceAccountToken {
			if ci := saTokenInfo(s.Namespace, s.Name, s.Data["token"], now); ci != nil {
				out = append(out, *ci)
			}
		}

		// 3. kubeconfig secrets — embedded client-certificate-data expiry
		for k, v := range s.Data {
			if !looksLikeKubeconfig(v) {
				continue
			}
			out = append(out, kubeconfigCerts(s.Namespace, s.Name+" ("+k+")", v, now)...)
		}
	}
	return out, nil
}

func certFromX509(ns, label, kind string, cert *x509.Certificate, now time.Time) CertInfo {
	return CertInfo{
		Namespace:  ns,
		Secret:     label,
		CommonName: cert.Subject.CommonName,
		DNSNames:   cert.DNSNames,
		Issuer:     cert.Issuer.CommonName,
		NotAfter:   cert.NotAfter.UTC().Format(time.RFC3339),
		DaysLeft:   int(cert.NotAfter.Sub(now).Hours() / 24),
		Expired:    now.After(cert.NotAfter),
		Kind:       kind,
	}
}

// saTokenInfo decodes a ServiceAccount-token JWT and reports its expiry. Legacy
// non-expiring tokens (no exp claim) are surfaced as long-lived — a credential a
// modern cluster should replace with a bound (projected) token.
func saTokenInfo(ns, name string, tok []byte, now time.Time) *CertInfo {
	parts := bytes.Split(tok, []byte("."))
	if len(parts) != 3 {
		return nil
	}
	payload, err := base64.RawURLEncoding.DecodeString(string(parts[1]))
	if err != nil {
		if payload, err = base64.URLEncoding.DecodeString(string(parts[1])); err != nil {
			return nil
		}
	}
	var claims struct {
		Exp int64  `json:"exp"`
		Sub string `json:"sub"`
	}
	if json.Unmarshal(payload, &claims) != nil {
		return nil
	}
	ci := &CertInfo{
		Namespace: ns, Secret: name + " (token)", Kind: "sa-token",
		CommonName: claims.Sub, Issuer: "kubernetes/serviceaccount",
	}
	if claims.Exp == 0 {
		ci.NoExpiry = true // long-lived legacy token
		return ci
	}
	exp := time.Unix(claims.Exp, 0)
	ci.NotAfter = exp.UTC().Format(time.RFC3339)
	ci.DaysLeft = int(exp.Sub(now).Hours() / 24)
	ci.Expired = now.After(exp)
	return ci
}

func looksLikeKubeconfig(v []byte) bool {
	return bytes.Contains(v, []byte("client-certificate-data")) ||
		(bytes.Contains(v, []byte("clusters:")) && bytes.Contains(v, []byte("users:")))
}

// kubeconfigCerts parses a kubeconfig blob and returns the expiry of every
// embedded client certificate (client-certificate-data).
func kubeconfigCerts(ns, label string, data []byte, now time.Time) []CertInfo {
	cfg, err := clientcmd.Load(data)
	if err != nil {
		return nil
	}
	var out []CertInfo
	for user, auth := range cfg.AuthInfos {
		cert := firstCert(auth.ClientCertificateData)
		if cert == nil {
			continue
		}
		out = append(out, certFromX509(ns, label+" · user:"+user, "kubeconfig", cert, now))
	}
	return out
}

// firstCert returns the first CERTIFICATE block parsed from PEM bytes.
func firstCert(pemBytes []byte) *x509.Certificate {
	for len(pemBytes) > 0 {
		block, rest := pem.Decode(pemBytes)
		if block == nil {
			return nil
		}
		if block.Type == "CERTIFICATE" {
			if cert, err := x509.ParseCertificate(block.Bytes); err == nil {
				return cert
			}
		}
		pemBytes = rest
	}
	return nil
}
