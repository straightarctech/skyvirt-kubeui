package k8s

import (
	"context"
	"testing"

	"go.uber.org/zap"
	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"
)

// TestRestrictsIngress pins the PolicyTypes defaulting rule. An unset
// PolicyTypes defaults to [Ingress] in the Kubernetes API, so treating the empty
// case as "not ingress" would report namespaces as uncovered when they are in
// fact locked down — the false alarm that erodes trust in the whole panel.
func TestRestrictsIngress(t *testing.T) {
	cases := []struct {
		name  string
		types []networkingv1.PolicyType
		want  bool
	}{
		{"unset defaults to ingress", nil, true},
		{"explicit ingress", []networkingv1.PolicyType{networkingv1.PolicyTypeIngress}, true},
		{"ingress and egress", []networkingv1.PolicyType{networkingv1.PolicyTypeIngress, networkingv1.PolicyTypeEgress}, true},
		{"egress only does not restrict ingress", []networkingv1.PolicyType{networkingv1.PolicyTypeEgress}, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			np := &networkingv1.NetworkPolicy{Spec: networkingv1.NetworkPolicySpec{PolicyTypes: c.types}}
			if got := restrictsIngress(np); got != c.want {
				t.Errorf("restrictsIngress = %v, want %v", got, c.want)
			}
		})
	}
}

// labeledPod builds a standalone pod carrying the given labels.
func labeledPod(ns, name string, lbls map[string]string) *corev1.Pod {
	return &corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: ns, Labels: lbls}}
}

// netpol builds an ingress-restricting NetworkPolicy with the given pod selector.
func netpol(ns, name string, match map[string]string) *networkingv1.NetworkPolicy {
	return &networkingv1.NetworkPolicy{
		ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: ns},
		Spec: networkingv1.NetworkPolicySpec{
			PodSelector: metav1.LabelSelector{MatchLabels: match},
			PolicyTypes: []networkingv1.PolicyType{networkingv1.PolicyTypeIngress},
		},
	}
}

// TestNetworkPolicyCoverage_EmptySelectorCoversWholeNamespace: the canonical
// default-deny policy selects every pod, so nothing in the namespace is
// unrestricted.
func TestNetworkPolicyCoverage_EmptySelectorCoversWholeNamespace(t *testing.T) {
	kc := &Client{
		Clientset: fake.NewSimpleClientset(
			labeledPod("default", "web", map[string]string{"app": "web"}),
			netpol("default", "default-deny", nil), // empty selector = all pods
		),
		Logger: zap.NewNop(),
	}
	rep, err := kc.NetworkPolicyCoverage(context.Background())
	if err != nil {
		t.Fatalf("NetworkPolicyCoverage: %v", err)
	}
	if rep.TotalWorkloads != 1 || rep.CoveredWorkloads != 1 {
		t.Errorf("Total/Covered = %d/%d, want 1/1", rep.TotalWorkloads, rep.CoveredWorkloads)
	}
	if len(rep.Unrestricted) != 0 {
		t.Errorf("Unrestricted = %+v, want none", rep.Unrestricted)
	}
}

// TestNetworkPolicyCoverage_LabelMismatchIsUnrestricted: a policy that selects
// other pods provides no cover.
func TestNetworkPolicyCoverage_LabelMismatchIsUnrestricted(t *testing.T) {
	kc := &Client{
		Clientset: fake.NewSimpleClientset(
			labeledPod("default", "web", map[string]string{"app": "web"}),
			netpol("default", "db-only", map[string]string{"app": "db"}),
		),
		Logger: zap.NewNop(),
	}
	rep, err := kc.NetworkPolicyCoverage(context.Background())
	if err != nil {
		t.Fatalf("NetworkPolicyCoverage: %v", err)
	}
	if rep.CoveredWorkloads != 0 || len(rep.Unrestricted) != 1 {
		t.Fatalf("Covered/Unrestricted = %d/%d, want 0/1: %+v", rep.CoveredWorkloads, len(rep.Unrestricted), rep.Unrestricted)
	}
	if rep.Unrestricted[0].Name != "web" {
		t.Errorf("Unrestricted[0].Name = %q, want web", rep.Unrestricted[0].Name)
	}
}

// TestNetworkPolicyCoverage_EgressOnlyPolicyDoesNotCover: an egress policy does
// not restrict who can reach the pod, so the workload stays unrestricted even
// though a NetworkPolicy object exists in the namespace.
func TestNetworkPolicyCoverage_EgressOnlyPolicyDoesNotCover(t *testing.T) {
	egressOnly := netpol("default", "egress", nil)
	egressOnly.Spec.PolicyTypes = []networkingv1.PolicyType{networkingv1.PolicyTypeEgress}
	kc := &Client{
		Clientset: fake.NewSimpleClientset(labeledPod("default", "web", nil), egressOnly),
		Logger:    zap.NewNop(),
	}
	rep, err := kc.NetworkPolicyCoverage(context.Background())
	if err != nil {
		t.Fatalf("NetworkPolicyCoverage: %v", err)
	}
	if len(rep.Unrestricted) != 1 {
		t.Errorf("Unrestricted = %+v, want the workload to remain unrestricted", rep.Unrestricted)
	}
}

// TestNetworkPolicyCoverage_PolicyIsNamespaceScoped: a policy in another
// namespace never covers this one.
func TestNetworkPolicyCoverage_PolicyIsNamespaceScoped(t *testing.T) {
	kc := &Client{
		Clientset: fake.NewSimpleClientset(
			labeledPod("team-a", "web", map[string]string{"app": "web"}),
			netpol("team-b", "default-deny", nil),
		),
		Logger: zap.NewNop(),
	}
	rep, err := kc.NetworkPolicyCoverage(context.Background())
	if err != nil {
		t.Fatalf("NetworkPolicyCoverage: %v", err)
	}
	if rep.CoveredWorkloads != 0 || len(rep.Unrestricted) != 1 {
		t.Errorf("Covered/Unrestricted = %d/%d, want 0/1 — policies do not cross namespaces", rep.CoveredWorkloads, len(rep.Unrestricted))
	}
}

// TestNetworkPolicyCoverage_SkipsSystemNamespaces
func TestNetworkPolicyCoverage_SkipsSystemNamespaces(t *testing.T) {
	kc := &Client{
		Clientset: fake.NewSimpleClientset(labeledPod("kube-system", "coredns", nil)),
		Logger:    zap.NewNop(),
	}
	rep, err := kc.NetworkPolicyCoverage(context.Background())
	if err != nil {
		t.Fatalf("NetworkPolicyCoverage: %v", err)
	}
	if rep.TotalWorkloads != 0 || len(rep.Unrestricted) != 0 {
		t.Errorf("Total/Unrestricted = %d/%d, want 0/0 for kube-system", rep.TotalWorkloads, len(rep.Unrestricted))
	}
}
