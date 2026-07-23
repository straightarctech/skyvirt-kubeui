package k8s

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"go.uber.org/zap"
	corev1 "k8s.io/api/core/v1"
	policyv1 "k8s.io/api/policy/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"
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

// DrainPod is one pod's disposition in a drain plan or result.
type DrainPod struct {
	Namespace string `json:"namespace"`
	Name      string `json:"name"`
	Reason    string `json:"reason,omitempty"` // why skipped, or why an eviction was blocked
	PDB       string `json:"pdb,omitempty"`    // guarding PodDisruptionBudget, if any
}

// DrainReport is the outcome (or dry-run plan) of draining a node.
type DrainReport struct {
	Node       string     `json:"node"`
	Evictable  []DrainPod `json:"evictable"`           // pods that would be / were evicted
	Skipped    []DrainPod `json:"skipped"`             // DaemonSet / mirror / already-terminal pods
	Evicted    []DrainPod `json:"evicted,omitempty"`   // successfully evicted (real drain only)
	Blocked    []DrainPod `json:"blocked,omitempty"`   // still up at deadline (usually PDB-guarded)
	TimedOut   bool       `json:"timed_out,omitempty"` // deadline hit with pods still up
	DurationMs int64      `json:"duration_ms,omitempty"`
	DryRun     bool       `json:"dry_run,omitempty"`
}

// classifyDrainPod reports whether a pod is exempt from eviction (as kubectl
// drain treats it) and why. DaemonSet-managed, static/mirror, and already
// terminal pods are never evicted.
func classifyDrainPod(pod *corev1.Pod) (skip bool, reason string) {
	if pod.Status.Phase == corev1.PodSucceeded || pod.Status.Phase == corev1.PodFailed {
		return true, "already terminal (" + string(pod.Status.Phase) + ")"
	}
	if pod.DeletionTimestamp != nil {
		return true, "already terminating"
	}
	if _, ok := pod.Annotations["kubernetes.io/config.mirror"]; ok {
		return true, "static/mirror pod (managed by kubelet)"
	}
	for _, ref := range pod.OwnerReferences {
		if ref.Kind == "DaemonSet" {
			return true, "DaemonSet-managed"
		}
	}
	return false, ""
}

// podPDB returns the name of a PodDisruptionBudget in the pod's namespace whose
// selector matches the pod, or "" if none. It surfaces the budget guarding a
// pod so operators know why an eviction may be throttled.
func (c *Client) podPDB(ctx context.Context, pod *corev1.Pod) string {
	pdbs, err := c.Clientset.PolicyV1().PodDisruptionBudgets(pod.Namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return ""
	}
	for i := range pdbs.Items {
		p := &pdbs.Items[i]
		if p.Spec.Selector == nil {
			continue
		}
		sel, err := metav1.LabelSelectorAsSelector(p.Spec.Selector)
		if err != nil {
			continue
		}
		if sel.Matches(labels.Set(pod.Labels)) {
			return p.Name
		}
	}
	return ""
}

// buildDrainReport lists the pods on a node and classifies each as evictable or
// skipped, annotating evictable pods with any guarding PDB.
func (c *Client) buildDrainReport(ctx context.Context, node string) (*DrainReport, []corev1.Pod, error) {
	pods, err := c.Clientset.CoreV1().Pods("").List(ctx, metav1.ListOptions{
		FieldSelector: "spec.nodeName=" + node,
	})
	if err != nil {
		return nil, nil, fmt.Errorf("listing pods on node %s: %w", node, err)
	}
	rep := &DrainReport{Node: node, Evictable: []DrainPod{}, Skipped: []DrainPod{}}
	evictable := make([]corev1.Pod, 0, len(pods.Items))
	for i := range pods.Items {
		pod := pods.Items[i]
		if skip, reason := classifyDrainPod(&pod); skip {
			rep.Skipped = append(rep.Skipped, DrainPod{Namespace: pod.Namespace, Name: pod.Name, Reason: reason})
			continue
		}
		dp := DrainPod{Namespace: pod.Namespace, Name: pod.Name, PDB: c.podPDB(ctx, &pod)}
		rep.Evictable = append(rep.Evictable, dp)
		evictable = append(evictable, pod)
	}
	return rep, evictable, nil
}

// DrainPlan returns a dry-run drain plan for a node — what would be evicted,
// what is exempt, and which pods are guarded by a PodDisruptionBudget. It makes
// no cluster change (does not cordon).
func (c *Client) DrainPlan(ctx context.Context, node string) (*DrainReport, error) {
	rep, _, err := c.buildDrainReport(ctx, node)
	if err != nil {
		return nil, err
	}
	rep.DryRun = true
	return rep, nil
}

// DrainNode cordons a node and evicts its pods through the Eviction API, which
// the API server evaluates against PodDisruptionBudgets — so a drain cannot take
// a service below its budget. Evictions blocked by a PDB (429) are retried with
// backoff until every pod is gone or the deadline is reached; the report lists
// what was evicted and what remained blocked. gracePeriod (seconds, <=0 = pod
// default) and timeout (0 = 2m default) bound the operation.
func (c *Client) DrainNode(ctx context.Context, node string, gracePeriod int, timeout time.Duration) (*DrainReport, error) {
	if timeout <= 0 {
		timeout = 2 * time.Minute
	}
	if err := c.CordonNode(ctx, node, true); err != nil {
		return nil, err
	}
	rep, evictable, err := c.buildDrainReport(ctx, node)
	if err != nil {
		return nil, err
	}
	rep.Evicted = []DrainPod{}
	rep.Blocked = []DrainPod{}

	start := time.Now()
	deadline := start.Add(timeout)
	var grace *int64
	if gracePeriod > 0 {
		g := int64(gracePeriod)
		grace = &g
	}

	// Track remaining pods to evict; retry PDB-blocked evictions until deadline.
	remaining := make(map[string]DrainPod, len(evictable))
	for _, p := range evictable {
		remaining[p.Namespace+"/"+p.Name] = DrainPod{Namespace: p.Namespace, Name: p.Name}
	}
	for len(remaining) > 0 && time.Now().Before(deadline) {
		blockedThisPass := false
		for key, dp := range remaining {
			evErr := c.Clientset.CoreV1().Pods(dp.Namespace).EvictV1(ctx, &policyv1.Eviction{
				ObjectMeta:    metav1.ObjectMeta{Name: dp.Name, Namespace: dp.Namespace},
				DeleteOptions: &metav1.DeleteOptions{GracePeriodSeconds: grace},
			})
			switch {
			case evErr == nil || apierrors.IsNotFound(evErr):
				rep.Evicted = append(rep.Evicted, dp)
				delete(remaining, key)
			case apierrors.IsTooManyRequests(evErr):
				// A PodDisruptionBudget is currently blocking this eviction.
				blockedThisPass = true
			default:
				c.Logger.Warn("eviction error during drain",
					zap.String("pod", dp.Name), zap.String("namespace", dp.Namespace), zap.Error(evErr))
				blockedThisPass = true
			}
		}
		if len(remaining) > 0 && blockedThisPass {
			select {
			case <-ctx.Done():
				return rep, ctx.Err()
			case <-time.After(5 * time.Second):
			}
		}
	}

	for _, dp := range remaining {
		dp.Reason = "blocked (disruption budget or eviction error) at deadline"
		dp.PDB = pdbNameFor(rep.Evictable, dp)
		rep.Blocked = append(rep.Blocked, dp)
	}
	rep.TimedOut = len(remaining) > 0
	rep.DurationMs = time.Since(start).Milliseconds()
	return rep, nil
}

// pdbNameFor recovers the PDB annotation captured for a pod in the evictable list.
func pdbNameFor(evictable []DrainPod, dp DrainPod) string {
	for _, e := range evictable {
		if e.Namespace == dp.Namespace && e.Name == dp.Name {
			return e.PDB
		}
	}
	return ""
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
