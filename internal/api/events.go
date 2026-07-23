package api

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/straightarctech/skyvirt-kubeui/internal/k8s"
)

// EventsHandler serves Kubernetes event REST endpoints.
type EventsHandler struct {
	kc *k8s.Client
}

func eventsHandler(kc *k8s.Client) *EventsHandler {
	return &EventsHandler{kc: kc}
}

// List returns events across all namespaces.
func (h *EventsHandler) List(w http.ResponseWriter, r *http.Request) {
	items, err := h.kc.ListEvents(r.Context(), "")
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, items)
}

// ListNamespaced returns events in a specific namespace.
func (h *EventsHandler) ListNamespaced(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "namespace")
	items, err := h.kc.ListEvents(r.Context(), ns)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, items)
}
