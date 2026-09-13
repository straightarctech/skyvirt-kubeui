package k8s

import (
	"testing"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// TestWorkloadKey pins the replica-collapsing rule. Three posture engines
// (availability, netpolcoverage, rightsize) key their per-workload dedup off
// this, so a change here silently multiplies or merges their findings.
func TestWorkloadKey(t *testing.T) {
	cases := []struct {
		name      string
		namespace string
		podName   string
		ownerName string // "" means no owner reference
		want      string
	}{
		{"replicaset hash is stripped", "default", "web-6c9fd8b7c8-xyz12", "web-6c9fd8b7c8", "default/web"},
		{"multi-segment name keeps all but the hash", "prod", "p", "my-app-7d9f8b", "prod/my-app"},
		{"bare pod name with no owner", "default", "standalone", "", "default/standalone"},
		{"short trailing segment is not a hash", "default", "p", "web-ab", "default/web-ab"},
		{"uppercase trailing segment is not a hash", "default", "p", "web-ABCDE", "default/web-ABCDE"},
		{"single segment is left alone", "default", "p", "web", "default/web"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			pod := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: c.podName, Namespace: c.namespace}}
			if c.ownerName != "" {
				pod.OwnerReferences = []metav1.OwnerReference{{Kind: "ReplicaSet", Name: c.ownerName}}
			}
			if got := workloadKey(pod); got != c.want {
				t.Errorf("workloadKey = %q, want %q", got, c.want)
			}
		})
	}
}

// TestIsHashish pins the character class used to decide whether a trailing name
// segment is a generated hash: lowercase letters and digits only.
func TestIsHashish(t *testing.T) {
	cases := []struct {
		in   string
		want bool
	}{
		{"6c9fd8b7c8", true},
		{"abc123", true},
		{"ABC123", false}, // uppercase is not hash-like
		{"ab-cd", false},  // a dash cannot appear inside a segment
		{"ab_cd", false},
		{"", true}, // vacuously true: no character violates the class
	}
	for _, c := range cases {
		if got := isHashish(c.in); got != c.want {
			t.Errorf("isHashish(%q) = %v, want %v", c.in, got, c.want)
		}
	}
}
