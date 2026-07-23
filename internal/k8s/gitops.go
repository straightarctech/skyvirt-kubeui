package k8s

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// FetchManifests shallow-clones a Git repo and returns the YAML manifests under
// `path`, concatenated. The raw material for GitOps-lite (fetch → diff → sync)
// with no Argo/Flux controller to operate. http(s) repos only — internal-mirror
// friendly and SSRF-bounded; credential prompts are disabled (private repos fail
// fast rather than hang).
func (c *Client) FetchManifests(ctx context.Context, repoURL, ref, path string) (string, error) {
	if !strings.HasPrefix(repoURL, "http://") && !strings.HasPrefix(repoURL, "https://") {
		return "", fmt.Errorf("repo URL must be http(s)")
	}
	if strings.Contains(path, "..") {
		return "", fmt.Errorf("path must not contain '..'")
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
	args = append(args, repoURL, dir)
	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	if out, err := cmd.CombinedOutput(); err != nil {
		return "", fmt.Errorf("git clone failed: %s", strings.TrimSpace(string(out)))
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
