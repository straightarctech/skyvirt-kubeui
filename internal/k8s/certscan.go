package k8s

import (
	"context"
	"crypto/x509"
	"encoding/pem"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// CertInfo describes a TLS certificate found in a Secret.
type CertInfo struct {
	Namespace  string   `json:"namespace"`
	Secret     string   `json:"secret"`
	CommonName string   `json:"common_name"`
	DNSNames   []string `json:"dns_names"`
	Issuer     string   `json:"issuer"`
	NotAfter   string   `json:"not_after"` // RFC3339 UTC
	DaysLeft   int      `json:"days_left"`
	Expired    bool     `json:"expired"`
}

// ScanCertExpiry finds TLS certificates stored in Secrets (kubernetes.io/tls and
// any Secret carrying tls.crt/ca.crt — cert-manager and hand-rolled alike) and
// reports their expiry. Only the certificate (public) is parsed; private keys are
// never read. The radar that catches a silently-expiring cert before it takes a
// service down.
func (c *Client) ScanCertExpiry(ctx context.Context) ([]CertInfo, error) {
	list, err := c.Clientset.CoreV1().Secrets("").List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	now := time.Now()
	out := make([]CertInfo, 0)
	for i := range list.Items {
		s := &list.Items[i]
		for _, key := range []string{"tls.crt", "ca.crt"} {
			raw := s.Data[key]
			if len(raw) == 0 {
				continue
			}
			cert := firstCert(raw)
			if cert == nil {
				continue
			}
			out = append(out, CertInfo{
				Namespace:  s.Namespace,
				Secret:     s.Name + " (" + key + ")",
				CommonName: cert.Subject.CommonName,
				DNSNames:   cert.DNSNames,
				Issuer:     cert.Issuer.CommonName,
				NotAfter:   cert.NotAfter.UTC().Format(time.RFC3339),
				DaysLeft:   int(cert.NotAfter.Sub(now).Hours() / 24),
				Expired:    now.After(cert.NotAfter),
			})
			break // one cert per secret (tls.crt preferred over ca.crt)
		}
	}
	return out, nil
}

// firstCert returns the first CERTIFICATE block parsed from PEM bytes.
func firstCert(pemBytes []byte) *x509.Certificate {
	for {
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
}
