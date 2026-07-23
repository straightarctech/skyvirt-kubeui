package api

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/straightarctech/skyvirt-kubeui/internal/k8s"
)

// revisionParam reads an optional ?revision=N (0 when absent/invalid = current).
func revisionParam(r *http.Request) int {
	n, _ := strconv.Atoi(r.URL.Query().Get("revision"))
	if n < 0 {
		return 0
	}
	return n
}

// HelmHandler serves Helm release REST endpoints.
type HelmHandler struct {
	kc *k8s.Client
}

func helmHandler(kc *k8s.Client) *HelmHandler {
	return &HelmHandler{kc: kc}
}

// List returns Helm releases across all namespaces.
func (h *HelmHandler) List(w http.ResponseWriter, r *http.Request) {
	items, err := h.kc.ListReleases(r.Context(), "")
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, items)
}

// ListNamespaced returns Helm releases in a specific namespace.
func (h *HelmHandler) ListNamespaced(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "namespace")
	items, err := h.kc.ListReleases(r.Context(), ns)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, items)
}

// Get returns a single Helm release.
func (h *HelmHandler) Get(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "namespace")
	name := chi.URLParam(r, "name")
	item, err := h.kc.GetRelease(r.Context(), ns, name)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, item)
}

type helmInstallRequest struct {
	ReleaseName string            `json:"release_name"`
	Namespace   string            `json:"namespace"`
	RepoURL     string            `json:"repo_url"`
	Chart       string            `json:"chart"`
	Version     string            `json:"version"`
	Values      map[string]string `json:"values"`
	ValuesYAML  string            `json:"values_yaml"` // full values.yaml (App Catalog install form)
}

// Install installs a Helm chart.
func (h *HelmHandler) Install(w http.ResponseWriter, r *http.Request) {
	var req helmInstallRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.ReleaseName == "" || req.Chart == "" {
		writeError(w, http.StatusBadRequest, "release_name and chart are required")
		return
	}
	if req.Namespace == "" {
		req.Namespace = "default"
	}

	out, err := h.kc.HelmInstall(r.Context(), req.Namespace, req.ReleaseName, req.RepoURL, req.Chart, req.Version, req.Values, req.ValuesYAML)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"message": "installed", "output": out})
}

// Upgrade upgrades a Helm release.
func (h *HelmHandler) Upgrade(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "namespace")
	name := chi.URLParam(r, "name")

	var req helmInstallRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Chart == "" {
		writeError(w, http.StatusBadRequest, "chart is required")
		return
	}

	out, err := h.kc.HelmUpgrade(r.Context(), ns, name, req.RepoURL, req.Chart, req.Version, req.Values)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"message": "upgraded", "output": out})
}

// Uninstall removes a Helm release.
func (h *HelmHandler) Uninstall(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "namespace")
	name := chi.URLParam(r, "name")

	if err := h.kc.HelmUninstall(r.Context(), ns, name); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"message": "uninstalled"})
}

// Rollback rolls back a Helm release.
func (h *HelmHandler) Rollback(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "namespace")
	name := chi.URLParam(r, "name")

	var req struct {
		Revision int `json:"revision"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if err := h.kc.HelmRollback(r.Context(), ns, name, req.Revision); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"message": "rolled back"})
}

// GetValues returns values for a release (optional ?revision=N).
func (h *HelmHandler) GetValues(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "namespace")
	name := chi.URLParam(r, "name")

	vals, err := h.kc.HelmGetValuesAt(r.Context(), ns, name, revisionParam(r))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"values": vals})
}

// GetManifest returns the rendered manifest for a release (optional ?revision=N).
func (h *HelmHandler) GetManifest(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "namespace")
	name := chi.URLParam(r, "name")

	manifest, err := h.kc.HelmGetManifest(r.Context(), ns, name, revisionParam(r))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"manifest": manifest})
}

// GetNotes returns the rendered NOTES.txt for a release.
func (h *HelmHandler) GetNotes(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "namespace")
	name := chi.URLParam(r, "name")

	notes, err := h.kc.HelmGetNotes(r.Context(), ns, name)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"notes": notes})
}

// History returns revision history for a release.
func (h *HelmHandler) History(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "namespace")
	name := chi.URLParam(r, "name")

	history, err := h.kc.HelmHistory(r.Context(), ns, name)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, history)
}

// SearchRepo searches a Helm repo for charts.
func (h *HelmHandler) SearchRepo(w http.ResponseWriter, r *http.Request) {
	repoURL := r.URL.Query().Get("repo_url")
	keyword := r.URL.Query().Get("keyword")
	if repoURL == "" {
		writeError(w, http.StatusBadRequest, "repo_url query param is required")
		return
	}

	results, err := h.kc.HelmSearchRepo(r.Context(), repoURL, keyword)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, results)
}

// ---------------------------------------------------------------------------
// App Catalog — repository management + chart browse/show.
// ---------------------------------------------------------------------------

// RepoList returns the configured Helm repositories.
func (h *HelmHandler) RepoList(w http.ResponseWriter, r *http.Request) {
	repos, err := h.kc.HelmRepoList(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, repos)
}

type helmRepoRequest struct {
	Name string `json:"name"`
	URL  string `json:"url"`
}

// RepoAdd adds (or force-updates) a Helm repository.
func (h *HelmHandler) RepoAdd(w http.ResponseWriter, r *http.Request) {
	var req helmRepoRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Name == "" || req.URL == "" {
		writeError(w, http.StatusBadRequest, "name and url are required")
		return
	}
	if err := h.kc.HelmRepoAdd(r.Context(), req.Name, req.URL); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"message": "added"})
}

// RepoRemove removes a configured Helm repository.
func (h *HelmHandler) RepoRemove(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	if err := h.kc.HelmRepoRemove(r.Context(), name); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"message": "removed"})
}

// CatalogSearch lists/searches charts across every configured repository (all
// charts when the q param is empty).
func (h *HelmHandler) CatalogSearch(w http.ResponseWriter, r *http.Request) {
	charts, err := h.kc.HelmSearchAll(r.Context(), r.URL.Query().Get("q"))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, charts)
}

// ChartShow returns a chart's metadata / default values / readme (?what=chart|values|readme)
// for the catalog detail + install form. ?chart=repo/chart, optional ?version=.
func (h *HelmHandler) ChartShow(w http.ResponseWriter, r *http.Request) {
	chart := r.URL.Query().Get("chart")
	if chart == "" {
		writeError(w, http.StatusBadRequest, "chart query param is required")
		return
	}
	what := r.URL.Query().Get("what")
	if what == "" {
		what = "chart"
	}
	out, err := h.kc.HelmShow(r.Context(), what, chart, r.URL.Query().Get("version"))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"content": out})
}
