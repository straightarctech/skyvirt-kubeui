package k8s

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	networkingv1 "k8s.io/api/networking/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// NetworkPolicySummary is the API-friendly network policy representation.
type NetworkPolicySummary struct {
	Name              string            `json:"name"`
	Namespace         string            `json:"namespace"`
	PodSelector       map[string]string `json:"pod_selector"`
	IngressRulesCount int               `json:"ingress_rules_count"`
	EgressRulesCount  int               `json:"egress_rules_count"`
	PolicyTypes       []string          `json:"policy_types"`
	CreatedAt         time.Time         `json:"created_at"`
}

func toNetworkPolicySummary(np *networkingv1.NetworkPolicy) NetworkPolicySummary {
	policyTypes := make([]string, len(np.Spec.PolicyTypes))
	for i, pt := range np.Spec.PolicyTypes {
		policyTypes[i] = string(pt)
	}
	return NetworkPolicySummary{
		Name:              np.Name,
		Namespace:         np.Namespace,
		PodSelector:       np.Spec.PodSelector.MatchLabels,
		IngressRulesCount: len(np.Spec.Ingress),
		EgressRulesCount:  len(np.Spec.Egress),
		PolicyTypes:       policyTypes,
		CreatedAt:         np.CreationTimestamp.Time,
	}
}

// ListNetworkPolicies returns network policies in a namespace. Pass "" for all namespaces.
func (c *Client) ListNetworkPolicies(ctx context.Context, namespace string) ([]NetworkPolicySummary, error) {
	list, err := c.Clientset.NetworkingV1().NetworkPolicies(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("listing network policies: %w", err)
	}
	out := make([]NetworkPolicySummary, len(list.Items))
	for i := range list.Items {
		out[i] = toNetworkPolicySummary(&list.Items[i])
	}
	return out, nil
}

// GetNetworkPolicy returns a network policy as raw JSON for detailed inspection.
func (c *Client) GetNetworkPolicy(ctx context.Context, namespace, name string) (json.RawMessage, error) {
	np, err := c.Clientset.NetworkingV1().NetworkPolicies(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, fmt.Errorf("getting network policy %s/%s: %w", namespace, name, err)
	}
	data, err := json.Marshal(np)
	if err != nil {
		return nil, fmt.Errorf("marshalling network policy %s/%s: %w", namespace, name, err)
	}
	return data, nil
}

// DeleteNetworkPolicy deletes a network policy.
func (c *Client) DeleteNetworkPolicy(ctx context.Context, namespace, name string) error {
	err := c.Clientset.NetworkingV1().NetworkPolicies(namespace).Delete(ctx, name, metav1.DeleteOptions{})
	if err != nil {
		return fmt.Errorf("deleting network policy %s/%s: %w", namespace, name, err)
	}
	return nil
}
