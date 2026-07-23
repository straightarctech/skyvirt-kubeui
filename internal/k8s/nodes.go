package k8s

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"go.uber.org/zap"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
)

// NodeSummary is the API-friendly node representation.
type NodeSummary struct {
	Name              string            `json:"name"`
	Status            string            `json:"status"`
	Roles             []string          `json:"roles"`
	Version           string            `json:"version"`
	InternalIP        string            `json:"internal_ip"`
	OS                string            `json:"os"`
	Architecture      string            `json:"architecture"`
	ContainerRuntime  string            `json:"container_runtime"`
	KernelVersion     string            `json:"kernel_version"`
	CPUCapacity       string            `json:"cpu_capacity"`
	MemoryCapacity    string            `json:"memory_capacity"`
	PodCapacity       string            `json:"pod_capacity"`
	CPUAllocatable    string            `json:"cpu_allocatable"`
	MemoryAllocatable string            `json:"memory_allocatable"`
	Labels            map[string]string `json:"labels"`
	Annotations       map[string]string `json:"annotations"`
	Taints            []TaintInfo       `json:"taints"`
	CreatedAt         time.Time         `json:"created_at"`
	Unschedulable     bool              `json:"unschedulable"`
	Conditions        []ConditionInfo   `json:"conditions"`
}

type TaintInfo struct {
	Key    string `json:"key"`
	Value  string `json:"value"`
	Effect string `json:"effect"`
}

type ConditionInfo struct {
	Type    string `json:"type"`
	Status  string `json:"status"`
	Reason  string `json:"reason"`
	Message string `json:"message"`
}

func nodeRoles(n *corev1.Node) []string {
	roles := []string{}
	for k := range n.Labels {
		if k == "node-role.kubernetes.io/master" || k == "node-role.kubernetes.io/control-plane" {
			roles = append(roles, "control-plane")
		}
		if k == "node-role.kubernetes.io/worker" {
			roles = append(roles, "worker")
		}
	}
	if len(roles) == 0 {
		roles = append(roles, "worker")
	}
	return roles
}

func nodeStatus(n *corev1.Node) string {
	for _, c := range n.Status.Conditions {
		if c.Type == corev1.NodeReady {
			if c.Status == corev1.ConditionTrue {
				return "Ready"
			}
			return "NotReady"
		}
	}
	return "Unknown"
}

func nodeInternalIP(n *corev1.Node) string {
	for _, addr := range n.Status.Addresses {
		if addr.Type == corev1.NodeInternalIP {
			return addr.Address
		}
	}
	return ""
}

func toNodeSummary(n *corev1.Node) NodeSummary {
	taints := make([]TaintInfo, len(n.Spec.Taints))
	for i, t := range n.Spec.Taints {
		taints[i] = TaintInfo{Key: t.Key, Value: t.Value, Effect: string(t.Effect)}
	}
	conditions := make([]ConditionInfo, len(n.Status.Conditions))
	for i, c := range n.Status.Conditions {
		conditions[i] = ConditionInfo{
			Type:    string(c.Type),
			Status:  string(c.Status),
			Reason:  c.Reason,
			Message: c.Message,
		}
	}
	return NodeSummary{
		Name:              n.Name,
		Status:            nodeStatus(n),
		Roles:             nodeRoles(n),
		Version:           n.Status.NodeInfo.KubeletVersion,
		InternalIP:        nodeInternalIP(n),
		OS:                n.Status.NodeInfo.OSImage,
		Architecture:      n.Status.NodeInfo.Architecture,
		ContainerRuntime:  n.Status.NodeInfo.ContainerRuntimeVersion,
		KernelVersion:     n.Status.NodeInfo.KernelVersion,
		CPUCapacity:       n.Status.Capacity.Cpu().String(),
		MemoryCapacity:    n.Status.Capacity.Memory().String(),
		PodCapacity:       n.Status.Capacity.Pods().String(),
		CPUAllocatable:    n.Status.Allocatable.Cpu().String(),
		MemoryAllocatable: n.Status.Allocatable.Memory().String(),
		Labels:            n.Labels,
		Annotations:       n.Annotations,
		Taints:            taints,
		CreatedAt:         n.CreationTimestamp.Time,
		Unschedulable:     n.Spec.Unschedulable,
		Conditions:        conditions,
	}
}

// ListNodes returns all cluster nodes.
func (c *Client) ListNodes(ctx context.Context) ([]NodeSummary, error) {
	list, err := c.Clientset.CoreV1().Nodes().List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("listing nodes: %w", err)
	}
	out := make([]NodeSummary, len(list.Items))
	for i := range list.Items {
		out[i] = toNodeSummary(&list.Items[i])
	}
	return out, nil
}

// GetNode returns a single node by name.
func (c *Client) GetNode(ctx context.Context, name string) (*NodeSummary, error) {
	n, err := c.Clientset.CoreV1().Nodes().Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, fmt.Errorf("getting node %s: %w", name, err)
	}
	s := toNodeSummary(n)
	return &s, nil
}

// CordonNode marks a node as unschedulable.
func (c *Client) CordonNode(ctx context.Context, name string, cordon bool) error {
	patch := fmt.Sprintf(`{"spec":{"unschedulable":%v}}`, cordon)
	_, err := c.Clientset.CoreV1().Nodes().Patch(ctx, name, types.MergePatchType, []byte(patch), metav1.PatchOptions{})
	if err != nil {
		return fmt.Errorf("cordoning node %s: %w", name, err)
	}
	return nil
}

// DrainNode evicts all pods from a node (simplified — real drain is complex).
func (c *Client) DrainNode(ctx context.Context, name string) error {
	// First cordon the node.
	if err := c.CordonNode(ctx, name, true); err != nil {
		return err
	}
	// List pods on this node.
	pods, err := c.Clientset.CoreV1().Pods("").List(ctx, metav1.ListOptions{
		FieldSelector: "spec.nodeName=" + name,
	})
	if err != nil {
		return fmt.Errorf("listing pods on node %s: %w", name, err)
	}
	// Evict each pod (skip DaemonSet pods and mirror pods).
	for _, pod := range pods.Items {
		if pod.Namespace == "kube-system" {
			continue
		}
		// Skip DaemonSet-owned pods.
		isDaemonSet := false
		for _, ref := range pod.OwnerReferences {
			if ref.Kind == "DaemonSet" {
				isDaemonSet = true
				break
			}
		}
		if isDaemonSet {
			continue
		}
		err := c.Clientset.CoreV1().Pods(pod.Namespace).Delete(ctx, pod.Name, metav1.DeleteOptions{
			GracePeriodSeconds: int64Ptr(30),
		})
		if err != nil {
			c.Logger.Warn("failed to evict pod during drain",
				zap.String("pod", pod.Name),
				zap.String("namespace", pod.Namespace),
				zap.Error(err))
		}
	}
	return nil
}

// SetNodeLabels sets labels on a node.
func (c *Client) SetNodeLabels(ctx context.Context, name string, labels map[string]string) error {
	labelsJSON, err := json.Marshal(map[string]interface{}{
		"metadata": map[string]interface{}{"labels": labels},
	})
	if err != nil {
		return err
	}
	_, err = c.Clientset.CoreV1().Nodes().Patch(ctx, name, types.MergePatchType, labelsJSON, metav1.PatchOptions{})
	if err != nil {
		return fmt.Errorf("setting labels on node %s: %w", name, err)
	}
	return nil
}

// TaintNode adds or removes a taint on a node.
func (c *Client) TaintNode(ctx context.Context, name string, taint TaintInfo, remove bool) error {
	node, err := c.Clientset.CoreV1().Nodes().Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return err
	}
	if remove {
		newTaints := []corev1.Taint{}
		for _, t := range node.Spec.Taints {
			if t.Key != taint.Key {
				newTaints = append(newTaints, t)
			}
		}
		node.Spec.Taints = newTaints
	} else {
		node.Spec.Taints = append(node.Spec.Taints, corev1.Taint{
			Key:    taint.Key,
			Value:  taint.Value,
			Effect: corev1.TaintEffect(taint.Effect),
		})
	}
	_, err = c.Clientset.CoreV1().Nodes().Update(ctx, node, metav1.UpdateOptions{})
	return err
}

func int64Ptr(i int64) *int64 { return &i }
