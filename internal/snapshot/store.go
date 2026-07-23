// Package snapshot persists point-in-time snapshots of Kubernetes resources so
// KubeUI can show a drift *timeline* — how a resource's spec changed over time,
// a diff between any two points, not just live-vs-last-applied.
//
// The default store keeps history in ConfigMaps in KubeUI's own namespace (one
// per tracked resource, a gzip'd ring of the last N snapshots) — air-gap native,
// survives a restart, needs no CRD and no external database. Snapshots store the
// noise-stripped live object; because defaulting noise is identical across
// points, point-to-point diffs come out clean without pruning to last-applied.
package snapshot

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"sort"
	"time"

	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"sigs.k8s.io/yaml"
)

// maxSnapshotsPerResource bounds the ring; maxContentBytes caps a single snapshot
// (a ConfigMap tops out at ~1 MB — larger resources need the Postgres tier).
const (
	maxSnapshotsPerResource = 20
	maxContentBytes         = 256 * 1024
	cmSizeBudget            = 900 * 1024
)

// Snapshot is one point-in-time capture of a resource's noise-stripped spec.
type Snapshot struct {
	ID         string    `json:"id"` // unix-nano string
	Kind       string    `json:"kind"`
	APIVersion string    `json:"api_version"`
	Namespace  string    `json:"namespace"`
	Name       string    `json:"name"`
	Taken      time.Time `json:"taken"`
	Hash       string    `json:"hash"`
	Source     string    `json:"source"` // periodic | on-demand | pre-revert
	Content    string    `json:"content,omitempty"` // stripped YAML (omitted in list views)
}

// TrackedRef summarizes one resource that has a snapshot timeline.
type TrackedRef struct {
	Kind      string    `json:"kind"`
	Namespace string    `json:"namespace"`
	Name      string    `json:"name"`
	Count     int       `json:"count"`
	Latest    time.Time `json:"latest"`
}

// Store persists and reads snapshot timelines.
type Store interface {
	// Put appends a snapshot, deduped by hash against the latest (returns false if
	// unchanged). Prunes to the retention bound.
	Put(ctx context.Context, s Snapshot) (bool, error)
	// Timeline returns a resource's snapshots, newest first (with Content).
	Timeline(ctx context.Context, kind, namespace, name string) ([]Snapshot, error)
	// List returns every tracked resource (metadata only).
	List(ctx context.Context) ([]TrackedRef, error)
}

func refKey(kind, ns, name string) string { return kind + "|" + ns + "|" + name }

func hashOf(b []byte) string { h := sha256.Sum256(b); return fmt.Sprintf("%x", h[:])[:16] }

func gz(b []byte) []byte {
	var buf bytes.Buffer
	w := gzip.NewWriter(&buf)
	_, _ = w.Write(b)
	_ = w.Close()
	return buf.Bytes()
}

func gunz(b []byte) []byte {
	r, err := gzip.NewReader(bytes.NewReader(b))
	if err != nil {
		return nil
	}
	out, _ := io.ReadAll(r)
	return out
}

// Strip removes status, managedFields and metadata/annotation noise so a snapshot
// reflects the meaningful spec and marshals it to stable YAML. Returns the YAML and
// its hash.
func Strip(obj map[string]any) ([]byte, string) {
	delete(obj, "status")
	if md, ok := obj["metadata"].(map[string]any); ok {
		for _, k := range []string{"managedFields", "resourceVersion", "uid", "generation", "creationTimestamp", "selfLink"} {
			delete(md, k)
		}
		if ann, ok := md["annotations"].(map[string]any); ok {
			delete(ann, "kubectl.kubernetes.io/last-applied-configuration")
			delete(ann, "deployment.kubernetes.io/revision")
			if len(ann) == 0 {
				delete(md, "annotations")
			}
		}
	}
	b, err := yaml.Marshal(obj)
	if err != nil {
		return nil, ""
	}
	return b, hashOf(b)
}

// ---------------------------------------------------------------------------
// ConfigMapStore — the default: one ConfigMap per resource in KubeUI's namespace
// ---------------------------------------------------------------------------

const (
	snapLabel   = "kubeui.io/snapshot"
	annKind     = "kubeui.io/snap-kind"
	annNS       = "kubeui.io/snap-namespace"
	annName     = "kubeui.io/snap-name"
	annVersion  = "kubeui.io/snap-apiversion"
	indexKey    = "index"
)

type ConfigMapStore struct {
	cs kubernetes.Interface
	ns string // KubeUI's own namespace
}

func NewConfigMapStore(cs kubernetes.Interface, ns string) *ConfigMapStore {
	return &ConfigMapStore{cs: cs, ns: ns}
}

func (c *ConfigMapStore) cmName(kind, ns, name string) string {
	return "kubeui-snap-" + hashOf([]byte(refKey(kind, ns, name)))
}

type indexEntry struct {
	ID     string    `json:"id"`
	Taken  time.Time `json:"taken"`
	Hash   string    `json:"hash"`
	Source string    `json:"source"`
}

func (c *ConfigMapStore) Put(ctx context.Context, s Snapshot) (bool, error) {
	if len(s.Content) > maxContentBytes {
		return false, nil // too large for a ConfigMap; skip (Postgres tier handles these)
	}
	cms := c.cs.CoreV1().ConfigMaps(c.ns)
	name := c.cmName(s.Kind, s.Namespace, s.Name)
	cm, err := cms.Get(ctx, name, metav1.GetOptions{})
	create := false
	if apierrors.IsNotFound(err) {
		create = true
		cm = &corev1.ConfigMap{
			ObjectMeta: metav1.ObjectMeta{
				Name:      name,
				Namespace: c.ns,
				Labels:    map[string]string{"app.kubernetes.io/managed-by": "kubeui", snapLabel: "true"},
				Annotations: map[string]string{
					annKind: s.Kind, annNS: s.Namespace, annName: s.Name, annVersion: s.APIVersion,
				},
			},
		}
	} else if err != nil {
		return false, err
	}
	if cm.BinaryData == nil {
		cm.BinaryData = map[string][]byte{}
	}

	var idx []indexEntry
	if raw := cm.Data[indexKey]; raw != "" {
		_ = json.Unmarshal([]byte(raw), &idx)
	}
	// dedup vs latest
	if len(idx) > 0 && idx[len(idx)-1].Hash == s.Hash {
		return false, nil
	}
	id := fmt.Sprintf("%d", s.Taken.UnixNano())
	cm.BinaryData[id] = gz([]byte(s.Content))
	idx = append(idx, indexEntry{ID: id, Taken: s.Taken, Hash: s.Hash, Source: s.Source})

	// retention: keep last N, and stay under the size budget
	prune := func() {
		for len(idx) > maxSnapshotsPerResource {
			delete(cm.BinaryData, idx[0].ID)
			idx = idx[1:]
		}
		for size(cm) > cmSizeBudget && len(idx) > 1 {
			delete(cm.BinaryData, idx[0].ID)
			idx = idx[1:]
		}
	}
	prune()
	b, _ := json.Marshal(idx)
	if cm.Data == nil {
		cm.Data = map[string]string{}
	}
	cm.Data[indexKey] = string(b)

	if create {
		_, err = cms.Create(ctx, cm, metav1.CreateOptions{})
	} else {
		_, err = cms.Update(ctx, cm, metav1.UpdateOptions{})
	}
	return err == nil, err
}

func size(cm *corev1.ConfigMap) int {
	n := 0
	for _, v := range cm.BinaryData {
		n += len(v)
	}
	for _, v := range cm.Data {
		n += len(v)
	}
	return n
}

func (c *ConfigMapStore) Timeline(ctx context.Context, kind, ns, name string) ([]Snapshot, error) {
	cm, err := c.cs.CoreV1().ConfigMaps(c.ns).Get(ctx, c.cmName(kind, ns, name), metav1.GetOptions{})
	if apierrors.IsNotFound(err) {
		return []Snapshot{}, nil
	}
	if err != nil {
		return nil, err
	}
	var idx []indexEntry
	if raw := cm.Data[indexKey]; raw != "" {
		_ = json.Unmarshal([]byte(raw), &idx)
	}
	out := make([]Snapshot, 0, len(idx))
	for _, e := range idx {
		out = append(out, Snapshot{
			ID: e.ID, Kind: kind, Namespace: ns, Name: name,
			APIVersion: cm.Annotations[annVersion], Taken: e.Taken, Hash: e.Hash, Source: e.Source,
			Content: string(gunz(cm.BinaryData[e.ID])),
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Taken.After(out[j].Taken) }) // newest first
	return out, nil
}

func (c *ConfigMapStore) List(ctx context.Context) ([]TrackedRef, error) {
	list, err := c.cs.CoreV1().ConfigMaps(c.ns).List(ctx, metav1.ListOptions{LabelSelector: snapLabel + "=true"})
	if err != nil {
		return nil, err
	}
	out := make([]TrackedRef, 0, len(list.Items))
	for i := range list.Items {
		cm := &list.Items[i]
		var idx []indexEntry
		if raw := cm.Data[indexKey]; raw != "" {
			_ = json.Unmarshal([]byte(raw), &idx)
		}
		ref := TrackedRef{Kind: cm.Annotations[annKind], Namespace: cm.Annotations[annNS], Name: cm.Annotations[annName], Count: len(idx)}
		if len(idx) > 0 {
			ref.Latest = idx[len(idx)-1].Taken
		}
		out = append(out, ref)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Latest.After(out[j].Latest) })
	return out, nil
}
