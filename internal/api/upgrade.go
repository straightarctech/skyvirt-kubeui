package api

import (
	"net/http"

	"github.com/straightarctech/skyvirt-kubeui/internal/k8s"
)

// UpgradeHandler serves cluster-upgrade readiness endpoints.
type UpgradeHandler struct{ kc *k8s.Client }

func upgradeHandler(kc *k8s.Client) *UpgradeHandler { return &UpgradeHandler{kc: kc} }

// APIScan reports uses of deprecated/removed Kubernetes APIs — the go/no-go
// signal before a cluster version bump. Covers BOTH Helm-rendered manifests and
// live (kubectl-applied) objects via their last-applied-configuration annotation,
// so nothing deployed outside Helm is a blind spot.
func (h *UpgradeHandler) APIScan(w http.ResponseWriter, r *http.Request) {
	findings, err := h.kc.ScanDeprecatedAPIs(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	findings = append(findings, h.kc.ScanDeprecatedAPIsLive(r.Context())...)

	// Dedup: an object that is both Helm-managed and carries a last-applied
	// annotation can surface from both scans — keep the first (Helm, more precise).
	seen := map[string]bool{}
	out := make([]k8s.APIFinding, 0, len(findings))
	for _, f := range findings {
		key := f.APIVersion + "|" + f.Kind + "|" + f.Name
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, f)
	}
	writeJSON(w, http.StatusOK, out)
}
