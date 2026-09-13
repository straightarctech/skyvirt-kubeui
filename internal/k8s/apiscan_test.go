package k8s

import "testing"

// TestLookupDeprecated pins that the table is matched on the (apiVersion, kind)
// PAIR, not on apiVersion alone. extensions/v1beta1 is the proof: it was removed
// in 1.16 for Deployment but survived until 1.22 for Ingress. A lookup that
// keyed on apiVersion would report the wrong target version for half the table,
// and an operator would plan the wrong cluster upgrade.
//
// NOTE for future authors: lookupDeprecated returns a pointer INTO the
// package-level deprecatedAPIs slice. Never mutate what it returns — it would
// corrupt the table for every later test and every later caller.
func TestLookupDeprecated(t *testing.T) {
	cases := []struct {
		apiVersion string
		kind       string
		wantFound  bool
		removedIn  string
	}{
		{"extensions/v1beta1", "Deployment", true, "1.16"},
		{"extensions/v1beta1", "DaemonSet", true, "1.16"},
		{"extensions/v1beta1", "Ingress", true, "1.22"}, // same group, later removal
		{"networking.k8s.io/v1beta1", "Ingress", true, "1.22"},
		{"extensions/v1beta1", "Pod", false, ""}, // kind not in the table for this group
		{"apps/v1", "Deployment", false, ""},     // the current, non-deprecated version
		{"", "", false, ""},
	}
	for _, c := range cases {
		got := lookupDeprecated(c.apiVersion, c.kind)
		if (got != nil) != c.wantFound {
			t.Errorf("lookupDeprecated(%q, %q) found = %v, want %v", c.apiVersion, c.kind, got != nil, c.wantFound)
			continue
		}
		if got != nil && got.RemovedIn != c.removedIn {
			t.Errorf("lookupDeprecated(%q, %q).RemovedIn = %q, want %q", c.apiVersion, c.kind, got.RemovedIn, c.removedIn)
		}
	}
}

// TestLookupDeprecated_CarriesReplacement checks the remediation field is
// populated — the finding is only actionable if it names what to migrate to.
func TestLookupDeprecated_CarriesReplacement(t *testing.T) {
	got := lookupDeprecated("extensions/v1beta1", "Ingress")
	if got == nil {
		t.Fatal("lookupDeprecated returned nil for a known-deprecated API")
	}
	if got.Replacement != "networking.k8s.io/v1" {
		t.Errorf("Replacement = %q, want networking.k8s.io/v1", got.Replacement)
	}
}
