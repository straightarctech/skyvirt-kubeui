package api

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/straightarctech/skyvirt-kubeui/internal/k8s"
)

// NodesHandler serves node-related REST endpoints.
type NodesHandler struct {
	kc *k8s.Client
}

func nodesHandler(kc *k8s.Client) *NodesHandler {
	return &NodesHandler{kc: kc}
}

// List returns all cluster nodes.
func (h *NodesHandler) List(w http.ResponseWriter, r *http.Request) {
	items, err := h.kc.ListNodes(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, items)
}

// Get returns a single node by name.
func (h *NodesHandler) Get(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	item, err := h.kc.GetNode(r.Context(), name)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, item)
}

// Cordon marks a node as unschedulable.
func (h *NodesHandler) Cordon(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	if err := h.kc.CordonNode(r.Context(), name, true); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "cordoned"})
}

// Uncordon marks a node as schedulable again.
func (h *NodesHandler) Uncordon(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	if err := h.kc.CordonNode(r.Context(), name, false); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "uncordoned"})
}

// DrainPlan returns a dry-run drain plan (no cluster change): evictable pods,
// exempt pods, and any guarding PodDisruptionBudgets.
func (h *NodesHandler) DrainPlan(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	rep, err := h.kc.DrainPlan(r.Context(), name)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, rep)
}

// Drain cordons a node and evicts its pods through the PDB-aware Eviction API.
// Optional JSON body: {"grace_period_seconds": N, "timeout_seconds": N}.
func (h *NodesHandler) Drain(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	var body struct {
		GracePeriodSeconds int `json:"grace_period_seconds"`
		TimeoutSeconds     int `json:"timeout_seconds"`
	}
	// Body is optional — ignore decode errors (e.g. empty body).
	_ = json.NewDecoder(r.Body).Decode(&body)
	timeout := time.Duration(body.TimeoutSeconds) * time.Second

	rep, err := h.kc.DrainNode(r.Context(), name, body.GracePeriodSeconds, timeout)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, rep)
}

// SetLabels sets labels on a node. Expects JSON body: {"labels": {"key":"value", ...}}.
func (h *NodesHandler) SetLabels(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	var body struct {
		Labels map[string]string `json:"labels"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}
	if err := h.kc.SetNodeLabels(r.Context(), name, body.Labels); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "labels updated"})
}

// AddTaint adds a taint to a node. Expects JSON body: {"key":"...", "value":"...", "effect":"NoSchedule"}.
func (h *NodesHandler) AddTaint(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	var taint k8s.TaintInfo
	if err := json.NewDecoder(r.Body).Decode(&taint); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}
	if err := h.kc.TaintNode(r.Context(), name, taint, false); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "taint added"})
}

// RemoveTaint removes a taint from a node by key.
func (h *NodesHandler) RemoveTaint(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	key := chi.URLParam(r, "key")
	taint := k8s.TaintInfo{Key: key}
	if err := h.kc.TaintNode(r.Context(), name, taint, true); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "taint removed"})
}
