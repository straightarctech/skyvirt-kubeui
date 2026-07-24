package k8s

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
)

// PodSummaryFromUnstructured converts a watch event's unstructured object into
// the same PodSummary shape ListPods returns, so the watch stream can carry
// typed deltas the frontend patches in place (no re-list).
func PodSummaryFromUnstructured(u *unstructured.Unstructured) (any, error) {
	var pod corev1.Pod
	if err := runtime.DefaultUnstructuredConverter.FromUnstructured(u.Object, &pod); err != nil {
		return nil, err
	}
	return toPodSummary(&pod), nil
}

// ContainerSummary describes a single container within a pod.
type ContainerSummary struct {
	Name     string `json:"name"`
	Image    string `json:"image"`
	Ready    bool   `json:"ready"`
	Restarts int32  `json:"restarts"`
}

// PodSummary is the API-friendly pod representation.
type PodSummary struct {
	Name       string            `json:"name"`
	Namespace  string            `json:"namespace"`
	Status     string            `json:"status"`
	Phase      string            `json:"phase"`
	Node       string            `json:"node"`
	IP         string            `json:"ip"`
	Containers []ContainerSummary `json:"containers"`
	Labels     map[string]string `json:"labels"`
	CreatedAt  time.Time         `json:"created_at"`
	OwnerKind  string            `json:"owner_kind"`
	OwnerName  string            `json:"owner_name"`
}

func podStatus(pod *corev1.Pod) string {
	// Check for terminating state.
	if pod.DeletionTimestamp != nil {
		return "Terminating"
	}
	// Check container statuses for a more descriptive status.
	for _, cs := range pod.Status.ContainerStatuses {
		if cs.State.Waiting != nil && cs.State.Waiting.Reason != "" {
			return cs.State.Waiting.Reason
		}
		if cs.State.Terminated != nil && cs.State.Terminated.Reason != "" {
			return cs.State.Terminated.Reason
		}
	}
	return string(pod.Status.Phase)
}

func toPodSummary(pod *corev1.Pod) PodSummary {
	containers := make([]ContainerSummary, 0, len(pod.Status.ContainerStatuses))
	// Build a map from status for easy lookup.
	statusMap := make(map[string]corev1.ContainerStatus, len(pod.Status.ContainerStatuses))
	for _, cs := range pod.Status.ContainerStatuses {
		statusMap[cs.Name] = cs
	}
	for _, c := range pod.Spec.Containers {
		cs := ContainerSummary{
			Name:  c.Name,
			Image: c.Image,
		}
		if status, ok := statusMap[c.Name]; ok {
			cs.Ready = status.Ready
			cs.Restarts = status.RestartCount
		}
		containers = append(containers, cs)
	}

	var ownerKind, ownerName string
	if len(pod.OwnerReferences) > 0 {
		ownerKind = pod.OwnerReferences[0].Kind
		ownerName = pod.OwnerReferences[0].Name
	}

	return PodSummary{
		Name:       pod.Name,
		Namespace:  pod.Namespace,
		Status:     podStatus(pod),
		Phase:      string(pod.Status.Phase),
		Node:       pod.Spec.NodeName,
		IP:         pod.Status.PodIP,
		Containers: containers,
		Labels:     pod.Labels,
		CreatedAt:  pod.CreationTimestamp.Time,
		OwnerKind:  ownerKind,
		OwnerName:  ownerName,
	}
}

// ListPods returns pods in a namespace. Pass "" for all namespaces.
func (c *Client) ListPods(ctx context.Context, namespace string) ([]PodSummary, error) {
	list, err := c.Clientset.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("listing pods: %w", err)
	}
	out := make([]PodSummary, len(list.Items))
	for i := range list.Items {
		out[i] = toPodSummary(&list.Items[i])
	}
	return out, nil
}

// GetPod returns a single pod.
func (c *Client) GetPod(ctx context.Context, namespace, name string) (*PodSummary, error) {
	pod, err := c.Clientset.CoreV1().Pods(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, fmt.Errorf("getting pod %s/%s: %w", namespace, name, err)
	}
	s := toPodSummary(pod)
	return &s, nil
}

// DeletePod deletes a pod.
func (c *Client) DeletePod(ctx context.Context, namespace, name string) error {
	err := c.Clientset.CoreV1().Pods(namespace).Delete(ctx, name, metav1.DeleteOptions{})
	if err != nil {
		return fmt.Errorf("deleting pod %s/%s: %w", namespace, name, err)
	}
	return nil
}

// maxLogBytes limits log reads to 10 MiB to prevent OOM.
const maxLogBytes = 10 * 1024 * 1024

// GetPodLogs retrieves log output from a container in a pod.
func (c *Client) GetPodLogs(ctx context.Context, namespace, name, container string, tailLines int64) (string, error) {
	opts := &corev1.PodLogOptions{}
	if container != "" {
		opts.Container = container
	}
	if tailLines > 0 {
		opts.TailLines = &tailLines
	}

	req := c.Clientset.CoreV1().Pods(namespace).GetLogs(name, opts)
	stream, err := req.Stream(ctx)
	if err != nil {
		return "", fmt.Errorf("streaming logs for %s/%s: %w", namespace, name, err)
	}
	defer stream.Close()

	var buf bytes.Buffer
	if _, err := io.Copy(&buf, io.LimitReader(stream, maxLogBytes)); err != nil {
		return "", fmt.Errorf("reading log stream for %s/%s: %w", namespace, name, err)
	}
	return buf.String(), nil
}
