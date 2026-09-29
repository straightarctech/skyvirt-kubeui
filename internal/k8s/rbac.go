package k8s

import (
	"context"
	"fmt"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// SubjectInfo describes a subject in a role binding.
type SubjectInfo struct {
	Kind      string `json:"kind"`
	Name      string `json:"name"`
	Namespace string `json:"namespace"`
}

// RoleSummary is the API-friendly role/clusterrole representation.
type RoleSummary struct {
	Name          string            `json:"name"`
	Namespace     string            `json:"namespace"`
	RulesCount    int               `json:"rules_count"`
	Labels        map[string]string `json:"labels"`
	CreatedAt     time.Time         `json:"created_at"`
	IsClusterRole bool              `json:"is_cluster_role"`
}

// RoleBindingSummary is the API-friendly rolebinding/clusterrolebinding representation.
type RoleBindingSummary struct {
	Name             string            `json:"name"`
	Namespace        string            `json:"namespace"`
	RoleRefKind      string            `json:"role_ref_kind"`
	RoleRefName      string            `json:"role_ref_name"`
	Subjects         []SubjectInfo     `json:"subjects"`
	Labels           map[string]string `json:"labels"`
	CreatedAt        time.Time         `json:"created_at"`
	IsClusterBinding bool              `json:"is_cluster_binding"`
}

// ListClusterRoles returns all cluster roles.
func (c *Client) ListClusterRoles(ctx context.Context) ([]RoleSummary, error) {
	list, err := c.Clientset.RbacV1().ClusterRoles().List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("listing cluster roles: %w", err)
	}
	out := make([]RoleSummary, len(list.Items))
	for i, cr := range list.Items {
		out[i] = RoleSummary{
			Name:          cr.Name,
			RulesCount:    len(cr.Rules),
			Labels:        cr.Labels,
			CreatedAt:     cr.CreationTimestamp.Time,
			IsClusterRole: true,
		}
	}
	return out, nil
}

// ListRoles returns roles in a namespace. Pass "" for all namespaces.
func (c *Client) ListRoles(ctx context.Context, namespace string) ([]RoleSummary, error) {
	list, err := c.Clientset.RbacV1().Roles(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("listing roles: %w", err)
	}
	out := make([]RoleSummary, len(list.Items))
	for i, r := range list.Items {
		out[i] = RoleSummary{
			Name:          r.Name,
			Namespace:     r.Namespace,
			RulesCount:    len(r.Rules),
			Labels:        r.Labels,
			CreatedAt:     r.CreationTimestamp.Time,
			IsClusterRole: false,
		}
	}
	return out, nil
}

// ListClusterRoleBindings returns all cluster role bindings.
func (c *Client) ListClusterRoleBindings(ctx context.Context) ([]RoleBindingSummary, error) {
	list, err := c.Clientset.RbacV1().ClusterRoleBindings().List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("listing cluster role bindings: %w", err)
	}
	out := make([]RoleBindingSummary, len(list.Items))
	for i, crb := range list.Items {
		subjects := make([]SubjectInfo, len(crb.Subjects))
		for j, s := range crb.Subjects {
			subjects[j] = SubjectInfo{
				Kind:      s.Kind,
				Name:      s.Name,
				Namespace: s.Namespace,
			}
		}
		out[i] = RoleBindingSummary{
			Name:             crb.Name,
			RoleRefKind:      crb.RoleRef.Kind,
			RoleRefName:      crb.RoleRef.Name,
			Subjects:         subjects,
			Labels:           crb.Labels,
			CreatedAt:        crb.CreationTimestamp.Time,
			IsClusterBinding: true,
		}
	}
	return out, nil
}

// ListRoleBindings returns role bindings in a namespace. Pass "" for all namespaces.
func (c *Client) ListRoleBindings(ctx context.Context, namespace string) ([]RoleBindingSummary, error) {
	list, err := c.Clientset.RbacV1().RoleBindings(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("listing role bindings: %w", err)
	}
	out := make([]RoleBindingSummary, len(list.Items))
	for i, rb := range list.Items {
		subjects := make([]SubjectInfo, len(rb.Subjects))
		for j, s := range rb.Subjects {
			subjects[j] = SubjectInfo{
				Kind:      s.Kind,
				Name:      s.Name,
				Namespace: s.Namespace,
			}
		}
		out[i] = RoleBindingSummary{
			Name:             rb.Name,
			Namespace:        rb.Namespace,
			RoleRefKind:      rb.RoleRef.Kind,
			RoleRefName:      rb.RoleRef.Name,
			Subjects:         subjects,
			Labels:           rb.Labels,
			CreatedAt:        rb.CreationTimestamp.Time,
			IsClusterBinding: false,
		}
	}
	return out, nil
}
