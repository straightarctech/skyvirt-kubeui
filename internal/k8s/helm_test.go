package k8s

import "testing"

func TestValidateHelmName(t *testing.T) {
	cases := []struct {
		name string
		ok   bool
	}{
		{"my-release", true},
		{"release.1_x", true},
		{"", false},
		{"-oops", false},    // leading dash → flag injection
		{"--set", false},    // helm flag
		{"bad name", false}, // space
		{"bad/name", false}, // slash not allowed for a name
	}
	for _, c := range cases {
		err := validateHelmName(c.name, "name")
		if (err == nil) != c.ok {
			t.Errorf("validateHelmName(%q): ok=%v, err=%v", c.name, c.ok, err)
		}
	}
}

func TestValidateHelmChartRef(t *testing.T) {
	cases := []struct {
		chart string
		ok    bool
	}{
		{"bitnami/nginx", true}, // repo/chart uses a slash
		{"nginx", true},
		{"oci://reg.example.com/charts/app", true},
		{"", false},
		{"-x", false}, // leading dash
		{"--post-renderer", false},
	}
	for _, c := range cases {
		err := validateHelmChartRef(c.chart)
		if (err == nil) != c.ok {
			t.Errorf("validateHelmChartRef(%q): ok=%v, err=%v", c.chart, c.ok, err)
		}
	}
}

func TestValidateHelmRepoURL(t *testing.T) {
	cases := []struct {
		url string
		ok  bool
	}{
		{"https://charts.example.com", true},
		{"http://charts.example.com", true},
		{"oci://reg.example.com", true},
		{"-flag", false},
		{"file:///etc/passwd", false}, // non-http(s)/oci scheme
		{"charts.example.com", false}, // no scheme
		{"", false},
	}
	for _, c := range cases {
		err := validateHelmRepoURL(c.url)
		if (err == nil) != c.ok {
			t.Errorf("validateHelmRepoURL(%q): ok=%v, err=%v", c.url, c.ok, err)
		}
	}
}

func TestValidateHelmValue(t *testing.T) {
	if err := validateHelmValue("key=value"); err != nil {
		t.Errorf("plain value rejected: %v", err)
	}
	if err := validateHelmValue("-injected"); err == nil {
		t.Error("dash-prefixed value should be rejected")
	}
}

// valuesFilesIn returns the -f arguments in the order helm will receive them.
func valuesFilesIn(args []string) []string {
	var out []string
	for i := 0; i < len(args)-1; i++ {
		if args[i] == "-f" {
			out = append(out, args[i+1])
		}
	}
	return out
}

// TestBuildInstallArgs_OverlayFollowsBase pins the ordering the schema-driven install
// form depends on. Helm merges -f files left to right, so the sparse overlay written
// by the form must come AFTER the chart's own values.yaml or the form silently loses
// every change. Reversing these two lines is an easy and completely invisible break:
// the install still succeeds, it just ignores what the user typed.
func TestBuildInstallArgs_OverlayFollowsBase(t *testing.T) {
	args, err := buildInstallArgs("web", "repo/nginx", "default", "", false, []string{"/tmp/base.yaml", "/tmp/overlay.yaml"}, nil)
	if err != nil {
		t.Fatalf("buildInstallArgs: %v", err)
	}
	got := valuesFilesIn(args)
	if len(got) != 2 {
		t.Fatalf("got %d -f args, want 2: %v", len(got), args)
	}
	if got[0] != "/tmp/base.yaml" || got[1] != "/tmp/overlay.yaml" {
		t.Errorf("-f order = %v, want base then overlay", got)
	}
}

// TestBuildInstallArgs_SkipsEmptyPaths: writeValuesFile returns "" for empty content,
// and an empty -f would make helm fail on a missing file.
func TestBuildInstallArgs_SkipsEmptyPaths(t *testing.T) {
	cases := []struct {
		name  string
		paths []string
		want  []string
	}{
		{"no values at all", []string{"", ""}, nil},
		{"base only", []string{"/tmp/base.yaml", ""}, []string{"/tmp/base.yaml"}},
		{"overlay only", []string{"", "/tmp/overlay.yaml"}, []string{"/tmp/overlay.yaml"}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			args, err := buildInstallArgs("web", "repo/nginx", "default", "", false, c.paths, nil)
			if err != nil {
				t.Fatalf("buildInstallArgs: %v", err)
			}
			got := valuesFilesIn(args)
			if len(got) != len(c.want) {
				t.Fatalf("-f args = %v, want %v", got, c.want)
			}
			for i := range got {
				if got[i] != c.want[i] {
					t.Errorf("-f args = %v, want %v", got, c.want)
				}
			}
		})
	}
}

// TestBuildInstallArgs_Version: --version only when supplied, and the value is
// validated rather than passed through to the command line.
func TestBuildInstallArgs_Version(t *testing.T) {
	args, err := buildInstallArgs("web", "repo/nginx", "default", "", false, nil, nil)
	if err != nil {
		t.Fatalf("buildInstallArgs: %v", err)
	}
	for _, a := range args {
		if a == "--version" {
			t.Errorf("--version present with no version supplied: %v", args)
		}
	}
	args, err = buildInstallArgs("web", "repo/nginx", "default", "1.2.3", false, nil, nil)
	if err != nil {
		t.Fatalf("buildInstallArgs: %v", err)
	}
	found := false
	for i := 0; i < len(args)-1; i++ {
		if args[i] == "--version" && args[i+1] == "1.2.3" {
			found = true
		}
	}
	if !found {
		t.Errorf("--version 1.2.3 missing: %v", args)
	}
	// A version that would inject a flag must be refused, not shelled out.
	if _, err := buildInstallArgs("web", "repo/nginx", "default", "--set=x", false, nil, nil); err == nil {
		t.Error("buildInstallArgs accepted a flag-shaped version, want an error")
	}
}

// TestBuildInstallArgs_SetKeysAreSortedAndValidated: ranging the values map directly
// produced a different argument order on every call, which makes the command
// unreproducible and this test impossible to write.
func TestBuildInstallArgs_SetKeysAreSortedAndValidated(t *testing.T) {
	args, err := buildInstallArgs("web", "repo/nginx", "default", "", false, nil, map[string]string{
		"zeta": "1", "alpha": "2", "mid": "3",
	})
	if err != nil {
		t.Fatalf("buildInstallArgs: %v", err)
	}
	var sets []string
	for i := 0; i < len(args)-1; i++ {
		if args[i] == "--set" {
			sets = append(sets, args[i+1])
		}
	}
	want := []string{"alpha=2", "mid=3", "zeta=1"}
	if len(sets) != len(want) {
		t.Fatalf("--set args = %v, want %v", sets, want)
	}
	for i := range sets {
		if sets[i] != want[i] {
			t.Fatalf("--set args = %v, want %v (sorted)", sets, want)
		}
	}
	if _, err := buildInstallArgs("web", "repo/nginx", "default", "", false, nil, map[string]string{"--bad": "x"}); err == nil {
		t.Error("buildInstallArgs accepted a flag-shaped --set key, want an error")
	}
}

// TestSchemaPathIn: `helm pull --untar` unpacks into <dir>/<chart base name>/, so the
// repo prefix and any oci:// scheme must be stripped to find values.schema.json.
func TestSchemaPathIn(t *testing.T) {
	cases := []struct {
		chartRef string
		want     string
	}{
		{"nginx", "/tmp/d/nginx/values.schema.json"},
		{"bitnami/nginx", "/tmp/d/nginx/values.schema.json"},
		{"oci://registry.example/charts/nginx", "/tmp/d/nginx/values.schema.json"},
		{"repo/sub/path/nginx", "/tmp/d/nginx/values.schema.json"},
		{"bitnami/nginx/", "/tmp/d/nginx/values.schema.json"}, // trailing slash tolerated
	}
	for _, c := range cases {
		if got := schemaPathIn("/tmp/d", c.chartRef); got != c.want {
			t.Errorf("schemaPathIn(%q) = %q, want %q", c.chartRef, got, c.want)
		}
	}
}

// TestBuildUpgradeArgs_OverlayFollowsBase: the upgrade path carries the same -f
// ordering contract as install. Here the base is the release's CURRENT values and
// the overlay is the schema form's overrides, so reversing them would silently
// re-apply the old values over the user's edits.
func TestBuildUpgradeArgs_OverlayFollowsBase(t *testing.T) {
	args, err := buildUpgradeArgs("web", "repo/nginx", "default", "", false, []string{"/tmp/current.yaml", "/tmp/overlay.yaml"}, nil)
	if err != nil {
		t.Fatalf("buildUpgradeArgs: %v", err)
	}
	got := valuesFilesIn(args)
	if len(got) != 2 || got[0] != "/tmp/current.yaml" || got[1] != "/tmp/overlay.yaml" {
		t.Errorf("-f order = %v, want current then overlay", got)
	}
}

// TestBuildUpgradeArgs_DryRun pins the flag pair that makes a preview a preview. A
// dry run must not carry --wait: there is nothing to wait for, and helm would block
// until the timeout on a render that never touches the cluster.
func TestBuildUpgradeArgs_DryRun(t *testing.T) {
	has := func(args []string, flag string) bool {
		for _, a := range args {
			if a == flag {
				return true
			}
		}
		return false
	}

	dry, err := buildUpgradeArgs("web", "repo/nginx", "default", "", true, nil, nil)
	if err != nil {
		t.Fatalf("buildUpgradeArgs: %v", err)
	}
	if !has(dry, "--dry-run") {
		t.Errorf("dry run missing --dry-run: %v", dry)
	}
	if has(dry, "--wait") {
		t.Errorf("dry run must not pass --wait: %v", dry)
	}

	real, err := buildUpgradeArgs("web", "repo/nginx", "default", "", false, nil, nil)
	if err != nil {
		t.Fatalf("buildUpgradeArgs: %v", err)
	}
	if has(real, "--dry-run") {
		t.Errorf("real upgrade must not pass --dry-run: %v", real)
	}
	if !has(real, "--wait") {
		t.Errorf("real upgrade missing --wait: %v", real)
	}
}

// TestBuildInstallArgs_DryRun pins the flag set that makes an install preview a
// preview. Two things must go, not one: --wait would block on resources that are
// never created, and --create-namespace would be a real cluster change inside what
// the caller was told is a read-only render.
func TestBuildInstallArgs_DryRun(t *testing.T) {
	has := func(args []string, flag string) bool {
		for _, a := range args {
			if a == flag {
				return true
			}
		}
		return false
	}

	dry, err := buildInstallArgs("web", "repo/nginx", "default", "", true, nil, nil)
	if err != nil {
		t.Fatalf("buildInstallArgs: %v", err)
	}
	if !has(dry, "--dry-run") {
		t.Errorf("preview missing --dry-run: %v", dry)
	}
	for _, forbidden := range []string{"--wait", "--create-namespace"} {
		if has(dry, forbidden) {
			t.Errorf("preview must not pass %s: %v", forbidden, dry)
		}
	}

	real, err := buildInstallArgs("web", "repo/nginx", "default", "", false, nil, nil)
	if err != nil {
		t.Fatalf("buildInstallArgs: %v", err)
	}
	if has(real, "--dry-run") {
		t.Errorf("a real install must not pass --dry-run: %v", real)
	}
	for _, required := range []string{"--wait", "--create-namespace"} {
		if !has(real, required) {
			t.Errorf("a real install is missing %s: %v", required, real)
		}
	}
}

// TestParseDryRunManifest pins the shape of `helm --dry-run --output json` that
// both previews depend on. If helm ever renames that field, this fails here
// rather than silently rendering an empty diff that reads as "no changes".
func TestParseDryRunManifest(t *testing.T) {
	got, err := parseDryRunManifest(`{"name":"web","manifest":"apiVersion: v1\nkind: Service\n"}`)
	if err != nil {
		t.Fatalf("parseDryRunManifest: %v", err)
	}
	if got != "apiVersion: v1\nkind: Service\n" {
		t.Errorf("manifest = %q, want the rendered YAML", got)
	}

	// A release with no manifest yields empty, not an error.
	if got, err := parseDryRunManifest(`{"name":"web"}`); err != nil || got != "" {
		t.Errorf("missing manifest field = (%q, %v), want (\"\", nil)", got, err)
	}

	// Anything that is not JSON is an error — helm failing and printing to stdout
	// must not be mistaken for an empty render.
	if _, err := parseDryRunManifest("Error: chart not found"); err == nil {
		t.Error("non-JSON output accepted; a helm failure would render as no changes")
	}
}
