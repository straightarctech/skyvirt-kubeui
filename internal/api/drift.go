package api

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/straightarctech/skyvirt-kubeui/internal/audit"
	"github.com/straightarctech/skyvirt-kubeui/internal/snapshot"
)

// DriftHandler serves the drift timeline — snapshot history of a resource, and
// on-demand capture of a namespace.
type DriftHandler struct {
	store snapshot.Store
	snap  *snapshot.Snapshotter
	audit audit.Store
}

func driftHandler(store snapshot.Store, snap *snapshot.Snapshotter, auditStore audit.Store) *DriftHandler {
	return &DriftHandler{store: store, snap: snap, audit: auditStore}
}

// attributedSnapshot pairs a snapshot with who/what caused the change it captured.
type attributedSnapshot struct {
	snapshot.Snapshot
	Origin     string `json:"origin"`                // kubeui | external | initial
	ChangedBy  string `json:"changed_by,omitempty"`  // user/email, when made through KubeUI
	ChangedVia string `json:"changed_via,omitempty"` // audit action (scale, apply, update…)
}

// Timeline returns a resource's snapshots (newest first), each attributed: a
// change made through KubeUI carries its author + action; a change with no
// matching KubeUI audit entry is flagged "external" (an out-of-band modification).
func (h *DriftHandler) Timeline(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	kind, name := q.Get("kind"), q.Get("name")
	if kind == "" || name == "" {
		writeError(w, http.StatusBadRequest, "kind and name are required")
		return
	}
	ns := q.Get("namespace")
	snaps, err := h.store.Timeline(r.Context(), kind, ns, name)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Recent audit entries (newest first) to attribute each change against.
	var audits []audit.Entry
	if h.audit != nil {
		audits, _ = h.audit.List(2000, 0)
	}

	out := make([]attributedSnapshot, len(snaps))
	for i := range snaps {
		a := attributedSnapshot{Snapshot: snaps[i]}
		if i == len(snaps)-1 { // oldest — the first capture, no prior change to attribute
			a.Origin = "initial"
		} else if e := matchAudit(audits, kind, ns, name, snaps[i+1].Taken, snaps[i].Taken); e != nil {
			a.Origin = "kubeui"
			if a.ChangedBy = e.Email; a.ChangedBy == "" {
				a.ChangedBy = e.User
			}
			a.ChangedVia = e.Action
		} else {
			a.Origin = "external"
		}
		out[i] = a
	}
	writeJSON(w, http.StatusOK, out)
}

// matchAudit returns the newest successful audit entry that mutated the resource
// in the window (after, upTo]. Audit entries are newest-first, so the first hit is
// the newest.
func matchAudit(entries []audit.Entry, kind, ns, name string, after, upTo time.Time) *audit.Entry {
	for i := range entries {
		e := &entries[i]
		if e.Status >= 300 || e.Kind != kind || e.Namespace != ns || e.Name != name {
			continue
		}
		if e.Timestamp.After(after) && !e.Timestamp.After(upTo) {
			return e
		}
	}
	return nil
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
