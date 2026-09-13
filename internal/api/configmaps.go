package api

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/straightarctech/skyvirt-kubeui/internal/k8s"
)

// ConfigMapsHandler serves ConfigMap REST endpoints.
type ConfigMapsHandler struct {
	kc *k8s.Client
}

func configMapsHandler(kc *k8s.Client) *ConfigMapsHandler {
	return &ConfigMapsHandler{kc: kc}
}

// List returns configmaps across all namespaces.
func (h *ConfigMapsHandler) List(w http.ResponseWriter, r *http.Request) {
	items, err := h.kc.ListConfigMaps(r.Context(), "")
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, items)
}

// ListNamespaced returns configmaps in a specific namespace.
func (h *ConfigMapsHandler) ListNamespaced(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "namespace")
	items, err := h.kc.ListConfigMaps(r.Context(), ns)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, items)
}

// Get returns a single configmap.
func (h *ConfigMapsHandler) Get(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "namespace")
	name := chi.URLParam(r, "name")
	item, err := h.kc.GetConfigMap(r.Context(), ns, name)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, item)
}

// Create creates a new configmap. Expects JSON body: {"name": "...", "data": {"key":"value"}}.
func (h *ConfigMapsHandler) Create(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "namespace")
	var body struct {
		Name string            `json:"name"`
		Data map[string]string `json:"data"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}
	if body.Name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}
	if err := h.kc.CreateConfigMap(r.Context(), ns, body.Name, body.Data); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"status": "created"})
}

// Update replaces the data in an existing configmap. Expects JSON body: {"data": {"key":"value"}}.
func (h *ConfigMapsHandler) Update(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "namespace")
	name := chi.URLParam(r, "name")
	var body struct {
		Data map[string]string `json:"data"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}
	if err := h.kc.UpdateConfigMap(r.Context(), ns, name, body.Data); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "updated"})
}

// Delete removes a configmap.
func (h *ConfigMapsHandler) Delete(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "namespace")
	name := chi.URLParam(r, "name")
	if checkProtectionByKind(w, r, h.kc, "ConfigMap", ns, name) {
		return
	}
	if err := h.kc.DeleteConfigMap(r.Context(), ns, name); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}
