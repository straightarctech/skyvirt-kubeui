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

// WorkloadAudit reports insecure workload settings (privileged, host namespaces,
// hostPath, root, added capabilities) per workload. No scanner required.
func (h *VulnHandler) WorkloadAudit(w http.ResponseWriter, r *http.Request) {
	risks, err := h.kc.WorkloadSecurityAudit(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, risks)
}

// ImageAudit reports the image-provenance inventory (registries, tags, mutable
// references). No scanner required.
func (h *VulnHandler) ImageAudit(w http.ResponseWriter, r *http.Request) {
	rep, err := h.kc.ImageAudit(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, rep)
}
