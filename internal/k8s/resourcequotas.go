package k8s

import (
	"context"
	"fmt"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

type ResourceQuotaSummary struct {
	Name      string            `json:"name"`
	Namespace string            `json:"namespace"`
	Hard      map[string]string `json:"hard"`
	Used      map[string]string `json:"used"`
	Labels    map[string]string `json:"labels"`
	CreatedAt time.Time         `json:"created_at"`
}

func (c *Client) ListResourceQuotas(ctx context.Context, namespace string) ([]ResourceQuotaSummary, error) {
	list, err := c.Clientset.CoreV1().ResourceQuotas(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("listing resource quotas: %w", err)
	}
	out := make([]ResourceQuotaSummary, len(list.Items))
	for i := range list.Items {
		rq := &list.Items[i]
		hard := make(map[string]string, len(rq.Status.Hard))
		for k, v := range rq.Status.Hard {
			hard[string(k)] = v.String()
		}
		used := make(map[string]string, len(rq.Status.Used))
		for k, v := range rq.Status.Used {
			used[string(k)] = v.String()
		}
		out[i] = ResourceQuotaSummary{
			Name:      rq.Name,
			Namespace: rq.Namespace,
			Hard:      hard,
			Used:      used,
			Labels:    rq.Labels,
			CreatedAt: rq.CreationTimestamp.Time,
		}
	}
	return out, nil
}

func (c *Client) DeleteResourceQuota(ctx context.Context, namespace, name string) error {
	if err := c.Clientset.CoreV1().ResourceQuotas(namespace).Delete(ctx, name, metav1.DeleteOptions{}); err != nil {
		return fmt.Errorf("deleting resource quota %s/%s: %w", namespace, name, err)
	}
	return nil
}
