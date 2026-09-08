package k8s

import (
	"context"
	"fmt"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

type WebhookSummary struct {
	Name          string    `json:"name"`
	Kind          string    `json:"kind"`
	Webhooks      int       `json:"webhooks"`
	FailurePolicy string   `json:"failure_policy"`
	SideEffects   string    `json:"side_effects"`
	CreatedAt     time.Time `json:"created_at"`
}

func (c *Client) ListValidatingWebhooks(ctx context.Context) ([]WebhookSummary, error) {
	list, err := c.Clientset.AdmissionregistrationV1().ValidatingWebhookConfigurations().List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("listing validating webhooks: %w", err)
	}
	out := make([]WebhookSummary, len(list.Items))
	for i := range list.Items {
		vw := &list.Items[i]
		fp := ""
		se := ""
		if len(vw.Webhooks) > 0 {
			if vw.Webhooks[0].FailurePolicy != nil {
				fp = string(*vw.Webhooks[0].FailurePolicy)
			}
			if vw.Webhooks[0].SideEffects != nil {
				se = string(*vw.Webhooks[0].SideEffects)
			}
		}
		out[i] = WebhookSummary{
			Name:          vw.Name,
			Kind:          "ValidatingWebhookConfiguration",
			Webhooks:      len(vw.Webhooks),
			FailurePolicy: fp,
			SideEffects:   se,
			CreatedAt:     vw.CreationTimestamp.Time,
		}
	}
	return out, nil
}

func (c *Client) ListMutatingWebhooks(ctx context.Context) ([]WebhookSummary, error) {
	list, err := c.Clientset.AdmissionregistrationV1().MutatingWebhookConfigurations().List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("listing mutating webhooks: %w", err)
	}
	out := make([]WebhookSummary, len(list.Items))
	for i := range list.Items {
		mw := &list.Items[i]
		fp := ""
		se := ""
		if len(mw.Webhooks) > 0 {
			if mw.Webhooks[0].FailurePolicy != nil {
				fp = string(*mw.Webhooks[0].FailurePolicy)
			}
			if mw.Webhooks[0].SideEffects != nil {
				se = string(*mw.Webhooks[0].SideEffects)
			}
		}
		out[i] = WebhookSummary{
			Name:          mw.Name,
			Kind:          "MutatingWebhookConfiguration",
			Webhooks:      len(mw.Webhooks),
			FailurePolicy: fp,
			SideEffects:   se,
			CreatedAt:     mw.CreationTimestamp.Time,
		}
	}
	return out, nil
}

func (c *Client) DeleteValidatingWebhook(ctx context.Context, name string) error {
	if err := c.Clientset.AdmissionregistrationV1().ValidatingWebhookConfigurations().Delete(ctx, name, metav1.DeleteOptions{}); err != nil {
		return fmt.Errorf("deleting validating webhook %s: %w", name, err)
	}
	return nil
}

func (c *Client) DeleteMutatingWebhook(ctx context.Context, name string) error {
	if err := c.Clientset.AdmissionregistrationV1().MutatingWebhookConfigurations().Delete(ctx, name, metav1.DeleteOptions{}); err != nil {
		return fmt.Errorf("deleting mutating webhook %s: %w", name, err)
	}
	return nil
}
