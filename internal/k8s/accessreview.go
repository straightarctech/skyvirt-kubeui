package k8s

import (
	"context"
	"fmt"

	authorizationv1 "k8s.io/api/authorization/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// AccessReviewResult is the outcome of a "can this subject do this?" check.
type AccessReviewResult struct {
	Allowed bool   `json:"allowed"`
	Denied  bool   `json:"denied"`
	Reason  string `json:"reason"`
}

// AccessReview answers "can <subject> <verb> <resource>?" via the cluster's own
// SubjectAccessReview API — the authoritative RBAC decision, reason included.
// subjectKind is "User", "Group", or "ServiceAccount".
func (c *Client) AccessReview(ctx context.Context, subjectKind, subjectName, subjectNamespace, verb, group, resource, name, namespace string) (*AccessReviewResult, error) {
	spec := authorizationv1.SubjectAccessReviewSpec{
		ResourceAttributes: &authorizationv1.ResourceAttributes{
			Namespace: namespace,
			Verb:      verb,
			Group:     group,
			Resource:  resource,
			Name:      name,
		},
	}
	switch subjectKind {
	case "ServiceAccount":
		spec.User = fmt.Sprintf("system:serviceaccount:%s:%s", subjectNamespace, subjectName)
	case "Group":
		spec.Groups = []string{subjectName}
	default: // User
		spec.User = subjectName
	}
	res, err := c.Clientset.AuthorizationV1().SubjectAccessReviews().Create(ctx, &authorizationv1.SubjectAccessReview{Spec: spec}, metav1.CreateOptions{})
	if err != nil {
		return nil, err
	}
	return &AccessReviewResult{Allowed: res.Status.Allowed, Denied: res.Status.Denied, Reason: res.Status.Reason}, nil
}

// RiskyBinding flags an over-broad ClusterRoleBinding.
type RiskyBinding struct {
	Name     string   `json:"name"`
	Role     string   `json:"role"`
	Subjects []string `json:"subjects"`
	Reasons  []string `json:"reasons"`
}

// RiskyClusterRoleBindings audits ClusterRoleBindings for over-broad grants:
// cluster-admin, and bindings to the everyone-groups.
func (c *Client) RiskyClusterRoleBindings(ctx context.Context) ([]RiskyBinding, error) {
	crbs, err := c.Clientset.RbacV1().ClusterRoleBindings().List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	out := make([]RiskyBinding, 0)
	for i := range crbs.Items {
		crb := &crbs.Items[i]
		var reasons, subs []string
		if crb.RoleRef.Name == "cluster-admin" {
			reasons = append(reasons, "grants cluster-admin")
		}
		for _, s := range crb.Subjects {
			label := s.Kind + ":" + s.Name
			if s.Namespace != "" {
				label = s.Kind + ":" + s.Namespace + "/" + s.Name
			}
			subs = append(subs, label)
			if s.Kind == "Group" && (s.Name == "system:authenticated" || s.Name == "system:unauthenticated") {
				reasons = append(reasons, "bound to everyone-group "+s.Name)
			}
		}
		if len(reasons) > 0 {
			out = append(out, RiskyBinding{Name: crb.Name, Role: crb.RoleRef.Name, Subjects: subs, Reasons: reasons})
		}
	}
	return out, nil
}
