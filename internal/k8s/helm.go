package k8s

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"regexp"
	"strings"
	"time"
)

// helmNameRe validates Helm release/repo names: alphanumeric, dashes, dots, underscores.
var helmNameRe = regexp.MustCompile(`^[a-zA-Z0-9._-]+$`)

// validateHelmName ensures a name is safe for use as a Helm CLI argument.
func validateHelmName(name, label string) error {
	if name == "" {
		return fmt.Errorf("%s must not be empty", label)
	}
	if strings.HasPrefix(name, "-") {
		return fmt.Errorf("%s must not start with a dash", label)
	}
	if !helmNameRe.MatchString(name) {
		return fmt.Errorf("%s contains invalid characters (only alphanumeric, dash, dot, underscore allowed)", label)
	}
	if len(name) > 253 {
		return fmt.Errorf("%s is too long (max 253 chars)", label)
	}
	return nil
}

// validateHelmValue ensures a --set value doesn't inject flags.
func validateHelmValue(v string) error {
	if strings.HasPrefix(v, "-") {
		return fmt.Errorf("value must not start with a dash")
	}
	return nil
}

// validateHelmChartRef ensures a chart reference ("repo/chart", a name, or an
// oci:// ref) can't be parsed by helm as a flag. It may contain "/" and ".",
// so validateHelmName is too strict.
func validateHelmChartRef(chart string) error {
	if chart == "" {
		return fmt.Errorf("chart must not be empty")
	}
	if strings.HasPrefix(chart, "-") {
		return fmt.Errorf("chart must not start with a dash")
	}
	return nil
}

// validateHelmRepoURL ensures the repo URL is an http(s)/oci URL, not a flag or
// a local path helm would treat as an argument.
func validateHelmRepoURL(u string) error {
	if strings.HasPrefix(u, "-") {
		return fmt.Errorf("repo URL must not start with a dash")
	}
	if !strings.HasPrefix(u, "http://") && !strings.HasPrefix(u, "https://") && !strings.HasPrefix(u, "oci://") {
		return fmt.Errorf("repo URL must be an http(s) or oci:// URL")
	}
	return nil
}

// repoNameForURL returns a deterministic, safe repo name from a URL.
func repoNameForURL(url string) string {
	h := sha256.Sum256([]byte(url))
	return "kubeui-" + hex.EncodeToString(h[:8])
}

// HelmRelease describes a Helm release in the cluster.
type HelmRelease struct {
	Name      string    `json:"name"`
	Namespace string    `json:"namespace"`
	Chart     string    `json:"chart"`
	Version   string    `json:"version"`
	Status    string    `json:"status"`
	Revision  string    `json:"revision"`
	UpdatedAt time.Time `json:"updated_at"`
	AppVer    string    `json:"app_version"`
}

// helmListEntry matches `helm list --output json` format.
type helmListEntry struct {
	Name       string `json:"name"`
	Namespace  string `json:"namespace"`
	Revision   string `json:"revision"`
	Updated    string `json:"updated"`
	Status     string `json:"status"`
	Chart      string `json:"chart"`
	AppVersion string `json:"app_version"`
}

func helmCmd(ctx context.Context, args ...string) ([]byte, error) {
	cmd := exec.CommandContext(ctx, "helm", args...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("%s: %s", err, strings.TrimSpace(stderr.String()))
	}
	return stdout.Bytes(), nil
}

// ListReleases returns Helm releases.
func (c *Client) ListReleases(ctx context.Context, namespace string) ([]HelmRelease, error) {
	args := []string{"list", "--output", "json", "--time-format", time.RFC3339}
	if namespace == "" {
		args = append(args, "--all-namespaces")
	} else {
		args = append(args, "--namespace", namespace)
	}
	out, err := helmCmd(ctx, args...)
	if err != nil {
		return nil, err
	}
	var entries []helmListEntry
	if err := json.Unmarshal(out, &entries); err != nil {
		return nil, fmt.Errorf("parsing helm output: %w", err)
	}
	releases := make([]HelmRelease, 0, len(entries))
	for _, e := range entries {
		t, _ := time.Parse(time.RFC3339, e.Updated)
		releases = append(releases, HelmRelease{
			Name:      e.Name,
			Namespace: e.Namespace,
			Chart:     e.Chart,
			Version:   e.Revision,
			Status:    e.Status,
			Revision:  e.Revision,
			UpdatedAt: t,
			AppVer:    e.AppVersion,
		})
	}
	return releases, nil
}

// GetRelease returns a single Helm release.
func (c *Client) GetRelease(ctx context.Context, namespace, name string) (*HelmRelease, error) {
	releases, err := c.ListReleases(ctx, namespace)
	if err != nil {
		return nil, err
	}
	for _, r := range releases {
		if r.Name == name {
			return &r, nil
		}
	}
	return nil, fmt.Errorf("release %q not found in namespace %q", name, namespace)
}

// writeValuesFile writes a raw values.yaml to a temp file and returns its path
// plus a cleanup func. Empty content returns ("", noop, nil).
func writeValuesFile(valuesYAML string) (string, func(), error) {
	if strings.TrimSpace(valuesYAML) == "" {
		return "", func() {}, nil
	}
	f, err := os.CreateTemp("", "kubeui-values-*.yaml")
	if err != nil {
		return "", func() {}, err
	}
	if _, err := f.WriteString(valuesYAML); err != nil {
		f.Close()
		os.Remove(f.Name())
		return "", func() {}, err
	}
	f.Close()
	return f.Name(), func() { os.Remove(f.Name()) }, nil
}

// HelmInstall installs a chart. repoURL is the Helm repo URL, chart is "repo/chart".
// valuesYAML, when non-empty, is passed as a full values file (`-f`); the `values`
// map is applied on top as `--set` overrides.
func (c *Client) HelmInstall(ctx context.Context, namespace, releaseName, repoURL, chartName, version string, values map[string]string, valuesYAML string) (string, error) {
	if err := validateHelmName(releaseName, "release name"); err != nil {
		return "", err
	}
	if err := validateHelmName(namespace, "namespace"); err != nil {
		return "", err
	}
	if err := validateHelmChartRef(chartName); err != nil {
		return "", err
	}
	// Add repo if URL provided.
	if repoURL != "" {
		if err := validateHelmRepoURL(repoURL); err != nil {
			return "", err
		}
		repoName := repoNameForURL(repoURL)
		if _, err := helmCmd(ctx, "repo", "add", repoName, repoURL, "--force-update"); err != nil {
			return "", fmt.Errorf("adding repo: %w", err)
		}
		if _, err := helmCmd(ctx, "repo", "update", repoName); err != nil {
			c.Logger.Warn("repo update warning")
		}
		if !strings.Contains(chartName, "/") {
			chartName = repoName + "/" + chartName
		}
	}

	args := []string{"install", releaseName, chartName, "--namespace", namespace, "--create-namespace", "--output", "json", "--wait", "--timeout", "5m"}
	if version != "" {
		if err := validateHelmName(version, "version"); err != nil {
			return "", err
		}
		args = append(args, "--version", version)
	}
	valuesPath, cleanup, err := writeValuesFile(valuesYAML)
	if err != nil {
		return "", fmt.Errorf("writing values file: %w", err)
	}
	defer cleanup()
	if valuesPath != "" {
		args = append(args, "-f", valuesPath)
	}
	for k, v := range values {
		if err := validateHelmValue(k); err != nil {
			return "", fmt.Errorf("invalid value key %q: %w", k, err)
		}
		args = append(args, "--set", k+"="+v)
	}
	out, err := helmCmd(ctx, args...)
	if err != nil {
		return "", err
	}
	return string(out), nil
}

// HelmUpgrade upgrades a release. A non-empty valuesYAML replaces the release
// values with the supplied file (values-editing flow); --set pairs are layered
// on top. When dryRun is true nothing is applied — helm renders the release and
// returns it as JSON (the ".manifest" field), which powers the pre-upgrade diff.
func (c *Client) HelmUpgrade(ctx context.Context, namespace, releaseName, repoURL, chartName, version string, values map[string]string, valuesYAML string, dryRun bool) (string, error) {
	if err := validateHelmName(releaseName, "release name"); err != nil {
		return "", err
	}
	if err := validateHelmName(namespace, "namespace"); err != nil {
		return "", err
	}
	if err := validateHelmChartRef(chartName); err != nil {
		return "", err
	}
	if repoURL != "" {
		if err := validateHelmRepoURL(repoURL); err != nil {
			return "", err
		}
		repoName := repoNameForURL(repoURL)
		if _, err := helmCmd(ctx, "repo", "add", repoName, repoURL, "--force-update"); err != nil {
			return "", fmt.Errorf("adding repo: %w", err)
		}
		if _, err := helmCmd(ctx, "repo", "update", repoName); err != nil {
			c.Logger.Warn("repo update warning")
		}
		if !strings.Contains(chartName, "/") {
			chartName = repoName + "/" + chartName
		}
	}

	args := []string{"upgrade", releaseName, chartName, "--namespace", namespace, "--output", "json"}
	if dryRun {
		// A dry run renders without touching the cluster; --wait would just block.
		args = append(args, "--dry-run")
	} else {
		args = append(args, "--wait", "--timeout", "5m")
	}
	if version != "" {
		if err := validateHelmName(version, "version"); err != nil {
			return "", err
		}
		args = append(args, "--version", version)
	}
	valuesPath, cleanup, err := writeValuesFile(valuesYAML)
	if err != nil {
		return "", fmt.Errorf("writing values file: %w", err)
	}
	defer cleanup()
	if valuesPath != "" {
		args = append(args, "-f", valuesPath)
	}
	for k, v := range values {
		if err := validateHelmValue(k); err != nil {
			return "", fmt.Errorf("invalid value key %q: %w", k, err)
		}
		args = append(args, "--set", k+"="+v)
	}
	out, err := helmCmd(ctx, args...)
	if err != nil {
		return "", err
	}
	return string(out), nil
}

// HelmUpgradePreview renders the proposed upgrade without applying it and returns
// the current and proposed manifests, ready to diff. No cluster change is made.
func (c *Client) HelmUpgradePreview(ctx context.Context, namespace, releaseName, repoURL, chartName, version string, values map[string]string, valuesYAML string) (current, proposed string, err error) {
	current, err = c.HelmGetManifest(ctx, namespace, releaseName, 0)
	if err != nil {
		return "", "", fmt.Errorf("reading current manifest: %w", err)
	}
	out, err := c.HelmUpgrade(ctx, namespace, releaseName, repoURL, chartName, version, values, valuesYAML, true)
	if err != nil {
		return "", "", err
	}
	var rel struct {
		Manifest string `json:"manifest"`
	}
	if err := json.Unmarshal([]byte(out), &rel); err != nil {
		return "", "", fmt.Errorf("parsing dry-run output: %w", err)
	}
	return current, rel.Manifest, nil
}

// HelmUninstall removes a release.
func (c *Client) HelmUninstall(ctx context.Context, namespace, releaseName string) error {
	if err := validateHelmName(releaseName, "release name"); err != nil {
		return err
	}
	if err := validateHelmName(namespace, "namespace"); err != nil {
		return err
	}
	_, err := helmCmd(ctx, "uninstall", releaseName, "--namespace", namespace)
	return err
}

// HelmRollback rolls back a release to a specific revision.
func (c *Client) HelmRollback(ctx context.Context, namespace, releaseName string, revision int) error {
	if err := validateHelmName(releaseName, "release name"); err != nil {
		return err
	}
	if revision < 1 {
		return fmt.Errorf("revision must be >= 1")
	}
	_, err := helmCmd(ctx, "rollback", releaseName, fmt.Sprintf("%d", revision), "--namespace", namespace, "--wait")
	return err
}

// HelmGetValues returns the values for a release.
func (c *Client) HelmGetValues(ctx context.Context, namespace, releaseName string) (string, error) {
	if err := validateHelmName(releaseName, "release name"); err != nil {
		return "", err
	}
	out, err := helmCmd(ctx, "get", "values", releaseName, "--namespace", namespace, "--all", "--output", "yaml")
	if err != nil {
		return "", err
	}
	return string(out), nil
}

// HelmGetValuesAt returns the values for a release at a specific revision
// (revision <= 0 = current). --all includes chart defaults so diffs are complete.
func (c *Client) HelmGetValuesAt(ctx context.Context, namespace, releaseName string, revision int) (string, error) {
	if err := validateHelmName(releaseName, "release name"); err != nil {
		return "", err
	}
	args := []string{"get", "values", releaseName, "--namespace", namespace, "--all", "--output", "yaml"}
	if revision > 0 {
		args = append(args, "--revision", fmt.Sprintf("%d", revision))
	}
	out, err := helmCmd(ctx, args...)
	if err != nil {
		return "", err
	}
	return string(out), nil
}

// HelmGetManifest returns the rendered manifest (all objects) for a release at a
// revision (revision <= 0 = current) — the raw material for a revision diff.
func (c *Client) HelmGetManifest(ctx context.Context, namespace, releaseName string, revision int) (string, error) {
	if err := validateHelmName(releaseName, "release name"); err != nil {
		return "", err
	}
	args := []string{"get", "manifest", releaseName, "--namespace", namespace}
	if revision > 0 {
		args = append(args, "--revision", fmt.Sprintf("%d", revision))
	}
	out, err := helmCmd(ctx, args...)
	if err != nil {
		return "", err
	}
	return string(out), nil
}

// HelmGetNotes returns the release notes.
func (c *Client) HelmGetNotes(ctx context.Context, namespace, releaseName string) (string, error) {
	if err := validateHelmName(releaseName, "release name"); err != nil {
		return "", err
	}
	out, err := helmCmd(ctx, "get", "notes", releaseName, "--namespace", namespace)
	if err != nil {
		return "", err
	}
	return string(out), nil
}

// HelmHistory returns the revision history for a release.
func (c *Client) HelmHistory(ctx context.Context, namespace, releaseName string) ([]map[string]interface{}, error) {
	if err := validateHelmName(releaseName, "release name"); err != nil {
		return nil, err
	}
	out, err := helmCmd(ctx, "history", releaseName, "--namespace", namespace, "--output", "json")
	if err != nil {
		return nil, err
	}
	var history []map[string]interface{}
	if err := json.Unmarshal(out, &history); err != nil {
		return nil, err
	}
	return history, nil
}

// HelmSearchRepo searches a repo for charts.
func (c *Client) HelmSearchRepo(ctx context.Context, repoURL, keyword string) ([]map[string]interface{}, error) {
	if err := validateHelmRepoURL(repoURL); err != nil {
		return nil, err
	}
	repoName := repoNameForURL(repoURL)
	if _, err := helmCmd(ctx, "repo", "add", repoName, repoURL, "--force-update"); err != nil {
		return nil, fmt.Errorf("adding repo: %w", err)
	}
	if _, err := helmCmd(ctx, "repo", "update", repoName); err != nil {
		c.Logger.Warn("repo update warning")
	}

	args := []string{"search", "repo", repoName, "--output", "json"}
	if keyword != "" {
		args = []string{"search", "repo", repoName + "/" + keyword, "--output", "json"}
	}
	out, err := helmCmd(ctx, args...)
	if err != nil {
		return nil, err
	}
	var results []map[string]interface{}
	if err := json.Unmarshal(out, &results); err != nil {
		return nil, err
	}
	return results, nil
}

// ---------------------------------------------------------------------------
// App Catalog — repository management + chart browse/show.
//
// Built on Helm's own persistent repo config (HELM_REPOSITORY_CONFIG), so
// configured repos survive across requests with no extra storage, and OCI +
// air-gapped mirrors work out of the box.
// ---------------------------------------------------------------------------

// HelmRepo is a configured Helm chart repository.
type HelmRepo struct {
	Name string `json:"name"`
	URL  string `json:"url"`
}

// HelmRepoList returns the configured Helm repositories (empty, not an error,
// when none are configured yet).
func (c *Client) HelmRepoList(ctx context.Context) ([]HelmRepo, error) {
	out, err := helmCmd(ctx, "repo", "list", "--output", "json")
	if err != nil {
		if strings.Contains(err.Error(), "no repositories") {
			return []HelmRepo{}, nil
		}
		return nil, err
	}
	var repos []HelmRepo
	if err := json.Unmarshal(out, &repos); err != nil {
		return nil, fmt.Errorf("parsing repo list: %w", err)
	}
	return repos, nil
}

// HelmRepoAdd adds (or force-updates) a named repository and refreshes its index.
func (c *Client) HelmRepoAdd(ctx context.Context, name, url string) error {
	if err := validateHelmName(name, "repo name"); err != nil {
		return err
	}
	if err := validateHelmRepoURL(url); err != nil {
		return err
	}
	if _, err := helmCmd(ctx, "repo", "add", name, url, "--force-update"); err != nil {
		return err
	}
	if _, err := helmCmd(ctx, "repo", "update", name); err != nil {
		c.Logger.Warn("repo index update warning")
	}
	return nil
}

// HelmRepoRemove removes a configured repository.
func (c *Client) HelmRepoRemove(ctx context.Context, name string) error {
	if err := validateHelmName(name, "repo name"); err != nil {
		return err
	}
	_, err := helmCmd(ctx, "repo", "remove", name)
	return err
}

// CatalogChart is a chart available in a configured repository.
type CatalogChart struct {
	Name        string `json:"name"` // "repo/chart"
	Version     string `json:"version"`
	AppVersion  string `json:"app_version"`
	Description string `json:"description"`
}

// HelmSearchAll searches every configured repository for charts (all charts when
// keyword is empty). Returns empty (not an error) when nothing matches or no repos
// are configured.
func (c *Client) HelmSearchAll(ctx context.Context, keyword string) ([]CatalogChart, error) {
	args := []string{"search", "repo", "--output", "json"}
	if keyword != "" {
		if err := validateHelmChartRef(keyword); err != nil {
			return nil, err
		}
		args = []string{"search", "repo", keyword, "--output", "json"}
	}
	out, err := helmCmd(ctx, args...)
	if err != nil {
		e := err.Error()
		if strings.Contains(e, "No results found") || strings.Contains(e, "no repositories") {
			return []CatalogChart{}, nil
		}
		return nil, err
	}
	var charts []CatalogChart
	if err := json.Unmarshal(out, &charts); err != nil {
		return nil, err
	}
	return charts, nil
}

// HelmShow returns `helm show <what>` for a chart ref ("repo/chart"), where what is
// one of "chart" (Chart.yaml metadata), "values" (default values.yaml — seeds the
// install form), or "readme". version is optional (latest when empty).
func (c *Client) HelmShow(ctx context.Context, what, chartRef, version string) (string, error) {
	switch what {
	case "chart", "values", "readme":
	default:
		return "", fmt.Errorf("unsupported show target %q", what)
	}
	if err := validateHelmChartRef(chartRef); err != nil {
		return "", err
	}
	args := []string{"show", what, chartRef}
	if version != "" {
		if err := validateHelmName(version, "version"); err != nil {
			return "", err
		}
		args = append(args, "--version", version)
	}
	out, err := helmCmd(ctx, args...)
	if err != nil {
		return "", err
	}
	return string(out), nil
}
