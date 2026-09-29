package k8s

import (
	"context"
	"fmt"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// NamespaceSummary is the API-friendly namespace representation.
type NamespaceSummary struct {
	Name        string            `json:"name"`
	Status      string            `json:"status"`
	Labels      map[string]string `json:"labels"`
	Annotations map[string]string `json:"annotations"`
	CreatedAt   time.Time         `json:"created_at"`
}

// NamespaceResources holds resource counts within a namespace.
type NamespaceResources struct {
	PodCount        int `json:"pod_count"`
	DeploymentCount int `json:"deployment_count"`
	ServiceCount    int `json:"service_count"`
	ConfigMapCount  int `json:"configmap_count"`
	SecretCount     int `json:"secret_count"`
}

func toNamespaceSummary(ns *corev1.Namespace) NamespaceSummary {
	return NamespaceSummary{
		Name:        ns.Name,
		Status:      string(ns.Status.Phase),
		Labels:      ns.Labels,
		Annotations: ns.Annotations,
		CreatedAt:   ns.CreationTimestamp.Time,
	}
}

// ListNamespaces returns all namespaces in the cluster.
func (c *Client) ListNamespaces(ctx context.Context) ([]NamespaceSummary, error) {
	list, err := c.Clientset.CoreV1().Namespaces().List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("listing namespaces: %w", err)
	}
	out := make([]NamespaceSummary, len(list.Items))
	for i := range list.Items {
		out[i] = toNamespaceSummary(&list.Items[i])
	}
	return out, nil
}

// CreateNamespace creates a namespace with optional labels.
func (c *Client) CreateNamespace(ctx context.Context, name string, labels map[string]string) error {
	ns := &corev1.Namespace{
		ObjectMeta: metav1.ObjectMeta{
			Name:   name,
			Labels: labels,
		},
	}
	_, err := c.Clientset.CoreV1().Namespaces().Create(ctx, ns, metav1.CreateOptions{})
	if err != nil {
		return fmt.Errorf("creating namespace %s: %w", name, err)
	}
	return nil
}

// DeleteNamespace deletes a namespace.
func (c *Client) DeleteNamespace(ctx context.Context, name string) error {
	err := c.Clientset.CoreV1().Namespaces().Delete(ctx, name, metav1.DeleteOptions{})
	if err != nil {
		return fmt.Errorf("deleting namespace %s: %w", name, err)
	}
	return nil
}

// GetNamespaceResources returns resource counts for a namespace.
func (c *Client) GetNamespaceResources(ctx context.Context, name string) (*NamespaceResources, error) {
	res := &NamespaceResources{}

	pods, err := c.Clientset.CoreV1().Pods(name).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("counting pods in namespace %s: %w", name, err)
	}
	res.PodCount = len(pods.Items)

	deployments, err := c.Clientset.AppsV1().Deployments(name).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("counting deployments in namespace %s: %w", name, err)
	}
	res.DeploymentCount = len(deployments.Items)

	services, err := c.Clientset.CoreV1().Services(name).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("counting services in namespace %s: %w", name, err)
	}
	res.ServiceCount = len(services.Items)

	configmaps, err := c.Clientset.CoreV1().ConfigMaps(name).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("counting configmaps in namespace %s: %w", name, err)
	}
	res.ConfigMapCount = len(configmaps.Items)

	secrets, err := c.Clientset.CoreV1().Secrets(name).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("counting secrets in namespace %s: %w", name, err)
	}
	res.SecretCount = len(secrets.Items)

	return res, nil
}
