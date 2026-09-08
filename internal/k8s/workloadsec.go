package k8s

import (
	"context"
	"fmt"
	"sort"
	"strings"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// SecFinding is one hardening issue on a workload.
type SecFinding struct {
	Check    string `json:"check"`
	Severity string `json:"severity"` // critical | high | medium | low
	Detail   string `json:"detail"`
}

// WorkloadRisk aggregates the hardening findings for one workload (replicas of
// the same controller are reported once).
type WorkloadRisk struct {
	Namespace string       `json:"namespace"`
	Kind      string       `json:"kind"`
	Name      string       `json:"name"`
	Severity  string       `json:"severity"` // worst finding
	Findings  []SecFinding `json:"findings"`
}

var sevRank = map[string]int{"critical": 3, "high": 2, "medium": 1, "low": 0}

// dangerousCaps escalate a container well beyond a normal workload.
var dangerousCaps = map[string]bool{
	"ALL": true, "SYS_ADMIN": true, "NET_ADMIN": true, "SYS_PTRACE": true,
	"SYS_MODULE": true, "NET_RAW": true, "SYS_BOOT": true, "DAC_OVERRIDE": true,
}

// WorkloadSecurityAudit scans running pods for insecure settings — privileged
// containers, host namespaces, hostPath mounts, root execution, added
// capabilities, and privilege escalation — and reports them per workload. It is
// read-only. System namespaces are included (many system pods are privileged by
// design); severity is what to sort by.
func (c *Client) WorkloadSecurityAudit(ctx context.Context) ([]WorkloadRisk, error) {
	pods, err := c.Clientset.CoreV1().Pods("").List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	seen := map[string]bool{}
	out := []WorkloadRisk{}
	for i := range pods.Items {
		pod := &pods.Items[i]
		kind, name := workloadOf(pod)
		key := pod.Namespace + "|" + kind + "|" + name
		if seen[key] {
			continue // another replica of a workload already audited
		}
		seen[key] = true

		findings := auditPod(pod)
		if len(findings) == 0 {
			continue
		}
		worst := "low"
		for _, f := range findings {
			if sevRank[f.Severity] > sevRank[worst] {
				worst = f.Severity
			}
		}
		out = append(out, WorkloadRisk{Namespace: pod.Namespace, Kind: kind, Name: name, Severity: worst, Findings: findings})
	}
	sort.Slice(out, func(i, j int) bool {
		if sevRank[out[i].Severity] != sevRank[out[j].Severity] {
			return sevRank[out[i].Severity] > sevRank[out[j].Severity]
		}
		if out[i].Namespace != out[j].Namespace {
			return out[i].Namespace < out[j].Namespace
		}
		return out[i].Name < out[j].Name
	})
	return out, nil
}

// workloadOf resolves the pod's owning workload, collapsing a ReplicaSet to its
// Deployment so replicas group under one friendly name.
func workloadOf(pod *corev1.Pod) (kind, name string) {
	for _, o := range pod.OwnerReferences {
		if o.Controller == nil || !*o.Controller {
			continue
		}
		if o.Kind == "ReplicaSet" {
			// web-6c9fd8b7c8 → Deployment "web"
			if idx := strings.LastIndex(o.Name, "-"); idx > 0 {
				return "Deployment", o.Name[:idx]
			}
		}
		return o.Kind, o.Name
	}
	return "Pod", pod.Name
}

func auditPod(pod *corev1.Pod) []SecFinding {
	var f []SecFinding
	s := &pod.Spec

	if s.HostNetwork {
		f = append(f, SecFinding{"hostNetwork", "high", "Shares the host network namespace."})
	}
	if s.HostPID {
		f = append(f, SecFinding{"hostPID", "high", "Shares the host process namespace."})
	}
	if s.HostIPC {
		f = append(f, SecFinding{"hostIPC", "high", "Shares the host IPC namespace."})
	}
	for _, v := range s.Volumes {
		if v.HostPath != nil {
			f = append(f, SecFinding{"hostPath", "high", fmt.Sprintf("Mounts host path %q (volume %q).", v.HostPath.Path, v.Name)})
		}
	}

	podNonRoot := s.SecurityContext != nil && s.SecurityContext.RunAsNonRoot != nil && *s.SecurityContext.RunAsNonRoot
	podRunAsRoot := s.SecurityContext != nil && s.SecurityContext.RunAsUser != nil && *s.SecurityContext.RunAsUser == 0

	all := append(append([]corev1.Container{}, s.InitContainers...), s.Containers...)
	for _, ctr := range all {
		sc := ctr.SecurityContext
		if sc != nil && sc.Privileged != nil && *sc.Privileged {
			f = append(f, SecFinding{"privileged", "critical", fmt.Sprintf("Container %q runs privileged (full host access).", ctr.Name)})
		}
		// Privilege escalation not explicitly disabled.
		if !(sc != nil && sc.AllowPrivilegeEscalation != nil && !*sc.AllowPrivilegeEscalation) {
			f = append(f, SecFinding{"allowPrivilegeEscalation", "medium", fmt.Sprintf("Container %q does not set allowPrivilegeEscalation=false.", ctr.Name)})
		}
		// Runs as root?
		ctrNonRoot := sc != nil && sc.RunAsNonRoot != nil && *sc.RunAsNonRoot
		ctrRunAsRoot := sc != nil && sc.RunAsUser != nil && *sc.RunAsUser == 0
		if ctrRunAsRoot || podRunAsRoot || (!ctrNonRoot && !podNonRoot) {
			f = append(f, SecFinding{"runAsRoot", "medium", fmt.Sprintf("Container %q may run as root (runAsNonRoot not enforced).", ctr.Name)})
		}
		// Added capabilities.
		if sc != nil && sc.Capabilities != nil {
			for _, cap := range sc.Capabilities.Add {
				name := string(cap)
				sev := "medium"
				if dangerousCaps[strings.ToUpper(name)] {
					sev = "high"
				}
				f = append(f, SecFinding{"addedCapability", sev, fmt.Sprintf("Container %q adds capability %s.", ctr.Name, name)})
			}
		}
	}
	return f
}
