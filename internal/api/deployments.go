package api

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/straightarctech/skyvirt-kubeui/internal/k8s"
)

// DeploymentsHandler serves deployment-related REST endpoints.
type DeploymentsHandler struct {
	kc *k8s.Client
}

func deploymentsHandler(kc *k8s.Client) *DeploymentsHandler {
	return &DeploymentsHandler{kc: kc}
}

// List returns deployments across all namespaces.
func (h *DeploymentsHandler) List(w http.ResponseWriter, r *http.Request) {
	items, err := h.kc.ListDeployments(r.Context(), "")
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, items)
}

// ListNamespaced returns deployments in a specific namespace.
func (h *DeploymentsHandler) ListNamespaced(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "namespace")
	items, err := h.kc.ListDeployments(r.Context(), ns)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, items)
}

// Get returns a single deployment.
func (h *DeploymentsHandler) Get(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "namespace")
	name := chi.URLParam(r, "name")
	item, err := h.kc.GetDeployment(r.Context(), ns, name)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, item)
}

// Scale changes the replica count. Expects JSON body: {"replicas": N}.
func (h *DeploymentsHandler) Scale(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "namespace")
	name := chi.URLParam(r, "name")
	var body struct {
		Replicas int32 `json:"replicas"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}
	if body.Replicas < 0 {
		writeError(w, http.StatusBadRequest, "replicas must be >= 0")
		return
	}
	if err := h.kc.ScaleDeployment(r.Context(), ns, name, body.Replicas); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "scaled"})
}

// Restart triggers a rolling restart by patching the pod template annotation.
func (h *DeploymentsHandler) Restart(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "namespace")
	name := chi.URLParam(r, "name")
	if err := h.kc.RestartDeployment(r.Context(), ns, name); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "restarted"})
}

// Rollback rolls a deployment back to a previous revision.
func (h *DeploymentsHandler) Rollback(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "namespace")
	name := chi.URLParam(r, "name")
	if err := h.kc.RollbackDeployment(r.Context(), ns, name); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "rolled back"})
}

// Delete removes a deployment.
func (h *DeploymentsHandler) Delete(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "namespace")
	name := chi.URLParam(r, "name")
	if checkProtectionByKind(w, r, h.kc, "Deployment", ns, name) {
		return
	}
	if err := h.kc.DeleteDeployment(r.Context(), ns, name); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// ListReplicaSets returns replicasets owned by a deployment.
func (h *DeploymentsHandler) ListReplicaSets(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "namespace")
	name := chi.URLParam(r, "name")
	items, err := h.kc.ListDeploymentReplicaSets(r.Context(), ns, name)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, items)
}
