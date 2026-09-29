package k8s

import (
	"context"
	"fmt"
	"time"

	appsv1 "k8s.io/api/apps/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
)

// DaemonSetSummary is the API-friendly daemonset representation.
type DaemonSetSummary struct {
	Name         string            `json:"name"`
	Namespace    string            `json:"namespace"`
	Desired      int32             `json:"desired"`
	Current      int32             `json:"current"`
	Ready        int32             `json:"ready"`
	UpToDate     int32             `json:"up_to_date"`
	Images       []string          `json:"images"`
	Labels       map[string]string `json:"labels"`
	NodeSelector map[string]string `json:"node_selector"`
	CreatedAt    time.Time         `json:"created_at"`
}

func toDaemonSetSummary(ds *appsv1.DaemonSet) DaemonSetSummary {
	images := make([]string, 0, len(ds.Spec.Template.Spec.Containers))
	for _, c := range ds.Spec.Template.Spec.Containers {
		images = append(images, c.Image)
	}
	return DaemonSetSummary{
		Name:         ds.Name,
		Namespace:    ds.Namespace,
		Desired:      ds.Status.DesiredNumberScheduled,
		Current:      ds.Status.CurrentNumberScheduled,
		Ready:        ds.Status.NumberReady,
		UpToDate:     ds.Status.UpdatedNumberScheduled,
		Images:       images,
		Labels:       ds.Labels,
		NodeSelector: ds.Spec.Template.Spec.NodeSelector,
		CreatedAt:    ds.CreationTimestamp.Time,
	}
}

// ListDaemonSets returns daemonsets in a namespace. Pass "" for all namespaces.
func (c *Client) ListDaemonSets(ctx context.Context, namespace string) ([]DaemonSetSummary, error) {
	list, err := c.Clientset.AppsV1().DaemonSets(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("listing daemonsets: %w", err)
	}
	out := make([]DaemonSetSummary, len(list.Items))
	for i := range list.Items {
		out[i] = toDaemonSetSummary(&list.Items[i])
	}
	return out, nil
}

// RestartDaemonSet triggers a rolling restart by patching the pod template annotation.
func (c *Client) RestartDaemonSet(ctx context.Context, namespace, name string) error {
	patch := fmt.Sprintf(`{"spec":{"template":{"metadata":{"annotations":{"kubectl.kubernetes.io/restartedAt":"%s"}}}}}`,
		time.Now().Format(time.RFC3339))
	_, err := c.Clientset.AppsV1().DaemonSets(namespace).Patch(ctx, name, types.StrategicMergePatchType, []byte(patch), metav1.PatchOptions{})
	if err != nil {
		return fmt.Errorf("restarting daemonset %s/%s: %w", namespace, name, err)
	}
	return nil
}

// DeleteDaemonSet deletes a daemonset.
func (c *Client) DeleteDaemonSet(ctx context.Context, namespace, name string) error {
	err := c.Clientset.AppsV1().DaemonSets(namespace).Delete(ctx, name, metav1.DeleteOptions{})
	if err != nil {
		return fmt.Errorf("deleting daemonset %s/%s: %w", namespace, name, err)
	}
	return nil
}
