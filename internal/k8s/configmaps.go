package k8s

import (
	"context"
	"fmt"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// ConfigMapSummary is the API-friendly configmap representation.
type ConfigMapSummary struct {
	Name      string            `json:"name"`
	Namespace string            `json:"namespace"`
	DataCount int               `json:"data_count"`
	Labels    map[string]string `json:"labels"`
	CreatedAt time.Time         `json:"created_at"`
}

// ConfigMapDetail extends ConfigMapSummary with actual data.
type ConfigMapDetail struct {
	ConfigMapSummary
	Data map[string]string `json:"data"`
}

func toConfigMapSummary(cm *corev1.ConfigMap) ConfigMapSummary {
	return ConfigMapSummary{
		Name:      cm.Name,
		Namespace: cm.Namespace,
		DataCount: len(cm.Data) + len(cm.BinaryData),
		Labels:    cm.Labels,
		CreatedAt: cm.CreationTimestamp.Time,
	}
}

// ListConfigMaps returns configmaps in a namespace. Pass "" for all namespaces.
func (c *Client) ListConfigMaps(ctx context.Context, namespace string) ([]ConfigMapSummary, error) {
	list, err := c.Clientset.CoreV1().ConfigMaps(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("listing configmaps: %w", err)
	}
	out := make([]ConfigMapSummary, len(list.Items))
	for i := range list.Items {
		out[i] = toConfigMapSummary(&list.Items[i])
	}
	return out, nil
}

// GetConfigMap returns a configmap with its data.
func (c *Client) GetConfigMap(ctx context.Context, namespace, name string) (*ConfigMapDetail, error) {
	cm, err := c.Clientset.CoreV1().ConfigMaps(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, fmt.Errorf("getting configmap %s/%s: %w", namespace, name, err)
	}
	return &ConfigMapDetail{
		ConfigMapSummary: toConfigMapSummary(cm),
		Data:             cm.Data,
	}, nil
}

// CreateConfigMap creates a configmap.
func (c *Client) CreateConfigMap(ctx context.Context, namespace, name string, data map[string]string) error {
	cm := &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{
			Name:      name,
			Namespace: namespace,
		},
		Data: data,
	}
	_, err := c.Clientset.CoreV1().ConfigMaps(namespace).Create(ctx, cm, metav1.CreateOptions{})
	if err != nil {
		return fmt.Errorf("creating configmap %s/%s: %w", namespace, name, err)
	}
	return nil
}

// UpdateConfigMap updates the data of an existing configmap.
func (c *Client) UpdateConfigMap(ctx context.Context, namespace, name string, data map[string]string) error {
	cm, err := c.Clientset.CoreV1().ConfigMaps(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return fmt.Errorf("getting configmap %s/%s for update: %w", namespace, name, err)
	}
	cm.Data = data
	_, err = c.Clientset.CoreV1().ConfigMaps(namespace).Update(ctx, cm, metav1.UpdateOptions{})
	if err != nil {
		return fmt.Errorf("updating configmap %s/%s: %w", namespace, name, err)
	}
	return nil
}

// DeleteConfigMap deletes a configmap.
func (c *Client) DeleteConfigMap(ctx context.Context, namespace, name string) error {
	err := c.Clientset.CoreV1().ConfigMaps(namespace).Delete(ctx, name, metav1.DeleteOptions{})
	if err != nil {
		return fmt.Errorf("deleting configmap %s/%s: %w", namespace, name, err)
	}
	return nil
}
