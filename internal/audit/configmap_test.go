package audit

import (
	"context"
	"fmt"
	"testing"
	"time"

	"go.uber.org/zap"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"
)

// The ConfigMapStore is the default audit backend when no DATABASE_URL is set,
// and its whole reason to exist is one claim: the audit trail survives a pod
// restart with no external database. An audit log that quietly loses entries is
// worse than none, because it is consulted precisely when someone needs to know
// what happened.

// store returns a ConfigMapStore over a fake cluster, with the namespace pinned
// so the test can look the ConfigMap up itself.
func store(t *testing.T, cs *fake.Clientset, capacity int) *ConfigMapStore {
	t.Helper()
	t.Setenv("POD_NAMESPACE", "kubeui-test")
	return NewConfigMapStore(cs, capacity, zap.NewNop())
}

func entry(action, resource string) Entry {
	return Entry{User: "alice", Action: action, Resource: resource}
}

// TestFlushThenLoad_SurvivesARestart is the headline guarantee, expressed the way
// it actually happens: one process records and flushes, the pod dies, a new
// process starts against the same cluster and must see the same trail.
func TestFlushThenLoad_SurvivesARestart(t *testing.T) {
	cs := fake.NewSimpleClientset()

	first := store(t, cs, 100)
	first.Record(entry("DELETE", "pods/web"))
	first.Record(entry("PATCH", "deployments/api"))
	first.Flush(context.Background())

	// A new process, same cluster.
	second := store(t, cs, 100)
	got, total := second.List(100, 0)
	if total != 2 {
		t.Fatalf("restored %d entries, want 2 — the trail did not survive", total)
	}
	// Newest first, as List orders them.
	if got[0].Resource != "deployments/api" || got[1].Resource != "pods/web" {
		t.Errorf("restored entries in the wrong order: %+v", got)
	}
	if got[1].Action != "DELETE" {
		t.Errorf("the DELETE lost its action: %+v", got[1])
	}
}

// TestRestart_DoesNotReuseEntryIDs: the persisted NextID has to come back with
// the entries. Without it a restarted pod restarts numbering at 1 and the trail
// contains two different events with the same id — which quietly breaks any
// consumer that de-duplicates or pages by id, including the SIEM forwarder.
func TestRestart_DoesNotReuseEntryIDs(t *testing.T) {
	cs := fake.NewSimpleClientset()

	first := store(t, cs, 100)
	first.Record(entry("DELETE", "pods/a"))
	first.Record(entry("DELETE", "pods/b"))
	before, _ := first.List(100, 0)
	highest := before[0].ID
	first.Flush(context.Background())

	second := store(t, cs, 100)
	second.Record(entry("DELETE", "pods/c"))
	after, _ := second.List(100, 0)

	if after[0].ID <= highest {
		t.Errorf("new entry got id %d, which is not above the pre-restart high of %d", after[0].ID, highest)
	}
	seen := map[int64]string{}
	for _, e := range after {
		if prev, dup := seen[e.ID]; dup {
			t.Errorf("id %d used by both %q and %q", e.ID, prev, e.Resource)
		}
		seen[e.ID] = e.Resource
	}
}

// TestFlush_CreatesThenUpdates: the first flush has no ConfigMap to update and
// the second must not create a duplicate.
func TestFlush_CreatesThenUpdates(t *testing.T) {
	cs := fake.NewSimpleClientset()
	s := store(t, cs, 100)

	s.Record(entry("DELETE", "pods/one"))
	s.Flush(context.Background())
	s.Record(entry("DELETE", "pods/two"))
	s.Flush(context.Background())

	list, err := cs.CoreV1().ConfigMaps("kubeui-test").List(context.Background(), metav1.ListOptions{})
	if err != nil {
		t.Fatalf("listing configmaps: %v", err)
	}
	if len(list.Items) != 1 {
		t.Fatalf("got %d ConfigMaps, want exactly 1", len(list.Items))
	}
	if list.Items[0].Name != auditCMName {
		t.Errorf("ConfigMap name = %q, want %q", list.Items[0].Name, auditCMName)
	}

	// The second flush must have replaced the payload, not appended a second key.
	if n := len(list.Items[0].BinaryData); n != 1 {
		t.Errorf("BinaryData has %d keys, want 1", n)
	}

	reloaded := store(t, cs, 100)
	if _, total := reloaded.List(100, 0); total != 2 {
		t.Errorf("reloaded %d entries, want both", total)
	}
}

// TestFlush_StoresCompressed: the payload is gzipped because a ConfigMap is
// capped near 1MB and an audit ring is repetitive text. If it were ever written
// raw, the store would start failing writes at a few thousand entries.
func TestFlush_StoresCompressed(t *testing.T) {
	cs := fake.NewSimpleClientset()
	s := store(t, cs, 2000)
	for i := 0; i < 500; i++ {
		s.Record(entry("DELETE", "pods/repeating-name-that-compresses-well"))
	}
	s.Flush(context.Background())

	cm, err := cs.CoreV1().ConfigMaps("kubeui-test").Get(context.Background(), auditCMName, metav1.GetOptions{})
	if err != nil {
		t.Fatalf("reading the ConfigMap: %v", err)
	}
	blob := cm.BinaryData["log"]
	if len(blob) == 0 {
		t.Fatal("no payload written")
	}
	if raw := gunzipBytes(blob); raw == nil {
		t.Fatal("payload is not gzip — it would outgrow the ConfigMap size limit")
	} else if len(blob) >= len(raw) {
		t.Errorf("payload did not compress: %d stored vs %d raw", len(blob), len(raw))
	}
}

// TestLoad_StartsFreshWhenThereIsNothingToRestore: a first run has no ConfigMap,
// which is ordinary and must not fail or panic.
func TestLoad_StartsFreshWhenThereIsNothingToRestore(t *testing.T) {
	s := store(t, fake.NewSimpleClientset(), 10)
	if _, total := s.List(10, 0); total != 0 {
		t.Errorf("a fresh store reported %d entries", total)
	}
	s.Record(entry("GET", "pods"))
	if _, total := s.List(10, 0); total != 1 {
		t.Error("a fresh store did not accept a record")
	}
}

// TestLoad_SurvivesACorruptPayload: a truncated or non-gzip ConfigMap must cost
// the history, not the process. Starting fresh is the right failure — refusing to
// start, or panicking, would take the console down over a damaged log.
func TestLoad_SurvivesACorruptPayload(t *testing.T) {
	for _, payload := range [][]byte{
		[]byte("not gzip at all"),
		nil,
		gzipBytes([]byte("{not json")),
		gzipBytes(nil),
	} {
		cs := fake.NewSimpleClientset(&corev1.ConfigMap{
			ObjectMeta: metav1.ObjectMeta{Name: auditCMName, Namespace: "kubeui-test"},
			BinaryData: map[string][]byte{"log": payload},
		})
		s := store(t, cs, 10)
		if _, total := s.List(10, 0); total != 0 {
			t.Errorf("a corrupt payload produced %d entries", total)
		}
		// And the store must still work afterwards.
		s.Record(entry("DELETE", "pods/after-corruption"))
		if _, total := s.List(10, 0); total != 1 {
			t.Error("the store was unusable after a corrupt load")
		}
	}
}

// TestRestore_RespectsCapacity: a ConfigMap written by a build with a larger ring
// must not overflow a smaller one on restore.
func TestRestore_RespectsCapacity(t *testing.T) {
	cs := fake.NewSimpleClientset()
	big := store(t, cs, 50)
	// Distinguishable entries: with 50 identical ones, keeping the oldest ten and
	// keeping the newest ten look exactly the same.
	for i := 0; i < 50; i++ {
		big.Record(entry("DELETE", fmt.Sprintf("pods/%02d", i)))
	}
	big.Flush(context.Background())

	small := store(t, cs, 10)
	got, total := small.List(100, 0)
	if total != 10 {
		t.Fatalf("restored %d entries into a ring of 10", total)
	}

	// The survivors must be the NEWEST ten. An audit log that keeps only ancient
	// entries after a restart is useless for the incident that prompted the look.
	if got[0].Resource != "pods/49" {
		t.Errorf("newest restored entry = %q, want pods/49", got[0].Resource)
	}
	if got[len(got)-1].Resource != "pods/40" {
		t.Errorf("oldest restored entry = %q, want pods/40 — the wrong end was kept", got[len(got)-1].Resource)
	}
}

// TestRun_FlushesOnShutdown: the ticker is 15s, far longer than a pod gets during
// termination, so the flush on context cancel is what actually persists the last
// few actions before a restart.
func TestRun_FlushesOnShutdown(t *testing.T) {
	cs := fake.NewSimpleClientset()
	s := store(t, cs, 100)
	s.Record(entry("DELETE", "pods/last-action"))

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { s.Run(ctx); close(done) }()

	cancel()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("Run did not return after its context was cancelled")
	}

	reloaded := store(t, cs, 100)
	got, total := reloaded.List(100, 0)
	if total != 1 {
		t.Fatalf("restored %d entries, want the action recorded before shutdown", total)
	}
	if got[0].Resource != "pods/last-action" {
		t.Errorf("restored %q, want pods/last-action", got[0].Resource)
	}
}

func TestGzipRoundTrip(t *testing.T) {
	payload := []byte(`{"entries":[{"action":"DELETE"}],"next_id":2}`)
	packed := gzipBytes(payload)
	if got := gunzipBytes(packed); string(got) != string(payload) {
		t.Errorf("round trip = %q, want %q", got, payload)
	}
	if gunzipBytes([]byte("plain text")) != nil {
		t.Error("gunzipBytes accepted non-gzip input")
	}
}

// TestAuditNamespace pins where the log is written. Writing it to the wrong
// namespace would look like it worked and lose the trail on every restart.
func TestAuditNamespace(t *testing.T) {
	t.Setenv("POD_NAMESPACE", "from-env")
	if got := auditNamespace(); got != "from-env" {
		t.Errorf("auditNamespace() = %q, want the POD_NAMESPACE value", got)
	}

	t.Setenv("POD_NAMESPACE", "")
	if got := auditNamespace(); got != "skyvirthci-kubeui" {
		t.Errorf("auditNamespace() = %q, want the chart's default namespace", got)
	}
}
