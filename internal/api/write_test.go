package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"go.uber.org/zap"
	appsv1 "k8s.io/api/apps/v1"
	autoscalingv1 "k8s.io/api/autoscaling/v1"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/kubernetes/fake"
	k8stesting "k8s.io/client-go/testing"

	"github.com/straightarctech/skyvirt-kubeui/internal/k8s"
)

// These cover the endpoints that CHANGE a cluster: scale, restart, delete,
// cordon, taint, suspend, rollback. The layer has one failure mode worse than
// all others — acting on the wrong object — so most of these seed two resources
// that differ only by namespace and assert the bystander survives untouched. A
// handler that reads the wrong URL parameter passes every single-object test and
// fails these.

// serve mounts one handler on a chi route and issues a request against it, so the
// URL parameters the handler reads are the ones chi actually extracted.
func serve(t *testing.T, method, route, target, body string, h http.HandlerFunc) *httptest.ResponseRecorder {
	t.Helper()
	r := chi.NewRouter()
	r.Method(method, route, h)
	var rdr *strings.Reader
	if body == "" {
		rdr = strings.NewReader("")
	} else {
		rdr = strings.NewReader(body)
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(method, target, rdr))
	return w
}

func int32p(i int32) *int32 { return &i }

func deploy(ns, name string, replicas int32) *appsv1.Deployment {
	return &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: ns},
		Spec: appsv1.DeploymentSpec{
			Replicas: int32p(replicas),
			Template: corev1.PodTemplateSpec{Spec: corev1.PodSpec{Containers: []corev1.Container{{Name: "c"}}}},
		},
	}
}

// scaleRecorder wires the scale subresource into a fake clientset and records the
// update the handler performs.
//
// The fake does not back scale on its own — GetScale panics with "runtime.Object
// is *v1.Deployment, not *v1.Scale" — because scale is a subresource with its own
// type and the tracker only holds Deployments. These reactors stand in for the API
// server, and recording the Scale object is what the test wants anyway: the thing
// worth asserting is exactly what the handler ASKS the server to do.
func scaleRecorder(cs *fake.Clientset, current int32) *autoscalingv1.Scale {
	got := &autoscalingv1.Scale{}
	cs.PrependReactor("get", "deployments", func(a k8stesting.Action) (bool, runtime.Object, error) {
		ga, ok := a.(k8stesting.GetAction)
		if !ok || ga.GetSubresource() != "scale" {
			return false, nil, nil
		}
		return true, &autoscalingv1.Scale{
			ObjectMeta: metav1.ObjectMeta{Name: ga.GetName(), Namespace: ga.GetNamespace()},
			Spec:       autoscalingv1.ScaleSpec{Replicas: current},
		}, nil
	})
	cs.PrependReactor("update", "deployments", func(a k8stesting.Action) (bool, runtime.Object, error) {
		ua, ok := a.(k8stesting.UpdateAction)
		if !ok || ua.GetSubresource() != "scale" {
			return false, nil, nil
		}
		s := ua.GetObject().(*autoscalingv1.Scale)
		*got = *s
		got.Namespace = ua.GetNamespace()
		return true, s, nil
	})
	return got
}

// TestScale_TargetsTheNamedResource: the handler must scale the deployment named
// in the URL, in the namespace named in the URL, to the count in the body. Reading
// the wrong URL parameter here scales the wrong workload — the single worst thing
// this layer can do — and it looks identical in every single-object test.
func TestScale_TargetsTheNamedResource(t *testing.T) {
	cs := fake.NewSimpleClientset(deploy("prod", "web", 1), deploy("staging", "web", 1))
	got := scaleRecorder(cs, 1)
	kc := &k8s.Client{Clientset: cs, Logger: zap.NewNop()}

	w := serve(t, http.MethodPost, "/namespaces/{namespace}/deployments/{name}/scale",
		"/namespaces/prod/deployments/web/scale", `{"replicas":5}`, deploymentsHandler(kc).Scale)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", w.Code, w.Body.String())
	}

	if got.Spec.Replicas != 5 {
		t.Errorf("scaled to %d, want 5", got.Spec.Replicas)
	}
	if got.Name != "web" {
		t.Errorf("scaled %q, want web", got.Name)
	}
	if got.Namespace != "prod" {
		t.Errorf("scaled in namespace %q, want prod — staging/web has the same name", got.Namespace)
	}
}

// TestScale_RejectsBadInputWithoutTouchingTheCluster: validation must run before
// anything is written, so a rejected request leaves no trace.
func TestScale_RejectsBadInputWithoutTouchingTheCluster(t *testing.T) {
	cases := []struct {
		name string
		body string
	}{
		{"not json", `{`},
		{"negative replicas", `{"replicas":-1}`},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			cs := fake.NewSimpleClientset(deploy("prod", "web", 2))
			kc := &k8s.Client{Clientset: cs, Logger: zap.NewNop()}

			got := scaleRecorder(cs, 2)
			w := serve(t, http.MethodPost, "/namespaces/{namespace}/deployments/{name}/scale",
				"/namespaces/prod/deployments/web/scale", c.body, deploymentsHandler(kc).Scale)
			if w.Code != http.StatusBadRequest {
				t.Errorf("status = %d, want 400 (body=%s)", w.Code, w.Body.String())
			}
			if got.Name != "" {
				t.Errorf("a rejected request still issued a scale to %s/%s", got.Namespace, got.Name)
			}
		})
	}
}

// TestRestart_StampsThePodTemplate: a rolling restart is not an API verb — it is
// an annotation on the pod template that makes the controller roll. If the stamp
// lands anywhere else, the button silently does nothing.
func TestRestart_StampsThePodTemplate(t *testing.T) {
	cs := fake.NewSimpleClientset(deploy("prod", "web", 2))
	kc := &k8s.Client{Clientset: cs, Logger: zap.NewNop()}

	w := serve(t, http.MethodPost, "/namespaces/{namespace}/deployments/{name}/restart",
		"/namespaces/prod/deployments/web/restart", "", deploymentsHandler(kc).Restart)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", w.Code, w.Body.String())
	}

	got, _ := cs.AppsV1().Deployments("prod").Get(context.Background(), "web", metav1.GetOptions{})
	ann := got.Spec.Template.Annotations
	if len(ann) == 0 {
		t.Fatal("no annotation on the pod template — the deployment will not roll")
	}
	found := false
	for k := range ann {
		if strings.Contains(k, "restartedAt") {
			found = true
		}
	}
	if !found {
		t.Errorf("pod template annotations = %v, want a restartedAt stamp", ann)
	}
}

// TestDeletePod_RemovesOnlyTheTarget: the same name in another namespace must
// survive. This is the test that catches a handler reading the wrong URL param.
func TestDeletePod_RemovesOnlyTheTarget(t *testing.T) {
	cs := fake.NewSimpleClientset(
		&corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "web", Namespace: "prod"}},
		&corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "web", Namespace: "staging"}},
	)
	kc := &k8s.Client{Clientset: cs, Logger: zap.NewNop()}

	w := serve(t, http.MethodDelete, "/namespaces/{namespace}/pods/{name}",
		"/namespaces/prod/pods/web", "", podsHandler(kc).Delete)
	if w.Code != http.StatusOK && w.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want success (body=%s)", w.Code, w.Body.String())
	}

	if _, err := cs.CoreV1().Pods("prod").Get(context.Background(), "web", metav1.GetOptions{}); err == nil {
		t.Error("prod/web still exists after delete")
	}
	if _, err := cs.CoreV1().Pods("staging").Get(context.Background(), "web", metav1.GetOptions{}); err != nil {
		t.Errorf("staging/web was deleted too — wrong namespace: %v", err)
	}
}

// TestCordonAndUncordon: cordon is the first half of every node maintenance, and
// an uncordon that fails to clear the flag leaves a node quietly out of service.
func TestCordonAndUncordon(t *testing.T) {
	cs := fake.NewSimpleClientset(
		&corev1.Node{ObjectMeta: metav1.ObjectMeta{Name: "node-a"}},
		&corev1.Node{ObjectMeta: metav1.ObjectMeta{Name: "node-b"}},
	)
	kc := &k8s.Client{Clientset: cs, Logger: zap.NewNop()}

	w := serve(t, http.MethodPost, "/nodes/{name}/cordon", "/nodes/node-a/cordon", "", nodesHandler(kc).Cordon)
	if w.Code != http.StatusOK {
		t.Fatalf("cordon status = %d (body=%s)", w.Code, w.Body.String())
	}
	a, _ := cs.CoreV1().Nodes().Get(context.Background(), "node-a", metav1.GetOptions{})
	if !a.Spec.Unschedulable {
		t.Error("node-a is not cordoned")
	}
	b, _ := cs.CoreV1().Nodes().Get(context.Background(), "node-b", metav1.GetOptions{})
	if b.Spec.Unschedulable {
		t.Error("node-b was cordoned too — the handler ignored the name")
	}

	w = serve(t, http.MethodPost, "/nodes/{name}/uncordon", "/nodes/node-a/uncordon", "", nodesHandler(kc).Uncordon)
	if w.Code != http.StatusOK {
		t.Fatalf("uncordon status = %d (body=%s)", w.Code, w.Body.String())
	}
	a, _ = cs.CoreV1().Nodes().Get(context.Background(), "node-a", metav1.GetOptions{})
	if a.Spec.Unschedulable {
		t.Error("node-a is still cordoned after uncordon — it would stay out of service")
	}
}

// TestAddAndRemoveTaint: a taint carries three fields and all of them matter —
// the wrong effect is the difference between repelling new pods and evicting
// running ones.
func TestAddAndRemoveTaint(t *testing.T) {
	cs := fake.NewSimpleClientset(&corev1.Node{ObjectMeta: metav1.ObjectMeta{Name: "node-a"}})
	kc := &k8s.Client{Clientset: cs, Logger: zap.NewNop()}

	w := serve(t, http.MethodPost, "/nodes/{name}/taint", "/nodes/node-a/taint",
		`{"key":"dedicated","value":"gpu","effect":"NoSchedule"}`, nodesHandler(kc).AddTaint)
	if w.Code != http.StatusOK {
		t.Fatalf("add taint status = %d (body=%s)", w.Code, w.Body.String())
	}
	n, _ := cs.CoreV1().Nodes().Get(context.Background(), "node-a", metav1.GetOptions{})
	if len(n.Spec.Taints) != 1 {
		t.Fatalf("taints = %+v, want exactly one", n.Spec.Taints)
	}
	got := n.Spec.Taints[0]
	if got.Key != "dedicated" || got.Value != "gpu" || string(got.Effect) != "NoSchedule" {
		t.Errorf("taint = %+v, want dedicated=gpu:NoSchedule", got)
	}

	w = serve(t, http.MethodDelete, "/nodes/{name}/taint/{key}", "/nodes/node-a/taint/dedicated", "",
		nodesHandler(kc).RemoveTaint)
	if w.Code != http.StatusOK {
		t.Fatalf("remove taint status = %d (body=%s)", w.Code, w.Body.String())
	}
	n, _ = cs.CoreV1().Nodes().Get(context.Background(), "node-a", metav1.GetOptions{})
	if len(n.Spec.Taints) != 0 {
		t.Errorf("taints = %+v, want none after removal", n.Spec.Taints)
	}
}

// TestAddTaint_RejectsBadBody: malformed input must not reach the node.
func TestAddTaint_RejectsBadBody(t *testing.T) {
	cs := fake.NewSimpleClientset(&corev1.Node{ObjectMeta: metav1.ObjectMeta{Name: "node-a"}})
	kc := &k8s.Client{Clientset: cs, Logger: zap.NewNop()}

	w := serve(t, http.MethodPost, "/nodes/{name}/taint", "/nodes/node-a/taint", `{`, nodesHandler(kc).AddTaint)
	if w.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", w.Code)
	}
	n, _ := cs.CoreV1().Nodes().Get(context.Background(), "node-a", metav1.GetOptions{})
	if len(n.Spec.Taints) != 0 {
		t.Errorf("a rejected request still tainted the node: %+v", n.Spec.Taints)
	}
}

// TestSuspendAndResumeCronJob: the flag is a boolean in the body, so the two
// directions are one handler and inverting it is an easy, silent mistake — a
// "resume" that suspends looks identical until the schedule stops firing.
func TestSuspendAndResumeCronJob(t *testing.T) {
	cj := &batchv1.CronJob{
		ObjectMeta: metav1.ObjectMeta{Name: "backup", Namespace: "ops"},
		Spec:       batchv1.CronJobSpec{Schedule: "0 * * * *"},
	}
	cs := fake.NewSimpleClientset(cj)
	kc := &k8s.Client{Clientset: cs, Logger: zap.NewNop()}

	for _, c := range []struct {
		body string
		want bool
	}{{`{"suspend":true}`, true}, {`{"suspend":false}`, false}} {
		w := serve(t, http.MethodPost, "/namespaces/{namespace}/cronjobs/{name}/suspend",
			"/namespaces/ops/cronjobs/backup/suspend", c.body, jobsHandler(kc).SuspendCronJob)
		if w.Code != http.StatusOK {
			t.Fatalf("status = %d (body=%s)", w.Code, w.Body.String())
		}
		got, _ := cs.BatchV1().CronJobs("ops").Get(context.Background(), "backup", metav1.GetOptions{})
		if got.Spec.Suspend == nil || *got.Spec.Suspend != c.want {
			t.Errorf("suspend = %v, want %v for body %s", got.Spec.Suspend, c.want, c.body)
		}
	}
}

// TestHelmRollback_TargetsTheRequestedRevision goes through the runner seam, so
// the HTTP layer's URL parameters and body are checked against the command that
// would actually run. Rolling back the wrong release, or to revision 0, is
// destructive and was previously unverifiable at this layer.
func TestHelmRollback_TargetsTheRequestedRevision(t *testing.T) {
	f := &recordingRunner{}
	kc := &k8s.Client{Clientset: fake.NewSimpleClientset(), Runner: f, Logger: zap.NewNop()}

	w := serve(t, http.MethodPost, "/namespaces/{namespace}/helm/releases/{name}/rollback",
		"/namespaces/prod/helm/releases/web/rollback", `{"revision":3}`, helmHandler(kc).Rollback)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d (body=%s)", w.Code, w.Body.String())
	}
	line := f.last()
	for _, want := range []string{"rollback", "web", "3", "--namespace prod"} {
		if !strings.Contains(line, want) {
			t.Errorf("rollback command %q missing %q", line, want)
		}
	}
}

// TestHelmRollback_RejectsBadBody: nothing should reach helm.
func TestHelmRollback_RejectsBadBody(t *testing.T) {
	f := &recordingRunner{}
	kc := &k8s.Client{Clientset: fake.NewSimpleClientset(), Runner: f, Logger: zap.NewNop()}

	w := serve(t, http.MethodPost, "/namespaces/{namespace}/helm/releases/{name}/rollback",
		"/namespaces/prod/helm/releases/web/rollback", `{`, helmHandler(kc).Rollback)
	if w.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", w.Code)
	}
	if len(f.cmds) != 0 {
		t.Errorf("a rejected request still ran: %v", f.cmds)
	}
}

// recordingRunner captures the commands a handler would have executed.
type recordingRunner struct{ cmds []string }

func (r *recordingRunner) Run(_ context.Context, c k8s.Command) ([]byte, error) {
	r.cmds = append(r.cmds, c.String())
	return []byte("{}"), nil
}

func (r *recordingRunner) last() string {
	if len(r.cmds) == 0 {
		return ""
	}
	return r.cmds[len(r.cmds)-1]
}
