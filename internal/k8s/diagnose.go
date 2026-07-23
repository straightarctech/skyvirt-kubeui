package k8s

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"sort"
	"strings"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// Finding is one diagnosed issue (or an all-clear) about a resource.
type Finding struct {
	Severity   string   `json:"severity"` // critical | warning | info | ok
	Title      string   `json:"title"`
	Detail     string   `json:"detail,omitempty"`
	Evidence   []string `json:"evidence,omitempty"`
	Suggestion string   `json:"suggestion,omitempty"`
}

// Diagnosis is the assembled troubleshooting report for a pod.
type Diagnosis struct {
	Namespace string    `json:"namespace"`
	Name      string    `json:"name"`
	Phase     string    `json:"phase"`
	Node      string    `json:"node"`
	Healthy   bool      `json:"healthy"`
	Findings  []Finding `json:"findings"`
}

// DiagnosePod gathers a pod's container states, related events, node conditions,
// and (for failing containers) previous-instance logs, then applies a rule set
// to produce human-readable findings with suggested fixes.
func (c *Client) DiagnosePod(ctx context.Context, namespace, name string) (*Diagnosis, error) {
	pod, err := c.Clientset.CoreV1().Pods(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, fmt.Errorf("getting pod %s/%s: %w", namespace, name, err)
	}
	return c.diagnosePodObject(ctx, pod), nil
}

// diagnosePodObject runs the rule set against an already-fetched pod, so a
// workload diagnosis can reuse it per-pod without re-fetching.
func (c *Client) diagnosePodObject(ctx context.Context, pod *corev1.Pod) *Diagnosis {
	namespace, name := pod.Namespace, pod.Name
	d := &Diagnosis{Namespace: namespace, Name: name, Phase: string(pod.Status.Phase), Node: pod.Spec.NodeName}

	// Warning events for this pod, most recent first.
	warnEvents := c.podWarningEvents(ctx, namespace, name)

	// --- Container-level rules ---
	for _, cs := range pod.Status.ContainerStatuses {
		if w := cs.State.Waiting; w != nil {
			switch w.Reason {
			case "CrashLoopBackOff":
				f := Finding{
					Severity:   "critical",
					Title:      fmt.Sprintf("Container %q is crash-looping", cs.Name),
					Detail:     fmt.Sprintf("%d restarts. %s", cs.RestartCount, w.Message),
					Suggestion: "Inspect the previous-instance logs below and the container's exit code. Common causes: the process exits immediately (bad command/args), a missing dependency or config, or a failing readiness of a required service.",
				}
				if t := cs.LastTerminationState.Terminated; t != nil {
					f.Evidence = append(f.Evidence, fmt.Sprintf("last exit: code %d (%s)", t.ExitCode, t.Reason))
				}
				if logs := c.previousLogs(ctx, namespace, name, cs.Name, 40); logs != "" {
					f.Evidence = append(f.Evidence, "previous logs (tail):\n"+logs)
				}
				d.Findings = append(d.Findings, f)
			case "ImagePullBackOff", "ErrImagePull", "InvalidImageName":
				d.Findings = append(d.Findings, Finding{
					Severity:   "critical",
					Title:      fmt.Sprintf("Image pull failing for %q", cs.Name),
					Detail:     fmt.Sprintf("image %s — %s", cs.Image, w.Message),
					Evidence:   pickEvents(warnEvents, "Failed", "pull"),
					Suggestion: "Verify the image name/tag exists and the registry is reachable. If private, check the pod's imagePullSecrets and that the node can authenticate.",
				})
			case "CreateContainerConfigError":
				d.Findings = append(d.Findings, Finding{
					Severity:   "critical",
					Title:      fmt.Sprintf("Container %q config error", cs.Name),
					Detail:     w.Message,
					Suggestion: "A referenced ConfigMap or Secret (env/volume) is likely missing or has the wrong key. Confirm it exists in this namespace.",
				})
			case "CreateContainerError", "RunContainerError":
				d.Findings = append(d.Findings, Finding{
					Severity: "critical",
					Title:    fmt.Sprintf("Container %q failed to start", cs.Name),
					Detail:   w.Message,
				})
			}
		}
		if t := cs.LastTerminationState.Terminated; t != nil && t.Reason == "OOMKilled" {
			d.Findings = append(d.Findings, Finding{
				Severity:   "critical",
				Title:      fmt.Sprintf("Container %q was OOM-killed", cs.Name),
				Detail:     "The container exceeded its memory limit and was terminated by the kernel.",
				Suggestion: "Raise the container's memory limit, or reduce its memory use. Check for a leak if this recurs.",
			})
		}
		// Running but never becoming ready → readiness probe likely failing.
		if cs.State.Running != nil && !cs.Ready {
			f := Finding{
				Severity:   "warning",
				Title:      fmt.Sprintf("Container %q is running but not Ready", cs.Name),
				Suggestion: "The readiness probe is failing. Verify the probe path/port and that the app is actually listening.",
				Evidence:   pickEvents(warnEvents, "Unhealthy", "Readiness"),
			}
			d.Findings = append(d.Findings, f)
		}
		if cs.RestartCount >= 5 && cs.State.Waiting == nil {
			d.Findings = append(d.Findings, Finding{
				Severity: "info",
				Title:    fmt.Sprintf("Container %q has restarted %d times", cs.Name, cs.RestartCount),
				Detail:   "Currently stable, but the restart history suggests intermittent failures.",
			})
		}
	}

	// --- Pod-level: unschedulable ---
	if pod.Status.Phase == corev1.PodPending && pod.Spec.NodeName == "" {
		sched := pickEvents(warnEvents, "FailedScheduling")
		f := Finding{
			Severity:   "critical",
			Title:      "Pod cannot be scheduled",
			Evidence:   sched,
			Suggestion: schedulingHint(sched),
		}
		d.Findings = append(d.Findings, f)
	}

	// --- Node-level ---
	if pod.Spec.NodeName != "" {
		if node, err := c.Clientset.CoreV1().Nodes().Get(ctx, pod.Spec.NodeName, metav1.GetOptions{}); err == nil {
			for _, cond := range node.Status.Conditions {
				switch {
				case cond.Type == corev1.NodeReady && cond.Status != corev1.ConditionTrue:
					d.Findings = append(d.Findings, Finding{
						Severity: "critical",
						Title:    fmt.Sprintf("Node %q is not Ready", node.Name),
						Detail:   cond.Message,
					})
				case cond.Type != corev1.NodeReady && cond.Status == corev1.ConditionTrue &&
					strings.HasSuffix(string(cond.Type), "Pressure"):
					d.Findings = append(d.Findings, Finding{
						Severity:   "warning",
						Title:      fmt.Sprintf("Node %q reports %s", node.Name, cond.Type),
						Detail:     cond.Message,
						Suggestion: "The pod may be evicted or throttled. Free resources on the node or reschedule elsewhere.",
					})
				}
			}
			if node.Spec.Unschedulable {
				d.Findings = append(d.Findings, Finding{
					Severity: "info",
					Title:    fmt.Sprintf("Node %q is cordoned", node.Name),
					Detail:   "No new pods will schedule here until it is uncordoned.",
				})
			}
		}
	}

	// Surface remaining warning events not already captured.
	if extra := uncoveredWarnings(warnEvents, d.Findings); len(extra) > 0 {
		d.Findings = append(d.Findings, Finding{
			Severity: "info",
			Title:    "Recent warning events",
			Evidence: extra,
		})
	}

	// All clear.
	if !hasIssue(d.Findings) {
		d.Healthy = true
		d.Findings = append([]Finding{{
			Severity: "ok",
			Title:    "No problems detected",
			Detail:   fmt.Sprintf("Pod is %s and all containers are ready.", d.Phase),
		}}, d.Findings...)
	}
	return d
}

// WorkloadDiagnosis aggregates the diagnoses of the pods behind a controller.
type WorkloadDiagnosis struct {
	Kind      string      `json:"kind"`
	Namespace string      `json:"namespace"`
	Name      string      `json:"name"`
	Healthy   bool        `json:"healthy"`
	Summary   string      `json:"summary"`
	Findings  []Finding   `json:"findings"` // workload-level
	Pods      []Diagnosis `json:"pods"`     // per-pod, worst first (capped)
}

const maxDiagnosedPods = 8

// DiagnoseWorkload resolves a Deployment/StatefulSet/DaemonSet's pods and
// diagnoses each, returning workload-level findings (replica health, no pods)
// plus the per-pod reports sorted worst-first.
func (c *Client) DiagnoseWorkload(ctx context.Context, kind, namespace, name string) (*WorkloadDiagnosis, error) {
	selector, desired, ready, err := c.workloadSelector(ctx, kind, namespace, name)
	if err != nil {
		return nil, err
	}

	wd := &WorkloadDiagnosis{Kind: kind, Namespace: namespace, Name: name}

	if desired > 0 && ready < desired {
		wd.Findings = append(wd.Findings, Finding{
			Severity:   sevFor(ready, desired),
			Title:      fmt.Sprintf("%d of %d replicas available", ready, desired),
			Suggestion: "Diagnose the unhealthy pods below for the underlying cause.",
		})
	}

	list, err := c.Clientset.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{LabelSelector: selector})
	if err != nil {
		return nil, fmt.Errorf("listing pods for %s %s/%s: %w", kind, namespace, name, err)
	}
	if len(list.Items) == 0 {
		wd.Summary = "No pods found"
		wd.Findings = append(wd.Findings, Finding{
			Severity:   "warning",
			Title:      "No pods found for this workload",
			Suggestion: "The controller may be scaled to 0, or its selector matches no pods. Check the replica count and selector.",
		})
		return wd, nil
	}

	var diags []Diagnosis
	unhealthy := 0
	for i := range list.Items {
		dg := c.diagnosePodObject(ctx, &list.Items[i])
		if !dg.Healthy {
			unhealthy++
		}
		diags = append(diags, *dg)
	}

	// Worst first: unhealthy before healthy, more criticals first.
	sort.SliceStable(diags, func(i, j int) bool {
		if diags[i].Healthy != diags[j].Healthy {
			return !diags[i].Healthy
		}
		return criticalCount(diags[i]) > criticalCount(diags[j])
	})
	if len(diags) > maxDiagnosedPods {
		diags = diags[:maxDiagnosedPods]
	}

	wd.Pods = diags
	wd.Healthy = unhealthy == 0 && len(wd.Findings) == 0
	wd.Summary = fmt.Sprintf("%d of %d pods unhealthy", unhealthy, len(list.Items))
	if wd.Healthy {
		wd.Summary = fmt.Sprintf("All %d pods healthy", len(list.Items))
	}
	return wd, nil
}

// workloadSelector returns the pod label selector and desired/ready replica
// counts for a Deployment, StatefulSet, or DaemonSet.
func (c *Client) workloadSelector(ctx context.Context, kind, namespace, name string) (string, int32, int32, error) {
	switch kind {
	case "Deployment":
		o, err := c.Clientset.AppsV1().Deployments(namespace).Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			return "", 0, 0, fmt.Errorf("getting deployment %s/%s: %w", namespace, name, err)
		}
		desired := int32(1)
		if o.Spec.Replicas != nil {
			desired = *o.Spec.Replicas
		}
		return metav1.FormatLabelSelector(o.Spec.Selector), desired, o.Status.AvailableReplicas, nil
	case "StatefulSet":
		o, err := c.Clientset.AppsV1().StatefulSets(namespace).Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			return "", 0, 0, fmt.Errorf("getting statefulset %s/%s: %w", namespace, name, err)
		}
		desired := int32(1)
		if o.Spec.Replicas != nil {
			desired = *o.Spec.Replicas
		}
		return metav1.FormatLabelSelector(o.Spec.Selector), desired, o.Status.ReadyReplicas, nil
	case "DaemonSet":
		o, err := c.Clientset.AppsV1().DaemonSets(namespace).Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			return "", 0, 0, fmt.Errorf("getting daemonset %s/%s: %w", namespace, name, err)
		}
		return metav1.FormatLabelSelector(o.Spec.Selector), o.Status.DesiredNumberScheduled, o.Status.NumberReady, nil
	default:
		return "", 0, 0, fmt.Errorf("diagnose not supported for kind %q", kind)
	}
}

func sevFor(ready, desired int32) string {
	if ready == 0 {
		return "critical"
	}
	return "warning"
}

func criticalCount(d Diagnosis) int {
	n := 0
	for _, f := range d.Findings {
		if f.Severity == "critical" {
			n++
		}
	}
	return n
}

func (c *Client) podWarningEvents(ctx context.Context, namespace, name string) []corev1.Event {
	list, err := c.Clientset.CoreV1().Events(namespace).List(ctx, metav1.ListOptions{
		FieldSelector: "involvedObject.name=" + name,
	})
	if err != nil {
		return nil
	}
	evs := make([]corev1.Event, 0, len(list.Items))
	for _, e := range list.Items {
		if e.Type == corev1.EventTypeWarning {
			evs = append(evs, e)
		}
	}
	sort.Slice(evs, func(i, j int) bool { return evs[i].LastTimestamp.After(evs[j].LastTimestamp.Time) })
	return evs
}

func (c *Client) previousLogs(ctx context.Context, namespace, name, container string, tail int64) string {
	req := c.Clientset.CoreV1().Pods(namespace).GetLogs(name, &corev1.PodLogOptions{
		Container: container, Previous: true, TailLines: &tail,
	})
	stream, err := req.Stream(ctx)
	if err != nil {
		return ""
	}
	defer stream.Close()
	var buf bytes.Buffer
	_, _ = io.Copy(&buf, io.LimitReader(stream, 64*1024))
	return strings.TrimSpace(buf.String())
}

// pickEvents returns messages of warning events whose reason or message contains
// any of the substrings (case-insensitive), newest first, capped at 3.
func pickEvents(evs []corev1.Event, needles ...string) []string {
	var out []string
	for _, e := range evs {
		hay := strings.ToLower(e.Reason + " " + e.Message)
		for _, n := range needles {
			if strings.Contains(hay, strings.ToLower(n)) {
				out = append(out, strings.TrimSpace(e.Message))
				break
			}
		}
		if len(out) >= 3 {
			break
		}
	}
	return out
}

func uncoveredWarnings(evs []corev1.Event, found []Finding) []string {
	covered := strings.ToLower(fmt.Sprint(found))
	var out []string
	for _, e := range evs {
		msg := strings.TrimSpace(e.Message)
		if msg == "" || strings.Contains(covered, strings.ToLower(msg)) {
			continue
		}
		out = append(out, fmt.Sprintf("%s: %s", e.Reason, msg))
		if len(out) >= 3 {
			break
		}
	}
	return out
}

func schedulingHint(evidence []string) string {
	joined := strings.ToLower(strings.Join(evidence, " "))
	switch {
	case strings.Contains(joined, "insufficient cpu"), strings.Contains(joined, "insufficient memory"):
		return "No node has enough free CPU/memory. Lower the pod's requests, free capacity, or add a node."
	case strings.Contains(joined, "taint"):
		return "Nodes are tainted against this pod. Add a matching toleration, or target a schedulable node."
	case strings.Contains(joined, "affinity"), strings.Contains(joined, "selector"):
		return "Node affinity / nodeSelector matches no node. Relax the constraint or label a node to match."
	case strings.Contains(joined, "volume"), strings.Contains(joined, "pvc"):
		return "A required volume/PVC can't be bound to a node. Check the PVC is Bound and its zone matches."
	default:
		return "Check the scheduler message above for the specific constraint."
	}
}

func hasIssue(findings []Finding) bool {
	for _, f := range findings {
		if f.Severity == "critical" || f.Severity == "warning" {
			return true
		}
	}
	return false
}
