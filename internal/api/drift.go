package api

import (
	"encoding/json"
	"net/http"

	"github.com/straightarctech/skyvirt-kubeui/internal/snapshot"
)

// DriftHandler serves the drift timeline — snapshot history of a resource, and
// on-demand capture of a namespace.
type DriftHandler struct {
	store snapshot.Store
	snap  *snapshot.Snapshotter
}

func driftHandler(store snapshot.Store, snap *snapshot.Snapshotter) *DriftHandler {
	return &DriftHandler{store: store, snap: snap}
}

// Timeline returns a resource's snapshots, newest first (each with its stripped
// YAML so the client can diff any two points).
func (h *DriftHandler) Timeline(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	kind, name := q.Get("kind"), q.Get("name")
	if kind == "" || name == "" {
		writeError(w, http.StatusBadRequest, "kind and name are required")
		return
	}
	snaps, err := h.store.Timeline(r.Context(), kind, q.Get("namespace"), name)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, snaps)
}

// SnapshotNow captures every curated resource in a namespace immediately.
func (h *DriftHandler) SnapshotNow(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Namespace string `json:"namespace"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Namespace == "" {
		writeError(w, http.StatusBadRequest, "namespace is required")
		return
	}
	n, err := h.snap.SnapshotNamespace(r.Context(), req.Namespace, "on-demand")
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]int{"new": n})
}

// Tracked lists every resource that has a snapshot timeline.
func (h *DriftHandler) Tracked(w http.ResponseWriter, r *http.Request) {
	refs, err := h.store.List(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, refs)
}
