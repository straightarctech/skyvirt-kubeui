package k8s

import (
	"context"
	"testing"

	"go.uber.org/zap"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"
)

// TestResourceQuantityFromBytes pins the binary-suffix rendering, including the
// boundary where the unit rolls over.
func TestResourceQuantityFromBytes(t *testing.T) {
	cases := []struct {
		in   int64
		want string
	}{
		{0, "0B"},
		{1023, "1023B"}, // still bytes
		{1024, "1.0Ki"}, // rolls over at exactly 1 KiB
		{1536, "1.5Ki"},
		{1048576, "1.0Mi"},
		{40 * 1024 * 1024 * 1024, "40.0Gi"},
	}
	for _, c := range cases {
		if got := resourceQuantityFromBytes(c.in); got != c.want {
			t.Errorf("resourceQuantityFromBytes(%d) = %q, want %q", c.in, got, c.want)
		}
	}
}

func selectorService(ns, name string) *corev1.Service {
	return &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: ns},
		Spec:       corev1.ServiceSpec{Selector: map[string]string{"app": name}},
	}
}

func endpointsWith(ns, name string, ready, notReady int) *corev1.Endpoints {
	ep := &corev1.Endpoints{ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: ns}}
	ss := corev1.EndpointSubset{}
	for i := 0; i < ready; i++ {
		ss.Addresses = append(ss.Addresses, corev1.EndpointAddress{IP: "10.0.0.1"})
	}
	for i := 0; i < notReady; i++ {
		ss.NotReadyAddresses = append(ss.NotReadyAddresses, corev1.EndpointAddress{IP: "10.0.0.2"})
	}
	ep.Subsets = []corev1.EndpointSubset{ss}
	return ep
}

// TestOrphanedResources_ServiceWithNoEndpoints: a selector-backed Service whose
// selector matches nothing blackholes traffic.
func TestOrphanedResources_ServiceWithNoEndpoints(t *testing.T) {
	kc := &Client{
		Clientset: fake.NewSimpleClientset(selectorService("default", "web")),
		Logger:    zap.NewNop(),
	}
	rep, err := kc.OrphanedResources(context.Background())
	if err != nil {
		t.Fatalf("OrphanedResources: %v", err)
	}
	if rep.DeadServices != 1 {
		t.Fatalf("DeadServices = %d, want 1 — a Service with no Endpoints object at all is dead", rep.DeadServices)
	}
	if rep.Items[0].Severity != "medium" || rep.Items[0].Kind != "Service" {
		t.Errorf("item = %q/%q, want medium/Service", rep.Items[0].Severity, rep.Items[0].Kind)
	}
}

// TestOrphanedResources_NotReadyAddressesDoNotCount pins a deliberate strictness:
// only READY addresses keep a Service alive. Counting NotReadyAddresses would
// hide exactly the outage this check exists to catch.
func TestOrphanedResources_NotReadyAddressesDoNotCount(t *testing.T) {
	kc := &Client{
		Clientset: fake.NewSimpleClientset(
			selectorService("default", "web"),
			endpointsWith("default", "web", 0, 3), // three pods, none ready
		),
		Logger: zap.NewNop(),
	}
	rep, err := kc.OrphanedResources(context.Background())
	if err != nil {
		t.Fatalf("OrphanedResources: %v", err)
	}
	if rep.DeadServices != 1 {
		t.Errorf("DeadServices = %d, want 1 — NotReadyAddresses must not count as live", rep.DeadServices)
	}
}

// TestOrphanedResources_HealthyServiceIsClean is the negative control, and also
// covers the two Service shapes that are exempt by design.
func TestOrphanedResources_HealthyServiceIsClean(t *testing.T) {
	headless := &corev1.Service{ // no selector: endpoints are managed by hand
		ObjectMeta: metav1.ObjectMeta{Name: "external-db", Namespace: "default"},
	}
	extName := &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{Name: "alias", Namespace: "default"},
		Spec:       corev1.ServiceSpec{Type: corev1.ServiceTypeExternalName, Selector: map[string]string{"app": "x"}},
	}
	kc := &Client{
		Clientset: fake.NewSimpleClientset(
			selectorService("default", "web"),
			endpointsWith("default", "web", 2, 0),
			headless, extName,
		),
		Logger: zap.NewNop(),
	}
	rep, err := kc.OrphanedResources(context.Background())
	if err != nil {
		t.Fatalf("OrphanedResources: %v", err)
	}
	if rep.DeadServices != 0 {
		t.Errorf("DeadServices = %d, want 0: %+v", rep.DeadServices, rep.Items)
	}
}

func boundPVC(ns, name, size string) *corev1.PersistentVolumeClaim {
	return &corev1.PersistentVolumeClaim{
		ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: ns},
		Status: corev1.PersistentVolumeClaimStatus{
			Phase:    corev1.ClaimBound,
			Capacity: corev1.ResourceList{corev1.ResourceStorage: resource.MustParse(size)},
		},
	}
}

// TestOrphanedResources_UnmountedPVC: a bound PVC nothing mounts is wasted spend,
// and its size rolls into the UnusedStorage total.
func TestOrphanedResources_UnmountedPVC(t *testing.T) {
	kc := &Client{
		Clientset: fake.NewSimpleClientset(boundPVC("default", "data", "10Gi")),
		Logger:    zap.NewNop(),
	}
	rep, err := kc.OrphanedResources(context.Background())
	if err != nil {
		t.Fatalf("OrphanedResources: %v", err)
	}
	if rep.UnusedPVCs != 1 {
		t.Fatalf("UnusedPVCs = %d, want 1", rep.UnusedPVCs)
	}
	if rep.UnusedStorage != "10.0Gi" {
		t.Errorf("UnusedStorage = %q, want 10.0Gi", rep.UnusedStorage)
	}
	if rep.Items[0].Severity != "low" {
		t.Errorf("Severity = %q, want low", rep.Items[0].Severity)
	}
}

// TestOrphanedResources_MountedPVCIsNotOrphaned — the negative control.
func TestOrphanedResources_MountedPVCIsNotOrphaned(t *testing.T) {
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "db-0", Namespace: "default"},
		Spec: corev1.PodSpec{Volumes: []corev1.Volume{{
			Name:         "data",
			VolumeSource: corev1.VolumeSource{PersistentVolumeClaim: &corev1.PersistentVolumeClaimVolumeSource{ClaimName: "data"}},
		}}},
	}
	kc := &Client{
		Clientset: fake.NewSimpleClientset(boundPVC("default", "data", "10Gi"), pod),
		Logger:    zap.NewNop(),
	}
	rep, err := kc.OrphanedResources(context.Background())
	if err != nil {
		t.Fatalf("OrphanedResources: %v", err)
	}
	if rep.UnusedPVCs != 0 {
		t.Errorf("UnusedPVCs = %d, want 0", rep.UnusedPVCs)
	}
	if rep.UnusedStorage != "" {
		t.Errorf("UnusedStorage = %q, want empty when nothing is wasted", rep.UnusedStorage)
	}
}

// TestOrphanedResources_PendingPVCIsNotAnOrphan: an unbound PVC is a health
// problem reported elsewhere, not wasted storage — counting it here would
// double-report it and inflate the wasted-capacity figure.
func TestOrphanedResources_PendingPVCIsNotAnOrphan(t *testing.T) {
	pending := boundPVC("default", "stuck", "5Gi")
	pending.Status.Phase = corev1.ClaimPending
	kc := &Client{Clientset: fake.NewSimpleClientset(pending), Logger: zap.NewNop()}
	rep, err := kc.OrphanedResources(context.Background())
	if err != nil {
		t.Fatalf("OrphanedResources: %v", err)
	}
	if rep.UnusedPVCs != 0 {
		t.Errorf("UnusedPVCs = %d, want 0 for a Pending claim", rep.UnusedPVCs)
	}
}
