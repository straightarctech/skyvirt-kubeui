package snapshot

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"
)

// base returns a realistic unstructured object with all the noise Strip exists to
// remove.
func base() map[string]any {
	return map[string]any{
		"apiVersion": "v1",
		"kind":       "ConfigMap",
		"metadata": map[string]any{
			"name":              "app-config",
			"namespace":         "default",
			"resourceVersion":   "12345",
			"uid":               "abc-123",
			"generation":        int64(7),
			"creationTimestamp": "2026-01-01T00:00:00Z",
			"selfLink":          "/api/v1/namespaces/default/configmaps/app-config",
			"managedFields":     []any{map[string]any{"manager": "kubectl"}},
			"annotations": map[string]any{
				"kubectl.kubernetes.io/last-applied-configuration": `{"a":1}`,
				"deployment.kubernetes.io/revision":                "3",
				"team":                                             "platform",
			},
		},
		"data":   map[string]any{"key": "value"},
		"status": map[string]any{"phase": "Active"},
	}
}

// TestStrip_RemovesServerNoise is the foundation of the whole timeline. Every
// field removed here is one the API server rewrites on its own: leave any of them
// in and the hash changes on resources nobody touched, so dedup stops working,
// every poll writes a snapshot, and the drift view fills with phantom changes.
func TestStrip_RemovesServerNoise(t *testing.T) {
	out, hash := Strip(base())
	if hash == "" {
		t.Fatal("Strip returned an empty hash")
	}
	got := string(out)

	for _, noise := range []string{
		"status", "managedFields", "resourceVersion", "uid",
		"generation", "creationTimestamp", "selfLink",
		"last-applied-configuration", "deployment.kubernetes.io/revision",
	} {
		if strings.Contains(got, noise) {
			t.Errorf("Strip left %q in the snapshot:\n%s", noise, got)
		}
	}

	// The meaningful content must survive — a snapshot of nothing is worse than none.
	for _, keep := range []string{"app-config", "key", "value", "team", "platform"} {
		if !strings.Contains(got, keep) {
			t.Errorf("Strip removed meaningful content %q:\n%s", keep, got)
		}
	}
}

// TestStrip_DropsAnnotationsMapWhenEmptied: if the only annotations were noise,
// the empty map must go too. An empty `annotations: {}` left behind still differs
// from an object that never had one, which is a diff a user cannot act on.
func TestStrip_DropsAnnotationsMapWhenEmptied(t *testing.T) {
	obj := base()
	md := obj["metadata"].(map[string]any)
	md["annotations"] = map[string]any{
		"kubectl.kubernetes.io/last-applied-configuration": `{"a":1}`,
		"deployment.kubernetes.io/revision":                "3",
	}
	out, _ := Strip(obj)
	if strings.Contains(string(out), "annotations") {
		t.Errorf("empty annotations map was left behind:\n%s", out)
	}
}

// TestStrip_HashIsContentAddressed pins the dedup contract: identical meaningful
// state hashes the same even when the server noise differs, and any real change
// produces a different hash.
func TestStrip_HashIsContentAddressed(t *testing.T) {
	_, h1 := Strip(base())

	// Same resource, re-read later: new resourceVersion, new managedFields.
	noisy := base()
	md := noisy["metadata"].(map[string]any)
	md["resourceVersion"] = "99999"
	md["managedFields"] = []any{map[string]any{"manager": "someone-else"}}
	noisy["status"] = map[string]any{"phase": "Terminating"}
	_, h2 := Strip(noisy)

	if h1 != h2 {
		t.Error("hash changed although only server-managed fields differed — dedup would never fire")
	}

	// A real edit must be visible.
	changed := base()
	changed["data"] = map[string]any{"key": "different"}
	_, h3 := Strip(changed)
	if h1 == h3 {
		t.Error("hash unchanged after a real data edit — drift would go unrecorded")
	}
}

func TestGzipRoundTrip(t *testing.T) {
	payload := strings.Repeat("apiVersion: v1\nkind: ConfigMap\n", 100)
	packed := gz([]byte(payload))
	if len(packed) >= len(payload) {
		t.Errorf("gz did not compress: %d -> %d bytes", len(payload), len(packed))
	}
	if got := string(gunz(packed)); got != payload {
		t.Error("gunz did not return the original content")
	}
	// Corrupt input must yield nil rather than panicking — a damaged ConfigMap
	// should cost one snapshot, not the whole timeline view.
	if got := gunz([]byte("not gzip at all")); got != nil {
		t.Errorf("gunz(garbage) = %q, want nil", got)
	}
}

// TestCMName_SeparatesResources: the ConfigMap name is a hash of kind|ns|name, so
// a collision would merge two unrelated resources into one timeline.
//
// refKey joins with "|" and does not escape, which is only safe because the
// separator cannot occur in the inputs: Kubernetes namespaces and names are RFC
// 1123 (lowercase alphanumeric, "-", "."), and Kind is a Go-identifier-shaped API
// kind. A case like {ns:"a", name:"b|c"} vs {ns:"a|b", name:"c"} DOES collide, but
// no API server can produce either — it is deliberately not tested here, because a
// test for an unreachable input invites a fix for a bug that cannot happen.
func TestCMName_SeparatesResources(t *testing.T) {
	c := NewConfigMapStore(fake.NewSimpleClientset(), "kubeui")
	seen := map[string]string{}
	for _, ref := range [][3]string{
		{"ConfigMap", "default", "app"},
		{"Secret", "default", "app"},     // same name, different kind
		{"ConfigMap", "other", "app"},    // same name, different namespace
		{"ConfigMap", "default", "app2"}, // near-identical name
		{"ConfigMap", "default", "app-2"},
		{"Deployment", "kube-system", "app"},
	} {
		name := c.cmName(ref[0], ref[1], ref[2])
		if prev, dup := seen[name]; dup {
			t.Errorf("name collision: %v and %v both map to %s", ref, prev, name)
		}
		seen[name] = fmt.Sprint(ref)
		if !strings.HasPrefix(name, "kubeui-snap-") {
			t.Errorf("name %q lacks the kubeui-snap- prefix", name)
		}
	}
}

func newStore(t *testing.T, objs ...*corev1.ConfigMap) (*ConfigMapStore, context.Context) {
	t.Helper()
	cs := fake.NewSimpleClientset()
	for _, o := range objs {
		if _, err := cs.CoreV1().ConfigMaps(o.Namespace).Create(context.Background(), o, metav1.CreateOptions{}); err != nil {
			t.Fatalf("seeding: %v", err)
		}
	}
	return NewConfigMapStore(cs, "kubeui"), context.Background()
}

func snap(taken time.Time, content, hash string) Snapshot {
	return Snapshot{
		Kind: "ConfigMap", APIVersion: "v1", Namespace: "default", Name: "app",
		Taken: taken, Hash: hash, Source: "periodic", Content: content,
	}
}

// TestPut_CreatesThenReadsBack: the first snapshot creates the ConfigMap, and the
// content survives the gzip round trip through storage.
func TestPut_CreatesThenReadsBack(t *testing.T) {
	c, ctx := newStore(t)
	yaml := "apiVersion: v1\nkind: ConfigMap\ndata:\n  key: value\n"

	stored, err := c.Put(ctx, snap(time.Now(), yaml, "hash-1"))
	if err != nil {
		t.Fatalf("Put: %v", err)
	}
	if !stored {
		t.Fatal("Put reported nothing stored on the first snapshot")
	}

	tl, err := c.Timeline(ctx, "ConfigMap", "default", "app")
	if err != nil {
		t.Fatalf("Timeline: %v", err)
	}
	if len(tl) != 1 {
		t.Fatalf("timeline has %d entries, want 1", len(tl))
	}
	if tl[0].Content != yaml {
		t.Errorf("content did not survive storage: %q", tl[0].Content)
	}
	if tl[0].Hash != "hash-1" || tl[0].Source != "periodic" {
		t.Errorf("metadata lost: hash=%q source=%q", tl[0].Hash, tl[0].Source)
	}
}

// TestPut_DedupesAgainstLatest is the property the whole design rests on: an
// unchanged resource costs nothing. Without it the 45-second reconcile would write
// a snapshot per resource per tick and blow the ConfigMap size budget within hours.
func TestPut_DedupesAgainstLatest(t *testing.T) {
	c, ctx := newStore(t)
	now := time.Now()

	if _, err := c.Put(ctx, snap(now, "same", "hash-1")); err != nil {
		t.Fatalf("Put: %v", err)
	}
	stored, err := c.Put(ctx, snap(now.Add(time.Minute), "same", "hash-1"))
	if err != nil {
		t.Fatalf("Put: %v", err)
	}
	if stored {
		t.Error("an identical hash was stored again — dedup did not fire")
	}

	tl, _ := c.Timeline(ctx, "ConfigMap", "default", "app")
	if len(tl) != 1 {
		t.Errorf("timeline has %d entries, want 1", len(tl))
	}

	// A changed hash must still append.
	if stored, err := c.Put(ctx, snap(now.Add(2*time.Minute), "different", "hash-2")); err != nil || !stored {
		t.Fatalf("changed snapshot not stored: stored=%v err=%v", stored, err)
	}
	if tl, _ := c.Timeline(ctx, "ConfigMap", "default", "app"); len(tl) != 2 {
		t.Errorf("timeline has %d entries, want 2", len(tl))
	}
}

// TestPut_RetainsOnlyTheMostRecent: the ring is bounded, and it drops the OLDEST.
// Dropping the newest instead would still keep the count correct while quietly
// discarding the change the user came to look at.
func TestPut_RetainsOnlyTheMostRecent(t *testing.T) {
	c, ctx := newStore(t)
	start := time.Now()

	total := maxSnapshotsPerResource + 5
	for i := 0; i < total; i++ {
		s := snap(start.Add(time.Duration(i)*time.Minute), fmt.Sprintf("content-%d", i), fmt.Sprintf("hash-%d", i))
		if _, err := c.Put(ctx, s); err != nil {
			t.Fatalf("Put %d: %v", i, err)
		}
	}

	tl, err := c.Timeline(ctx, "ConfigMap", "default", "app")
	if err != nil {
		t.Fatalf("Timeline: %v", err)
	}
	if len(tl) != maxSnapshotsPerResource {
		t.Fatalf("timeline has %d entries, want the retention bound of %d", len(tl), maxSnapshotsPerResource)
	}
	// Newest first, and the newest must be the last one written.
	if tl[0].Hash != fmt.Sprintf("hash-%d", total-1) {
		t.Errorf("newest entry = %q, want hash-%d", tl[0].Hash, total-1)
	}
	// The oldest survivor is total-maxSnapshots, i.e. the early ones were pruned.
	oldest := tl[len(tl)-1].Hash
	if oldest != fmt.Sprintf("hash-%d", total-maxSnapshotsPerResource) {
		t.Errorf("oldest survivor = %q, want hash-%d — the wrong end was pruned", oldest, total-maxSnapshotsPerResource)
	}
}

// TestTimeline_NewestFirst: the UI reads this order directly.
func TestTimeline_NewestFirst(t *testing.T) {
	c, ctx := newStore(t)
	now := time.Now()
	// Deliberately written oldest-last to prove the sort, not the insertion order.
	_, _ = c.Put(ctx, snap(now.Add(-2*time.Hour), "old", "h-old"))
	_, _ = c.Put(ctx, snap(now, "new", "h-new"))

	tl, _ := c.Timeline(ctx, "ConfigMap", "default", "app")
	if len(tl) != 2 {
		t.Fatalf("timeline has %d entries, want 2", len(tl))
	}
	if tl[0].Hash != "h-new" || tl[1].Hash != "h-old" {
		t.Errorf("order = %q,%q; want newest first", tl[0].Hash, tl[1].Hash)
	}
}

// TestTimeline_UnknownResourceIsEmptyNotAnError: a resource with no history is a
// normal state, not a failure — the UI shows "no snapshots yet".
func TestTimeline_UnknownResourceIsEmptyNotAnError(t *testing.T) {
	c, ctx := newStore(t)
	tl, err := c.Timeline(ctx, "ConfigMap", "default", "never-seen")
	if err != nil {
		t.Fatalf("Timeline on an untracked resource errored: %v", err)
	}
	if len(tl) != 0 {
		t.Errorf("timeline has %d entries, want 0", len(tl))
	}
}

// TestPut_SkipsOversizedContent: a resource too large for a ConfigMap is skipped
// rather than failing the snapshot run or writing an object the API server will
// reject. It must not create an empty ConfigMap either.
func TestPut_SkipsOversizedContent(t *testing.T) {
	c, ctx := newStore(t)
	huge := strings.Repeat("x", maxContentBytes+1)

	stored, err := c.Put(ctx, snap(time.Now(), huge, "hash-huge"))
	if err != nil {
		t.Fatalf("oversized Put errored instead of skipping: %v", err)
	}
	if stored {
		t.Error("oversized content reported as stored")
	}
	if tl, _ := c.Timeline(ctx, "ConfigMap", "default", "app"); len(tl) != 0 {
		t.Errorf("oversized content created a timeline entry: %+v", tl)
	}
}

// TestList_ReportsEveryTrackedResource: List drives the drift overview, so the
// counts and the identity carried in annotations both matter.
func TestList_ReportsEveryTrackedResource(t *testing.T) {
	c, ctx := newStore(t)
	now := time.Now()

	_, _ = c.Put(ctx, snap(now.Add(-time.Hour), "a1", "a-1"))
	_, _ = c.Put(ctx, snap(now.Add(-30*time.Minute), "a2", "a-2"))

	other := snap(now, "b1", "b-1")
	other.Name = "other"
	_, _ = c.Put(ctx, other)

	refs, err := c.List(ctx)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(refs) != 2 {
		t.Fatalf("List returned %d refs, want 2: %+v", len(refs), refs)
	}
	// Sorted by most recent activity, so the resource touched last comes first.
	if refs[0].Name != "other" {
		t.Errorf("first ref = %q, want the most recently updated (other)", refs[0].Name)
	}
	byName := map[string]TrackedRef{}
	for _, r := range refs {
		byName[r.Name] = r
	}
	if got := byName["app"].Count; got != 2 {
		t.Errorf("app count = %d, want 2", got)
	}
	if byName["app"].Kind != "ConfigMap" || byName["app"].Namespace != "default" {
		t.Errorf("identity lost: %+v", byName["app"])
	}
}
