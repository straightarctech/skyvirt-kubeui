package k8s

import (
	"context"
	"fmt"
	"sort"
	"time"

	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// HealthIssue is one unhealthy resource surfaced by the triage scan.
type HealthIssue struct {
	Severity  string `json:"severity"` // critical | high | medium
	Category  string `json:"category"` // Pod | Node | Storage | Job
	Kind      string `json:"kind"`
	Namespace string `json:"namespace,omitempty"`
	Name      string `json:"name"`
	Reason    string `json:"reason"`
	Detail    string `json:"detail,omitempty"`
}

// ClusterHealthReport is the whole-cluster triage board.
type ClusterHealthReport struct {
	Issues  []HealthIssue  `json:"issues"`
	Counts  map[string]int `json:"counts"` // by severity
	Scanned map[string]int `json:"scanned"`
	Healthy bool           `json:"healthy"`
}

var healthSevRank = map[string]int{"critical": 3, "high": 2, "medium": 1}

// container waiting reasons and their severity.
var waitingSeverity = map[string]string{
	"CrashLoopBackOff":           "critical",
	"ImagePullBackOff":           "high",
	"ErrImagePull":               "high",
	"InvalidImageName":           "high",
	"CreateContainerConfigError": "high",
	"CreateContainerError":       "high",
	"RunContainerError":          "high",
}

// ClusterHealth scans the whole cluster for things that are broken or stuck right
// now — crash-looping / unschedulable / not-ready pods, NotReady or pressured
// nodes, pending/lost volumes, and failed jobs — and returns them ranked. Pod
// issues collapse to their workload so a crash-looping Deployment shows once. It
// is read-only.
func (c *Client) ClusterHealth(ctx context.Context) (*ClusterHealthReport, error) {
	rep := &ClusterHealthReport{Counts: map[string]int{"critical": 0, "high": 0, "medium": 0}, Scanned: map[string]int{}}
	now := time.Now()

	// --- Pods (collapsed by workload) ---
	byWorkload := map[string]HealthIssue{}
	if pods, err := c.Clientset.CoreV1().Pods("").List(ctx, metav1.ListOptions{}); err == nil {
		rep.Scanned["pods"] = len(pods.Items)
		for i := range pods.Items {
			pod := &pods.Items[i]
			issue, ok := podHealth(pod, now)
			if !ok {
				continue
			}
			key := workloadKey(pod)
			if cur, exists := byWorkload[key]; !exists || healthSevRank[issue.Severity] > healthSevRank[cur.Severity] {
				byWorkload[key] = issue
			}
		}
	}
	for _, iss := range byWorkload {
		rep.Issues = append(rep.Issues, iss)
	}

	// --- Nodes ---
	if nodes, err := c.Clientset.CoreV1().Nodes().List(ctx, metav1.ListOptions{}); err == nil {
		rep.Scanned["nodes"] = len(nodes.Items)
		for i := range nodes.Items {
			n := &nodes.Items[i]
			for _, cond := range n.Status.Conditions {
				switch {
				case cond.Type == corev1.NodeReady && cond.Status != corev1.ConditionTrue:
					rep.Issues = append(rep.Issues, HealthIssue{Severity: "critical", Category: "Node", Kind: "Node",
						Name: n.Name, Reason: "NotReady", Detail: cond.Message})
				case cond.Type != corev1.NodeReady && cond.Status == corev1.ConditionTrue &&
					(cond.Type == corev1.NodeMemoryPressure || cond.Type == corev1.NodeDiskPressure || cond.Type == corev1.NodePIDPressure):
					rep.Issues = append(rep.Issues, HealthIssue{Severity: "high", Category: "Node", Kind: "Node",
						Name: n.Name, Reason: string(cond.Type), Detail: cond.Message})
				}
			}
		}
	}

	// --- PersistentVolumeClaims ---
	if pvcs, err := c.Clientset.CoreV1().PersistentVolumeClaims("").List(ctx, metav1.ListOptions{}); err == nil {
		rep.Scanned["pvcs"] = len(pvcs.Items)
		for i := range pvcs.Items {
			pvc := &pvcs.Items[i]
			switch pvc.Status.Phase {
			case corev1.ClaimPending:
				// Pending briefly at creation is normal; flag if it's been a while.
				if now.Sub(pvc.CreationTimestamp.Time) > 2*time.Minute {
					rep.Issues = append(rep.Issues, HealthIssue{Severity: "high", Category: "Storage", Kind: "PersistentVolumeClaim",
						Namespace: pvc.Namespace, Name: pvc.Name, Reason: "Pending", Detail: "not bound to a volume"})
				}
			case corev1.ClaimLost:
				rep.Issues = append(rep.Issues, HealthIssue{Severity: "critical", Category: "Storage", Kind: "PersistentVolumeClaim",
					Namespace: pvc.Namespace, Name: pvc.Name, Reason: "Lost", Detail: "bound volume is gone"})
			}
		}
	}

	// --- Jobs ---
	if jobs, err := c.Clientset.BatchV1().Jobs("").List(ctx, metav1.ListOptions{}); err == nil {
		rep.Scanned["jobs"] = len(jobs.Items)
		for i := range jobs.Items {
			j := &jobs.Items[i]
			if jobFailed(j) {
				rep.Issues = append(rep.Issues, HealthIssue{Severity: "medium", Category: "Job", Kind: "Job",
					Namespace: j.Namespace, Name: j.Name, Reason: "Failed",
					Detail: fmt.Sprintf("%d failed pod(s)", j.Status.Failed)})
			}
		}
	}

	for _, iss := range rep.Issues {
		rep.Counts[iss.Severity]++
	}
	rep.Healthy = len(rep.Issues) == 0
	sort.SliceStable(rep.Issues, func(a, b int) bool {
		ia, ib := rep.Issues[a], rep.Issues[b]
		if healthSevRank[ia.Severity] != healthSevRank[ib.Severity] {
			return healthSevRank[ia.Severity] > healthSevRank[ib.Severity]
		}
		if ia.Category != ib.Category {
			return ia.Category < ib.Category
		}
		return ia.Name < ib.Name
	})
	return rep, nil
}

// podHealth returns an issue for a pod that is broken or stuck, or ok=false.
func podHealth(pod *corev1.Pod, now time.Time) (HealthIssue, bool) {
	if pod.Status.Phase == corev1.PodSucceeded {
		return HealthIssue{}, false
	}
	base := HealthIssue{Category: "Pod", Kind: "Pod", Namespace: pod.Namespace, Name: pod.Name}

	statuses := append(append([]corev1.ContainerStatus{}, pod.Status.InitContainerStatuses...), pod.Status.ContainerStatuses...)

	// OOMKilled takes precedence over a generic crash-loop label — it names the
	// actual cause (memory) and matters even if the pod has since recovered.
	// Critical while still down, high once running again.
	for _, cs := range statuses {
		if cs.LastTerminationState.Terminated != nil && cs.LastTerminationState.Terminated.Reason == "OOMKilled" {
			sev := "high"
			if cs.State.Waiting != nil || cs.State.Terminated != nil {
				sev = "critical"
			}
			base.Severity, base.Reason = sev, "OOMKilled"
			base.Detail = fmt.Sprintf("container %q was OOM-killed (%d restarts) — raise its memory limit", cs.Name, cs.RestartCount)
			return base, true
		}
	}

	// Container-level failures (crashloop, image pull, config errors).
	for _, cs := range statuses {
		if cs.State.Waiting != nil {
			if sev, ok := waitingSeverity[cs.State.Waiting.Reason]; ok {
				base.Severity, base.Reason = sev, cs.State.Waiting.Reason
				base.Detail = fmt.Sprintf("container %q: %s", cs.Name, cs.State.Waiting.Message)
				return base, true
			}
		}
	}

	// Unschedulable: pending with no node assigned.
	if pod.Status.Phase == corev1.PodPending && pod.Spec.NodeName == "" {
		if now.Sub(pod.CreationTimestamp.Time) > time.Minute {
			base.Severity, base.Reason, base.Detail = "high", "Unschedulable", "pending — no node has been assigned"
			return base, true
		}
		return HealthIssue{}, false
	}

	// Flapping: currently up but has restarted many times.
	for _, cs := range statuses {
		if cs.RestartCount >= 5 {
			base.Severity, base.Reason = "medium", "Restarting"
			base.Detail = fmt.Sprintf("container %q has restarted %d times", cs.Name, cs.RestartCount)
			return base, true
		}
	}

	// Running but not Ready for a while.
	if pod.Status.Phase == corev1.PodRunning && now.Sub(pod.CreationTimestamp.Time) > 5*time.Minute {
		for _, cond := range pod.Status.Conditions {
			if cond.Type == corev1.PodReady && cond.Status != corev1.ConditionTrue {
				base.Severity, base.Reason, base.Detail = "medium", "NotReady", "running but not passing readiness"
				return base, true
			}
		}
	}
	return HealthIssue{}, false
}

// jobFailed reports whether a Job has a terminal Failed condition.
func jobFailed(j *batchv1.Job) bool {
	for _, cond := range j.Status.Conditions {
		if cond.Type == batchv1.JobFailed && cond.Status == corev1.ConditionTrue {
			return true
		}
	}
	return false
}
