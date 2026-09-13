package api

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/straightarctech/skyvirt-kubeui/internal/k8s"
)

// SecretsHandler serves Kubernetes Secret REST endpoints.
type SecretsHandler struct {
	kc *k8s.Client
}

func secretsHandler(kc *k8s.Client) *SecretsHandler {
	return &SecretsHandler{kc: kc}
}

// List returns secrets across all namespaces.
func (h *SecretsHandler) List(w http.ResponseWriter, r *http.Request) {
	items, err := h.kc.ListSecrets(r.Context(), "")
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, items)
}

// ListNamespaced returns secrets in a specific namespace.
func (h *SecretsHandler) ListNamespaced(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "namespace")
	items, err := h.kc.ListSecrets(r.Context(), ns)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, items)
}

// Get returns a single secret.
func (h *SecretsHandler) Get(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "namespace")
	name := chi.URLParam(r, "name")
	item, err := h.kc.GetSecret(r.Context(), ns, name)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, item)
}

// Create creates a new secret.
// Expects JSON body: {"name": "...", "type": "Opaque", "data": {"key": "base64value"}}.
func (h *SecretsHandler) Create(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "namespace")
	var body struct {
		Name string            `json:"name"`
		Type string            `json:"type"`
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
	if body.Type == "" {
		body.Type = "Opaque"
	}
	// Convert string data to []byte.
	byteData := make(map[string][]byte, len(body.Data))
	for k, v := range body.Data {
		byteData[k] = []byte(v)
	}
	if err := h.kc.CreateSecret(r.Context(), ns, body.Name, body.Type, byteData); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"status": "created"})
}

// Update replaces the data of an existing secret.
// Expects JSON body: {"data": {"key": "base64value"}}.
func (h *SecretsHandler) Update(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "namespace")
	name := chi.URLParam(r, "name")
	var body struct {
		Data map[string]string `json:"data"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}
	byteData := make(map[string][]byte, len(body.Data))
	for k, v := range body.Data {
		byteData[k] = []byte(v)
	}
	if err := h.kc.UpdateSecret(r.Context(), ns, name, byteData); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "updated"})
}

// Delete removes a secret.
func (h *SecretsHandler) Delete(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "namespace")
	name := chi.URLParam(r, "name")
	if checkProtectionByKind(w, r, h.kc, "Secret", ns, name) {
		return
	}
	if err := h.kc.DeleteSecret(r.Context(), ns, name); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}
