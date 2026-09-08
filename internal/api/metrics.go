package api

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/straightarctech/skyvirt-kubeui/internal/k8s"
)

// MetricsHandler serves metrics-server REST endpoints (top nodes / pods).
type MetricsHandler struct {
	kc *k8s.Client
}

func metricsHandler(kc *k8s.Client) *MetricsHandler {
	return &MetricsHandler{kc: kc}
}

// TopNodes returns CPU/memory usage for all nodes.
func (h *MetricsHandler) TopNodes(w http.ResponseWriter, r *http.Request) {
	items, err := h.kc.TopNodes(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, items)
}

// TopPods returns CPU/memory usage for pods across all namespaces.
func (h *MetricsHandler) TopPods(w http.ResponseWriter, r *http.Request) {
	items, err := h.kc.TopPods(r.Context(), "")
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, items)
}

// TopPodsNamespaced returns CPU/memory usage for pods in a specific namespace.
func (h *MetricsHandler) TopPodsNamespaced(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "namespace")
	items, err := h.kc.TopPods(r.Context(), ns)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, items)
}
