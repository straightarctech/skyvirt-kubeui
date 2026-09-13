package k8s

import (
	"context"
	"fmt"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

type PriorityClassSummary struct {
	Name             string    `json:"name"`
	Value            int32     `json:"value"`
	GlobalDefault    bool      `json:"global_default"`
	PreemptionPolicy string   `json:"preemption_policy"`
	Description      string    `json:"description"`
	CreatedAt        time.Time `json:"created_at"`
}

func (c *Client) ListPriorityClasses(ctx context.Context) ([]PriorityClassSummary, error) {
	list, err := c.Clientset.SchedulingV1().PriorityClasses().List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("listing priority classes: %w", err)
	}
	out := make([]PriorityClassSummary, len(list.Items))
	for i := range list.Items {
		pc := &list.Items[i]
		pp := "PreemptLowerPriority"
		if pc.PreemptionPolicy != nil {
			pp = string(*pc.PreemptionPolicy)
		}
		out[i] = PriorityClassSummary{
			Name:             pc.Name,
			Value:            pc.Value,
			GlobalDefault:    pc.GlobalDefault,
			PreemptionPolicy: pp,
			Description:      pc.Description,
			CreatedAt:        pc.CreationTimestamp.Time,
		}
	}
	return out, nil
}

func (c *Client) DeletePriorityClass(ctx context.Context, name string) error {
	if err := c.Clientset.SchedulingV1().PriorityClasses().Delete(ctx, name, metav1.DeleteOptions{}); err != nil {
		return fmt.Errorf("deleting priority class %s: %w", name, err)
	}
	return nil
}
