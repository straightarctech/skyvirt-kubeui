package k8s

import (
	"context"
	"fmt"
	"sort"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// OrphanItem is one resource worth reviewing: a Service that routes nowhere or a
// PersistentVolumeClaim nothing mounts.
type OrphanItem struct {
	Severity  string `json:"severity"` // medium | low
	Category  string `json:"category"` // Service | PersistentVolumeClaim
	Kind      string `json:"kind"`
	Namespace string `json:"namespace"`
	Name      string `json:"name"`
	Detail    string `json:"detail"`
}

// OrphanReport lists broken/unused resources.
type OrphanReport struct {
	Items         []OrphanItem `json:"items"`
	DeadServices  int          `json:"dead_services"`
	UnusedPVCs    int          `json:"unused_pvcs"`
	UnusedStorage string       `json:"unused_storage,omitempty"` // human total, e.g. "40Gi"
}

// OrphanedResources finds Services whose selector matches no ready endpoints
// (traffic to them blackholes) and bound PersistentVolumeClaims that no pod
// mounts (wasted storage). It is read-only — a review list, not an auto-cleanup.
func (c *Client) OrphanedResources(ctx context.Context) (*OrphanReport, error) {
	rep := &OrphanReport{Items: []OrphanItem{}}

	// --- Services with no endpoints ---
	svcs, err := c.Clientset.CoreV1().Services("").List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	eps, err := c.Clientset.CoreV1().Endpoints("").List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	ready := map[string]int{} // ns/name -> ready address count
	for i := range eps.Items {
		e := &eps.Items[i]
		n := 0
		for _, ss := range e.Subsets {
			n += len(ss.Addresses)
		}
		ready[e.Namespace+"/"+e.Name] = n
	}
	for i := range svcs.Items {
		s := &svcs.Items[i]
		// Only selector-backed cluster services are expected to have endpoints.
		if len(s.Spec.Selector) == 0 || s.Spec.Type == corev1.ServiceTypeExternalName {
			continue
		}
		if ready[s.Namespace+"/"+s.Name] == 0 {
			rep.Items = append(rep.Items, OrphanItem{Severity: "medium", Category: "Service", Kind: "Service",
				Namespace: s.Namespace, Name: s.Name,
				Detail: "no ready endpoints — its selector matches no running pods, so traffic blackholes"})
			rep.DeadServices++
		}
	}

	// --- Bound PVCs no pod mounts ---
	pods, err := c.Clientset.CoreV1().Pods("").List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	mounted := map[string]bool{}
	for i := range pods.Items {
		pod := &pods.Items[i]
		for _, v := range pod.Spec.Volumes {
			if v.PersistentVolumeClaim != nil {
				mounted[pod.Namespace+"/"+v.PersistentVolumeClaim.ClaimName] = true
			}
		}
	}
	pvcs, err := c.Clientset.CoreV1().PersistentVolumeClaims("").List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	unusedBytes := int64(0)
	for i := range pvcs.Items {
		pvc := &pvcs.Items[i]
		if pvc.Status.Phase != corev1.ClaimBound {
			continue // pending/lost is a health issue, not an orphan
		}
		if mounted[pvc.Namespace+"/"+pvc.Name] {
			continue
		}
		size := pvc.Status.Capacity[corev1.ResourceStorage]
		rep.Items = append(rep.Items, OrphanItem{Severity: "low", Category: "PersistentVolumeClaim", Kind: "PersistentVolumeClaim",
			Namespace: pvc.Namespace, Name: pvc.Name,
			Detail: fmt.Sprintf("bound (%s) but not mounted by any pod — wasted storage", size.String())})
		rep.UnusedPVCs++
		unusedBytes += size.Value()
	}
	if unusedBytes > 0 {
		q := resourceQuantityFromBytes(unusedBytes)
		rep.UnusedStorage = q
	}

	sort.SliceStable(rep.Items, func(a, b int) bool {
		if rep.Items[a].Severity != rep.Items[b].Severity {
			return rep.Items[a].Severity == "medium" // medium before low
		}
		if rep.Items[a].Namespace != rep.Items[b].Namespace {
			return rep.Items[a].Namespace < rep.Items[b].Namespace
		}
		return rep.Items[a].Name < rep.Items[b].Name
	})
	return rep, nil
}

// resourceQuantityFromBytes renders a byte count as a binary-suffixed size.
func resourceQuantityFromBytes(b int64) string {
	const unit = 1024
	if b < unit {
		return fmt.Sprintf("%dB", b)
	}
	div, exp := int64(unit), 0
	for n := b / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f%ci", float64(b)/float64(div), "KMGTPE"[exp])
}
