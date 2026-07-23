package api

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/straightarctech/skyvirt-kubeui/internal/k8s"
)

// CRDsHandler serves CustomResourceDefinition REST endpoints.
type CRDsHandler struct {
	kc *k8s.Client
}

func crdsHandler(kc *k8s.Client) *CRDsHandler {
	return &CRDsHandler{kc: kc}
}

// List returns all CRDs in the cluster.
func (h *CRDsHandler) List(w http.ResponseWriter, r *http.Request) {
	items, err := h.kc.ListCRDs(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, items)
}

// ListInstances returns instances of a CRD across all namespaces.
// Path params: group, version, resource.
func (h *CRDsHandler) ListInstances(w http.ResponseWriter, r *http.Request) {
	group := chi.URLParam(r, "group")
	version := chi.URLParam(r, "version")
	resource := chi.URLParam(r, "resource")
	items, err := h.kc.GetCRDInstances(r.Context(), group, version, resource, "")
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, items)
}

// ListInstancesNamespaced returns instances of a CRD in a specific namespace.
func (h *CRDsHandler) ListInstancesNamespaced(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "namespace")
	group := chi.URLParam(r, "group")
	version := chi.URLParam(r, "version")
	resource := chi.URLParam(r, "resource")
	items, err := h.kc.GetCRDInstances(r.Context(), group, version, resource, ns)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, items)
}
