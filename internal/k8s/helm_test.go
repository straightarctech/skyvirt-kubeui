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
		{"-oops", false},        // leading dash → flag injection
		{"--set", false},        // helm flag
		{"bad name", false},     // space
		{"bad/name", false},     // slash not allowed for a name
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
		{"-x", false},      // leading dash
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
