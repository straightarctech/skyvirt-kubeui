package api

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/straightarctech/skyvirt-kubeui/internal/k8s"
)

// NetworkHandler serves NetworkPolicy REST endpoints.
type NetworkHandler struct {
	kc *k8s.Client
}

func networkHandler(kc *k8s.Client) *NetworkHandler {
	return &NetworkHandler{kc: kc}
}

// List returns network policies across all namespaces.
func (h *NetworkHandler) List(w http.ResponseWriter, r *http.Request) {
	items, err := h.kc.ListNetworkPolicies(r.Context(), "")
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, items)
}

// ListNamespaced returns network policies in a specific namespace.
func (h *NetworkHandler) ListNamespaced(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "namespace")
	items, err := h.kc.ListNetworkPolicies(r.Context(), ns)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, items)
}

// Get returns a single network policy.
func (h *NetworkHandler) Get(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "namespace")
	name := chi.URLParam(r, "name")
	item, err := h.kc.GetNetworkPolicy(r.Context(), ns, name)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, item)
}

// Delete removes a network policy.
func (h *NetworkHandler) Delete(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "namespace")
	name := chi.URLParam(r, "name")
	if checkProtectionByKind(w, r, h.kc, "NetworkPolicy", ns, name) {
		return
	}
	if err := h.kc.DeleteNetworkPolicy(r.Context(), ns, name); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}
