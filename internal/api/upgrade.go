package api

import (
	"net/http"

	"github.com/straightarctech/skyvirt-kubeui/internal/k8s"
)

// UpgradeHandler serves cluster-upgrade readiness endpoints.
type UpgradeHandler struct{ kc *k8s.Client }

func upgradeHandler(kc *k8s.Client) *UpgradeHandler { return &UpgradeHandler{kc: kc} }

// APIScan reports uses of deprecated/removed Kubernetes APIs — the go/no-go
// signal before a cluster version bump.
func (h *UpgradeHandler) APIScan(w http.ResponseWriter, r *http.Request) {
	findings, err := h.kc.ScanDeprecatedAPIs(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if findings == nil {
		findings = []k8s.APIFinding{}
	}
	writeJSON(w, http.StatusOK, findings)
}
