package k8s

import (
	"context"
	"fmt"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// SecretSummary is the API-friendly secret representation.
// It exposes only key names, never secret values.
type SecretSummary struct {
	Name      string            `json:"name"`
	Namespace string            `json:"namespace"`
	Type      string            `json:"type"`
	DataKeys  []string          `json:"data_keys"`
	Labels    map[string]string `json:"labels"`
	CreatedAt time.Time         `json:"created_at"`
}

func toSecretSummary(s *corev1.Secret) SecretSummary {
	keys := make([]string, 0, len(s.Data))
	for k := range s.Data {
		keys = append(keys, k)
	}
	return SecretSummary{
		Name:      s.Name,
		Namespace: s.Namespace,
		Type:      string(s.Type),
		DataKeys:  keys,
		Labels:    s.Labels,
		CreatedAt: s.CreationTimestamp.Time,
	}
}

// ListSecrets returns secrets in a namespace. Pass "" for all namespaces.
func (c *Client) ListSecrets(ctx context.Context, namespace string) ([]SecretSummary, error) {
	list, err := c.Clientset.CoreV1().Secrets(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("listing secrets: %w", err)
	}
	out := make([]SecretSummary, len(list.Items))
	for i := range list.Items {
		out[i] = toSecretSummary(&list.Items[i])
	}
	return out, nil
}

// GetSecret returns a secret summary with key names only, not values.
func (c *Client) GetSecret(ctx context.Context, namespace, name string) (*SecretSummary, error) {
	s, err := c.Clientset.CoreV1().Secrets(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, fmt.Errorf("getting secret %s/%s: %w", namespace, name, err)
	}
	summary := toSecretSummary(s)
	return &summary, nil
}

// CreateSecret creates a secret.
func (c *Client) CreateSecret(ctx context.Context, namespace, name, secretType string, data map[string][]byte) error {
	secret := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Name:      name,
			Namespace: namespace,
		},
		Type: corev1.SecretType(secretType),
		Data: data,
	}
	_, err := c.Clientset.CoreV1().Secrets(namespace).Create(ctx, secret, metav1.CreateOptions{})
	if err != nil {
		return fmt.Errorf("creating secret %s/%s: %w", namespace, name, err)
	}
	return nil
}

// UpdateSecret replaces the data of an existing secret.
func (c *Client) UpdateSecret(ctx context.Context, namespace, name string, data map[string][]byte) error {
	s, err := c.Clientset.CoreV1().Secrets(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return fmt.Errorf("getting secret %s/%s for update: %w", namespace, name, err)
	}
	s.Data = data
	_, err = c.Clientset.CoreV1().Secrets(namespace).Update(ctx, s, metav1.UpdateOptions{})
	if err != nil {
		return fmt.Errorf("updating secret %s/%s: %w", namespace, name, err)
	}
	return nil
}

// DeleteSecret deletes a secret.
func (c *Client) DeleteSecret(ctx context.Context, namespace, name string) error {
	err := c.Clientset.CoreV1().Secrets(namespace).Delete(ctx, name, metav1.DeleteOptions{})
	if err != nil {
		return fmt.Errorf("deleting secret %s/%s: %w", namespace, name, err)
	}
	return nil
}
