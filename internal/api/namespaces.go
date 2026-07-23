package api

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/straightarctech/skyvirt-kubeui/internal/k8s"
)

// NamespacesHandler serves namespace-related REST endpoints.
type NamespacesHandler struct {
	kc *k8s.Client
}

func namespacesHandler(kc *k8s.Client) *NamespacesHandler {
	return &NamespacesHandler{kc: kc}
}

// List returns all namespaces.
func (h *NamespacesHandler) List(w http.ResponseWriter, r *http.Request) {
	items, err := h.kc.ListNamespaces(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, items)
}

// Create creates a new namespace. Expects JSON body: {"name": "...", "labels": {...}}.
func (h *NamespacesHandler) Create(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name   string            `json:"name"`
		Labels map[string]string `json:"labels"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}
	if body.Name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}
	if err := h.kc.CreateNamespace(r.Context(), body.Name, body.Labels); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"status": "created"})
}

// Delete removes a namespace.
func (h *NamespacesHandler) Delete(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	if checkProtectionByKind(w, r, h.kc, "Namespace", "", name) {
		return
	}
	if err := h.kc.DeleteNamespace(r.Context(), name); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// Resources returns a summary of resources within a namespace.
func (h *NamespacesHandler) Resources(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	res, err := h.kc.GetNamespaceResources(r.Context(), name)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, res)
}
