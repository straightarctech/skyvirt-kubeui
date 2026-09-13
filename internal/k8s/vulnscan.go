package k8s

import (
	"context"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

var vulnReportGVR = schema.GroupVersionResource{
	Group: "aquasecurity.github.io", Version: "v1alpha1", Resource: "vulnerabilityreports",
}

var configAuditGVR = schema.GroupVersionResource{
	Group: "aquasecurity.github.io", Version: "v1alpha1", Resource: "configauditreports",
}

// ConfigAuditReport is one workload's misconfiguration summary from Trivy Operator.
type ConfigAuditReport struct {
	Namespace string `json:"namespace"`
	Resource  string `json:"resource"`
	Critical  int    `json:"critical"`
	High      int    `json:"high"`
	Medium    int    `json:"medium"`
	Low       int    `json:"low"`
}

// ListConfigAuditReports aggregates Trivy Operator's ConfigAuditReports — one row
// per workload, with its per-severity misconfiguration counts.
func (c *Client) ListConfigAuditReports(ctx context.Context) ([]ConfigAuditReport, error) {
	list, err := c.DynamicClient.Resource(configAuditGVR).Namespace("").List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	out := make([]ConfigAuditReport, 0, len(list.Items))
	for i := range list.Items {
		o := list.Items[i].Object
		meta := mapAt(o, "metadata")
		labels := mapAt(o, "metadata", "labels")
		summary := mapAt(o, "report", "summary")
		res := strFrom(labels, "trivy-operator.resource.kind")
		if n := strFrom(labels, "trivy-operator.resource.name"); n != "" {
			res += "/" + n
		}
		out = append(out, ConfigAuditReport{
			Namespace: strFrom(meta, "namespace"),
			Resource:  res,
			Critical:  numFrom(summary, "criticalCount"),
			High:      numFrom(summary, "highCount"),
			Medium:    numFrom(summary, "mediumCount"),
			Low:       numFrom(summary, "lowCount"),
		})
	}
	return out, nil
}

// VulnReport is one image's vulnerability summary from Trivy Operator.
type VulnReport struct {
	Namespace string `json:"namespace"`
	Workload  string `json:"workload"`
	Container string `json:"container"`
	Image     string `json:"image"`
	Critical  int    `json:"critical"`
	High      int    `json:"high"`
	Medium    int    `json:"medium"`
	Low       int    `json:"low"`
	Unknown   int    `json:"unknown"`
}

// TrivyInstalled reports whether Trivy Operator's CRDs are present.
func (c *Client) TrivyInstalled(ctx context.Context) bool {
	_, err := c.DynamicClient.Resource(vulnReportGVR).Namespace("").List(ctx, metav1.ListOptions{Limit: 1})
	return err == nil
}

func mapAt(o map[string]any, keys ...string) map[string]any {
	cur := o
	for _, k := range keys {
		m, ok := cur[k].(map[string]any)
		if !ok {
			return nil
		}
		cur = m
	}
	return cur
}

func numFrom(m map[string]any, key string) int {
	if m == nil {
		return 0
	}
	switch v := m[key].(type) {
	case int64:
		return int(v)
	case float64:
		return int(v)
	case int:
		return v
	}
	return 0
}

func strFrom(m map[string]any, key string) string {
	if m == nil {
		return ""
	}
	s, _ := m[key].(string)
	return s
}

// ListVulnReports aggregates Trivy Operator's VulnerabilityReports — one row per
// scanned image, with its per-severity CVE counts and the workload it belongs to.
func (c *Client) ListVulnReports(ctx context.Context) ([]VulnReport, error) {
	list, err := c.DynamicClient.Resource(vulnReportGVR).Namespace("").List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	out := make([]VulnReport, 0, len(list.Items))
	for i := range list.Items {
		o := list.Items[i].Object
		meta := mapAt(o, "metadata")
		labels := mapAt(o, "metadata", "labels")
		artifact := mapAt(o, "report", "artifact")
		registry := mapAt(o, "report", "registry")
		summary := mapAt(o, "report", "summary")

		image := strFrom(artifact, "repository")
		if tag := strFrom(artifact, "tag"); tag != "" {
			image += ":" + tag
		}
		if reg := strFrom(registry, "server"); reg != "" && reg != "index.docker.io" {
			image = reg + "/" + image
		}
		workload := strFrom(labels, "trivy-operator.resource.kind")
		if wn := strFrom(labels, "trivy-operator.resource.name"); wn != "" {
			workload += "/" + wn
		}
		out = append(out, VulnReport{
			Namespace: strFrom(meta, "namespace"),
			Workload:  workload,
			Container: strFrom(labels, "trivy-operator.container.name"),
			Image:     image,
			Critical:  numFrom(summary, "criticalCount"),
			High:      numFrom(summary, "highCount"),
			Medium:    numFrom(summary, "mediumCount"),
			Low:       numFrom(summary, "lowCount"),
			Unknown:   numFrom(summary, "unknownCount"),
		})
	}
	return out, nil
}
