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

func int32Ptr(i int32) *int32 { return &i }

// replicaPod builds one replica of Deployment "web" placed on the given node.
// The name carries a ReplicaSet-style hash so workloadKey collapses every
// replica onto "default/web" — which is the key AvailabilityAudit looks up.
func replicaPod(suffix, node string) *corev1.Pod {
	return &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:            "web-6c9fd8b7c8-" + suffix,
			Namespace:       "default",
			OwnerReferences: []metav1.OwnerReference{{Kind: "ReplicaSet", Name: "web-6c9fd8b7c8", Controller: boolPtr(true)}},
		},
		Spec:   corev1.PodSpec{NodeName: node},
		Status: corev1.PodStatus{Phase: corev1.PodRunning},
	}
}

func webDeployment(replicas int32) *appsv1.Deployment {
	return &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{Name: "web", Namespace: "default"},
		Spec:       appsv1.DeploymentSpec{Replicas: int32Ptr(replicas)},
	}
}

// TestReplicasOf: an unset replica count means 1 in the Kubernetes API, and
// treating nil as 0 would silently exempt every defaulted Deployment from the
// single-replica check.
func TestReplicasOf(t *testing.T) {
	if got := replicasOf(nil); got != 1 {
		t.Errorf("replicasOf(nil) = %d, want 1", got)
	}
	if got := replicasOf(int32Ptr(3)); got != 3 {
		t.Errorf("replicasOf(3) = %d, want 3", got)
	}
	if got := replicasOf(int32Ptr(0)); got != 0 {
		t.Errorf("replicasOf(0) = %d, want 0", got)
	}
}

// TestAvailabilityAudit_SingleReplicaIsMedium: one replica has no redundancy.
//
// The fixture deliberately runs TWO pods on ONE node while the Deployment asks
// for a single replica — the state you see mid-rollout. That is the only shape
// in which the early return after the single-replica risk is observable: drop
// the return and the spread check also fires, reporting the same workload twice
// with contradictory severities. A one-pod fixture cannot catch that, because
// the spread check needs two running pods before it does anything.
func TestAvailabilityAudit_SingleReplicaIsMedium(t *testing.T) {
	kc := &Client{
		Clientset: fake.NewSimpleClientset(
			webDeployment(1),
			replicaPod("a", "node-a"), replicaPod("b", "node-a"),
		),
		Logger: zap.NewNop(),
	}
	rep, err := kc.AvailabilityAudit(context.Background())
	if err != nil {
		t.Fatalf("AvailabilityAudit: %v", err)
	}
	if len(rep.Risks) != 1 {
		t.Fatalf("got %d risks, want exactly 1 — the spread check must not also fire: %+v", len(rep.Risks), rep.Risks)
	}
	if rep.Risks[0].Severity != "medium" || rep.Risks[0].Reason != "single replica" {
		t.Errorf("risk = %q/%q, want medium/single replica", rep.Risks[0].Severity, rep.Risks[0].Reason)
	}
	if rep.SingleReplica != 1 || rep.Concentrated != 0 {
		t.Errorf("SingleReplica/Concentrated = %d/%d, want 1/0", rep.SingleReplica, rep.Concentrated)
	}
}

// TestAvailabilityAudit_AllReplicasOnOneNodeIsHigh: replicas that all landed on
// one node give the illusion of redundancy while a single node failure takes the
// whole workload down — hence high, above the single-replica case.
func TestAvailabilityAudit_AllReplicasOnOneNodeIsHigh(t *testing.T) {
	kc := &Client{
		Clientset: fake.NewSimpleClientset(
			webDeployment(3),
			replicaPod("a", "node-a"), replicaPod("b", "node-a"), replicaPod("c", "node-a"),
		),
		Logger: zap.NewNop(),
	}
	rep, err := kc.AvailabilityAudit(context.Background())
	if err != nil {
		t.Fatalf("AvailabilityAudit: %v", err)
	}
	if len(rep.Risks) != 1 {
		t.Fatalf("got %d risks, want 1: %+v", len(rep.Risks), rep.Risks)
	}
	if rep.Risks[0].Severity != "high" || rep.Risks[0].Reason != "all replicas on one node" {
		t.Errorf("risk = %q/%q, want high/all replicas on one node", rep.Risks[0].Severity, rep.Risks[0].Reason)
	}
	if rep.Concentrated != 1 {
		t.Errorf("Concentrated = %d, want 1", rep.Concentrated)
	}
}

// TestAvailabilityAudit_SpreadWorkloadIsClean is the negative control: replicas
// on distinct nodes produce no risk at all.
func TestAvailabilityAudit_SpreadWorkloadIsClean(t *testing.T) {
	kc := &Client{
		Clientset: fake.NewSimpleClientset(
			webDeployment(3),
			replicaPod("a", "node-a"), replicaPod("b", "node-b"), replicaPod("c", "node-c"),
		),
		Logger: zap.NewNop(),
	}
	rep, err := kc.AvailabilityAudit(context.Background())
	if err != nil {
		t.Fatalf("AvailabilityAudit: %v", err)
	}
	if len(rep.Risks) != 0 {
		t.Errorf("got %d risks, want 0: %+v", len(rep.Risks), rep.Risks)
	}
	if rep.Analyzed != 1 {
		t.Errorf("Analyzed = %d, want 1", rep.Analyzed)
	}
}

// TestAvailabilityAudit_UnschedulableWorkloadIsNotASpreadRisk: with fewer than
// two running pods there is nothing to judge spread from. That is a health
// problem, reported elsewhere — not an HA misconfiguration.
func TestAvailabilityAudit_UnschedulableWorkloadIsNotASpreadRisk(t *testing.T) {
	pending := replicaPod("a", "") // never scheduled: no node name
	kc := &Client{
		Clientset: fake.NewSimpleClientset(webDeployment(3), pending),
		Logger:    zap.NewNop(),
	}
	rep, err := kc.AvailabilityAudit(context.Background())
	if err != nil {
		t.Fatalf("AvailabilityAudit: %v", err)
	}
	if len(rep.Risks) != 0 {
		t.Errorf("got %d risks, want 0: %+v", len(rep.Risks), rep.Risks)
	}
}

// TestAvailabilityAudit_SucceededPodsAreIgnored: completed pods are not running
// replicas and must not be counted toward node spread.
func TestAvailabilityAudit_SucceededPodsAreIgnored(t *testing.T) {
	done := replicaPod("a", "node-a")
	done.Status.Phase = corev1.PodSucceeded
	live := replicaPod("b", "node-b")
	kc := &Client{
		Clientset: fake.NewSimpleClientset(webDeployment(2), done, live),
		Logger:    zap.NewNop(),
	}
	rep, err := kc.AvailabilityAudit(context.Background())
	if err != nil {
		t.Fatalf("AvailabilityAudit: %v", err)
	}
	// Only one running pod remains, so spread cannot be judged — no risk.
	if len(rep.Risks) != 0 {
		t.Errorf("got %d risks, want 0 — a Succeeded pod must not count as a replica: %+v", len(rep.Risks), rep.Risks)
	}
}

// TestAvailabilityAudit_SkipsSystemNamespaces
func TestAvailabilityAudit_SkipsSystemNamespaces(t *testing.T) {
	sys := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{Name: "coredns", Namespace: "kube-system"},
		Spec:       appsv1.DeploymentSpec{Replicas: int32Ptr(1)},
	}
	kc := &Client{Clientset: fake.NewSimpleClientset(sys), Logger: zap.NewNop()}
	rep, err := kc.AvailabilityAudit(context.Background())
	if err != nil {
		t.Fatalf("AvailabilityAudit: %v", err)
	}
	if rep.Analyzed != 0 || len(rep.Risks) != 0 {
		t.Errorf("Analyzed/Risks = %d/%d, want 0/0 for kube-system", rep.Analyzed, len(rep.Risks))
	}
}
