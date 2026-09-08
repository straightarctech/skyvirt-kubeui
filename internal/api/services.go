package api

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	corev1 "k8s.io/api/core/v1"

	"github.com/straightarctech/skyvirt-kubeui/internal/k8s"
)

// ServicesHandler serves Kubernetes Service REST endpoints.
type ServicesHandler struct {
	kc *k8s.Client
}

func servicesHandler(kc *k8s.Client) *ServicesHandler {
	return &ServicesHandler{kc: kc}
}

// List returns services across all namespaces.
func (h *ServicesHandler) List(w http.ResponseWriter, r *http.Request) {
	items, err := h.kc.ListServices(r.Context(), "")
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, items)
}

// ListNamespaced returns services in a specific namespace.
func (h *ServicesHandler) ListNamespaced(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "namespace")
	items, err := h.kc.ListServices(r.Context(), ns)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, items)
}

// Get returns a single service.
func (h *ServicesHandler) Get(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "namespace")
	name := chi.URLParam(r, "name")
	item, err := h.kc.GetService(r.Context(), ns, name)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, item)
}

// Create creates a new service. Expects a JSON service spec in the body.
func (h *ServicesHandler) Create(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "namespace")
	var svc corev1.Service
	if err := json.NewDecoder(r.Body).Decode(&svc); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}
	if svc.Namespace == "" {
		svc.Namespace = ns
	}
	result, err := h.kc.CreateService(r.Context(), ns, &svc)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, result)
}

// Delete removes a service.
func (h *ServicesHandler) Delete(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "namespace")
	name := chi.URLParam(r, "name")
	if checkProtectionByKind(w, r, h.kc, "Service", ns, name) {
		return
	}
	if err := h.kc.DeleteService(r.Context(), ns, name); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}
