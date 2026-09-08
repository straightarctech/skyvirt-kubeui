package k8s

import (
	"context"
	"fmt"
	"time"

	appsv1 "k8s.io/api/apps/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
)

// StatefulSetSummary is the API-friendly statefulset representation.
type StatefulSetSummary struct {
	Name          string            `json:"name"`
	Namespace     string            `json:"namespace"`
	Replicas      int32             `json:"replicas"`
	ReadyReplicas int32             `json:"ready_replicas"`
	ServiceName   string            `json:"service_name"`
	Images        []string          `json:"images"`
	Labels        map[string]string `json:"labels"`
	CreatedAt     time.Time         `json:"created_at"`
}

func toStatefulSetSummary(s *appsv1.StatefulSet) StatefulSetSummary {
	var replicas int32
	if s.Spec.Replicas != nil {
		replicas = *s.Spec.Replicas
	}
	images := make([]string, 0, len(s.Spec.Template.Spec.Containers))
	for _, c := range s.Spec.Template.Spec.Containers {
		images = append(images, c.Image)
	}
	return StatefulSetSummary{
		Name:          s.Name,
		Namespace:     s.Namespace,
		Replicas:      replicas,
		ReadyReplicas: s.Status.ReadyReplicas,
		ServiceName:   s.Spec.ServiceName,
		Images:        images,
		Labels:        s.Labels,
		CreatedAt:     s.CreationTimestamp.Time,
	}
}

// ListStatefulSets returns statefulsets in a namespace. Pass "" for all namespaces.
func (c *Client) ListStatefulSets(ctx context.Context, namespace string) ([]StatefulSetSummary, error) {
	list, err := c.Clientset.AppsV1().StatefulSets(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("listing statefulsets: %w", err)
	}
	out := make([]StatefulSetSummary, len(list.Items))
	for i := range list.Items {
		out[i] = toStatefulSetSummary(&list.Items[i])
	}
	return out, nil
}

// ScaleStatefulSet sets the replica count for a statefulset.
func (c *Client) ScaleStatefulSet(ctx context.Context, namespace, name string, replicas int32) error {
	scale, err := c.Clientset.AppsV1().StatefulSets(namespace).GetScale(ctx, name, metav1.GetOptions{})
	if err != nil {
		return fmt.Errorf("getting scale for statefulset %s/%s: %w", namespace, name, err)
	}
	scale.Spec.Replicas = replicas
	_, err = c.Clientset.AppsV1().StatefulSets(namespace).UpdateScale(ctx, name, scale, metav1.UpdateOptions{})
	if err != nil {
		return fmt.Errorf("scaling statefulset %s/%s to %d: %w", namespace, name, replicas, err)
	}
	return nil
}

// RestartStatefulSet triggers a rolling restart by patching the pod template annotation.
func (c *Client) RestartStatefulSet(ctx context.Context, namespace, name string) error {
	patch := fmt.Sprintf(`{"spec":{"template":{"metadata":{"annotations":{"kubectl.kubernetes.io/restartedAt":"%s"}}}}}`,
		time.Now().Format(time.RFC3339))
	_, err := c.Clientset.AppsV1().StatefulSets(namespace).Patch(ctx, name, types.StrategicMergePatchType, []byte(patch), metav1.PatchOptions{})
	if err != nil {
		return fmt.Errorf("restarting statefulset %s/%s: %w", namespace, name, err)
	}
	return nil
}

// DeleteStatefulSet deletes a statefulset.
func (c *Client) DeleteStatefulSet(ctx context.Context, namespace, name string) error {
	err := c.Clientset.AppsV1().StatefulSets(namespace).Delete(ctx, name, metav1.DeleteOptions{})
	if err != nil {
		return fmt.Errorf("deleting statefulset %s/%s: %w", namespace, name, err)
	}
	return nil
}
