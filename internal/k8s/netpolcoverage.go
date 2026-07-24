package k8s

import (
	"context"
	"sort"

	networkingv1 "k8s.io/api/networking/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"
)

// UnrestrictedWorkload is a workload whose pods no ingress NetworkPolicy selects —
// they accept connections from anywhere in the cluster (default-allow).
type UnrestrictedWorkload struct {
	Namespace string `json:"namespace"`
	Kind      string `json:"kind"`
	Name      string `json:"name"`
}

// NetworkPolicyCoverageReport summarises ingress isolation across the cluster.
type NetworkPolicyCoverageReport struct {
	Unrestricted     []UnrestrictedWorkload `json:"unrestricted"`
	TotalWorkloads   int                    `json:"total_workloads"`
	CoveredWorkloads int                    `json:"covered_workloads"`
}

// NetworkPolicyCoverage reports which workloads have no NetworkPolicy restricting
// their ingress — meaning any pod in the cluster can reach them. It is read-only
// and skips the control-plane namespaces (whose isolation is managed by the
// distribution). Finer than the "namespace has zero policies" posture check: it
// catches pods left uncovered inside a namespace that has some policies.
func (c *Client) NetworkPolicyCoverage(ctx context.Context) (*NetworkPolicyCoverageReport, error) {
	pods, err := c.Clientset.CoreV1().Pods("").List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	nps, err := c.Clientset.NetworkingV1().NetworkPolicies("").List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}

	// Ingress-restricting selectors per namespace.
	type nsSel struct{ sels []labels.Selector }
	ingress := map[string]*nsSel{}
	for i := range nps.Items {
		np := &nps.Items[i]
		if !restrictsIngress(np) {
			continue
		}
		sel, err := metav1.LabelSelectorAsSelector(&np.Spec.PodSelector)
		if err != nil {
			continue
		}
		e := ingress[np.Namespace]
		if e == nil {
			e = &nsSel{}
			ingress[np.Namespace] = e
		}
		e.sels = append(e.sels, sel)
	}

	rep := &NetworkPolicyCoverageReport{Unrestricted: []UnrestrictedWorkload{}}
	seen := map[string]bool{}
	for i := range pods.Items {
		pod := &pods.Items[i]
		if systemNamespaces[pod.Namespace] {
			continue
		}
		key := workloadKey(pod)
		if seen[key] {
			continue
		}
		seen[key] = true
		rep.TotalWorkloads++

		covered := false
		if e := ingress[pod.Namespace]; e != nil {
			set := labels.Set(pod.Labels)
			for _, s := range e.sels {
				if s.Matches(set) {
					covered = true
					break
				}
			}
		}
		if covered {
			rep.CoveredWorkloads++
			continue
		}
		kind, name := workloadOf(pod)
		rep.Unrestricted = append(rep.Unrestricted, UnrestrictedWorkload{Namespace: pod.Namespace, Kind: kind, Name: name})
	}

	sort.Slice(rep.Unrestricted, func(a, b int) bool {
		if rep.Unrestricted[a].Namespace != rep.Unrestricted[b].Namespace {
			return rep.Unrestricted[a].Namespace < rep.Unrestricted[b].Namespace
		}
		return rep.Unrestricted[a].Name < rep.Unrestricted[b].Name
	})
	return rep, nil
}

// restrictsIngress reports whether a NetworkPolicy applies to ingress traffic.
// PolicyTypes is authoritative when set; an unset PolicyTypes defaults to
// [Ingress] (plus Egress if egress rules exist), so absence counts as ingress.
func restrictsIngress(np *networkingv1.NetworkPolicy) bool {
	if len(np.Spec.PolicyTypes) == 0 {
		return true
	}
	for _, t := range np.Spec.PolicyTypes {
		if t == networkingv1.PolicyTypeIngress {
			return true
		}
	}
	return false
}
