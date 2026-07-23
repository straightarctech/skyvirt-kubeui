package api

import (
	"encoding/json"
	"net/http"

	"github.com/straightarctech/skyvirt-kubeui/internal/k8s"
)

// AccessReviewHandler serves the RBAC access-review endpoints.
type AccessReviewHandler struct{ kc *k8s.Client }

func accessReviewHandler(kc *k8s.Client) *AccessReviewHandler { return &AccessReviewHandler{kc: kc} }

type accessReviewRequest struct {
	SubjectKind      string `json:"subject_kind"` // User | Group | ServiceAccount
	SubjectName      string `json:"subject_name"`
	SubjectNamespace string `json:"subject_namespace"` // for ServiceAccount
	Verb             string `json:"verb"`
	Group            string `json:"group"`
	Resource         string `json:"resource"`
	Name             string `json:"name"`
	Namespace        string `json:"namespace"`
}

// Check answers "can this subject perform this action?".
func (h *AccessReviewHandler) Check(w http.ResponseWriter, r *http.Request) {
	var req accessReviewRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.SubjectName == "" || req.Verb == "" || req.Resource == "" {
		writeError(w, http.StatusBadRequest, "subject_name, verb and resource are required")
		return
	}
	res, err := h.kc.AccessReview(r.Context(), req.SubjectKind, req.SubjectName, req.SubjectNamespace, req.Verb, req.Group, req.Resource, req.Name, req.Namespace)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, res)
}

// Risky returns over-broad ClusterRoleBindings.
func (h *AccessReviewHandler) Risky(w http.ResponseWriter, r *http.Request) {
	risky, err := h.kc.RiskyClusterRoleBindings(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, risky)
}
