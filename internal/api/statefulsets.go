package api

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/straightarctech/skyvirt-kubeui/internal/k8s"
)

// StatefulSetsHandler serves statefulset-related REST endpoints.
type StatefulSetsHandler struct {
	kc *k8s.Client
}

func statefulSetsHandler(kc *k8s.Client) *StatefulSetsHandler {
	return &StatefulSetsHandler{kc: kc}
}

// List returns statefulsets across all namespaces.
func (h *StatefulSetsHandler) List(w http.ResponseWriter, r *http.Request) {
	items, err := h.kc.ListStatefulSets(r.Context(), "")
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, items)
}

// ListNamespaced returns statefulsets in a specific namespace.
func (h *StatefulSetsHandler) ListNamespaced(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "namespace")
	items, err := h.kc.ListStatefulSets(r.Context(), ns)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, items)
}

// Scale changes the replica count. Expects JSON body: {"replicas": N}.
func (h *StatefulSetsHandler) Scale(w http.ResponseWriter, r *http.Request) {
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
	if err := h.kc.ScaleStatefulSet(r.Context(), ns, name, body.Replicas); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "scaled"})
}

// Restart triggers a rolling restart.
func (h *StatefulSetsHandler) Restart(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "namespace")
	name := chi.URLParam(r, "name")
	if err := h.kc.RestartStatefulSet(r.Context(), ns, name); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "restarted"})
}

// Delete removes a statefulset.
func (h *StatefulSetsHandler) Delete(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "namespace")
	name := chi.URLParam(r, "name")
	if checkProtectionByKind(w, r, h.kc, "StatefulSet", ns, name) {
		return
	}
	if err := h.kc.DeleteStatefulSet(r.Context(), ns, name); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}
