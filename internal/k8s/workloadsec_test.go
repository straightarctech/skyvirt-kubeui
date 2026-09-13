package k8s

import (
	"context"
	"testing"

	"go.uber.org/zap"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"
)

func boolPtr(b bool) *bool { return &b }

// checks counts findings by check name so tests can assert on the rules that
// fired without depending on slice order.
func checks(findings []SecFinding) map[string]int {
	out := map[string]int{}
	for _, f := range findings {
		out[f.Check]++
	}
	return out
}

// sevOf returns the severity recorded for the first finding of a given check.
func sevOf(findings []SecFinding, check string) string {
	for _, f := range findings {
		if f.Check == check {
			return f.Severity
		}
	}
	return ""
}

// hardened is a container that explicitly opts out of every default-on finding.
func hardened(name string) corev1.Container {
	return corev1.Container{
		Name: name,
		SecurityContext: &corev1.SecurityContext{
			AllowPrivilegeEscalation: boolPtr(false),
			RunAsNonRoot:             boolPtr(true),
		},
	}
}

// TestAuditPod_HardenedPodIsClean is the negative control. Without it, every
// other test here would still pass against an auditPod that flags everything.
func TestAuditPod_HardenedPodIsClean(t *testing.T) {
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "web", Namespace: "default"},
		Spec:       corev1.PodSpec{Containers: []corev1.Container{hardened("c1")}},
	}
	if got := auditPod(pod); len(got) != 0 {
		t.Errorf("auditPod(hardened) = %+v, want no findings", got)
	}
}

// TestAuditPod_DefaultsAreFlagged pins the most-hit rules in the whole engine: a
// container that simply omits a SecurityContext is reported for BOTH
// allowPrivilegeEscalation and runAsRoot. Suppressing either requires setting
// the field explicitly — silence is not consent.
func TestAuditPod_DefaultsAreFlagged(t *testing.T) {
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "web", Namespace: "default"},
		Spec:       corev1.PodSpec{Containers: []corev1.Container{{Name: "c1"}}},
	}
	got := checks(auditPod(pod))
	if got["allowPrivilegeEscalation"] != 1 {
		t.Errorf("allowPrivilegeEscalation fired %d times, want 1", got["allowPrivilegeEscalation"])
	}
	if got["runAsRoot"] != 1 {
		t.Errorf("runAsRoot fired %d times, want 1", got["runAsRoot"])
	}
}

// TestAuditPod_HostNamespaces: each host namespace share is its own high finding.
func TestAuditPod_HostNamespaces(t *testing.T) {
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "n", Namespace: "default"},
		Spec: corev1.PodSpec{
			HostNetwork: true, HostPID: true, HostIPC: true,
			Containers: []corev1.Container{hardened("c1")},
		},
	}
	findings := auditPod(pod)
	got := checks(findings)
	for _, check := range []string{"hostNetwork", "hostPID", "hostIPC"} {
		if got[check] != 1 {
			t.Errorf("%s fired %d times, want 1", check, got[check])
		}
		if sev := sevOf(findings, check); sev != "high" {
			t.Errorf("%s severity = %q, want high", check, sev)
		}
	}
}

// TestAuditPod_HostPathIsPerVolume: two hostPath mounts are two findings, so the
// detail can name each path rather than collapsing them into one.
func TestAuditPod_HostPathIsPerVolume(t *testing.T) {
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "n", Namespace: "default"},
		Spec: corev1.PodSpec{
			Volumes: []corev1.Volume{
				{Name: "docker", VolumeSource: corev1.VolumeSource{HostPath: &corev1.HostPathVolumeSource{Path: "/var/run/docker.sock"}}},
				{Name: "logs", VolumeSource: corev1.VolumeSource{HostPath: &corev1.HostPathVolumeSource{Path: "/var/log"}}},
				{Name: "tmp", VolumeSource: corev1.VolumeSource{EmptyDir: &corev1.EmptyDirVolumeSource{}}},
			},
			Containers: []corev1.Container{hardened("c1")},
		},
	}
	if got := checks(auditPod(pod))["hostPath"]; got != 2 {
		t.Errorf("hostPath fired %d times, want 2 (one per hostPath volume, emptyDir ignored)", got)
	}
}

// TestAuditPod_PrivilegedIsCritical — the only rule that reaches critical.
func TestAuditPod_PrivilegedIsCritical(t *testing.T) {
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "n", Namespace: "default"},
		Spec: corev1.PodSpec{Containers: []corev1.Container{{
			Name: "c1",
			SecurityContext: &corev1.SecurityContext{
				Privileged:               boolPtr(true),
				AllowPrivilegeEscalation: boolPtr(false),
				RunAsNonRoot:             boolPtr(true),
			},
		}}},
	}
	findings := auditPod(pod)
	if sev := sevOf(findings, "privileged"); sev != "critical" {
		t.Errorf("privileged severity = %q, want critical", sev)
	}
}

// TestAuditPod_RunAsUserZeroWinsOverRunAsNonRoot pins a subtle ordering:
// runAsUser:0 is OR'd ahead of the runAsNonRoot check, so a container asserting
// both is still flagged. That is the safe reading — the kubelet would reject the
// pod anyway — but it is easy to "simplify" away.
func TestAuditPod_RunAsUserZeroWinsOverRunAsNonRoot(t *testing.T) {
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "n", Namespace: "default"},
		Spec: corev1.PodSpec{Containers: []corev1.Container{{
			Name: "c1",
			SecurityContext: &corev1.SecurityContext{
				RunAsUser:                int64Ptr(0),
				RunAsNonRoot:             boolPtr(true),
				AllowPrivilegeEscalation: boolPtr(false),
			},
		}}},
	}
	if got := checks(auditPod(pod))["runAsRoot"]; got != 1 {
		t.Errorf("runAsRoot fired %d times, want 1 — runAsUser:0 must win over runAsNonRoot:true", got)
	}
}

// TestAuditPod_CapabilitySeverity: dangerous capabilities are high, ordinary
// ones medium, and the match is case-insensitive.
func TestAuditPod_CapabilitySeverity(t *testing.T) {
	cases := []struct {
		capability string
		wantSev    string
	}{
		{"NET_ADMIN", "high"},
		{"net_admin", "high"}, // lowercase must still resolve to the dangerous set
		{"SYS_ADMIN", "high"},
		{"ALL", "high"},
		{"CHOWN", "medium"},
	}
	for _, c := range cases {
		t.Run(c.capability, func(t *testing.T) {
			pod := &corev1.Pod{
				ObjectMeta: metav1.ObjectMeta{Name: "n", Namespace: "default"},
				Spec: corev1.PodSpec{Containers: []corev1.Container{{
					Name: "c1",
					SecurityContext: &corev1.SecurityContext{
						AllowPrivilegeEscalation: boolPtr(false),
						RunAsNonRoot:             boolPtr(true),
						Capabilities:             &corev1.Capabilities{Add: []corev1.Capability{corev1.Capability(c.capability)}},
					},
				}}},
			}
			findings := auditPod(pod)
			if got := checks(findings)["addedCapability"]; got != 1 {
				t.Fatalf("addedCapability fired %d times, want 1", got)
			}
			if sev := sevOf(findings, "addedCapability"); sev != c.wantSev {
				t.Errorf("severity for %s = %q, want %q", c.capability, sev, c.wantSev)
			}
		})
	}
}

// TestAuditPod_ScansInitContainers: init containers run with the same privileges
// as app containers and must not be skipped.
func TestAuditPod_ScansInitContainers(t *testing.T) {
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "n", Namespace: "default"},
		Spec: corev1.PodSpec{
			InitContainers: []corev1.Container{{
				Name:            "setup",
				SecurityContext: &corev1.SecurityContext{Privileged: boolPtr(true), AllowPrivilegeEscalation: boolPtr(false), RunAsNonRoot: boolPtr(true)},
			}},
			Containers: []corev1.Container{hardened("app")},
		},
	}
	if got := checks(auditPod(pod))["privileged"]; got != 1 {
		t.Errorf("privileged fired %d times, want 1 — an init container must be scanned", got)
	}
}

// TestAuditPod_PodLevelNonRootSuppressesContainerFinding: runAsNonRoot set at the
// pod level covers containers that do not set it themselves.
func TestAuditPod_PodLevelNonRootSuppressesContainerFinding(t *testing.T) {
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "n", Namespace: "default"},
		Spec: corev1.PodSpec{
			SecurityContext: &corev1.PodSecurityContext{RunAsNonRoot: boolPtr(true)},
			Containers: []corev1.Container{{
				Name:            "c1",
				SecurityContext: &corev1.SecurityContext{AllowPrivilegeEscalation: boolPtr(false)},
			}},
		},
	}
	if got := checks(auditPod(pod))["runAsRoot"]; got != 0 {
		t.Errorf("runAsRoot fired %d times, want 0 — pod-level runAsNonRoot must apply", got)
	}
}

// TestWorkloadOf resolves a pod to the workload a human recognises.
func TestWorkloadOf(t *testing.T) {
	ctrl := boolPtr(true)
	cases := []struct {
		name     string
		owner    *metav1.OwnerReference
		podName  string
		wantKind string
		wantName string
	}{
		{"replicaset collapses to its deployment", &metav1.OwnerReference{Kind: "ReplicaSet", Name: "web-6c9fd8b7c8", Controller: ctrl}, "web-6c9fd8b7c8-ab123", "Deployment", "web"},
		{"statefulset is reported as-is", &metav1.OwnerReference{Kind: "StatefulSet", Name: "db", Controller: ctrl}, "db-0", "StatefulSet", "db"},
		{"daemonset is reported as-is", &metav1.OwnerReference{Kind: "DaemonSet", Name: "agent", Controller: ctrl}, "agent-xyz", "DaemonSet", "agent"},
		{"no owner falls back to the pod itself", nil, "standalone", "Pod", "standalone"},
		// A ReplicaSet name with no dash cannot be split, so it is reported as the
		// ReplicaSet rather than being mangled into an empty Deployment name.
		{"dashless replicaset stays a replicaset", &metav1.OwnerReference{Kind: "ReplicaSet", Name: "web", Controller: ctrl}, "web-ab123", "ReplicaSet", "web"},
		{"non-controller owner is ignored", &metav1.OwnerReference{Kind: "ReplicaSet", Name: "web-6c9fd8b7c8"}, "orphan", "Pod", "orphan"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			pod := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: c.podName, Namespace: "default"}}
			if c.owner != nil {
				pod.OwnerReferences = []metav1.OwnerReference{*c.owner}
			}
			kind, name := workloadOf(pod)
			if kind != c.wantKind || name != c.wantName {
				t.Errorf("workloadOf = (%q, %q), want (%q, %q)", kind, name, c.wantKind, c.wantName)
			}
		})
	}
}

// TestWorkloadSecurityAudit_IncludesSystemNamespaces pins a deliberate
// difference from every other posture engine: this one does NOT skip
// kube-system, because that is exactly where privileged pods live.
func TestWorkloadSecurityAudit_IncludesSystemNamespaces(t *testing.T) {
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "kube-proxy-abc", Namespace: "kube-system"},
		Spec: corev1.PodSpec{
			HostNetwork: true,
			Containers:  []corev1.Container{hardened("c1")},
		},
	}
	kc := &Client{Clientset: fake.NewSimpleClientset(pod), Logger: zap.NewNop()}
	got, err := kc.WorkloadSecurityAudit(context.Background())
	if err != nil {
		t.Fatalf("WorkloadSecurityAudit: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("got %d risks, want 1 — kube-system must be audited: %+v", len(got), got)
	}
	if got[0].Namespace != "kube-system" || got[0].Severity != "high" {
		t.Errorf("risk = %s/%s severity %q, want kube-system severity high", got[0].Namespace, got[0].Name, got[0].Severity)
	}
}

// TestWorkloadSecurityAudit_DedupesReplicas: three pods of one Deployment are
// one risk entry, not three.
func TestWorkloadSecurityAudit_DedupesReplicas(t *testing.T) {
	ctrl := boolPtr(true)
	mk := func(suffix string) *corev1.Pod {
		return &corev1.Pod{
			ObjectMeta: metav1.ObjectMeta{
				Name:            "web-6c9fd8b7c8-" + suffix,
				Namespace:       "default",
				OwnerReferences: []metav1.OwnerReference{{Kind: "ReplicaSet", Name: "web-6c9fd8b7c8", Controller: ctrl}},
			},
			Spec: corev1.PodSpec{HostPID: true, Containers: []corev1.Container{hardened("c1")}},
		}
	}
	kc := &Client{Clientset: fake.NewSimpleClientset(mk("a"), mk("b"), mk("c")), Logger: zap.NewNop()}
	got, err := kc.WorkloadSecurityAudit(context.Background())
	if err != nil {
		t.Fatalf("WorkloadSecurityAudit: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("got %d risks, want 1 deduped entry: %+v", len(got), got)
	}
	if got[0].Kind != "Deployment" || got[0].Name != "web" {
		t.Errorf("risk = %s/%s, want Deployment/web", got[0].Kind, got[0].Name)
	}
}

// TestWorkloadSecurityAudit_SeverityRollup: the workload takes the worst
// severity across its findings, not the first or the last.
func TestWorkloadSecurityAudit_SeverityRollup(t *testing.T) {
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "mixed", Namespace: "default"},
		Spec: corev1.PodSpec{
			HostNetwork: true, // high
			Containers: []corev1.Container{{
				Name:            "c1",
				SecurityContext: &corev1.SecurityContext{Privileged: boolPtr(true)}, // critical
			}},
		},
	}
	kc := &Client{Clientset: fake.NewSimpleClientset(pod), Logger: zap.NewNop()}
	got, err := kc.WorkloadSecurityAudit(context.Background())
	if err != nil {
		t.Fatalf("WorkloadSecurityAudit: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("got %d risks, want 1", len(got))
	}
	if got[0].Severity != "critical" {
		t.Errorf("Severity = %q, want critical (worst of high+critical)", got[0].Severity)
	}
}
