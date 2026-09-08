package k8s

import (
	"context"
	"fmt"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// NodeMetrics holds resource usage for a single node.
type NodeMetrics struct {
	Name         string `json:"name"`
	CPUUsage     string `json:"cpu_usage"`
	MemoryUsage  string `json:"memory_usage"`
	CPUPercent   float64 `json:"cpu_percent"`
	MemoryPercent float64 `json:"memory_percent"`
}

// ContainerMetricsInfo holds resource usage for a single container.
type ContainerMetricsInfo struct {
	Name        string `json:"name"`
	CPUUsage    string `json:"cpu_usage"`
	MemoryUsage string `json:"memory_usage"`
}

// PodMetricsInfo holds resource usage for a pod and its containers.
type PodMetricsInfo struct {
	Name       string                 `json:"name"`
	Namespace  string                 `json:"namespace"`
	Containers []ContainerMetricsInfo `json:"containers"`
}

// TopNodes returns resource usage metrics for all cluster nodes.
// Requires metrics-server to be installed in the cluster.
func (c *Client) TopNodes(ctx context.Context) ([]NodeMetrics, error) {
	if c.MetricsClient == nil {
		return nil, fmt.Errorf("metrics client is not available (metrics-server may not be installed)")
	}

	// Get node metrics from metrics-server.
	metricsList, err := c.MetricsClient.MetricsV1beta1().NodeMetricses().List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("listing node metrics: %w", err)
	}

	// Get node capacities for percentage calculations.
	nodeList, err := c.Clientset.CoreV1().Nodes().List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("listing nodes for capacity: %w", err)
	}
	capacityMap := make(map[string][2]int64) // name -> [cpuMillis, memBytes]
	for _, n := range nodeList.Items {
		cpuMillis := n.Status.Allocatable.Cpu().MilliValue()
		memBytes := n.Status.Allocatable.Memory().Value()
		capacityMap[n.Name] = [2]int64{cpuMillis, memBytes}
	}

	out := make([]NodeMetrics, 0, len(metricsList.Items))
	for _, m := range metricsList.Items {
		cpuUsage := m.Usage.Cpu().MilliValue()
		memUsage := m.Usage.Memory().Value()

		var cpuPct, memPct float64
		if cap, ok := capacityMap[m.Name]; ok {
			if cap[0] > 0 {
				cpuPct = float64(cpuUsage) / float64(cap[0]) * 100
			}
			if cap[1] > 0 {
				memPct = float64(memUsage) / float64(cap[1]) * 100
			}
		}

		out = append(out, NodeMetrics{
			Name:          m.Name,
			CPUUsage:      m.Usage.Cpu().String(),
			MemoryUsage:   m.Usage.Memory().String(),
			CPUPercent:    cpuPct,
			MemoryPercent: memPct,
		})
	}
	return out, nil
}

// TopPods returns resource usage metrics for pods in a namespace.
// Pass "" for all namespaces. Requires metrics-server.
func (c *Client) TopPods(ctx context.Context, namespace string) ([]PodMetricsInfo, error) {
	if c.MetricsClient == nil {
		return nil, fmt.Errorf("metrics client is not available (metrics-server may not be installed)")
	}

	metricsList, err := c.MetricsClient.MetricsV1beta1().PodMetricses(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("listing pod metrics: %w", err)
	}

	out := make([]PodMetricsInfo, 0, len(metricsList.Items))
	for _, m := range metricsList.Items {
		containers := make([]ContainerMetricsInfo, 0, len(m.Containers))
		for _, cm := range m.Containers {
			containers = append(containers, ContainerMetricsInfo{
				Name:        cm.Name,
				CPUUsage:    cm.Usage.Cpu().String(),
				MemoryUsage: cm.Usage.Memory().String(),
			})
		}
		out = append(out, PodMetricsInfo{
			Name:       m.Name,
			Namespace:  m.Namespace,
			Containers: containers,
		})
	}
	return out, nil
}
