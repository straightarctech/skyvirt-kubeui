package api

import (
	"net/http"

	"github.com/straightarctech/skyvirt-kubeui/internal/k8s"
)

// VulnHandler serves the image-vulnerability views (Trivy Operator reports).
type VulnHandler struct{ kc *k8s.Client }

func vulnHandler(kc *k8s.Client) *VulnHandler { return &VulnHandler{kc: kc} }

// Status reports whether Trivy Operator is installed.
func (h *VulnHandler) Status(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]bool{"installed": h.kc.TrivyInstalled(r.Context())})
}

// Reports returns per-image vulnerability summaries.
func (h *VulnHandler) Reports(w http.ResponseWriter, r *http.Request) {
	reports, err := h.kc.ListVulnReports(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, reports)
}
