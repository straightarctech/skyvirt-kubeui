package snapshot

import (
	"context"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"

	"go.uber.org/zap"
)

// trackLabel opts a namespace into drift-timeline snapshotting. Default off — the
// snapshotter only ever touches namespaces the operator has labelled, so there
// are no surprise etcd writes.
const trackLabel = "kubeui.io/track-drift"

// curatedGVRs — the spec-carrying, hand-managed kinds worth a timeline. Secrets
// are deliberately excluded (never snapshot secret material); ephemeral kinds
// (Jobs, ReplicaSets) are excluded as owned/noisy.
var curatedGVRs = []schema.GroupVersionResource{
	{Group: "apps", Version: "v1", Resource: "deployments"},
	{Group: "apps", Version: "v1", Resource: "statefulsets"},
	{Group: "apps", Version: "v1", Resource: "daemonsets"},
	{Group: "batch", Version: "v1", Resource: "cronjobs"},
	{Group: "", Version: "v1", Resource: "services"},
	{Group: "", Version: "v1", Resource: "configmaps"},
	{Group: "networking.k8s.io", Version: "v1", Resource: "ingresses"},
	{Group: "networking.k8s.io", Version: "v1", Resource: "networkpolicies"},
	{Group: "autoscaling", Version: "v2", Resource: "horizontalpodautoscalers"},
	{Group: "policy", Version: "v1", Resource: "poddisruptionbudgets"},
}

// Snapshotter periodically snapshots the tracked namespaces into the Store.
type Snapshotter struct {
	cs       kubernetes.Interface
	dyn      dynamic.Interface
	store    Store
	logger   *zap.Logger
	interval time.Duration
}

func NewSnapshotter(cs kubernetes.Interface, dyn dynamic.Interface, store Store, logger *zap.Logger) *Snapshotter {
	return &Snapshotter{cs: cs, dyn: dyn, store: store, logger: logger, interval: 45 * time.Second}
}

// Run is the background loop. It reconciles the tracked namespaces on a short
// interval — re-listing and snapshotting, with dedup-by-hash making unchanged
// resources free, so a change is captured within one interval. A poll (rather
// than a watch informer) keeps this simple and robust: no shared-cache mutation,
// no dependency on watch-stream reliability, and List always reads through to
// the current state. Event-driven capture could be layered on later.
func (s *Snapshotter) Run(ctx context.Context) {
	t := time.NewTicker(s.interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			if n, err := s.snapshotTracked(ctx, "reconcile"); err == nil && n > 0 && s.logger != nil {
				s.logger.Info("drift timeline snapshot", zap.Int("new_snapshots", n))
			}
		}
	}
}

func (s *Snapshotter) snapshotTracked(ctx context.Context, source string) (int, error) {
	nss, err := s.cs.CoreV1().Namespaces().List(ctx, metav1.ListOptions{LabelSelector: trackLabel + "=true"})
	if err != nil {
		return 0, err
	}
	total := 0
	for i := range nss.Items {
		n, _ := s.SnapshotNamespace(ctx, nss.Items[i].Name, source)
		total += n
	}
	return total, nil
}

// SnapshotNamespace captures every curated resource in a namespace. Returns the
// number of NEW snapshots stored (unchanged resources dedup to nothing).
func (s *Snapshotter) SnapshotNamespace(ctx context.Context, ns, source string) (int, error) {
	now := time.Now()
	count := 0
	for _, gvr := range curatedGVRs {
		list, err := s.dyn.Resource(gvr).Namespace(ns).List(ctx, metav1.ListOptions{})
		if err != nil {
			continue // GVR unserved / forbidden — skip, never fatal
		}
		for i := range list.Items {
			item := &list.Items[i]
			kind, apiVersion, name := item.GetKind(), item.GetAPIVersion(), item.GetName()
			content, hash := Strip(item.Object)
			if content == nil {
				continue
			}
			ok, _ := s.store.Put(ctx, Snapshot{
				Kind: kind, APIVersion: apiVersion, Namespace: ns, Name: name,
				Taken: now, Hash: hash, Source: source, Content: string(content),
			})
			if ok {
				count++
			}
		}
	}
	return count, nil
}
