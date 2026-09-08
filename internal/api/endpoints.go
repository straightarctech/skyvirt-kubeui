package api

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/straightarctech/skyvirt-kubeui/internal/k8s"
)

type EndpointsHandler struct {
	kc *k8s.Client
}

func endpointsHandler(kc *k8s.Client) *EndpointsHandler {
	return &EndpointsHandler{kc: kc}
}

func (h *EndpointsHandler) List(w http.ResponseWriter, r *http.Request) {
	items, err := h.kc.ListEndpoints(r.Context(), "")
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, items)
}

func (h *EndpointsHandler) ListNamespaced(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "namespace")
	items, err := h.kc.ListEndpoints(r.Context(), ns)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, items)
}
