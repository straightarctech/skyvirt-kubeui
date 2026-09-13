package k8s

import (
	"context"
	"fmt"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

type LimitRangeItem struct {
	Type           string            `json:"type"`
	Max            map[string]string `json:"max"`
	Min            map[string]string `json:"min"`
	Default        map[string]string `json:"default"`
	DefaultRequest map[string]string `json:"default_request"`
}

type LimitRangeSummary struct {
	Name      string            `json:"name"`
	Namespace string            `json:"namespace"`
	Limits    []LimitRangeItem  `json:"limits"`
	Labels    map[string]string `json:"labels"`
	CreatedAt time.Time         `json:"created_at"`
}

func (c *Client) ListLimitRanges(ctx context.Context, namespace string) ([]LimitRangeSummary, error) {
	list, err := c.Clientset.CoreV1().LimitRanges(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("listing limit ranges: %w", err)
	}
	out := make([]LimitRangeSummary, len(list.Items))
	for i := range list.Items {
		lr := &list.Items[i]
		limits := make([]LimitRangeItem, len(lr.Spec.Limits))
		for j, l := range lr.Spec.Limits {
			item := LimitRangeItem{Type: string(l.Type)}
			if l.Max != nil {
				item.Max = make(map[string]string, len(l.Max))
				for k, v := range l.Max {
					item.Max[string(k)] = v.String()
				}
			}
			if l.Min != nil {
				item.Min = make(map[string]string, len(l.Min))
				for k, v := range l.Min {
					item.Min[string(k)] = v.String()
				}
			}
			if l.Default != nil {
				item.Default = make(map[string]string, len(l.Default))
				for k, v := range l.Default {
					item.Default[string(k)] = v.String()
				}
			}
			if l.DefaultRequest != nil {
				item.DefaultRequest = make(map[string]string, len(l.DefaultRequest))
				for k, v := range l.DefaultRequest {
					item.DefaultRequest[string(k)] = v.String()
				}
			}
			limits[j] = item
		}
		out[i] = LimitRangeSummary{
			Name:      lr.Name,
			Namespace: lr.Namespace,
			Limits:    limits,
			Labels:    lr.Labels,
			CreatedAt: lr.CreationTimestamp.Time,
		}
	}
	return out, nil
}
