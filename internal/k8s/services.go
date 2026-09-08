package k8s

import (
	"context"
	"fmt"
	"strings"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
)

// ServiceSummaryFromUnstructured maps a watch event's object to the same
// summary ListServices returns, for typed deltas (patch-in-place).
func ServiceSummaryFromUnstructured(u *unstructured.Unstructured) (any, error) {
	var svc corev1.Service
	if err := runtime.DefaultUnstructuredConverter.FromUnstructured(u.Object, &svc); err != nil {
		return nil, err
	}
	return toServiceSummary(&svc), nil
}

// ServicePort describes a single port on a Kubernetes service.
type ServicePort struct {
	Name       string `json:"name"`
	Port       int32  `json:"port"`
	TargetPort string `json:"target_port"`
	NodePort   int32  `json:"node_port"`
	Protocol   string `json:"protocol"`
}

// ServiceSummary is the API-friendly service representation.
type ServiceSummary struct {
	Name       string            `json:"name"`
	Namespace  string            `json:"namespace"`
	Type       string            `json:"type"`
	ClusterIP  string            `json:"cluster_ip"`
	ExternalIP string            `json:"external_ip"`
	Ports      []ServicePort     `json:"ports"`
	Selector   map[string]string `json:"selector"`
	Labels     map[string]string `json:"labels"`
	CreatedAt  time.Time         `json:"created_at"`
}

func serviceExternalIP(svc *corev1.Service) string {
	if len(svc.Spec.ExternalIPs) > 0 {
		return strings.Join(svc.Spec.ExternalIPs, ",")
	}
	for _, ing := range svc.Status.LoadBalancer.Ingress {
		if ing.IP != "" {
			return ing.IP
		}
		if ing.Hostname != "" {
			return ing.Hostname
		}
	}
	return ""
}

func toServiceSummary(svc *corev1.Service) ServiceSummary {
	ports := make([]ServicePort, len(svc.Spec.Ports))
	for i, p := range svc.Spec.Ports {
		ports[i] = ServicePort{
			Name:       p.Name,
			Port:       p.Port,
			TargetPort: p.TargetPort.String(),
			NodePort:   p.NodePort,
			Protocol:   string(p.Protocol),
		}
	}
	return ServiceSummary{
		Name:       svc.Name,
		Namespace:  svc.Namespace,
		Type:       string(svc.Spec.Type),
		ClusterIP:  svc.Spec.ClusterIP,
		ExternalIP: serviceExternalIP(svc),
		Ports:      ports,
		Selector:   svc.Spec.Selector,
		Labels:     svc.Labels,
		CreatedAt:  svc.CreationTimestamp.Time,
	}
}

// ListServices returns services in a namespace. Pass "" for all namespaces.
func (c *Client) ListServices(ctx context.Context, namespace string) ([]ServiceSummary, error) {
	list, err := c.Clientset.CoreV1().Services(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("listing services: %w", err)
	}
	out := make([]ServiceSummary, len(list.Items))
	for i := range list.Items {
		out[i] = toServiceSummary(&list.Items[i])
	}
	return out, nil
}

// GetService returns a single service.
func (c *Client) GetService(ctx context.Context, namespace, name string) (*ServiceSummary, error) {
	svc, err := c.Clientset.CoreV1().Services(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, fmt.Errorf("getting service %s/%s: %w", namespace, name, err)
	}
	s := toServiceSummary(svc)
	return &s, nil
}

// CreateService creates a service from the given spec.
func (c *Client) CreateService(ctx context.Context, namespace string, svc *corev1.Service) (*ServiceSummary, error) {
	created, err := c.Clientset.CoreV1().Services(namespace).Create(ctx, svc, metav1.CreateOptions{})
	if err != nil {
		return nil, fmt.Errorf("creating service in %s: %w", namespace, err)
	}
	s := toServiceSummary(created)
	return &s, nil
}

// DeleteService deletes a service.
func (c *Client) DeleteService(ctx context.Context, namespace, name string) error {
	err := c.Clientset.CoreV1().Services(namespace).Delete(ctx, name, metav1.DeleteOptions{})
	if err != nil {
		return fmt.Errorf("deleting service %s/%s: %w", namespace, name, err)
	}
	return nil
}
