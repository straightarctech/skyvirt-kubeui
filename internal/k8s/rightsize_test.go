package k8s

import (
	"context"
	"strings"
	"testing"

	"go.uber.org/zap"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/kubernetes/fake"
	metricsv1beta1 "k8s.io/metrics/pkg/apis/metrics/v1beta1"
	metricsfake "k8s.io/metrics/pkg/client/clientset/versioned/fake"
)

// TestPct pins the percentage helper, including the sentinel: -1 means "no
// request set", which the UI must render differently from 0%.
func TestPct(t *testing.T) {
	cases := []struct {
		usage, request int64
		want           int
	}{
		{50, 100, 50},
		{0, 100, 0},
		{150, 100, 150}, // over 100% is legal and meaningful
		{1, 3, 33},      // integer truncation, not rounding
		{50, 0, -1},     // no request → sentinel, never a division by zero
		{50, -5, -1},
	}
	for _, c := range cases {
		if got := pct(c.usage, c.request); got != c.want {
			t.Errorf("pct(%d, %d) = %d, want %d", c.usage, c.request, got, c.want)
		}
	}
}

// TestWorstSev pins the severity merge, including its asymmetry on unknown
// inputs: an unrecognised severity ranks 0, so it can never beat a known one but
// it CAN be returned when it is the incumbent.
func TestWorstSev(t *testing.T) {
	cases := []struct {
		a, b, want string
	}{
		{"low", "medium", "medium"},
		{"medium", "low", "medium"},
		{"medium", "high", "high"},
		{"high", "medium", "high"},
		{"low", "low", "low"},
		{"bogus", "low", "low"},   // unknown ranks 0, so low wins
		{"high", "bogus", "high"}, // ... but an unknown challenger never wins
	}
	for _, c := range cases {
		if got := worstSev(c.a, c.b); got != c.want {
			t.Errorf("worstSev(%q, %q) = %q, want %q", c.a, c.b, got, c.want)
		}
	}
}

// TestReqStr pins the em-dash placeholder used when no request is set — the UI
// shows this literal, so it is part of the contract.
func TestReqStr(t *testing.T) {
	if got := cpuReqStr(0); got != "—" {
		t.Errorf("cpuReqStr(0) = %q, want an em dash", got)
	}
	if got := memReqStr(0); got != "—" {
		t.Errorf("memReqStr(0) = %q, want an em dash", got)
	}
	if got := cpuReqStr(250); got != "250m" {
		t.Errorf("cpuReqStr(250) = %q, want 250m", got)
	}
	if got := memReqStr(64 * 1024 * 1024); got != "64Mi" {
		t.Errorf("memReqStr(64Mi) = %q, want 64Mi", got)
	}
}

// podMetricsGVR is the resource the metrics client actually reads. It is "pods"
// within metrics.k8s.io — NOT the pluralized "podmetricses" that
// metricsfake.NewSimpleClientset(obj...) files seeded objects under. Seeding via
// the constructor therefore silently yields an EMPTY list, and any assertion
// that tolerates zero workloads would pass against no data at all. Always seed
// through Tracker().Create with this GVR.
var podMetricsGVR = schema.GroupVersionResource{Group: "metrics.k8s.io", Version: "v1beta1", Resource: "pods"}

// seedMetrics returns a metrics client carrying the given PodMetrics.
func seedMetrics(t *testing.T, objs ...*metricsv1beta1.PodMetrics) *metricsfake.Clientset {
	t.Helper()
	mc := metricsfake.NewSimpleClientset()
	for _, o := range objs {
		if err := mc.Tracker().Create(podMetricsGVR, o, o.Namespace); err != nil {
			t.Fatalf("seeding PodMetrics %s/%s: %v", o.Namespace, o.Name, err)
		}
	}
	return mc
}

// rightsizeFixture builds a single-container pod with the given requests, plus
// the matching PodMetrics entry for its usage.
func rightsizeFixture(t *testing.T, cpuReq, memReq, cpuUse, memUse string) *Client {
	t.Helper()
	reqs := corev1.ResourceList{}
	if cpuReq != "" {
		reqs[corev1.ResourceCPU] = resource.MustParse(cpuReq)
	}
	if memReq != "" {
		reqs[corev1.ResourceMemory] = resource.MustParse(memReq)
	}
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "web", Namespace: "default"},
		Spec: corev1.PodSpec{Containers: []corev1.Container{{
			Name:      "c1",
			Resources: corev1.ResourceRequirements{Requests: reqs},
		}}},
	}
	pm := &metricsv1beta1.PodMetrics{
		ObjectMeta: metav1.ObjectMeta{Name: "web", Namespace: "default"},
		Containers: []metricsv1beta1.ContainerMetrics{{
			Name: "c1",
			Usage: corev1.ResourceList{
				corev1.ResourceCPU:    resource.MustParse(cpuUse),
				corev1.ResourceMemory: resource.MustParse(memUse),
			},
		}},
	}
	return &Client{
		Clientset:     fake.NewSimpleClientset(pod),
		MetricsClient: seedMetrics(t, pm),
		Logger:        zap.NewNop(),
	}
}

// TestRightsize_RequiresMetricsServer: without metrics there is nothing to
// compare against, and the engine must say so rather than report everything as
// using zero resources.
func TestRightsize_RequiresMetricsServer(t *testing.T) {
	kc := &Client{Clientset: fake.NewSimpleClientset(), Logger: zap.NewNop()}
	_, err := kc.Rightsize(context.Background())
	if err == nil {
		t.Fatal("Rightsize with no MetricsClient returned nil error, want a metrics-server error")
	}
	if !strings.Contains(err.Error(), "metrics-server is not available") {
		t.Errorf("error = %q, want it to mention metrics-server", err)
	}
}

// TestRightsize_MissingRequestsCountedOnce: a workload missing BOTH requests
// raises two flags but increments NoRequests only once — that counter is a
// workload count, not a flag count.
func TestRightsize_MissingRequestsCountedOnce(t *testing.T) {
	kc := rightsizeFixture(t, "", "", "50m", "64Mi")
	rep, err := kc.Rightsize(context.Background())
	if err != nil {
		t.Fatalf("Rightsize: %v", err)
	}
	if rep.NoRequests != 1 {
		t.Errorf("NoRequests = %d, want 1 (per workload, not per missing request)", rep.NoRequests)
	}
	if len(rep.Workloads) != 1 {
		t.Fatalf("got %d workloads, want 1: %+v", len(rep.Workloads), rep.Workloads)
	}
	w := rep.Workloads[0]
	if len(w.Flags) != 2 {
		t.Errorf("Flags = %v, want both the CPU and memory no-request flags", w.Flags)
	}
	if w.Severity != "medium" {
		t.Errorf("Severity = %q, want medium", w.Severity)
	}
	if w.CPUPct != -1 || w.MemPct != -1 {
		t.Errorf("CPUPct/MemPct = %d/%d, want -1/-1 with no requests set", w.CPUPct, w.MemPct)
	}
}

// TestRightsize_MemoryOverRequestSuppressesCPUFlag pins the else-if branch: a
// workload over its request on BOTH axes reports only the memory flag, and
// counts as one under-provisioned workload rather than two. Memory wins because
// exceeding it gets you OOM-killed, while exceeding CPU only throttles.
func TestRightsize_MemoryOverRequestSuppressesCPUFlag(t *testing.T) {
	kc := rightsizeFixture(t, "100m", "100Mi", "200m", "200Mi")
	rep, err := kc.Rightsize(context.Background())
	if err != nil {
		t.Fatalf("Rightsize: %v", err)
	}
	if len(rep.Workloads) != 1 {
		t.Fatalf("got %d workloads, want 1", len(rep.Workloads))
	}
	w := rep.Workloads[0]
	joined := strings.Join(w.Flags, "|")
	if !strings.Contains(joined, "OOM risk") {
		t.Errorf("Flags = %v, want the memory-over-request flag", w.Flags)
	}
	if strings.Contains(joined, "throttling") {
		t.Errorf("Flags = %v, want NO CPU flag — the CPU check is an else-if", w.Flags)
	}
	if rep.UnderProvisioned != 1 {
		t.Errorf("UnderProvisioned = %d, want 1", rep.UnderProvisioned)
	}
	if w.Severity != "high" {
		t.Errorf("Severity = %q, want high", w.Severity)
	}
}

// TestRightsize_CPUOverRequestAloneIsMedium: with memory inside its request, the
// CPU branch is reached and carries the lower severity.
func TestRightsize_CPUOverRequestAloneIsMedium(t *testing.T) {
	kc := rightsizeFixture(t, "100m", "100Mi", "200m", "50Mi")
	rep, err := kc.Rightsize(context.Background())
	if err != nil {
		t.Fatalf("Rightsize: %v", err)
	}
	w := rep.Workloads[0]
	if !strings.Contains(strings.Join(w.Flags, "|"), "throttling") {
		t.Errorf("Flags = %v, want the CPU-over-request flag", w.Flags)
	}
	if w.Severity != "medium" {
		t.Errorf("Severity = %q, want medium", w.Severity)
	}
}

// TestRightsize_OverProvisionedStaysLow: wasting resources is worth reporting
// but is not a reliability risk, so it must not raise severity.
func TestRightsize_OverProvisionedStaysLow(t *testing.T) {
	kc := rightsizeFixture(t, "100m", "100Mi", "5m", "5Mi")
	rep, err := kc.Rightsize(context.Background())
	if err != nil {
		t.Fatalf("Rightsize: %v", err)
	}
	if len(rep.Workloads) != 1 {
		t.Fatalf("got %d workloads, want 1", len(rep.Workloads))
	}
	if rep.OverProvisioned != 1 {
		t.Errorf("OverProvisioned = %d, want 1 (counted once even with both axes flagged)", rep.OverProvisioned)
	}
	if got := rep.Workloads[0].Severity; got != "low" {
		t.Errorf("Severity = %q, want low — over-provisioning never raises severity", got)
	}
}

// TestRightsize_ExactlyTwentyPercentIsNotFlagged: the comparison is a strict
// usage*5 < request, so a workload sitting exactly at the 20% line is left
// alone. An off-by-one here would flag a large share of healthy workloads.
func TestRightsize_ExactlyTwentyPercentIsNotFlagged(t *testing.T) {
	kc := rightsizeFixture(t, "100m", "100Mi", "20m", "20Mi")
	rep, err := kc.Rightsize(context.Background())
	if err != nil {
		t.Fatalf("Rightsize: %v", err)
	}
	if rep.OverProvisioned != 0 {
		t.Errorf("OverProvisioned = %d, want 0 at exactly 20%% usage", rep.OverProvisioned)
	}
	if len(rep.Workloads) != 0 {
		t.Errorf("Workloads = %+v, want none — nothing was flagged", rep.Workloads)
	}
	if rep.Analyzed != 1 {
		t.Errorf("Analyzed = %d, want 1 — an unflagged workload is still analyzed", rep.Analyzed)
	}
}

// TestRightsize_TinyRequestsAreBelowTheNoiseFloor: requests under 10 millicores
// are exempt from the over-provisioning check, so sidecars asking for 5m are not
// reported forever.
func TestRightsize_TinyRequestsAreBelowTheNoiseFloor(t *testing.T) {
	kc := rightsizeFixture(t, "9m", "32Mi", "0", "32Mi")
	rep, err := kc.Rightsize(context.Background())
	if err != nil {
		t.Fatalf("Rightsize: %v", err)
	}
	if rep.OverProvisioned != 0 {
		t.Errorf("OverProvisioned = %d, want 0 — a 9m request is below the 10m floor", rep.OverProvisioned)
	}
	if len(rep.Workloads) != 0 {
		t.Errorf("Workloads = %+v, want none", rep.Workloads)
	}
}

// TestRightsize_SkipsSystemNamespaces and pods with no metrics at all.
func TestRightsize_SkipsSystemNamespacesAndUnmeasuredPods(t *testing.T) {
	sysPod := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "kube-proxy", Namespace: "kube-system"}}
	noMetrics := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "starting", Namespace: "default"}}
	sysMetrics := &metricsv1beta1.PodMetrics{
		ObjectMeta: metav1.ObjectMeta{Name: "kube-proxy", Namespace: "kube-system"},
		Containers: []metricsv1beta1.ContainerMetrics{{Name: "c1", Usage: corev1.ResourceList{
			corev1.ResourceCPU: resource.MustParse("10m"), corev1.ResourceMemory: resource.MustParse("10Mi"),
		}}},
	}
	kc := &Client{
		Clientset:     fake.NewSimpleClientset(sysPod, noMetrics),
		MetricsClient: seedMetrics(t, sysMetrics),
		Logger:        zap.NewNop(),
	}
	rep, err := kc.Rightsize(context.Background())
	if err != nil {
		t.Fatalf("Rightsize: %v", err)
	}
	if rep.Analyzed != 0 {
		t.Errorf("Analyzed = %d, want 0 — system pods are skipped and unmeasured pods have no data", rep.Analyzed)
	}
}
