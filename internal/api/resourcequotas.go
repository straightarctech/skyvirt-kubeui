package api

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/straightarctech/skyvirt-kubeui/internal/k8s"
)

type ResourceQuotasHandler struct {
	kc *k8s.Client
}

func resourceQuotasHandler(kc *k8s.Client) *ResourceQuotasHandler {
	return &ResourceQuotasHandler{kc: kc}
}

func (h *ResourceQuotasHandler) List(w http.ResponseWriter, r *http.Request) {
	items, err := h.kc.ListResourceQuotas(r.Context(), "")
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, items)
}

func (h *ResourceQuotasHandler) ListNamespaced(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "namespace")
	items, err := h.kc.ListResourceQuotas(r.Context(), ns)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, items)
}

func (h *ResourceQuotasHandler) Delete(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "namespace")
	name := chi.URLParam(r, "name")
	if checkProtectionByKind(w, r, h.kc, "ResourceQuota", ns, name) {
		return
	}
	if err := h.kc.DeleteResourceQuota(r.Context(), ns, name); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}
