package api

import (
	"context"
	"crypto/sha1"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"go.uber.org/zap"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/straightarctech/skyvirt-kubeui/internal/k8s"
)

const gitopsCMName = "kubeui-gitops-sources"

// GitOpsSource is a tracked Git repo/path plus its last reconcile status. Tokens
// are never persisted — auto-sync targets repos reachable without stored creds
// (a private-repo credential store is a later addition).
type GitOpsSource struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	RepoURL     string `json:"repo_url"`
	Ref         string `json:"ref"`
	Path        string `json:"path"`
	IntervalSec int    `json:"interval_sec"` // reconcile cadence (min 30)
	AutoApply   bool   `json:"auto_apply"`   // apply drift automatically, else detect-only

	// Status (updated by the reconciler).
	LastChecked string `json:"last_checked,omitempty"`
	LastSynced  string `json:"last_synced,omitempty"`
	InSync      bool   `json:"in_sync"`
	Create      int    `json:"create"`
	Update      int    `json:"update"`
	Errors      int    `json:"errors"`
	LastError   string `json:"last_error,omitempty"`
}

// GitOpsHandler serves GitOps-lite: on-demand fetch plus persistent sources that
// are reconciled (drift-detected, optionally auto-applied) on a schedule.
type GitOpsHandler struct {
	kc     *k8s.Client
	logger *zap.Logger
	mu     sync.Mutex
}

func gitopsHandler(kc *k8s.Client, logger *zap.Logger) *GitOpsHandler {
	return &GitOpsHandler{kc: kc, logger: logger}
}

// Fetch clones a repo and returns the manifests under a path; the frontend
// diffs them against the live cluster and syncs via the existing apply path.
func (h *GitOpsHandler) Fetch(w http.ResponseWriter, r *http.Request) {
	var req struct {
		RepoURL  string `json:"repo_url"`
		Ref      string `json:"ref"`
		Path     string `json:"path"`
		Username string `json:"username"`
		Token    string `json:"token"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.RepoURL == "" {
		writeError(w, http.StatusBadRequest, "repo_url is required")
		return
	}
	manifests, err := h.kc.FetchManifests(r.Context(), req.RepoURL, req.Ref, req.Path, req.Username, req.Token)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"manifests": manifests})
}

// --- Sources CRUD -----------------------------------------------------------

func (h *GitOpsHandler) ListSources(w http.ResponseWriter, r *http.Request) {
	srcs, err := h.load(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, srcs)
}

func (h *GitOpsHandler) CreateSource(w http.ResponseWriter, r *http.Request) {
	var in GitOpsSource
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil || in.RepoURL == "" {
		writeError(w, http.StatusBadRequest, "repo_url is required")
		return
	}
	if in.IntervalSec < 30 {
		in.IntervalSec = 300
	}
	if in.Name == "" {
		in.Name = in.RepoURL
	}
	in.ID = sourceID(in.RepoURL, in.Ref, in.Path)

	h.mu.Lock()
	defer h.mu.Unlock()
	srcs, err := h.load(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	replaced := false
	for i := range srcs {
		if srcs[i].ID == in.ID {
			// Preserve status; update the editable fields.
			srcs[i].Name, srcs[i].IntervalSec, srcs[i].AutoApply = in.Name, in.IntervalSec, in.AutoApply
			in = srcs[i]
			replaced = true
			break
		}
	}
	if !replaced {
		srcs = append(srcs, in)
	}
	if err := h.save(r.Context(), srcs); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, in)
}

func (h *GitOpsHandler) DeleteSource(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	h.mu.Lock()
	defer h.mu.Unlock()
	srcs, err := h.load(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	out := srcs[:0]
	for _, s := range srcs {
		if s.ID != id {
			out = append(out, s)
		}
	}
	if err := h.save(r.Context(), out); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// SyncSource reconciles one source immediately (respects its auto_apply flag).
func (h *GitOpsHandler) SyncSource(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	srcs, err := h.load(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	for i := range srcs {
		if srcs[i].ID == id {
			h.reconcile(r.Context(), &srcs[i])
			h.mu.Lock()
			_ = h.persistStatus(r.Context(), srcs[i])
			h.mu.Unlock()
			writeJSON(w, http.StatusOK, srcs[i])
			return
		}
	}
	writeError(w, http.StatusNotFound, "source not found")
}

// --- Reconciler -------------------------------------------------------------

// RunScheduler reconciles due sources on a 30s tick.
func (h *GitOpsHandler) RunScheduler(ctx context.Context) {
	t := time.NewTicker(30 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			srcs, err := h.load(ctx)
			if err != nil {
				continue
			}
			changed := false
			now := time.Now()
			for i := range srcs {
				if !due(srcs[i], now) {
					continue
				}
				h.reconcile(ctx, &srcs[i])
				changed = true
			}
			if changed {
				h.mu.Lock()
				_ = h.save(ctx, srcs)
				h.mu.Unlock()
			}
		}
	}
}

func due(s GitOpsSource, now time.Time) bool {
	if s.LastChecked == "" {
		return true
	}
	last, err := time.Parse(time.RFC3339, s.LastChecked)
	if err != nil {
		return true
	}
	iv := s.IntervalSec
	if iv < 30 {
		iv = 300
	}
	return now.Sub(last) >= time.Duration(iv)*time.Second
}

// reconcile fetches, plans against live, and (when auto_apply) applies drift.
// It updates the source's status in place.
func (h *GitOpsHandler) reconcile(ctx context.Context, s *GitOpsSource) {
	s.LastChecked = time.Now().UTC().Format(time.RFC3339)
	s.LastError = ""
	manifests, err := h.kc.FetchManifests(ctx, s.RepoURL, s.Ref, s.Path, "", "")
	if err != nil {
		s.LastError, s.InSync = err.Error(), false
		return
	}
	plan, err := h.kc.PlanManifest(ctx, []byte(manifests))
	if err != nil {
		s.LastError, s.InSync = err.Error(), false
		return
	}
	s.Create, s.Update, s.Errors, s.InSync = plan.Create, plan.Update, plan.Errors, plan.InSync

	if s.AutoApply && !plan.InSync && plan.Errors == 0 {
		if _, err := h.kc.ApplyManifest(ctx, []byte(manifests), false); err != nil {
			s.LastError = "apply: " + err.Error()
			return
		}
		// Re-plan to reflect the post-apply state.
		if p2, err := h.kc.PlanManifest(ctx, []byte(manifests)); err == nil {
			s.Create, s.Update, s.Errors, s.InSync = p2.Create, p2.Update, p2.Errors, p2.InSync
		}
		s.LastSynced = time.Now().UTC().Format(time.RFC3339)
		if h.logger != nil {
			h.logger.Info("gitops auto-sync applied", zap.String("source", s.Name))
		}
	}
}

// --- Store (ConfigMap-backed) ----------------------------------------------

func (h *GitOpsHandler) load(ctx context.Context) ([]GitOpsSource, error) {
	cm, err := h.kc.Clientset.CoreV1().ConfigMaps(ownNamespace()).Get(ctx, gitopsCMName, metav1.GetOptions{})
	if apierrors.IsNotFound(err) {
		return []GitOpsSource{}, nil
	}
	if err != nil {
		return nil, err
	}
	var srcs []GitOpsSource
	if raw := cm.Data["sources"]; raw != "" {
		if err := json.Unmarshal([]byte(raw), &srcs); err != nil {
			return nil, err
		}
	}
	return srcs, nil
}

func (h *GitOpsHandler) save(ctx context.Context, srcs []GitOpsSource) error {
	b, err := json.Marshal(srcs)
	if err != nil {
		return err
	}
	cms := h.kc.Clientset.CoreV1().ConfigMaps(ownNamespace())
	cm, err := cms.Get(ctx, gitopsCMName, metav1.GetOptions{})
	if apierrors.IsNotFound(err) {
		_, err = cms.Create(ctx, &corev1.ConfigMap{
			ObjectMeta: metav1.ObjectMeta{
				Name: gitopsCMName, Namespace: ownNamespace(),
				Labels: map[string]string{"app.kubernetes.io/managed-by": "kubeui"},
			},
			Data: map[string]string{"sources": string(b)},
		}, metav1.CreateOptions{})
		return err
	} else if err != nil {
		return err
	}
	if cm.Data == nil {
		cm.Data = map[string]string{}
	}
	cm.Data["sources"] = string(b)
	_, err = cms.Update(ctx, cm, metav1.UpdateOptions{})
	return err
}

// persistStatus writes back one source's latest status (caller holds the lock).
func (h *GitOpsHandler) persistStatus(ctx context.Context, s GitOpsSource) error {
	srcs, err := h.load(ctx)
	if err != nil {
		return err
	}
	for i := range srcs {
		if srcs[i].ID == s.ID {
			srcs[i] = s
			return h.save(ctx, srcs)
		}
	}
	return nil
}

func sourceID(repo, ref, path string) string {
	sum := sha1.Sum([]byte(repo + "\n" + ref + "\n" + path))
	return fmt.Sprintf("%x", sum[:8])
}
