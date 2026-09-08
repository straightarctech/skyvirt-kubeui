package api

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/straightarctech/skyvirt-kubeui/internal/k8s"
)

// ApplyHandler handles generic resource apply/get/update endpoints.
type ApplyHandler struct {
	kc *k8s.Client
}

func applyHandler(kc *k8s.Client) *ApplyHandler {
	return &ApplyHandler{kc: kc}
}

// Apply handles POST /api/v1/apply.
// Expects JSON body: {"manifest": "<yaml-or-json-string>"}.
func (h *ApplyHandler) Apply(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Manifest string `json:"manifest"`
		Force    bool   `json:"force"` // take ownership of conflicting fields (intentional revert)
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body: "+err.Error())
		return
	}
	if body.Manifest == "" {
		writeError(w, http.StatusBadRequest, "manifest is required")
		return
	}

	results, err := h.kc.ApplyManifest(r.Context(), []byte(body.Manifest), body.Force)
	if err != nil {
		writeK8sError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, results)
}

// GetResource handles GET /api/v1/resources/{kind}/namespaces/{namespace}/{name}.
// Returns the resource as raw JSON.
func (h *ApplyHandler) GetResource(w http.ResponseWriter, r *http.Request) {
	kind := chi.URLParam(r, "kind")
	namespace := chi.URLParam(r, "namespace")
	name := chi.URLParam(r, "name")

	data, err := h.kc.GetResourceYAML(r.Context(), kind, namespace, name)
	if err != nil {
		writeK8sError(w, err)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	w.Write(data)
}

// GetClusterResource handles GET /api/v1/resources/{kind}/{name}.
// Returns a cluster-scoped resource as raw JSON.
func (h *ApplyHandler) GetClusterResource(w http.ResponseWriter, r *http.Request) {
	kind := chi.URLParam(r, "kind")
	name := chi.URLParam(r, "name")

	data, err := h.kc.GetResourceYAML(r.Context(), kind, "", name)
	if err != nil {
		writeK8sError(w, err)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	w.Write(data)
}

// UpdateResource handles PUT /api/v1/resources/{kind}/namespaces/{namespace}/{name}.
// Expects JSON body: {"manifest": "<yaml-or-json-string>"}.
func (h *ApplyHandler) UpdateResource(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Manifest string `json:"manifest"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body: "+err.Error())
		return
	}
	if body.Manifest == "" {
		writeError(w, http.StatusBadRequest, "manifest is required")
		return
	}

	if err := h.kc.UpdateResource(r.Context(), []byte(body.Manifest)); err != nil {
		writeK8sError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "updated"})
}

// DeleteResource handles DELETE /api/v1/resources/{kind}/namespaces/{namespace}/{name}.
func (h *ApplyHandler) DeleteResource(w http.ResponseWriter, r *http.Request) {
	kind := chi.URLParam(r, "kind")
	namespace := chi.URLParam(r, "namespace")
	name := chi.URLParam(r, "name")

	if err := h.kc.DeleteResource(r.Context(), kind, namespace, name); err != nil {
		writeK8sError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// DeleteClusterResource handles DELETE /api/v1/resources/{kind}/{name}.
func (h *ApplyHandler) DeleteClusterResource(w http.ResponseWriter, r *http.Request) {
	kind := chi.URLParam(r, "kind")
	name := chi.URLParam(r, "name")

	if err := h.kc.DeleteResource(r.Context(), kind, "", name); err != nil {
		writeK8sError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// UpdateClusterResource handles PUT /api/v1/resources/{kind}/{name}.
// Expects JSON body: {"manifest": "<yaml-or-json-string>"}.
func (h *ApplyHandler) UpdateClusterResource(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Manifest string `json:"manifest"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body: "+err.Error())
		return
	}
	if body.Manifest == "" {
		writeError(w, http.StatusBadRequest, "manifest is required")
		return
	}

	if err := h.kc.UpdateResource(r.Context(), []byte(body.Manifest)); err != nil {
		writeK8sError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "updated"})
}
