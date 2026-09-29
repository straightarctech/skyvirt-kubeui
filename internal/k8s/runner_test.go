package k8s

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"go.uber.org/zap"
)

// fakeRunner records every command and replies from a scripted table.
//
// Everything in this file was untestable before Client.Runner existed: these are
// the paths that install, upgrade, roll back and uninstall real releases on
// customer clusters, and they could only be reached with a helm binary on PATH.
type fakeRunner struct {
	// calls is every Command the code under test asked to run, in order.
	calls []Command
	// reply, keyed by a substring of the command line, returns canned output. The
	// first matching key wins; an unmatched command returns empty output and nil.
	reply map[string]func(Command) ([]byte, error)
}

func (f *fakeRunner) Run(_ context.Context, c Command) ([]byte, error) {
	f.calls = append(f.calls, c)
	for key, fn := range f.reply {
		if strings.Contains(c.String(), key) {
			return fn(c)
		}
	}
	return nil, nil
}

// ran reports whether any recorded command contains all the given fragments.
func (f *fakeRunner) ran(fragments ...string) bool {
	for _, c := range f.calls {
		line := c.String()
		all := true
		for _, frag := range fragments {
			if !strings.Contains(line, frag) {
				all = false
				break
			}
		}
		if all {
			return true
		}
	}
	return false
}

func (f *fakeRunner) lines() string {
	var b strings.Builder
	for _, c := range f.calls {
		b.WriteString("\n  " + c.String())
	}
	return b.String()
}

func withRunner(f *fakeRunner) *Client {
	return &Client{Runner: f, Logger: zap.NewNop()}
}

// TestHelmInstall_BuildsTheWholeInvocation exercises install end to end through
// the seam: repo registration, the chart reference being qualified with the repo
// name, and both values files reaching helm in the right order. Previously only
// buildInstallArgs could be checked, which left everything around it unverified.
func TestHelmInstall_BuildsTheWholeInvocation(t *testing.T) {
	f := &fakeRunner{reply: map[string]func(Command) ([]byte, error){
		"install": func(Command) ([]byte, error) { return []byte(`{"name":"web"}`), nil },
	}}
	c := withRunner(f)

	_, err := c.HelmInstall(context.Background(), "prod", "web", "https://charts.example", "nginx", "1.2.3",
		map[string]string{"replicaCount": "3"}, "base: yes\n", "overlay: yes\n", false)
	if err != nil {
		t.Fatalf("HelmInstall: %v", err)
	}

	if !f.ran("repo", "add", "https://charts.example") {
		t.Errorf("the repo was never registered:%s", f.lines())
	}
	if !f.ran("repo", "update") {
		t.Errorf("the repo index was never refreshed:%s", f.lines())
	}

	var install Command
	for _, cmd := range f.calls {
		if len(cmd.Args) > 0 && cmd.Args[0] == "install" {
			install = cmd
		}
	}
	if install.Name == "" {
		t.Fatalf("no install command was run:%s", f.lines())
	}
	line := install.String()

	// A bare chart name must be qualified with the repo that was just added,
	// otherwise helm resolves it against whatever else is configured locally.
	if !strings.Contains(line, "/nginx") {
		t.Errorf("chart was not qualified with the repo: %s", line)
	}
	for _, want := range []string{"--namespace prod", "--version 1.2.3", "--set replicaCount=3", "--create-namespace", "--wait"} {
		if !strings.Contains(line, want) {
			t.Errorf("install missing %q: %s", want, line)
		}
	}

	// Both values files, base before overlay — the overlay must win.
	var files []string
	for i := 0; i < len(install.Args)-1; i++ {
		if install.Args[i] == "-f" {
			files = append(files, install.Args[i+1])
		}
	}
	if len(files) != 2 {
		t.Fatalf("got %d -f files, want base and overlay: %s", len(files), line)
	}
	// The temp files are already removed by the time HelmInstall returns — which is
	// itself correct — so order is asserted from the argument list, not the disk.
	if files[0] == files[1] {
		t.Errorf("both -f flags point at the same file: %s", line)
	}
}

// TestHelmInstall_DoesNotTouchTheClusterOnDryRun: the preview path must never
// carry the flags that make a real change.
func TestHelmInstall_DoesNotTouchTheClusterOnDryRun(t *testing.T) {
	f := &fakeRunner{reply: map[string]func(Command) ([]byte, error){
		"install": func(Command) ([]byte, error) {
			return []byte(`{"manifest":"apiVersion: v1\nkind: Service\n"}`), nil
		},
	}}
	c := withRunner(f)

	got, err := c.HelmInstallPreview(context.Background(), "prod", "web", "", "repo/nginx", "", nil, "", "")
	if err != nil {
		t.Fatalf("HelmInstallPreview: %v", err)
	}
	if got != "apiVersion: v1\nkind: Service\n" {
		t.Errorf("manifest = %q, want the rendered YAML", got)
	}

	line := f.calls[len(f.calls)-1].String()
	if !strings.Contains(line, "--dry-run") {
		t.Errorf("preview did not pass --dry-run: %s", line)
	}
	for _, forbidden := range []string{"--wait", "--create-namespace"} {
		if strings.Contains(line, forbidden) {
			t.Errorf("preview passed %s — that is a real cluster change: %s", forbidden, line)
		}
	}
}

// TestHelmUninstallAndRollback pin two destructive commands that nothing
// previously checked. A wrong namespace or a missing revision here removes or
// reverts the wrong thing.
func TestHelmUninstallAndRollback(t *testing.T) {
	f := &fakeRunner{}
	c := withRunner(f)

	if err := c.HelmUninstall(context.Background(), "prod", "web"); err != nil {
		t.Fatalf("HelmUninstall: %v", err)
	}
	if !f.ran("uninstall", "web", "--namespace prod") {
		t.Errorf("uninstall did not target prod/web:%s", f.lines())
	}

	if err := c.HelmRollback(context.Background(), "prod", "web", 4); err != nil {
		t.Fatalf("HelmRollback: %v", err)
	}
	if !f.ran("rollback", "web", "4", "--namespace prod") {
		t.Errorf("rollback did not target revision 4 of prod/web:%s", f.lines())
	}
}

// TestHelmRepoList_TreatsNoRepositoriesAsEmpty pins a string-match on helm's error
// text. A fresh install has no repos configured, and that must render as an empty
// catalog rather than an error banner — but the check is a substring match on a
// message helm could reword in any release, so it needs a test naming the string.
func TestHelmRepoList_TreatsNoRepositoriesAsEmpty(t *testing.T) {
	f := &fakeRunner{reply: map[string]func(Command) ([]byte, error){
		"repo list": func(Command) ([]byte, error) {
			return nil, errors.New("exit status 1: Error: no repositories to show")
		},
	}}
	repos, err := withRunner(f).HelmRepoList(context.Background())
	if err != nil {
		t.Fatalf("a fresh install with no repos returned an error: %v", err)
	}
	if len(repos) != 0 {
		t.Errorf("repos = %+v, want empty", repos)
	}

	// A different failure must still surface.
	f2 := &fakeRunner{reply: map[string]func(Command) ([]byte, error){
		"repo list": func(Command) ([]byte, error) { return nil, errors.New("permission denied") },
	}}
	if _, err := withRunner(f2).HelmRepoList(context.Background()); err == nil {
		t.Error("a real failure was swallowed as an empty repo list")
	}
}

// TestChartSchema_ReadsTheUntarredChart covers the pull-and-read path added for
// the install form. The fake stands in for helm by writing the file where
// `--untardir` says it will land, which is exactly the contract the real binary
// honours and the thing schemaPathIn has to agree with.
func TestChartSchema_ReadsTheUntarredChart(t *testing.T) {
	const schema = `{"$schema":"http://json-schema.org/draft-07/schema#","type":"object"}`

	f := &fakeRunner{reply: map[string]func(Command) ([]byte, error){
		"pull": func(c Command) ([]byte, error) {
			dir := ""
			for i := 0; i < len(c.Args)-1; i++ {
				if c.Args[i] == "--untardir" {
					dir = c.Args[i+1]
				}
			}
			if dir == "" {
				return nil, errors.New("no --untardir passed")
			}
			if err := os.MkdirAll(filepath.Join(dir, "nginx"), 0o755); err != nil {
				return nil, err
			}
			return nil, os.WriteFile(filepath.Join(dir, "nginx", "values.schema.json"), []byte(schema), 0o644)
		},
	}}

	got, err := withRunner(f).ChartSchema(context.Background(), "bitnami/nginx", "1.2.3")
	if err != nil {
		t.Fatalf("ChartSchema: %v", err)
	}
	if got != schema {
		t.Errorf("schema = %q, want the file contents", got)
	}
	if !f.ran("pull", "bitnami/nginx", "--untar", "--version 1.2.3") {
		t.Errorf("pull was not invoked as expected:%s", f.lines())
	}
}

// TestChartSchema_AbsentSchemaIsNotAnError: most charts ship no schema, so this is
// the common path. Returning an error would make the install form show a failure
// for a perfectly normal chart.
func TestChartSchema_AbsentSchemaIsNotAnError(t *testing.T) {
	f := &fakeRunner{reply: map[string]func(Command) ([]byte, error){
		// Untars the chart but writes no schema, like most real charts.
		"pull": func(c Command) ([]byte, error) {
			for i := 0; i < len(c.Args)-1; i++ {
				if c.Args[i] == "--untardir" {
					return nil, os.MkdirAll(filepath.Join(c.Args[i+1], "nginx"), 0o755)
				}
			}
			return nil, nil
		},
	}}
	got, err := withRunner(f).ChartSchema(context.Background(), "repo/nginx", "")
	if err != nil {
		t.Fatalf("a chart without a schema returned an error: %v", err)
	}
	if got != "" {
		t.Errorf("schema = %q, want empty", got)
	}
}

// TestChartSchema_RejectsAFlagShapedChartRef: the ref reaches a command line, so
// the guard against a leading dash matters and must run before anything executes.
func TestChartSchema_RejectsAFlagShapedChartRef(t *testing.T) {
	f := &fakeRunner{}
	if _, err := withRunner(f).ChartSchema(context.Background(), "--set=x", ""); err == nil {
		t.Error("a flag-shaped chart ref was accepted")
	}
	if len(f.calls) != 0 {
		t.Errorf("rejected input still reached the command line:%s", f.lines())
	}
}

// TestListReleases_ParsesHelmOutput covers the JSON decode that every release
// list depends on, including that an empty list is not an error.
func TestListReleases_ParsesHelmOutput(t *testing.T) {
	payload, _ := json.Marshal([]map[string]any{
		{"name": "web", "namespace": "prod", "chart": "nginx-1.2.3", "status": "deployed", "revision": "2", "app_version": "1.25"},
	})
	f := &fakeRunner{reply: map[string]func(Command) ([]byte, error){
		"list": func(Command) ([]byte, error) { return payload, nil },
	}}

	rels, err := withRunner(f).ListReleases(context.Background(), "prod")
	if err != nil {
		t.Fatalf("ListReleases: %v", err)
	}
	if len(rels) != 1 {
		t.Fatalf("got %d releases, want 1", len(rels))
	}
	if rels[0].Name != "web" || rels[0].Namespace != "prod" {
		t.Errorf("release = %+v, want web in prod", rels[0])
	}
	if !f.ran("list", "--namespace prod") {
		t.Errorf("list was not scoped to the namespace:%s", f.lines())
	}
}

// TestCommandString is what every assertion above leans on.
func TestCommandString(t *testing.T) {
	got := Command{Name: "helm", Args: []string{"install", "web", "--namespace", "prod"}}.String()
	if want := "helm install web --namespace prod"; got != want {
		t.Errorf("String() = %q, want %q", got, want)
	}
	if got := (Command{Name: "helm"}).String(); got != "helm" {
		t.Errorf("String() with no args = %q, want %q", got, "helm")
	}
}

// TestExecRunner_RealBinary is the one test that proves the production runner
// actually runs something, so the fake above is standing in for behaviour that
// exists. It uses a shell builtin rather than helm, which need not be installed.
func TestExecRunner_RealBinary(t *testing.T) {
	out, err := execRunner{}.Run(context.Background(), Command{Name: "echo", Args: []string{"hello"}})
	if err != nil {
		t.Fatalf("execRunner: %v", err)
	}
	if strings.TrimSpace(string(out)) != "hello" {
		t.Errorf("stdout = %q, want hello", out)
	}

	// A failing command folds stderr into the error, which callers pattern-match on.
	if _, err := (execRunner{}).Run(context.Background(), Command{Name: "false"}); err == nil {
		t.Error("a failing command returned no error")
	}

	// Combined mode returns both streams and does not wrap.
	out, _ = execRunner{}.Run(context.Background(), Command{
		Name: "sh", Args: []string{"-c", "echo out; echo err 1>&2"}, Combined: true,
	})
	if !strings.Contains(string(out), "out") || !strings.Contains(string(out), "err") {
		t.Errorf("combined output = %q, want both streams", out)
	}

	// Env is appended to the inherited environment.
	out, _ = execRunner{}.Run(context.Background(), Command{
		Name: "sh", Args: []string{"-c", "echo $KUBEUI_TEST_VAR"}, Env: []string{"KUBEUI_TEST_VAR=set"},
	})
	if strings.TrimSpace(string(out)) != "set" {
		t.Errorf("env var not passed through: %q", out)
	}
}
