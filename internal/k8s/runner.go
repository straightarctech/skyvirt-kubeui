package k8s

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"strings"
)

// CommandRunner runs an external binary.
//
// WHY THIS EXISTS
// Two of this package's write paths shell out: every Helm operation (install,
// upgrade, rollback, uninstall, repo management — 24 call sites) and the GitOps
// clone. Before this seam they called exec.CommandContext directly, so NONE of
// them could be tested without the real binaries on PATH and, for GitOps, a
// reachable git server. Those are the paths that mutate customer clusters, which
// made them the worst code in the repo to leave unexercised.
//
// Client.Runner is nil in normal use and defaults to execRunner, so production
// behaviour is unchanged and no construction site had to be touched. Tests set it
// to a fake and assert on the commands that would have run.
type CommandRunner interface {
	Run(ctx context.Context, cmd Command) ([]byte, error)
}

// Command describes one external invocation. The fields are explicit rather than
// implied by separate methods, because the two callers genuinely differ: helm
// wants stdout with stderr folded into the error, git wants both streams together
// so the caller can redact a token before it reaches a log.
type Command struct {
	Name string
	Args []string
	// Env is appended to the inherited environment. Nil inherits unchanged.
	Env []string
	// Combined returns stdout and stderr together, and leaves the error as the
	// exec error rather than wrapping stderr into it.
	Combined bool
}

// String renders the command for assertions and error messages. Not for shell use.
func (c Command) String() string {
	return strings.TrimSpace(c.Name + " " + strings.Join(c.Args, " "))
}

// execRunner is the production implementation: it actually runs the binary.
type execRunner struct{}

func (execRunner) Run(ctx context.Context, c Command) ([]byte, error) {
	cmd := exec.CommandContext(ctx, c.Name, c.Args...)
	if len(c.Env) > 0 {
		cmd.Env = append(os.Environ(), c.Env...)
	}
	if c.Combined {
		return cmd.CombinedOutput()
	}
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		// Callers pattern-match on this string (e.g. "no repositories",
		// "No results found"), so the shape is part of the contract.
		return nil, fmt.Errorf("%s: %s", err, strings.TrimSpace(stderr.String()))
	}
	return stdout.Bytes(), nil
}

// runner returns the injected runner, or the real one when none is set. Keeping
// the zero value useful means every existing &Client{...} literal still works.
func (c *Client) runner() CommandRunner {
	if c.Runner != nil {
		return c.Runner
	}
	return execRunner{}
}
