package k8s

import (
	"context"
	"testing"

	"go.uber.org/zap"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"
)

// deployWith builds a Deployment whose pod template carries the given
// containers. probes.go reads the TEMPLATE, never live pods.
func deployWith(ns, name string, containers ...corev1.Container) *appsv1.Deployment {
	return &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: ns},
		Spec: appsv1.DeploymentSpec{
			Template: corev1.PodTemplateSpec{Spec: corev1.PodSpec{Containers: containers}},
		},
	}
}

// TestProbeAudit_MissingReadinessIsMedium: a missing readiness probe is the more
// serious gap (traffic reaches a pod that is not ready), so it alone raises the
// severity to medium.
func TestProbeAudit_MissingReadinessIsMedium(t *testing.T) {
	dep := deployWith("default", "web", corev1.Container{Name: "c1", LivenessProbe: &corev1.Probe{}})
	kc := &Client{Clientset: fake.NewSimpleClientset(dep), Logger: zap.NewNop()}
	rep, err := kc.ProbeAudit(context.Background())
	if err != nil {
		t.Fatalf("ProbeAudit: %v", err)
	}
	if len(rep.Gaps) != 1 {
		t.Fatalf("got %d gaps, want 1: %+v", len(rep.Gaps), rep.Gaps)
	}
	if rep.Gaps[0].Severity != "medium" {
		t.Errorf("Severity = %q, want medium", rep.Gaps[0].Severity)
	}
	if want := "no readiness probe on c1"; rep.Gaps[0].Detail != want {
		t.Errorf("Detail = %q, want %q", rep.Gaps[0].Detail, want)
	}
	if rep.MissingReadiness != 1 || rep.MissingLiveness != 0 {
		t.Errorf("MissingReadiness/MissingLiveness = %d/%d, want 1/0", rep.MissingReadiness, rep.MissingLiveness)
	}
}

// TestProbeAudit_MissingLivenessOnlyStaysLow is the counterpart: a missing
// liveness probe is reported but does NOT raise severity. Flipping this would
// turn most clusters medium overnight.
func TestProbeAudit_MissingLivenessOnlyStaysLow(t *testing.T) {
	dep := deployWith("default", "web", corev1.Container{Name: "c1", ReadinessProbe: &corev1.Probe{}})
	kc := &Client{Clientset: fake.NewSimpleClientset(dep), Logger: zap.NewNop()}
	rep, err := kc.ProbeAudit(context.Background())
	if err != nil {
		t.Fatalf("ProbeAudit: %v", err)
	}
	if len(rep.Gaps) != 1 {
		t.Fatalf("got %d gaps, want 1: %+v", len(rep.Gaps), rep.Gaps)
	}
	if rep.Gaps[0].Severity != "low" {
		t.Errorf("Severity = %q, want low — a missing liveness probe alone is not medium", rep.Gaps[0].Severity)
	}
	if rep.MissingReadiness != 0 || rep.MissingLiveness != 1 {
		t.Errorf("MissingReadiness/MissingLiveness = %d/%d, want 0/1", rep.MissingReadiness, rep.MissingLiveness)
	}
}

// TestProbeAudit_FullyProbedIsNotReported is the negative control: a workload
// with both probes produces no gap at all, though it still counts as analyzed.
func TestProbeAudit_FullyProbedIsNotReported(t *testing.T) {
	dep := deployWith("default", "web", corev1.Container{
		Name: "c1", ReadinessProbe: &corev1.Probe{}, LivenessProbe: &corev1.Probe{},
	})
	kc := &Client{Clientset: fake.NewSimpleClientset(dep), Logger: zap.NewNop()}
	rep, err := kc.ProbeAudit(context.Background())
	if err != nil {
		t.Fatalf("ProbeAudit: %v", err)
	}
	if len(rep.Gaps) != 0 {
		t.Errorf("got %d gaps, want 0: %+v", len(rep.Gaps), rep.Gaps)
	}
	if rep.Analyzed != 1 {
		t.Errorf("Analyzed = %d, want 1 — a healthy workload is still analyzed", rep.Analyzed)
	}
}

// TestProbeAudit_CountersArePerWorkload: a Deployment with two unprobed
// containers is ONE missing-readiness count, not two. The counters headline the
// dashboard, so double-counting containers would inflate them.
func TestProbeAudit_CountersArePerWorkload(t *testing.T) {
	dep := deployWith("default", "web",
		corev1.Container{Name: "c1"},
		corev1.Container{Name: "c2"},
	)
	kc := &Client{Clientset: fake.NewSimpleClientset(dep), Logger: zap.NewNop()}
	rep, err := kc.ProbeAudit(context.Background())
	if err != nil {
		t.Fatalf("ProbeAudit: %v", err)
	}
	if rep.MissingReadiness != 1 || rep.MissingLiveness != 1 {
		t.Errorf("MissingReadiness/MissingLiveness = %d/%d, want 1/1 per workload", rep.MissingReadiness, rep.MissingLiveness)
	}
	// Both container names appear in one detail string, joined by ", ".
	if want := "no readiness probe on c1, c2; no liveness probe on c1, c2"; rep.Gaps[0].Detail != want {
		t.Errorf("Detail = %q, want %q", rep.Gaps[0].Detail, want)
	}
}

// TestProbeAudit_SkipsSystemNamespaces: control-plane workloads are out of
// scope, and must not even be counted as analyzed.
func TestProbeAudit_SkipsSystemNamespaces(t *testing.T) {
	sys := deployWith("kube-system", "coredns", corev1.Container{Name: "c1"})
	app := deployWith("default", "web", corev1.Container{Name: "c1"})
	kc := &Client{Clientset: fake.NewSimpleClientset(sys, app), Logger: zap.NewNop()}
	rep, err := kc.ProbeAudit(context.Background())
	if err != nil {
		t.Fatalf("ProbeAudit: %v", err)
	}
	if rep.Analyzed != 1 {
		t.Errorf("Analyzed = %d, want 1 — kube-system must be skipped entirely", rep.Analyzed)
	}
	if len(rep.Gaps) != 1 || rep.Gaps[0].Namespace != "default" {
		t.Errorf("gaps = %+v, want only the default-namespace workload", rep.Gaps)
	}
}

// TestProbeAudit_CoversAllThreeWorkloadKinds: StatefulSets and DaemonSets are
// audited alongside Deployments, and each is labelled with its own kind.
func TestProbeAudit_CoversAllThreeWorkloadKinds(t *testing.T) {
	dep := deployWith("default", "web", corev1.Container{Name: "c1"})
	sts := &appsv1.StatefulSet{
		ObjectMeta: metav1.ObjectMeta{Name: "db", Namespace: "default"},
		Spec: appsv1.StatefulSetSpec{
			Template: corev1.PodTemplateSpec{Spec: corev1.PodSpec{Containers: []corev1.Container{{Name: "c1"}}}},
		},
	}
	ds := &appsv1.DaemonSet{
		ObjectMeta: metav1.ObjectMeta{Name: "agent", Namespace: "default"},
		Spec: appsv1.DaemonSetSpec{
			Template: corev1.PodTemplateSpec{Spec: corev1.PodSpec{Containers: []corev1.Container{{Name: "c1"}}}},
		},
	}
	kc := &Client{Clientset: fake.NewSimpleClientset(dep, sts, ds), Logger: zap.NewNop()}
	rep, err := kc.ProbeAudit(context.Background())
	if err != nil {
		t.Fatalf("ProbeAudit: %v", err)
	}
	if rep.Analyzed != 3 {
		t.Fatalf("Analyzed = %d, want 3", rep.Analyzed)
	}
	kinds := map[string]bool{}
	for _, g := range rep.Gaps {
		kinds[g.Kind] = true
	}
	for _, want := range []string{"Deployment", "StatefulSet", "DaemonSet"} {
		if !kinds[want] {
			t.Errorf("no gap reported with Kind %q; got %+v", want, rep.Gaps)
		}
	}
}
