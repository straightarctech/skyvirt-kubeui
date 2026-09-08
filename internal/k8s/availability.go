package k8s

import (
	"context"
	"fmt"
	"sort"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// AvailabilityRisk is one workload that is a single point of failure.
type AvailabilityRisk struct {
	Severity  string `json:"severity"` // high | medium
	Kind      string `json:"kind"`
	Namespace string `json:"namespace"`
	Name      string `json:"name"`
	Reason    string `json:"reason"`
	Detail    string `json:"detail"`
}

// AvailabilityReport summarises single-points-of-failure.
type AvailabilityReport struct {
	Risks         []AvailabilityRisk `json:"risks"`
	Concentrated  int                `json:"concentrated"` // multi-replica, all on one node
	SingleReplica int                `json:"single_replica"`
	Analyzed      int                `json:"analyzed"`
}

type placement struct {
	nodes   map[string]bool
	running int
}

// AvailabilityAudit finds workloads that a single node failure would take down:
// multi-replica Deployments/StatefulSets whose pods all landed on one node (no
// spread), and workloads running a single replica. Read-only. Skips control-plane
// namespaces.
func (c *Client) AvailabilityAudit(ctx context.Context) (*AvailabilityReport, error) {
	pods, err := c.Clientset.CoreV1().Pods("").List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	place := map[string]*placement{}
	for i := range pods.Items {
		pod := &pods.Items[i]
		if pod.Spec.NodeName == "" || pod.Status.Phase == corev1.PodSucceeded {
			continue
		}
		key := workloadKey(pod)
		p := place[key]
		if p == nil {
			p = &placement{nodes: map[string]bool{}}
			place[key] = p
		}
		p.nodes[pod.Spec.NodeName] = true
		p.running++
	}

	rep := &AvailabilityReport{Risks: []AvailabilityRisk{}}
	add := func(r AvailabilityRisk) { rep.Risks = append(rep.Risks, r) }

	consider := func(ns, kind, name string, desired int32) {
		if systemNamespaces[ns] {
			return
		}
		rep.Analyzed++
		if desired <= 1 {
			add(AvailabilityRisk{Severity: "medium", Kind: kind, Namespace: ns, Name: name,
				Reason: "single replica", Detail: "one replica — no redundancy if its pod or node fails"})
			rep.SingleReplica++
			return
		}
		p := place[ns+"/"+name]
		if p == nil || p.running < 2 {
			return // not enough running pods to judge spread (a health issue, not HA config)
		}
		if len(p.nodes) == 1 {
			var node string
			for n := range p.nodes {
				node = n
			}
			add(AvailabilityRisk{Severity: "high", Kind: kind, Namespace: ns, Name: name,
				Reason: "all replicas on one node",
				Detail: fmt.Sprintf("%d replicas all on node %q — a node failure takes the whole workload down", p.running, node)})
			rep.Concentrated++
		}
	}

	deps, err := c.Clientset.AppsV1().Deployments("").List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	for i := range deps.Items {
		consider(deps.Items[i].Namespace, "Deployment", deps.Items[i].Name, replicasOf(deps.Items[i].Spec.Replicas))
	}
	sts, err := c.Clientset.AppsV1().StatefulSets("").List(ctx, metav1.ListOptions{})
	if err == nil {
		for i := range sts.Items {
			consider(sts.Items[i].Namespace, "StatefulSet", sts.Items[i].Name, replicasOf(sts.Items[i].Spec.Replicas))
		}
	}

	sort.SliceStable(rep.Risks, func(a, b int) bool {
		ra, rb := rep.Risks[a], rep.Risks[b]
		if ra.Severity != rb.Severity {
			return ra.Severity == "high" // high before medium
		}
		if ra.Namespace != rb.Namespace {
			return ra.Namespace < rb.Namespace
		}
		return ra.Name < rb.Name
	})
	return rep, nil
}

func replicasOf(r *int32) int32 {
	if r == nil {
		return 1
	}
	return *r
}
