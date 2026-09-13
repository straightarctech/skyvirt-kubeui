package api

import (
	"net/http"

	"github.com/straightarctech/skyvirt-kubeui/internal/k8s"
)

// CertsHandler serves the certificate-expiry radar.
type CertsHandler struct{ kc *k8s.Client }

func certsHandler(kc *k8s.Client) *CertsHandler { return &CertsHandler{kc: kc} }

// Expiry reports TLS certificates in the cluster's Secrets and when they expire.
func (h *CertsHandler) Expiry(w http.ResponseWriter, r *http.Request) {
	certs, err := h.kc.ScanCertExpiry(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, certs)
}
