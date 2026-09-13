package k8s

import (
	"context"
	"sort"
	"strings"
	"testing"

	"go.uber.org/zap"
	rbacv1 "k8s.io/api/rbac/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"
)

// viaNames returns the via-set as a sorted, comma-joined string. classifyRules
// returns a map, so tests must compare sets — never iteration order.
func viaNames(vias map[string]bool) string {
	out := make([]string, 0, len(vias))
	for v := range vias {
		out = append(out, v)
	}
	sort.Strings(out)
	return strings.Join(out, ",")
}

// TestHasStr pins the deliberate asymmetry: a "*" in the LIST matches any want,
// but a "*" as the WANT does not match a concrete list entry. Making this
// symmetric would flag every role that merely grants "get" as a wildcard.
func TestHasStr(t *testing.T) {
	cases := []struct {
		list []string
		want string
		ok   bool
	}{
		{[]string{"*"}, "create", true}, // wildcard in the list matches anything
		{[]string{"get"}, "*", false},   // ... but not the reverse
		{[]string{"get", "list"}, "list", true},
		{[]string{"get"}, "create", false},
		{nil, "get", false},
	}
	for _, c := range cases {
		if got := hasStr(c.list, c.want); got != c.ok {
			t.Errorf("hasStr(%v, %q) = %v, want %v", c.list, c.want, got, c.ok)
		}
	}
}

// TestRuleGrants requires all three dimensions to line up: verb, API group, and
// a resource that appears in the caller's resource set.
func TestRuleGrants(t *testing.T) {
	rule := rbacv1.PolicyRule{
		Verbs:     []string{"create"},
		APIGroups: []string{"rbac.authorization.k8s.io"},
		Resources: []string{"rolebindings"},
	}
	cases := []struct {
		name      string
		verb      string
		group     string
		resources map[string]bool
		ok        bool
	}{
		{"all three match", "create", "rbac.authorization.k8s.io", rbacBindingResources, true},
		{"wrong verb", "delete", "rbac.authorization.k8s.io", rbacBindingResources, false},
		{"wrong group", "create", "", rbacBindingResources, false},
		{"resource not in set", "create", "rbac.authorization.k8s.io", impersonateResources, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := ruleGrants(rule, c.verb, c.group, c.resources); got != c.ok {
				t.Errorf("ruleGrants(...) = %v, want %v", got, c.ok)
			}
		})
	}
	// A rule listing resources ["*"] matches every resource set, because "*" is a
	// member of each one.
	star := rbacv1.PolicyRule{Verbs: []string{"impersonate"}, APIGroups: []string{""}, Resources: []string{"*"}}
	if !ruleGrants(star, "impersonate", "", impersonateResources) {
		t.Error("ruleGrants with resources [*] = false, want true")
	}
}

// TestClassifyRules pins each of the five escalation reasons, and the two
// negative cases that matter: a benign read-only rule, and a near-wildcard that
// is missing one of the three dimensions.
func TestClassifyRules(t *testing.T) {
	cases := []struct {
		name string
		rule rbacv1.PolicyRule
		want string // sorted, comma-joined via set
	}{
		{
			// A true wildcard grants every reason at once — it satisfies each of
			// the narrower checks too. Asserting the full set documents that.
			"full wildcard implies every via",
			rbacv1.PolicyRule{Verbs: []string{"*"}, APIGroups: []string{"*"}, Resources: []string{"*"}},
			"bind,escalate,impersonate,rbac-write,wildcard",
		},
		{
			// Wildcard verbs+groups but a concrete resource is NOT a wildcard.
			"wildcard needs all three dimensions",
			rbacv1.PolicyRule{Verbs: []string{"*"}, APIGroups: []string{"*"}, Resources: []string{"pods"}},
			"",
		},
		{
			"write on rolebindings is rbac-write",
			rbacv1.PolicyRule{Verbs: []string{"create"}, APIGroups: []string{"rbac.authorization.k8s.io"}, Resources: []string{"rolebindings"}},
			"rbac-write",
		},
		{
			"escalate on clusterroles",
			rbacv1.PolicyRule{Verbs: []string{"escalate"}, APIGroups: []string{"rbac.authorization.k8s.io"}, Resources: []string{"clusterroles"}},
			"escalate",
		},
		{
			"bind on clusterroles",
			rbacv1.PolicyRule{Verbs: []string{"bind"}, APIGroups: []string{"rbac.authorization.k8s.io"}, Resources: []string{"clusterroles"}},
			"bind",
		},
		{
			// impersonate is checked against the CORE group, not the rbac group.
			"impersonate users in the core group",
			rbacv1.PolicyRule{Verbs: []string{"impersonate"}, APIGroups: []string{""}, Resources: []string{"users"}},
			"impersonate",
		},
		{
			"read-only pods rule grants nothing",
			rbacv1.PolicyRule{Verbs: []string{"get", "list"}, APIGroups: []string{""}, Resources: []string{"pods"}},
			"",
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := viaNames(classifyRules([]rbacv1.PolicyRule{c.rule})); got != c.want {
				t.Errorf("classifyRules = %q, want %q", got, c.want)
			}
		})
	}
}

// TestCritical pins the severity split. Only three of the six reasons are
// critical; escalate/bind/impersonate are indirect paths and stay high. Widening
// this set would turn a large share of ordinary clusters critical overnight.
func TestCritical(t *testing.T) {
	cases := []struct {
		via string
		ok  bool
	}{
		{"wildcard", true},
		{"rbac-write", true},
		{"cluster-admin", true},
		{"escalate", false},
		{"bind", false},
		{"impersonate", false},
		{"", false},
	}
	for _, c := range cases {
		if got := critical(c.via); got != c.ok {
			t.Errorf("critical(%q) = %v, want %v", c.via, got, c.ok)
		}
	}
}

// TestAdminReach_ClusterAdminByName pins the well-known-name shortcut: a binding
// to "cluster-admin" is reported even when no ClusterRole object with readable
// wildcard rules exists in the cluster.
func TestAdminReach_ClusterAdminByName(t *testing.T) {
	crb := &rbacv1.ClusterRoleBinding{
		ObjectMeta: metav1.ObjectMeta{Name: "admins"},
		RoleRef:    rbacv1.RoleRef{Kind: "ClusterRole", Name: "cluster-admin"},
		Subjects:   []rbacv1.Subject{{Kind: "User", Name: "alice"}},
	}
	kc := &Client{Clientset: fake.NewSimpleClientset(crb), Logger: zap.NewNop()}
	got, err := kc.AdminReach(context.Background())
	if err != nil {
		t.Fatalf("AdminReach: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("got %d subjects, want 1: %+v", len(got), got)
	}
	if got[0].Kind != "User" || got[0].Name != "alice" {
		t.Errorf("subject = %s/%s, want User/alice", got[0].Kind, got[0].Name)
	}
	if got[0].Severity != "critical" {
		t.Errorf("Severity = %q, want critical", got[0].Severity)
	}
	if len(got[0].Paths) != 1 || got[0].Paths[0].Via != "cluster-admin" {
		t.Fatalf("Paths = %+v, want one path via cluster-admin", got[0].Paths)
	}
	if got[0].Paths[0].Scope != "cluster" {
		t.Errorf("Scope = %q, want cluster", got[0].Paths[0].Scope)
	}
}

// TestAdminReach_RoleBindingToClusterAdminIsCritical pins current behaviour that
// is arguably over-strict: a RoleBinding grants cluster-admin's rules only
// within its own namespace, yet the subject is still reported critical. The
// scope string does say "namespace/<ns>". Recorded deliberately — changing the
// severity is a product call, not a test fix.
func TestAdminReach_RoleBindingToClusterAdminIsCritical(t *testing.T) {
	rb := &rbacv1.RoleBinding{
		ObjectMeta: metav1.ObjectMeta{Name: "ns-admins", Namespace: "team-a"},
		RoleRef:    rbacv1.RoleRef{Kind: "ClusterRole", Name: "cluster-admin"},
		Subjects:   []rbacv1.Subject{{Kind: "ServiceAccount", Name: "deployer", Namespace: "team-a"}},
	}
	kc := &Client{Clientset: fake.NewSimpleClientset(rb), Logger: zap.NewNop()}
	got, err := kc.AdminReach(context.Background())
	if err != nil {
		t.Fatalf("AdminReach: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("got %d subjects, want 1: %+v", len(got), got)
	}
	if got[0].Severity != "critical" {
		t.Errorf("Severity = %q, want critical", got[0].Severity)
	}
	if want := "namespace/team-a"; got[0].Paths[0].Scope != want {
		t.Errorf("Scope = %q, want %q", got[0].Paths[0].Scope, want)
	}
}

// TestAdminReach_EscalateIsHighNotCritical is the severity guard at the
// integration level: an escalate-only role must not be promoted to critical.
func TestAdminReach_EscalateIsHighNotCritical(t *testing.T) {
	cr := &rbacv1.ClusterRole{
		ObjectMeta: metav1.ObjectMeta{Name: "escalator"},
		Rules: []rbacv1.PolicyRule{{
			Verbs:     []string{"escalate"},
			APIGroups: []string{"rbac.authorization.k8s.io"},
			Resources: []string{"clusterroles"},
		}},
	}
	crb := &rbacv1.ClusterRoleBinding{
		ObjectMeta: metav1.ObjectMeta{Name: "escalator-binding"},
		RoleRef:    rbacv1.RoleRef{Kind: "ClusterRole", Name: "escalator"},
		Subjects:   []rbacv1.Subject{{Kind: "Group", Name: "devs"}},
	}
	kc := &Client{Clientset: fake.NewSimpleClientset(cr, crb), Logger: zap.NewNop()}
	got, err := kc.AdminReach(context.Background())
	if err != nil {
		t.Fatalf("AdminReach: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("got %d subjects, want 1: %+v", len(got), got)
	}
	if got[0].Severity != "high" {
		t.Errorf("Severity = %q, want high — escalate is an indirect path", got[0].Severity)
	}
	if got[0].Paths[0].Via != "escalate" {
		t.Errorf("Via = %q, want escalate", got[0].Paths[0].Via)
	}
}

// TestAdminReach_DedupesSubjectAcrossBindings: one subject reached by two
// bindings is a single entry carrying both paths, not two entries.
func TestAdminReach_DedupesSubjectAcrossBindings(t *testing.T) {
	sub := rbacv1.Subject{Kind: "User", Name: "carol"}
	a := &rbacv1.ClusterRoleBinding{
		ObjectMeta: metav1.ObjectMeta{Name: "aaa-binding"},
		RoleRef:    rbacv1.RoleRef{Kind: "ClusterRole", Name: "cluster-admin"},
		Subjects:   []rbacv1.Subject{sub},
	}
	b := &rbacv1.ClusterRoleBinding{
		ObjectMeta: metav1.ObjectMeta{Name: "zzz-binding"},
		RoleRef:    rbacv1.RoleRef{Kind: "ClusterRole", Name: "cluster-admin"},
		Subjects:   []rbacv1.Subject{sub},
	}
	kc := &Client{Clientset: fake.NewSimpleClientset(a, b), Logger: zap.NewNop()}
	got, err := kc.AdminReach(context.Background())
	if err != nil {
		t.Fatalf("AdminReach: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("got %d subjects, want 1 deduped: %+v", len(got), got)
	}
	if len(got[0].Paths) != 2 {
		t.Fatalf("got %d paths, want 2: %+v", len(got[0].Paths), got[0].Paths)
	}
	// Paths are sorted by binding name.
	if got[0].Paths[0].Binding != "aaa-binding" || got[0].Paths[1].Binding != "zzz-binding" {
		t.Errorf("paths not sorted by binding: %+v", got[0].Paths)
	}
}

// TestAdminReach_IgnoresHarmlessRoles: a read-only ClusterRole yields no
// subjects at all. Without this, every test above could pass on a function that
// simply flags everything.
func TestAdminReach_IgnoresHarmlessRoles(t *testing.T) {
	cr := &rbacv1.ClusterRole{
		ObjectMeta: metav1.ObjectMeta{Name: "viewer"},
		Rules:      []rbacv1.PolicyRule{{Verbs: []string{"get", "list"}, APIGroups: []string{""}, Resources: []string{"pods"}}},
	}
	crb := &rbacv1.ClusterRoleBinding{
		ObjectMeta: metav1.ObjectMeta{Name: "viewer-binding"},
		RoleRef:    rbacv1.RoleRef{Kind: "ClusterRole", Name: "viewer"},
		Subjects:   []rbacv1.Subject{{Kind: "User", Name: "dave"}},
	}
	kc := &Client{Clientset: fake.NewSimpleClientset(cr, crb), Logger: zap.NewNop()}
	got, err := kc.AdminReach(context.Background())
	if err != nil {
		t.Fatalf("AdminReach: %v", err)
	}
	if len(got) != 0 {
		t.Errorf("got %d subjects, want 0: %+v", len(got), got)
	}
}
