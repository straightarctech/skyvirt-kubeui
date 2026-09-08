package k8s

import (
	"context"
	"fmt"
	"sort"
	"strings"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// SecurityFinding is one security-posture issue about a specific resource.
type SecurityFinding struct {
	Severity    string `json:"severity"` // high | medium | low
	Category    string `json:"category"` // Workload | Namespace | RBAC
	Title       string `json:"title"`
	Kind        string `json:"kind"`
	Namespace   string `json:"namespace,omitempty"`
	Name        string `json:"name"`
	Detail      string `json:"detail,omitempty"`
	Remediation string `json:"remediation,omitempty"`
}

// SecurityPosture is the assembled cluster security report.
type SecurityPosture struct {
	Score    int               `json:"score"` // 0–100
	Counts   map[string]int    `json:"counts"`
	Scanned  map[string]int    `json:"scanned"` // pods/namespaces/etc examined
	Findings []SecurityFinding `json:"findings"`
}

var systemNamespaces = map[string]bool{
	"kube-system": true, "kube-public": true, "kube-node-lease": true,
}

// SecurityScan inspects workloads, namespaces, and RBAC for common
// misconfigurations and returns ranked findings with a headline score. It is
// read-only and best-effort — a section that fails to list is skipped, not fatal.
func (c *Client) SecurityScan(ctx context.Context) (*SecurityPosture, error) {
	p := &SecurityPosture{
		Counts:  map[string]int{"high": 0, "medium": 0, "low": 0},
		Scanned: map[string]int{},
	}
	seen := map[string]bool{} // dedup key -> workloads with N replicas report once

	add := func(f SecurityFinding, dedup string) {
		if dedup != "" {
			if seen[dedup] {
				return
			}
			seen[dedup] = true
		}
		p.Findings = append(p.Findings, f)
		p.Counts[f.Severity]++
	}

	// --- Workloads (pods) ---
	// Specific high-risk configs get a per-resource row; near-universal hygiene
	// checks are aggregated into one finding each (with a count) so the panel
	// stays actionable instead of listing the same issue 40 times.
	hy := &hygiene{escalate: map[string]bool{}, root: map[string]bool{}, noLimits: map[string]bool{}, workloads: map[string]bool{}}
	if pods, err := c.Clientset.CoreV1().Pods("").List(ctx, metav1.ListOptions{}); err == nil {
		p.Scanned["pods"] = len(pods.Items)
		for i := range pods.Items {
			c.scanPod(&pods.Items[i], add, hy)
		}
	}
	total := len(hy.workloads)
	if n := len(hy.escalate); n > 0 {
		add(SecurityFinding{Severity: "medium", Category: "Workload", Title: "Workloads allow privilege escalation",
			Kind: "Workload", Name: fmt.Sprintf("%d of %d", n, total),
			Detail: "containers can gain more privileges than they start with",
			Remediation: "Set securityContext.allowPrivilegeEscalation: false."}, "")
	}
	if n := len(hy.root); n > 0 {
		add(SecurityFinding{Severity: "medium", Category: "Workload", Title: "Workloads may run as root",
			Kind: "Workload", Name: fmt.Sprintf("%d of %d", n, total),
			Detail: "no non-root user is enforced",
			Remediation: "Set securityContext.runAsNonRoot: true with a non-zero runAsUser."}, "")
	}
	if n := len(hy.noLimits); n > 0 {
		add(SecurityFinding{Severity: "low", Category: "Workload", Title: "Workloads without resource limits",
			Kind: "Workload", Name: fmt.Sprintf("%d of %d", n, total),
			Detail: "no CPU/memory limits set",
			Remediation: "Set resources.limits so one pod can't starve a node."}, "")
	}

	// --- Namespaces (network isolation + pod-security) ---
	c.scanNamespaces(ctx, p, add)

	// --- RBAC (over-broad grants) ---
	c.scanRBAC(ctx, p, add)

	// --- RBAC escalation paths (can self-grant admin without holding it) ---
	c.scanEscalation(ctx, p, add)

	// --- Certificate expiry ---
	c.scanCerts(ctx, p, add)

	// Score: weight by severity (high dominates), floored at 0. Tuned so the
	// number has range across clusters rather than pinning to 0 whenever a couple
	// of privileged system add-ons (CSI, backup agents) are present.
	score := 100 - (p.Counts["high"]*6 + p.Counts["medium"]*2 + p.Counts["low"]*1)
	if score < 0 {
		score = 0
	}
	p.Score = score

	// Rank: severity desc, then category, then name.
	sev := map[string]int{"high": 3, "medium": 2, "low": 1}
	sort.SliceStable(p.Findings, func(a, b int) bool {
		fa, fb := p.Findings[a], p.Findings[b]
		if sev[fa.Severity] != sev[fb.Severity] {
			return sev[fa.Severity] > sev[fb.Severity]
		}
		if fa.Category != fb.Category {
			return fa.Category < fb.Category
		}
		return fa.Name < fb.Name
	})
	return p, nil
}

// workloadKey collapses a pod's replicas to one logical workload so a Deployment
// with N pods reports a finding once.
func workloadKey(pod *corev1.Pod) string {
	name := pod.Name
	if len(pod.OwnerReferences) > 0 {
		name = pod.OwnerReferences[0].Name // e.g. ReplicaSet "web-7f9c…"
	}
	// Strip trailing hash segments.
	parts := strings.Split(name, "-")
	if len(parts) > 1 {
		last := parts[len(parts)-1]
		if len(last) >= 5 && isHashish(last) {
			parts = parts[:len(parts)-1]
		}
	}
	return pod.Namespace + "/" + strings.Join(parts, "-")
}

func isHashish(s string) bool {
	for _, r := range s {
		if !((r >= 'a' && r <= 'z') || (r >= '0' && r <= '9')) {
			return false
		}
	}
	return true
}

// hygiene aggregates near-universal checks by distinct workload.
type hygiene struct {
	escalate, root, noLimits, workloads map[string]bool
}

func (c *Client) scanPod(pod *corev1.Pod, add func(SecurityFinding, string), hy *hygiene) {
	wk := workloadKey(pod)
	hy.workloads[wk] = true
	ns, name := pod.Namespace, pod.Name
	f := func(sev, title, detail, remediation string) SecurityFinding {
		return SecurityFinding{Severity: sev, Category: "Workload", Title: title, Kind: "Pod",
			Namespace: ns, Name: name, Detail: detail, Remediation: remediation}
	}

	if pod.Spec.HostNetwork || pod.Spec.HostPID || pod.Spec.HostIPC {
		which := []string{}
		if pod.Spec.HostNetwork {
			which = append(which, "hostNetwork")
		}
		if pod.Spec.HostPID {
			which = append(which, "hostPID")
		}
		if pod.Spec.HostIPC {
			which = append(which, "hostIPC")
		}
		add(f("high", "Shares host namespaces", strings.Join(which, ", ")+" — the pod can see/affect the node",
			"Remove hostNetwork/hostPID/hostIPC unless strictly required."), wk+"|hostns")
	}

	for _, v := range pod.Spec.Volumes {
		if v.HostPath != nil {
			add(f("high", "Mounts a hostPath volume", "path "+v.HostPath.Path+" from the node",
				"Use a PVC or emptyDir instead of a hostPath mount."), wk+"|hostpath")
			break
		}
	}

	containers := append(append([]corev1.Container{}, pod.Spec.InitContainers...), pod.Spec.Containers...)
	for _, ct := range containers {
		sc := ct.SecurityContext
		if sc != nil && sc.Privileged != nil && *sc.Privileged {
			add(f("high", "Privileged container", "container "+ct.Name+" runs privileged",
				"Drop privileged: true; grant only the specific capabilities needed."), wk+"|priv")
		}
		if sc != nil && sc.Capabilities != nil {
			for _, cap := range sc.Capabilities.Add {
				if cap == "ALL" || cap == "SYS_ADMIN" || cap == "NET_ADMIN" || cap == "SYS_PTRACE" {
					add(f("high", "Dangerous capability added", "container "+ct.Name+" adds "+string(cap),
						"Remove the capability or scope it to a dedicated, isolated workload."), wk+"|cap")
					break
				}
			}
		}
		if sc == nil || sc.AllowPrivilegeEscalation == nil || *sc.AllowPrivilegeEscalation {
			hy.escalate[wk] = true
		}
		runsRoot := (sc == nil || sc.RunAsNonRoot == nil || !*sc.RunAsNonRoot) &&
			(pod.Spec.SecurityContext == nil || pod.Spec.SecurityContext.RunAsNonRoot == nil || !*pod.Spec.SecurityContext.RunAsNonRoot)
		if runsRoot {
			hy.root[wk] = true
		}
		if len(ct.Resources.Limits) == 0 {
			hy.noLimits[wk] = true
		}
	}
}

func (c *Client) scanNamespaces(ctx context.Context, p *SecurityPosture, add func(SecurityFinding, string)) {
	nss, err := c.Clientset.CoreV1().Namespaces().List(ctx, metav1.ListOptions{})
	if err != nil {
		return
	}
	for i := range nss.Items {
		ns := &nss.Items[i]
		if systemNamespaces[ns.Name] || ns.Status.Phase == corev1.NamespaceTerminating {
			continue
		}
		p.Scanned["namespaces"]++
		// Only flag namespaces that actually run workloads. If we can't confirm
		// there are workloads, skip rather than emit findings on a guess.
		pods, err := c.Clientset.CoreV1().Pods(ns.Name).List(ctx, metav1.ListOptions{Limit: 1})
		if err != nil || pods == nil || len(pods.Items) == 0 {
			continue
		}
		// Don't emit a false "No NetworkPolicy" if the list itself failed.
		nps, err := c.Clientset.NetworkingV1().NetworkPolicies(ns.Name).List(ctx, metav1.ListOptions{})
		if err != nil {
			continue
		}
		if nps == nil || len(nps.Items) == 0 {
			add(SecurityFinding{Severity: "medium", Category: "Namespace", Title: "No NetworkPolicy",
				Kind: "Namespace", Name: ns.Name, Detail: "workloads accept traffic from anywhere",
				Remediation: "Add a default-deny NetworkPolicy, then allow only required flows."}, "")
		}
		if ns.Labels["pod-security.kubernetes.io/enforce"] == "" {
			add(SecurityFinding{Severity: "low", Category: "Namespace", Title: "No Pod Security Standard enforced",
				Kind: "Namespace", Name: ns.Name, Detail: "no pod-security.kubernetes.io/enforce label",
				Remediation: "Label the namespace with enforce=baseline (or restricted)."}, "")
		}
	}
}

// isSystemSubject skips built-in identities that legitimately hold broad rights.
func isSystemSubject(kind, name, ns string) bool {
	if strings.HasPrefix(name, "system:") {
		return true
	}
	return kind == "ServiceAccount" && systemNamespaces[ns]
}

// scanEscalation flags non-system subjects that can grant themselves cluster-admin
// through an escalation primitive (writing RBAC bindings, escalate, bind,
// impersonate) without already holding admin — a class the literal cluster-admin
// check misses. Subjects that already hold admin/wildcard are left to scanRBAC.
func (c *Client) scanEscalation(ctx context.Context, p *SecurityPosture, add func(SecurityFinding, string)) {
	reach, err := c.AdminReach(ctx)
	if err != nil {
		return
	}
	for _, s := range reach {
		if isSystemSubject(s.Kind, s.Name, s.Namespace) {
			continue
		}
		var vias []string
		direct := false
		for _, path := range s.Paths {
			switch path.Via {
			case "cluster-admin", "wildcard":
				direct = true
			case "rbac-write", "escalate", "bind", "impersonate":
				if !containsStr(vias, path.Via) {
					vias = append(vias, path.Via)
				}
			}
		}
		if direct || len(vias) == 0 {
			continue // direct admins are covered by scanRBAC; nothing to escalate here
		}
		label := s.Name
		if s.Namespace != "" {
			label = s.Namespace + "/" + s.Name
		}
		add(SecurityFinding{Severity: "high", Category: "RBAC", Title: "Subject can escalate to cluster-admin",
			Kind: s.Kind, Name: label,
			Detail:      "can grant itself admin via " + strings.Join(vias, ", "),
			Remediation: "Remove RBAC write / escalate / bind / impersonate rights from this subject's roles."}, "esc|"+s.Kind+"|"+label)
	}
}

// scanCerts flags expired or soon-to-expire certificates (a scheduled outage in
// waiting). Long-lived (no-expiry) creds are a hygiene concern handled elsewhere.
func (c *Client) scanCerts(ctx context.Context, p *SecurityPosture, add func(SecurityFinding, string)) {
	certs, err := c.ScanCertExpiry(ctx)
	if err != nil {
		return
	}
	p.Scanned["certificates"] = len(certs)
	for _, ci := range certs {
		if ci.NoExpiry {
			continue
		}
		key := "cert|" + ci.Namespace + "/" + ci.Secret
		if ci.Expired {
			add(SecurityFinding{Severity: "high", Category: "Certificate", Title: "Certificate expired",
				Kind: ci.Kind, Namespace: ci.Namespace, Name: ci.Secret,
				Detail: "expired " + ci.NotAfter, Remediation: "Rotate or renew the certificate."}, key)
		} else if ci.DaysLeft <= 14 {
			add(SecurityFinding{Severity: "medium", Category: "Certificate", Title: "Certificate expiring soon",
				Kind: ci.Kind, Namespace: ci.Namespace, Name: ci.Secret,
				Detail: fmt.Sprintf("expires in %dd", ci.DaysLeft), Remediation: "Renew the certificate before it expires."}, key)
		}
	}
}

func containsStr(list []string, want string) bool {
	for _, s := range list {
		if s == want {
			return true
		}
	}
	return false
}

func (c *Client) scanRBAC(ctx context.Context, p *SecurityPosture, add func(SecurityFinding, string)) {
	crbs, err := c.Clientset.RbacV1().ClusterRoleBindings().List(ctx, metav1.ListOptions{})
	if err != nil {
		return
	}
	p.Scanned["clusterrolebindings"] = len(crbs.Items)
	for i := range crbs.Items {
		crb := &crbs.Items[i]
		if crb.RoleRef.Name != "cluster-admin" {
			continue
		}
		for _, s := range crb.Subjects {
			// System components legitimately hold cluster-admin.
			if strings.HasPrefix(s.Name, "system:") || strings.HasPrefix(crb.Name, "system:") {
				continue
			}
			add(SecurityFinding{Severity: "high", Category: "RBAC", Title: "cluster-admin granted",
				Kind: "ClusterRoleBinding", Name: crb.Name,
				Detail: fmt.Sprintf("%s %q has full cluster-admin", strings.ToLower(s.Kind), s.Name),
				Remediation: "Grant a least-privilege role instead of cluster-admin."}, crb.Name+"|"+s.Name)
		}
	}
}
