package api

import (
	"net/http"

	"github.com/straightarctech/skyvirt-kubeui/internal/k8s"
)

// securityPostureHandler serves a read-only cluster security scan.
func securityPostureHandler(kc *k8s.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		posture, err := kc.SecurityScan(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, posture)
	}
}
