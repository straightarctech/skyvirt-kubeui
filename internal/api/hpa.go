package api

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/straightarctech/skyvirt-kubeui/internal/k8s"
)

// HPAHandler serves HorizontalPodAutoscaler REST endpoints.
type HPAHandler struct {
	kc *k8s.Client
}

func hpaHandler(kc *k8s.Client) *HPAHandler {
	return &HPAHandler{kc: kc}
}

// List returns HPAs across all namespaces.
func (h *HPAHandler) List(w http.ResponseWriter, r *http.Request) {
	items, err := h.kc.ListHPAs(r.Context(), "")
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, items)
}

// ListNamespaced returns HPAs in a specific namespace.
func (h *HPAHandler) ListNamespaced(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "namespace")
	items, err := h.kc.ListHPAs(r.Context(), ns)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, items)
}

// Delete removes an HPA.
func (h *HPAHandler) Delete(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "namespace")
	name := chi.URLParam(r, "name")
	if checkProtectionByKind(w, r, h.kc, "HorizontalPodAutoscaler", ns, name) {
		return
	}
	if err := h.kc.DeleteHPA(r.Context(), ns, name); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}
