package api

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"go.uber.org/zap"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"

	"github.com/straightarctech/skyvirt-kubeui/internal/k8s"
)

// TestSecretsList_Redaction guards that the secrets list never returns raw
// values, only key names.
func TestSecretsList_Redaction(t *testing.T) {
	sec := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{Name: "db", Namespace: "default"},
		Type:       corev1.SecretTypeOpaque,
		Data:       map[string][]byte{"password": []byte("s3cr3t")},
	}
	kc := &k8s.Client{Clientset: fake.NewSimpleClientset(sec), Logger: zap.NewNop()}
	h := secretsHandler(kc)

	w := httptest.NewRecorder()
	h.List(w, httptest.NewRequest(http.MethodGet, "/api/v1/secrets", nil))

	body := w.Body.String()
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", w.Code, body)
	}
	if !strings.Contains(body, "password") {
		t.Errorf("expected key name 'password' in response: %s", body)
	}
	if strings.Contains(body, "s3cr3t") {
		t.Errorf("raw secret value leaked in response: %s", body)
	}
	if b64 := base64.StdEncoding.EncodeToString([]byte("s3cr3t")); strings.Contains(body, b64) {
		t.Errorf("base64 secret value leaked in response: %s", body)
	}
}

// TestPodsList_RestartsField guards the restart-count contract: the container
// restart count is serialized under "restarts" (the bug was a "restart_count"
// mismatch that stuck every readout at 0).
func TestPodsList_RestartsField(t *testing.T) {
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "p1", Namespace: "default"},
		Spec:       corev1.PodSpec{Containers: []corev1.Container{{Name: "c1"}}},
		Status: corev1.PodStatus{
			Phase:             corev1.PodRunning,
			ContainerStatuses: []corev1.ContainerStatus{{Name: "c1", RestartCount: 3, Ready: true}},
		},
	}
	kc := &k8s.Client{Clientset: fake.NewSimpleClientset(pod), Logger: zap.NewNop()}
	h := podsHandler(kc)

	w := httptest.NewRecorder()
	h.List(w, httptest.NewRequest(http.MethodGet, "/api/v1/pods", nil))
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", w.Code, w.Body.String())
	}

	var pods []map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &pods); err != nil {
		t.Fatalf("decode: %v (body=%s)", err, w.Body.String())
	}
	if len(pods) != 1 {
		t.Fatalf("got %d pods, want 1", len(pods))
	}
	containers, _ := pods[0]["containers"].([]any)
	if len(containers) != 1 {
		t.Fatalf("got %d containers, want 1", len(containers))
	}
	c := containers[0].(map[string]any)
	if _, ok := c["restarts"]; !ok {
		t.Errorf("container missing 'restarts' field: %v", c)
	}
	if got, _ := c["restarts"].(float64); got != 3 {
		t.Errorf("restarts = %v, want 3", c["restarts"])
	}
}

// TestCreatePV_CapacityValidation guards that a malformed capacity is a 400,
// not a panic-recovered 500.
func TestCreatePV_CapacityValidation(t *testing.T) {
	kc := &k8s.Client{Clientset: fake.NewSimpleClientset(), Logger: zap.NewNop()}
	h := storageHandler(kc)

	bad := httptest.NewRequest(http.MethodPost, "/api/v1/pvs",
		strings.NewReader(`{"name":"x","capacity":"abc","host_path":"/x"}`))
	wBad := httptest.NewRecorder()
	h.CreatePV(wBad, bad)
	if wBad.Code != http.StatusBadRequest {
		t.Errorf("bad capacity: status = %d, want 400 (body=%s)", wBad.Code, wBad.Body.String())
	}

	good := httptest.NewRequest(http.MethodPost, "/api/v1/pvs",
		strings.NewReader(`{"name":"pv1","capacity":"10Gi","host_path":"/data"}`))
	wGood := httptest.NewRecorder()
	h.CreatePV(wGood, good)
	if wGood.Code >= 400 {
		t.Errorf("valid capacity: status = %d, want < 400 (body=%s)", wGood.Code, wGood.Body.String())
	}
}

func TestCreatePVC_CapacityValidation(t *testing.T) {
	kc := &k8s.Client{Clientset: fake.NewSimpleClientset(), Logger: zap.NewNop()}
	h := storageHandler(kc)

	r := httptest.NewRequest(http.MethodPost, "/api/v1/namespaces/default/pvcs",
		strings.NewReader(`{"name":"x","capacity":"nonsense"}`))
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("namespace", "default")
	r = r.WithContext(context.WithValue(r.Context(), chi.RouteCtxKey, rctx))
	w := httptest.NewRecorder()
	h.CreatePVC(w, r)
	if w.Code != http.StatusBadRequest {
		t.Errorf("bad capacity: status = %d, want 400 (body=%s)", w.Code, w.Body.String())
	}
}
