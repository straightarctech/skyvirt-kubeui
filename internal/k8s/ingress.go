package k8s

import (
	"context"
	"fmt"
	"time"

	networkingv1 "k8s.io/api/networking/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// IngressPath describes a single path rule within an ingress rule.
type IngressPath struct {
	Path        string `json:"path"`
	PathType    string `json:"path_type"`
	ServiceName string `json:"service_name"`
	ServicePort string `json:"service_port"`
}

// IngressRule describes a host-based routing rule.
type IngressRule struct {
	Host  string        `json:"host"`
	Paths []IngressPath `json:"paths"`
}

// IngressTLS describes TLS configuration for an ingress.
type IngressTLS struct {
	Hosts      []string `json:"hosts"`
	SecretName string   `json:"secret_name"`
}

// IngressSummary is the API-friendly ingress representation.
type IngressSummary struct {
	Name      string            `json:"name"`
	Namespace string            `json:"namespace"`
	Class     string            `json:"class"`
	Rules     []IngressRule     `json:"rules"`
	TLS       []IngressTLS      `json:"tls"`
	Labels    map[string]string `json:"labels"`
	CreatedAt time.Time         `json:"created_at"`
}

func toIngressSummary(ing *networkingv1.Ingress) IngressSummary {
	var class string
	if ing.Spec.IngressClassName != nil {
		class = *ing.Spec.IngressClassName
	}

	rules := make([]IngressRule, 0, len(ing.Spec.Rules))
	for _, r := range ing.Spec.Rules {
		rule := IngressRule{Host: r.Host}
		if r.HTTP != nil {
			paths := make([]IngressPath, 0, len(r.HTTP.Paths))
			for _, p := range r.HTTP.Paths {
				ip := IngressPath{
					Path: p.Path,
				}
				if p.PathType != nil {
					ip.PathType = string(*p.PathType)
				}
				if p.Backend.Service != nil {
					ip.ServiceName = p.Backend.Service.Name
					if p.Backend.Service.Port.Name != "" {
						ip.ServicePort = p.Backend.Service.Port.Name
					} else {
						ip.ServicePort = fmt.Sprintf("%d", p.Backend.Service.Port.Number)
					}
				}
				paths = append(paths, ip)
			}
			rule.Paths = paths
		}
		rules = append(rules, rule)
	}

	tls := make([]IngressTLS, 0, len(ing.Spec.TLS))
	for _, t := range ing.Spec.TLS {
		tls = append(tls, IngressTLS{
			Hosts:      t.Hosts,
			SecretName: t.SecretName,
		})
	}

	return IngressSummary{
		Name:      ing.Name,
		Namespace: ing.Namespace,
		Class:     class,
		Rules:     rules,
		TLS:       tls,
		Labels:    ing.Labels,
		CreatedAt: ing.CreationTimestamp.Time,
	}
}

// ListIngresses returns ingresses in a namespace. Pass "" for all namespaces.
func (c *Client) ListIngresses(ctx context.Context, namespace string) ([]IngressSummary, error) {
	list, err := c.Clientset.NetworkingV1().Ingresses(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("listing ingresses: %w", err)
	}
	out := make([]IngressSummary, len(list.Items))
	for i := range list.Items {
		out[i] = toIngressSummary(&list.Items[i])
	}
	return out, nil
}

// GetIngress returns a single ingress.
func (c *Client) GetIngress(ctx context.Context, namespace, name string) (*IngressSummary, error) {
	ing, err := c.Clientset.NetworkingV1().Ingresses(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, fmt.Errorf("getting ingress %s/%s: %w", namespace, name, err)
	}
	s := toIngressSummary(ing)
	return &s, nil
}

// DeleteIngress deletes an ingress.
func (c *Client) DeleteIngress(ctx context.Context, namespace, name string) error {
	err := c.Clientset.NetworkingV1().Ingresses(namespace).Delete(ctx, name, metav1.DeleteOptions{})
	if err != nil {
		return fmt.Errorf("deleting ingress %s/%s: %w", namespace, name, err)
	}
	return nil
}
