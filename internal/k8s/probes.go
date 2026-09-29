package k8s

import (
	"context"
	"sort"
	"strings"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// ProbeGap is a workload missing a health probe on one or more containers.
type ProbeGap struct {
	Severity  string `json:"severity"` // medium | low
	Kind      string `json:"kind"`
	Namespace string `json:"namespace"`
	Name      string `json:"name"`
	Detail    string `json:"detail"`
}

// ProbeReport summarises health-probe coverage.
type ProbeReport struct {
	Gaps             []ProbeGap `json:"gaps"`
	Analyzed         int        `json:"analyzed"`
	MissingReadiness int        `json:"missing_readiness"`
	MissingLiveness  int        `json:"missing_liveness"`
}

// ProbeAudit flags workloads whose containers lack health probes: a missing
// readiness probe means traffic can hit a pod before it is ready (rough
// rollouts); a missing liveness probe means a hung container is never restarted.
// Template-level and read-only; skips control-plane namespaces.
func (c *Client) ProbeAudit(ctx context.Context) (*ProbeReport, error) {
	rep := &ProbeReport{Gaps: []ProbeGap{}}

	check := func(ns, kind, name string, containers []corev1.Container) {
		if systemNamespaces[ns] {
			return
		}
		rep.Analyzed++
		var noReady, noLive []string
		for _, ct := range containers {
			if ct.ReadinessProbe == nil {
				noReady = append(noReady, ct.Name)
			}
			if ct.LivenessProbe == nil {
				noLive = append(noLive, ct.Name)
			}
		}
		if len(noReady) == 0 && len(noLive) == 0 {
			return
		}
		var parts []string
		sev := "low"
		if len(noReady) > 0 {
			parts = append(parts, "no readiness probe on "+strings.Join(noReady, ", "))
			sev = "medium"
			rep.MissingReadiness++
		}
		if len(noLive) > 0 {
			parts = append(parts, "no liveness probe on "+strings.Join(noLive, ", "))
			rep.MissingLiveness++
		}
		rep.Gaps = append(rep.Gaps, ProbeGap{Severity: sev, Kind: kind, Namespace: ns, Name: name, Detail: strings.Join(parts, "; ")})
	}

	if deps, err := c.Clientset.AppsV1().Deployments("").List(ctx, metav1.ListOptions{}); err == nil {
		for i := range deps.Items {
			check(deps.Items[i].Namespace, "Deployment", deps.Items[i].Name, deps.Items[i].Spec.Template.Spec.Containers)
		}
	} else {
		return nil, err
	}
	if sts, err := c.Clientset.AppsV1().StatefulSets("").List(ctx, metav1.ListOptions{}); err == nil {
		for i := range sts.Items {
			check(sts.Items[i].Namespace, "StatefulSet", sts.Items[i].Name, sts.Items[i].Spec.Template.Spec.Containers)
		}
	}
	if ds, err := c.Clientset.AppsV1().DaemonSets("").List(ctx, metav1.ListOptions{}); err == nil {
		for i := range ds.Items {
			check(ds.Items[i].Namespace, "DaemonSet", ds.Items[i].Name, ds.Items[i].Spec.Template.Spec.Containers)
		}
	}

	sort.SliceStable(rep.Gaps, func(a, b int) bool {
		ga, gb := rep.Gaps[a], rep.Gaps[b]
		if ga.Severity != gb.Severity {
			return ga.Severity == "medium" // medium before low
		}
		if ga.Namespace != gb.Namespace {
			return ga.Namespace < gb.Namespace
		}
		return ga.Name < gb.Name
	})
	return rep, nil
}
