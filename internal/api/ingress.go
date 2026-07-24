package api

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/straightarctech/skyvirt-kubeui/internal/k8s"
)

// IngressHandler serves Ingress REST endpoints.
type IngressHandler struct {
	kc *k8s.Client
}

func ingressHandler(kc *k8s.Client) *IngressHandler {
	return &IngressHandler{kc: kc}
}

// List returns ingresses across all namespaces.
func (h *IngressHandler) List(w http.ResponseWriter, r *http.Request) {
	items, err := h.kc.ListIngresses(r.Context(), "")
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, items)
}

// ListNamespaced returns ingresses in a specific namespace.
func (h *IngressHandler) ListNamespaced(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "namespace")
	items, err := h.kc.ListIngresses(r.Context(), ns)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, items)
}

// Get returns a single ingress.
func (h *IngressHandler) Get(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "namespace")
	name := chi.URLParam(r, "name")
	item, err := h.kc.GetIngress(r.Context(), ns, name)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, item)
}

// Delete removes an ingress.
func (h *IngressHandler) Delete(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "namespace")
	name := chi.URLParam(r, "name")
	if checkProtectionByKind(w, r, h.kc, "Ingress", ns, name) {
		return
	}
	if err := h.kc.DeleteIngress(r.Context(), ns, name); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}
