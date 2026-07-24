package api

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/straightarctech/skyvirt-kubeui/internal/k8s"
)

type LimitRangesHandler struct {
	kc *k8s.Client
}

func limitRangesHandler(kc *k8s.Client) *LimitRangesHandler {
	return &LimitRangesHandler{kc: kc}
}

func (h *LimitRangesHandler) List(w http.ResponseWriter, r *http.Request) {
	items, err := h.kc.ListLimitRanges(r.Context(), "")
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, items)
}

func (h *LimitRangesHandler) ListNamespaced(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "namespace")
	items, err := h.kc.ListLimitRanges(r.Context(), ns)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, items)
}
