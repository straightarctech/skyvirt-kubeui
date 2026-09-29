package k8s

import (
	"context"
	"fmt"
	"sort"

	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// WorkloadUsage compares a workload's live resource usage to what it requests.
type WorkloadUsage struct {
	Namespace  string   `json:"namespace"`
	Kind       string   `json:"kind"`
	Name       string   `json:"name"`
	CPUUsage   string   `json:"cpu_usage"`
	CPURequest string   `json:"cpu_request"`
	CPUPct     int      `json:"cpu_pct"` // usage/request %, -1 when no request set
	MemUsage   string   `json:"mem_usage"`
	MemRequest string   `json:"mem_request"`
	MemPct     int      `json:"mem_pct"`
	Severity   string   `json:"severity"` // high | medium | low
	Flags      []string `json:"flags"`
}

// RightsizeReport summarises requests-vs-usage across the cluster.
type RightsizeReport struct {
	Workloads        []WorkloadUsage `json:"workloads"`
	Analyzed         int             `json:"analyzed"`
	NoRequests       int             `json:"no_requests"`
	UnderProvisioned int             `json:"under_provisioned"`
	OverProvisioned  int             `json:"over_provisioned"`
}

type usageAcc struct {
	ns, kind, name                 string
	cpuUse, cpuReq, memUse, memReq int64 // cpu in milli, mem in bytes
}

// Rightsize compares each workload's live usage (from metrics-server) to its
// resource requests and flags workloads with no requests set, usage over the
// request (OOM/throttle risk), or usage far under it (over-provisioned). Usage
// is a point-in-time reading — a single sample, not a percentile — so treat it
// as a pointer, not a precise recommendation. Read-only.
func (c *Client) Rightsize(ctx context.Context) (*RightsizeReport, error) {
	if c.MetricsClient == nil {
		return nil, fmt.Errorf("metrics-server is not available")
	}
	metricsList, err := c.MetricsClient.MetricsV1beta1().PodMetricses("").List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("listing pod metrics: %w", err)
	}
	// Per-pod usage sums (across containers).
	type cpuMem struct{ cpu, mem int64 }
	podUse := map[string]cpuMem{}
	for i := range metricsList.Items {
		m := &metricsList.Items[i]
		var cu, mu int64
		for _, cm := range m.Containers {
			cu += cm.Usage.Cpu().MilliValue()
			mu += cm.Usage.Memory().Value()
		}
		podUse[m.Namespace+"/"+m.Name] = cpuMem{cu, mu}
	}

	pods, err := c.Clientset.CoreV1().Pods("").List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	accs := map[string]*usageAcc{}
	for i := range pods.Items {
		pod := &pods.Items[i]
		if systemNamespaces[pod.Namespace] {
			continue
		}
		use, ok := podUse[pod.Namespace+"/"+pod.Name]
		if !ok {
			continue // no metrics yet (just started / terminating)
		}
		key := workloadKey(pod)
		a := accs[key]
		if a == nil {
			kind, name := workloadOf(pod)
			a = &usageAcc{ns: pod.Namespace, kind: kind, name: name}
			accs[key] = a
		}
		a.cpuUse += use.cpu
		a.memUse += use.mem
		for _, ct := range pod.Spec.Containers {
			a.cpuReq += ct.Resources.Requests.Cpu().MilliValue()
			a.memReq += ct.Resources.Requests.Memory().Value()
		}
	}

	rep := &RightsizeReport{Workloads: []WorkloadUsage{}}
	for _, a := range accs {
		rep.Analyzed++
		w := WorkloadUsage{
			Namespace: a.ns, Kind: a.kind, Name: a.name,
			CPUUsage:   resource.NewMilliQuantity(a.cpuUse, resource.DecimalSI).String(),
			CPURequest: cpuReqStr(a.cpuReq),
			MemUsage:   resource.NewQuantity(a.memUse, resource.BinarySI).String(),
			MemRequest: memReqStr(a.memReq),
			CPUPct:     pct(a.cpuUse, a.cpuReq),
			MemPct:     pct(a.memUse, a.memReq),
			Severity:   "low",
		}
		flagged := false
		// No requests → no scheduling/QoS guarantee.
		if a.cpuReq == 0 {
			w.Flags = append(w.Flags, "no CPU request")
			w.Severity = worstSev(w.Severity, "medium")
			flagged = true
		}
		if a.memReq == 0 {
			w.Flags = append(w.Flags, "no memory request")
			w.Severity = worstSev(w.Severity, "medium")
			flagged = true
		}
		if a.cpuReq == 0 || a.memReq == 0 {
			rep.NoRequests++
		}
		// Usage over request.
		if a.memReq > 0 && a.memUse > a.memReq {
			w.Flags = append(w.Flags, "memory usage over request (OOM risk)")
			w.Severity = worstSev(w.Severity, "high")
			rep.UnderProvisioned++
			flagged = true
		} else if a.cpuReq > 0 && a.cpuUse > a.cpuReq {
			w.Flags = append(w.Flags, "CPU usage over request (throttling)")
			w.Severity = worstSev(w.Severity, "medium")
			rep.UnderProvisioned++
			flagged = true
		}
		// Far under request → over-provisioned (only when a real request exists).
		over := false
		if a.cpuReq >= 10 && a.cpuUse*5 < a.cpuReq {
			w.Flags = append(w.Flags, "CPU over-provisioned (<20% used)")
			over = true
		}
		if a.memReq >= 16*1024*1024 && a.memUse*5 < a.memReq {
			w.Flags = append(w.Flags, "memory over-provisioned (<20% used)")
			over = true
		}
		if over {
			rep.OverProvisioned++
			flagged = true
		}
		if flagged {
			rep.Workloads = append(rep.Workloads, w)
		}
	}

	sev := map[string]int{"high": 3, "medium": 2, "low": 1}
	sort.SliceStable(rep.Workloads, func(i, j int) bool {
		if sev[rep.Workloads[i].Severity] != sev[rep.Workloads[j].Severity] {
			return sev[rep.Workloads[i].Severity] > sev[rep.Workloads[j].Severity]
		}
		if rep.Workloads[i].Namespace != rep.Workloads[j].Namespace {
			return rep.Workloads[i].Namespace < rep.Workloads[j].Namespace
		}
		return rep.Workloads[i].Name < rep.Workloads[j].Name
	})
	return rep, nil
}

func pct(usage, request int64) int {
	if request <= 0 {
		return -1
	}
	return int(usage * 100 / request)
}

func cpuReqStr(milli int64) string {
	if milli == 0 {
		return "—"
	}
	return resource.NewMilliQuantity(milli, resource.DecimalSI).String()
}

func memReqStr(b int64) string {
	if b == 0 {
		return "—"
	}
	return resource.NewQuantity(b, resource.BinarySI).String()
}

func worstSev(a, b string) string {
	rank := map[string]int{"low": 1, "medium": 2, "high": 3}
	if rank[b] > rank[a] {
		return b
	}
	return a
}
