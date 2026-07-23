package api

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/straightarctech/skyvirt-kubeui/internal/k8s"
)

// DaemonSetsHandler serves daemonset-related REST endpoints.
type DaemonSetsHandler struct {
	kc *k8s.Client
}

func daemonSetsHandler(kc *k8s.Client) *DaemonSetsHandler {
	return &DaemonSetsHandler{kc: kc}
}

// List returns daemonsets across all namespaces.
func (h *DaemonSetsHandler) List(w http.ResponseWriter, r *http.Request) {
	items, err := h.kc.ListDaemonSets(r.Context(), "")
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, items)
}

// ListNamespaced returns daemonsets in a specific namespace.
func (h *DaemonSetsHandler) ListNamespaced(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "namespace")
	items, err := h.kc.ListDaemonSets(r.Context(), ns)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, items)
}

// Restart triggers a rolling restart of a daemonset.
func (h *DaemonSetsHandler) Restart(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "namespace")
	name := chi.URLParam(r, "name")
	if err := h.kc.RestartDaemonSet(r.Context(), ns, name); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "restarted"})
}

// Delete removes a daemonset.
func (h *DaemonSetsHandler) Delete(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "namespace")
	name := chi.URLParam(r, "name")
	if checkProtectionByKind(w, r, h.kc, "DaemonSet", ns, name) {
		return
	}
	if err := h.kc.DeleteDaemonSet(r.Context(), ns, name); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}
