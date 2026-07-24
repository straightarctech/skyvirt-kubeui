package audit

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"io"
	"os"
	"strings"
	"sync/atomic"
	"time"

	"go.uber.org/zap"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
)

const auditCMName = "kubeui-audit-log"

// ConfigMapStore is a durable audit backend that needs no external database: a
// fast in-memory ring, periodically flushed (gzip'd) to a ConfigMap in KubeUI's
// namespace and reloaded on start. The audit trail survives a pod restart —
// air-gap friendly, no CRD, no DB. Set DATABASE_URL for the higher-volume,
// queryable Postgres backend instead.
type ConfigMapStore struct {
	mem    *MemoryStore
	cs     kubernetes.Interface
	ns     string
	logger *zap.Logger
	dirty  atomic.Bool
}

func NewConfigMapStore(cs kubernetes.Interface, capacity int, logger *zap.Logger) *ConfigMapStore {
	s := &ConfigMapStore{mem: NewMemoryStore(capacity), cs: cs, ns: auditNamespace(), logger: logger}
	s.load(context.Background())
	return s
}

func (s *ConfigMapStore) Record(e Entry) {
	s.mem.Record(e)
	s.dirty.Store(true)
}

func (s *ConfigMapStore) List(limit, offset int) ([]Entry, int) { return s.mem.List(limit, offset) }

// Run flushes the ring to the ConfigMap when dirty, on an interval and on cancel.
func (s *ConfigMapStore) Run(ctx context.Context) {
	t := time.NewTicker(15 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			s.Flush(context.Background())
			return
		case <-t.C:
			if s.dirty.Swap(false) {
				s.Flush(ctx)
			}
		}
	}
}

type auditBlob struct {
	Entries []Entry `json:"entries"`
	NextID  int64   `json:"next_id"`
}

// Flush persists the current ring to the ConfigMap. Safe to call directly (e.g.
// on shutdown).
func (s *ConfigMapStore) Flush(ctx context.Context) {
	entries, nextID := s.mem.snapshot()
	raw, err := json.Marshal(auditBlob{Entries: entries, NextID: nextID})
	if err != nil {
		return
	}
	data := gzipBytes(raw)
	cms := s.cs.CoreV1().ConfigMaps(s.ns)
	cm, err := cms.Get(ctx, auditCMName, metav1.GetOptions{})
	if apierrors.IsNotFound(err) {
		_, err = cms.Create(ctx, &corev1.ConfigMap{
			ObjectMeta: metav1.ObjectMeta{
				Name: auditCMName, Namespace: s.ns,
				Labels: map[string]string{"app.kubernetes.io/managed-by": "kubeui"},
			},
			BinaryData: map[string][]byte{"log": data},
		}, metav1.CreateOptions{})
	} else if err == nil {
		if cm.BinaryData == nil {
			cm.BinaryData = map[string][]byte{}
		}
		cm.BinaryData["log"] = data
		_, err = cms.Update(ctx, cm, metav1.UpdateOptions{})
	}
	if err != nil && s.logger != nil {
		s.logger.Warn("audit flush to configmap failed", zap.Error(err))
	}
}

func (s *ConfigMapStore) load(ctx context.Context) {
	cm, err := s.cs.CoreV1().ConfigMaps(s.ns).Get(ctx, auditCMName, metav1.GetOptions{})
	if err != nil {
		return // none yet (first run) or unreadable — start fresh
	}
	raw := gunzipBytes(cm.BinaryData["log"])
	if raw == nil {
		return
	}
	var blob auditBlob
	if json.Unmarshal(raw, &blob) != nil {
		return
	}
	s.mem.restore(blob.Entries, blob.NextID)
	if s.logger != nil {
		s.logger.Info("audit: restored from configmap", zap.Int("entries", len(blob.Entries)))
	}
}

func gzipBytes(b []byte) []byte {
	var buf bytes.Buffer
	w := gzip.NewWriter(&buf)
	_, _ = w.Write(b)
	_ = w.Close()
	return buf.Bytes()
}

func gunzipBytes(b []byte) []byte {
	r, err := gzip.NewReader(bytes.NewReader(b))
	if err != nil {
		return nil
	}
	out, _ := io.ReadAll(r)
	return out
}

func auditNamespace() string {
	if b, err := os.ReadFile("/var/run/secrets/kubernetes.io/serviceaccount/namespace"); err == nil {
		if ns := strings.TrimSpace(string(b)); ns != "" {
			return ns
		}
	}
	if ns := os.Getenv("POD_NAMESPACE"); ns != "" {
		return ns
	}
	return "skyvirthci-kubeui"
}
