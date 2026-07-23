package k8s

import (
	"context"
	"fmt"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

type ServiceAccountSummary struct {
	Name                         string            `json:"name"`
	Namespace                    string            `json:"namespace"`
	Secrets                      int               `json:"secrets"`
	ImagePullSecrets             []string          `json:"image_pull_secrets"`
	AutomountServiceAccountToken *bool             `json:"automount_token"`
	Labels                       map[string]string `json:"labels"`
	CreatedAt                    time.Time         `json:"created_at"`
}

func (c *Client) ListServiceAccounts(ctx context.Context, namespace string) ([]ServiceAccountSummary, error) {
	list, err := c.Clientset.CoreV1().ServiceAccounts(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("listing service accounts: %w", err)
	}
	out := make([]ServiceAccountSummary, len(list.Items))
	for i := range list.Items {
		sa := &list.Items[i]
		ips := make([]string, len(sa.ImagePullSecrets))
		for j, s := range sa.ImagePullSecrets {
			ips[j] = s.Name
		}
		out[i] = ServiceAccountSummary{
			Name:                         sa.Name,
			Namespace:                    sa.Namespace,
			Secrets:                      len(sa.Secrets),
			ImagePullSecrets:             ips,
			AutomountServiceAccountToken: sa.AutomountServiceAccountToken,
			Labels:                       sa.Labels,
			CreatedAt:                    sa.CreationTimestamp.Time,
		}
	}
	return out, nil
}

func (c *Client) DeleteServiceAccount(ctx context.Context, namespace, name string) error {
	if err := c.Clientset.CoreV1().ServiceAccounts(namespace).Delete(ctx, name, metav1.DeleteOptions{}); err != nil {
		return fmt.Errorf("deleting service account %s/%s: %w", namespace, name, err)
	}
	return nil
}
