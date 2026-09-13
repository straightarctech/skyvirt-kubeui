package k8s

import (
	"context"
	"fmt"
	"time"

	autoscalingv2 "k8s.io/api/autoscaling/v2"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// HPASummary is the API-friendly horizontal pod autoscaler representation.
type HPASummary struct {
	Name            string    `json:"name"`
	Namespace       string    `json:"namespace"`
	TargetKind      string    `json:"target_kind"`
	TargetName      string    `json:"target_name"`
	MinReplicas     int32     `json:"min_replicas"`
	MaxReplicas     int32     `json:"max_replicas"`
	CurrentReplicas int32     `json:"current_replicas"`
	DesiredReplicas int32     `json:"desired_replicas"`
	Metrics         []string  `json:"metrics"`
	CreatedAt       time.Time `json:"created_at"`
}

func hpaMetricDescriptions(hpa *autoscalingv2.HorizontalPodAutoscaler) []string {
	descriptions := make([]string, 0, len(hpa.Spec.Metrics))
	for _, m := range hpa.Spec.Metrics {
		switch m.Type {
		case autoscalingv2.ResourceMetricSourceType:
			if m.Resource != nil {
				desc := string(m.Resource.Name)
				if m.Resource.Target.AverageUtilization != nil {
					desc += fmt.Sprintf(" (target: %d%%)", *m.Resource.Target.AverageUtilization)
				} else if m.Resource.Target.AverageValue != nil {
					desc += fmt.Sprintf(" (target avg: %s)", m.Resource.Target.AverageValue.String())
				}
				descriptions = append(descriptions, desc)
			}
		case autoscalingv2.PodsMetricSourceType:
			if m.Pods != nil {
				descriptions = append(descriptions, fmt.Sprintf("pods/%s", m.Pods.Metric.Name))
			}
		case autoscalingv2.ObjectMetricSourceType:
			if m.Object != nil {
				descriptions = append(descriptions, fmt.Sprintf("object/%s", m.Object.Metric.Name))
			}
		case autoscalingv2.ExternalMetricSourceType:
			if m.External != nil {
				descriptions = append(descriptions, fmt.Sprintf("external/%s", m.External.Metric.Name))
			}
		default:
			descriptions = append(descriptions, string(m.Type))
		}
	}
	return descriptions
}

func toHPASummary(hpa *autoscalingv2.HorizontalPodAutoscaler) HPASummary {
	var minReplicas int32
	if hpa.Spec.MinReplicas != nil {
		minReplicas = *hpa.Spec.MinReplicas
	}
	return HPASummary{
		Name:            hpa.Name,
		Namespace:       hpa.Namespace,
		TargetKind:      hpa.Spec.ScaleTargetRef.Kind,
		TargetName:      hpa.Spec.ScaleTargetRef.Name,
		MinReplicas:     minReplicas,
		MaxReplicas:     hpa.Spec.MaxReplicas,
		CurrentReplicas: hpa.Status.CurrentReplicas,
		DesiredReplicas: hpa.Status.DesiredReplicas,
		Metrics:         hpaMetricDescriptions(hpa),
		CreatedAt:       hpa.CreationTimestamp.Time,
	}
}

// ListHPAs returns horizontal pod autoscalers in a namespace. Pass "" for all namespaces.
func (c *Client) ListHPAs(ctx context.Context, namespace string) ([]HPASummary, error) {
	list, err := c.Clientset.AutoscalingV2().HorizontalPodAutoscalers(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("listing HPAs: %w", err)
	}
	out := make([]HPASummary, len(list.Items))
	for i := range list.Items {
		out[i] = toHPASummary(&list.Items[i])
	}
	return out, nil
}

// DeleteHPA deletes a horizontal pod autoscaler.
func (c *Client) DeleteHPA(ctx context.Context, namespace, name string) error {
	err := c.Clientset.AutoscalingV2().HorizontalPodAutoscalers(namespace).Delete(ctx, name, metav1.DeleteOptions{})
	if err != nil {
		return fmt.Errorf("deleting HPA %s/%s: %w", namespace, name, err)
	}
	return nil
}
