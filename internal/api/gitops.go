package api

import (
	"encoding/json"
	"net/http"

	"github.com/straightarctech/skyvirt-kubeui/internal/k8s"
)

// GitOpsHandler serves GitOps-lite (fetch manifests from a Git repo).
type GitOpsHandler struct{ kc *k8s.Client }

func gitopsHandler(kc *k8s.Client) *GitOpsHandler { return &GitOpsHandler{kc: kc} }

// Fetch clones a repo and returns the manifests under a path; the frontend
// diffs them against the live cluster and syncs via the existing apply path.
func (h *GitOpsHandler) Fetch(w http.ResponseWriter, r *http.Request) {
	var req struct {
		RepoURL string `json:"repo_url"`
		Ref     string `json:"ref"`
		Path    string `json:"path"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.RepoURL == "" {
		writeError(w, http.StatusBadRequest, "repo_url is required")
		return
	}
	manifests, err := h.kc.FetchManifests(r.Context(), req.RepoURL, req.Ref, req.Path)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"manifests": manifests})
}
