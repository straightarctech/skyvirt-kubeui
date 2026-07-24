package k8s

import (
	"context"
	"sort"

	rbacv1 "k8s.io/api/rbac/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// AdminPath is one way a subject reaches (or can grant itself) admin.
type AdminPath struct {
	Binding string `json:"binding"`
	Scope   string `json:"scope"` // "cluster" or "namespace/<ns>"
	Role    string `json:"role"`
	Via     string `json:"via"` // cluster-admin | wildcard | rbac-write | escalate | bind | impersonate
}

// AdminReachSubject is a subject that can reach cluster-admin, with every path.
type AdminReachSubject struct {
	Kind      string      `json:"kind"`
	Name      string      `json:"name"`
	Namespace string      `json:"namespace,omitempty"`
	Severity  string      `json:"severity"` // critical | high
	Paths     []AdminPath `json:"paths"`
}

// rbacResources / impersonateResources name the objects whose write (or verb)
// lets a subject grant itself more than it has.
var rbacRoleResources = map[string]bool{"roles": true, "clusterroles": true, "*": true}
var rbacBindingResources = map[string]bool{"rolebindings": true, "clusterrolebindings": true, "*": true}
var impersonateResources = map[string]bool{"users": true, "groups": true, "serviceaccounts": true, "*": true}
var writeVerbs = map[string]bool{"create": true, "update": true, "patch": true, "delete": true, "deletecollection": true, "*": true}

func hasStr(list []string, want string) bool {
	for _, s := range list {
		if s == want || s == "*" {
			return true
		}
	}
	return false
}

// ruleGrants reports whether a rule grants verb over (group, resource).
func ruleGrants(r rbacv1.PolicyRule, verb, group string, resources map[string]bool) bool {
	if !hasStr(r.Verbs, verb) {
		return false
	}
	if !hasStr(r.APIGroups, group) {
		return false
	}
	for _, res := range r.Resources {
		if resources[res] {
			return true
		}
	}
	return false
}

// classifyRules returns the set of admin-reach "via" reasons a rule set grants.
func classifyRules(rules []rbacv1.PolicyRule) map[string]bool {
	vias := map[string]bool{}
	for _, r := range rules {
		// Full wildcard = cluster-admin equivalent.
		if hasStr(r.Verbs, "*") && hasStr(r.APIGroups, "*") && hasStr(r.Resources, "*") {
			vias["wildcard"] = true
		}
		// Write on RBAC bindings → can bind any role to itself.
		for v := range writeVerbs {
			if ruleGrants(r, v, "rbac.authorization.k8s.io", rbacBindingResources) {
				vias["rbac-write"] = true
			}
		}
		// escalate / bind on roles → can craft/grant a role beyond current rights.
		if ruleGrants(r, "escalate", "rbac.authorization.k8s.io", rbacRoleResources) {
			vias["escalate"] = true
		}
		if ruleGrants(r, "bind", "rbac.authorization.k8s.io", rbacBindingResources) ||
			ruleGrants(r, "bind", "rbac.authorization.k8s.io", rbacRoleResources) {
			vias["bind"] = true
		}
		// impersonate users/groups/serviceaccounts → can act as anyone (incl. admins).
		if ruleGrants(r, "impersonate", "", impersonateResources) {
			vias["impersonate"] = true
		}
	}
	return vias
}

func critical(via string) bool {
	return via == "wildcard" || via == "rbac-write" || via == "cluster-admin"
}

func subjectLabel(s rbacv1.Subject) (kind, name, ns string) {
	return s.Kind, s.Name, s.Namespace
}

// AdminReach reports every subject that can reach cluster-admin — bound to an
// admin-equivalent role, or holding an escalation primitive (write RBAC
// bindings, escalate, bind, impersonate) that lets it grant itself admin. It is
// read-only: it reasons over Roles/ClusterRoles and their bindings, not live
// SubjectAccessReview probes.
func (c *Client) AdminReach(ctx context.Context) ([]AdminReachSubject, error) {
	crs, err := c.Clientset.RbacV1().ClusterRoles().List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	roles, err := c.Clientset.RbacV1().Roles("").List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	// via-set per ClusterRole name, and per namespaced Role "ns/name".
	crVias := map[string]map[string]bool{}
	for i := range crs.Items {
		crVias[crs.Items[i].Name] = classifyRules(crs.Items[i].Rules)
	}
	roleVias := map[string]map[string]bool{}
	for i := range roles.Items {
		roleVias[roles.Items[i].Namespace+"/"+roles.Items[i].Name] = classifyRules(roles.Items[i].Rules)
	}

	// A well-known name: the built-in cluster-admin always counts even if the API
	// server elides its wildcard rules from the read.
	markAdmin := func(vias map[string]bool, roleName string) map[string]bool {
		if roleName == "cluster-admin" {
			if vias == nil {
				vias = map[string]bool{}
			}
			vias["cluster-admin"] = true
		}
		return vias
	}

	subjects := map[string]*AdminReachSubject{}
	add := func(s rbacv1.Subject, path AdminPath) {
		kind, name, ns := subjectLabel(s)
		key := kind + "|" + ns + "|" + name
		sub := subjects[key]
		if sub == nil {
			sub = &AdminReachSubject{Kind: kind, Name: name, Namespace: ns, Severity: "high"}
			subjects[key] = sub
		}
		sub.Paths = append(sub.Paths, path)
		if critical(path.Via) {
			sub.Severity = "critical"
		}
	}

	// ClusterRoleBindings — cluster-wide grants.
	crbs, err := c.Clientset.RbacV1().ClusterRoleBindings().List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	for i := range crbs.Items {
		crb := &crbs.Items[i]
		vias := markAdmin(crVias[crb.RoleRef.Name], crb.RoleRef.Name)
		for via := range vias {
			for _, s := range crb.Subjects {
				add(s, AdminPath{Binding: crb.Name, Scope: "cluster", Role: crb.RoleRef.Name, Via: via})
			}
		}
	}

	// RoleBindings — namespace-scoped grants (a ClusterRole referenced here applies
	// only in the binding's namespace).
	rbs, err := c.Clientset.RbacV1().RoleBindings("").List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	for i := range rbs.Items {
		rb := &rbs.Items[i]
		var vias map[string]bool
		if rb.RoleRef.Kind == "ClusterRole" {
			vias = markAdmin(crVias[rb.RoleRef.Name], rb.RoleRef.Name)
		} else {
			vias = roleVias[rb.Namespace+"/"+rb.RoleRef.Name]
		}
		for via := range vias {
			for _, s := range rb.Subjects {
				add(s, AdminPath{Binding: rb.Name, Scope: "namespace/" + rb.Namespace, Role: rb.RoleRef.Name, Via: via})
			}
		}
	}

	out := make([]AdminReachSubject, 0, len(subjects))
	for _, s := range subjects {
		sort.Slice(s.Paths, func(i, j int) bool { return s.Paths[i].Binding < s.Paths[j].Binding })
		out = append(out, *s)
	}
	// Critical first, then by name.
	sort.Slice(out, func(i, j int) bool {
		if (out[i].Severity == "critical") != (out[j].Severity == "critical") {
			return out[i].Severity == "critical"
		}
		return out[i].Name < out[j].Name
	})
	return out, nil
}
