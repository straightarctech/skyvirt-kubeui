package k8s

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// FetchManifests shallow-clones a Git repo and returns the YAML manifests under
// `path`, concatenated. The raw material for GitOps-lite (fetch → diff → sync)
// with no Argo/Flux controller to operate. http(s) repos only — internal-mirror
// friendly and SSRF-bounded; credential prompts are disabled (so a private repo
// without a token fails fast rather than hanging). A token (with an optional
// username) authenticates private repos — injected into the HTTPS URL as
// userinfo, never logged, and redacted from any error output.
func (c *Client) FetchManifests(ctx context.Context, repoURL, ref, path, username, token string) (string, error) {
	if !strings.HasPrefix(repoURL, "http://") && !strings.HasPrefix(repoURL, "https://") {
		return "", fmt.Errorf("repo URL must be http(s)")
	}
	if strings.Contains(path, "..") {
		return "", fmt.Errorf("path must not contain '..'")
	}

	// For a private repo, embed the credential in the clone URL. Default username
	// "oauth2" works for both GitHub (PAT used as password) and GitLab.
	cloneURL := repoURL
	if token != "" {
		u, err := url.Parse(repoURL)
		if err != nil {
			return "", fmt.Errorf("invalid repo URL")
		}
		user := username
		if user == "" {
			user = "oauth2"
		}
		u.User = url.UserPassword(user, token)
		cloneURL = u.String()
	}

	dir, err := os.MkdirTemp("", "kubeui-gitops-*")
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(dir)

	args := []string{"clone", "--depth", "1", "--single-branch"}
	if ref != "" {
		args = append(args, "--branch", ref)
	}
	args = append(args, cloneURL, dir)
	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	if out, err := cmd.CombinedOutput(); err != nil {
		msg := strings.TrimSpace(string(out))
		if token != "" {
			msg = strings.ReplaceAll(msg, token, "***") // never leak the token
		}
		return "", fmt.Errorf("git clone failed: %s", msg)
	}

	root := filepath.Join(dir, filepath.Clean("/"+path))
	if !strings.HasPrefix(root, dir) {
		return "", fmt.Errorf("invalid path")
	}

	var docs []string
	err = filepath.Walk(root, func(p string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return err
		}
		if strings.HasSuffix(p, ".yaml") || strings.HasSuffix(p, ".yml") {
			if b, e := os.ReadFile(p); e == nil {
				docs = append(docs, strings.TrimSpace(string(b)))
			}
		}
		return nil
	})
	if err != nil {
		return "", err
	}
	if len(docs) == 0 {
		return "", fmt.Errorf("no .yaml/.yml manifests found under %q", path)
	}
	return strings.Join(docs, "\n---\n"), nil
}
