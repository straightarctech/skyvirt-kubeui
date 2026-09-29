package k8s

import (
	"context"
	"strings"
	"testing"

	"go.uber.org/zap"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"
)

// TestSchedulingHint pins the switch ORDER, not just the mapping. The cases are
// evaluated top-down and the first match wins, so an event mentioning both a
// capacity shortfall and a taint must return the capacity hint. Reordering the
// switch would change the advice an operator acts on.
func TestSchedulingHint(t *testing.T) {
	cases := []struct {
		name     string
		evidence []string
		wantPart string
	}{
		{"insufficient cpu", []string{"0/3 nodes are available: 3 Insufficient cpu"}, "enough free CPU/memory"},
		{"insufficient memory", []string{"0/3 nodes are available: 3 Insufficient memory"}, "enough free CPU/memory"},
		{"taint", []string{"node(s) had untolerated taint {node-role.kubernetes.io/control-plane}"}, "tainted against this pod"},
		{"affinity", []string{"node(s) didn't match pod affinity rules"}, "affinity / nodeSelector"},
		{"node selector", []string{"node(s) didn't match Pod's node selector"}, "affinity / nodeSelector"},
		{"volume", []string{"pod has unbound immediate PersistentVolumeClaims"}, "volume/PVC can't be bound"},
		{"nothing recognised", []string{"some unfamiliar scheduler message"}, "Check the scheduler message"},
		{"no evidence at all", nil, "Check the scheduler message"},
		{
			// Both conditions present: capacity is checked first and must win.
			"capacity outranks taint",
			[]string{"0/3 nodes are available: 1 Insufficient cpu, 2 node(s) had untolerated taint"},
			"enough free CPU/memory",
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := schedulingHint(c.evidence)
			if !strings.Contains(got, c.wantPart) {
				t.Errorf("schedulingHint(%v) = %q, want it to contain %q", c.evidence, got, c.wantPart)
			}
		})
	}
}

func warnEvent(reason, msg string) corev1.Event {
	return corev1.Event{
		ObjectMeta: metav1.ObjectMeta{Name: reason},
		Type:       corev1.EventTypeWarning,
		Reason:     reason,
		Message:    msg,
	}
}

// TestPickEvents: matching is case-insensitive across reason AND message, the
// message is trimmed, and the result is capped at 3 so one noisy pod cannot
// flood a diagnosis.
func TestPickEvents(t *testing.T) {
	evs := []corev1.Event{
		warnEvent("FailedScheduling", "  0/3 nodes are available  "),
		warnEvent("BackOff", "Back-off restarting failed container"),
		warnEvent("Unrelated", "something else entirely"),
	}
	got := pickEvents(evs, "FailedScheduling")
	if len(got) != 1 {
		t.Fatalf("pickEvents matched %d events, want 1: %v", len(got), got)
	}
	if got[0] != "0/3 nodes are available" {
		t.Errorf("message = %q, want it trimmed", got[0])
	}
	// Case-insensitive, and matching on the message body rather than the reason.
	if got := pickEvents(evs, "BACK-OFF RESTARTING"); len(got) != 1 {
		t.Errorf("case-insensitive message match returned %d events, want 1: %v", len(got), got)
	}
	// A needle matching nothing returns nothing.
	if got := pickEvents(evs, "no such text"); len(got) != 0 {
		t.Errorf("pickEvents(no match) = %v, want none", got)
	}
	// Cap at 3.
	many := []corev1.Event{
		warnEvent("R1", "failed one"), warnEvent("R2", "failed two"),
		warnEvent("R3", "failed three"), warnEvent("R4", "failed four"),
	}
	if got := pickEvents(many, "failed"); len(got) != 3 {
		t.Errorf("pickEvents matched %d events, want the cap of 3: %v", len(got), got)
	}
}

// TestUncoveredWarnings: events whose text a finding already explains are
// suppressed, so the diagnosis does not repeat itself. Everything else is
// surfaced as "Reason: Message", capped at 3.
func TestUncoveredWarnings(t *testing.T) {
	found := []Finding{{
		Severity: "critical",
		Title:    "Image cannot be pulled",
		Detail:   "back-off pulling image",
	}}
	evs := []corev1.Event{
		warnEvent("Failed", "back-off pulling image"),       // already covered by the finding
		warnEvent("FailedMount", "unable to attach volume"), // not covered
		warnEvent("Empty", "   "),                           // blank messages are skipped
	}
	got := uncoveredWarnings(evs, found)
	if len(got) != 1 {
		t.Fatalf("uncoveredWarnings = %v, want exactly the uncovered one", got)
	}
	if got[0] != "FailedMount: unable to attach volume" {
		t.Errorf("got %q, want \"FailedMount: unable to attach volume\"", got[0])
	}
	// With no findings at all, everything non-blank is uncovered — capped at 3.
	many := []corev1.Event{
		warnEvent("A", "one"), warnEvent("B", "two"), warnEvent("C", "three"), warnEvent("D", "four"),
	}
	if got := uncoveredWarnings(many, nil); len(got) != 3 {
		t.Errorf("uncoveredWarnings returned %d, want the cap of 3: %v", len(got), got)
	}
}

// TestSevFor pins the replica-shortfall rating. The caller only invokes it when
// desired > 0 and ready < desired, so every case below is already degraded; what
// is being pinned is where "critical" begins.
//
// The 1-of-100 case is the one that matters: it used to report "warning",
// because desired was accepted and then ignored, so a near-total outage was
// rated the same as a single missing replica. Losing the majority of a
// workload's capacity is now critical. The line sits at half — a judgement call,
// not a Kubernetes rule — so the two rows either side of it are pinned
// explicitly and will fail loudly if anyone moves it.
func TestSevFor(t *testing.T) {
	cases := []struct {
		ready, desired int32
		want           string
	}{
		{0, 3, "critical"},   // nothing serving
		{1, 100, "critical"}, // near-total outage — the regression this guards
		{4, 10, "critical"},  // below half
		{5, 10, "warning"},   // exactly half is not critical
		{1, 2, "warning"},    // half
		{2, 3, "warning"},    // majority still serving
	}
	for _, c := range cases {
		if got := sevFor(c.ready, c.desired); got != c.want {
			t.Errorf("sevFor(%d, %d) = %q, want %q", c.ready, c.desired, got, c.want)
		}
	}
}

// TestHasIssue: only critical and warning count as problems. "info" and "ok"
// findings must not keep a healthy pod from being reported healthy.
func TestHasIssue(t *testing.T) {
	cases := []struct {
		name     string
		findings []Finding
		want     bool
	}{
		{"none", nil, false},
		{"critical", []Finding{{Severity: "critical"}}, true},
		{"warning", []Finding{{Severity: "warning"}}, true},
		{"info only", []Finding{{Severity: "info"}}, false},
		{"ok only", []Finding{{Severity: "ok"}}, false},
		{"info plus warning", []Finding{{Severity: "info"}, {Severity: "warning"}}, true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := hasIssue(c.findings); got != c.want {
				t.Errorf("hasIssue = %v, want %v", got, c.want)
			}
		})
	}
}

// TestCriticalCount drives the unhealthy-first ordering of workload diagnoses.
func TestCriticalCount(t *testing.T) {
	d := Diagnosis{Findings: []Finding{
		{Severity: "critical"}, {Severity: "warning"}, {Severity: "critical"}, {Severity: "info"},
	}}
	if got := criticalCount(d); got != 2 {
		t.Errorf("criticalCount = %d, want 2", got)
	}
	if got := criticalCount(Diagnosis{}); got != 0 {
		t.Errorf("criticalCount(empty) = %d, want 0", got)
	}
}

// TestDiagnoseWorkload_UnsupportedKind: only the three controller kinds are
// supported, and anything else must fail loudly rather than report a healthy
// workload with no pods.
func TestDiagnoseWorkload_UnsupportedKind(t *testing.T) {
	kc := &Client{Clientset: fake.NewSimpleClientset(), Logger: zap.NewNop()}
	_, err := kc.DiagnoseWorkload(context.Background(), "CronJob", "default", "backup")
	if err == nil {
		t.Fatal("DiagnoseWorkload(CronJob) returned nil error, want an unsupported-kind error")
	}
	if !strings.Contains(err.Error(), "not supported") {
		t.Errorf("error = %q, want it to say the kind is not supported", err)
	}
}
