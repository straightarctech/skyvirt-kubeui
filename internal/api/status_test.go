package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"go.uber.org/zap"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/kubernetes/fake"

	"github.com/straightarctech/skyvirt-kubeui/internal/k8s"
)

// errorBody extracts the "error" field the API wraps every failure in.
func errorBody(t *testing.T, w *httptest.ResponseRecorder) string {
	t.Helper()
	var got map[string]string
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatalf("response is not a JSON object: %q", w.Body.String())
	}
	return got["error"]
}

// TestWriteK8sError_Mapping covers every branch of the mapper that distinguishes
// a client mistake from a server fault.
//
// This matters more than its size suggests: a missing resource reported as 500
// tells an operator the console is broken when the truth is they asked for
// something that is not there, and it makes every dashboard that counts 5xx
// useless. Every handler in the package now routes its errors through here.
//
// The last row is load-bearing beyond what it looks like. A sweep that
// mechanically replaced every `writeError(w, StatusInternalServerError,
// err.Error())` with a call to this function also rewrote this function's own
// terminating branch, turning it into unbounded recursion — this row is what
// surfaced it, as a stack overflow rather than a wrong status code.
func TestWriteK8sError_Mapping(t *testing.T) {
	gr := schema.GroupResource{Group: "", Resource: "pods"}
	cases := []struct {
		name string
		err  error
		want int
	}{
		{"not found", apierrors.NewNotFound(gr, "web"), http.StatusNotFound},
		{"already exists", apierrors.NewAlreadyExists(gr, "web"), http.StatusConflict},
		{"conflict", apierrors.NewConflict(gr, "web", errors.New("changed")), http.StatusConflict},
		{"bad request", apierrors.NewBadRequest("nope"), http.StatusBadRequest},
		{"invalid", apierrors.NewInvalid(schema.GroupKind{Kind: "Pod"}, "web", nil), http.StatusBadRequest},
		{"forbidden", apierrors.NewForbidden(gr, "web", errors.New("rbac")), http.StatusForbidden},
		{"unauthorized", apierrors.NewUnauthorized("no token"), http.StatusUnauthorized},
		// Anything that is not a Kubernetes API error really is a server fault.
		{"plain error falls through to 500", errors.New("disk on fire"), http.StatusInternalServerError},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			writeK8sError(w, c.err)
			if w.Code != c.want {
				t.Errorf("status = %d, want %d (body=%s)", w.Code, c.want, w.Body.String())
			}
			if errorBody(t, w) == "" {
				t.Error("error body is empty; the client is told nothing")
			}
		})
	}
}

// TestWriteK8sError_SeesThroughWrapping is the case that would break silently.
// The k8s layer wraps API errors with context before returning them — e.g.
// GetResourceYAML returns fmt.Errorf("resource %s %s/%s not found: %w", …). If
// the mapper compared types directly instead of unwrapping, every one of those
// would land on 500 and the mapping above would be dead code in practice.
func TestWriteK8sError_SeesThroughWrapping(t *testing.T) {
	gr := schema.GroupResource{Group: "", Resource: "pods"}
	wrapped := errors.Join(errors.New("getting pod default/web"), apierrors.NewNotFound(gr, "web"))

	w := httptest.NewRecorder()
	writeK8sError(w, wrapped)
	if w.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404 — a wrapped NotFound must still map", w.Code)
	}
}

// TestWriteJSON_Shape pins the response envelope every client parses.
func TestWriteJSON_Shape(t *testing.T) {
	w := httptest.NewRecorder()
	writeJSON(w, http.StatusCreated, map[string]string{"hello": "world"})

	if w.Code != http.StatusCreated {
		t.Errorf("status = %d, want 201", w.Code)
	}
	if ct := w.Header().Get("Content-Type"); ct != "application/json" {
		t.Errorf("Content-Type = %q, want application/json", ct)
	}
	var got map[string]string
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil || got["hello"] != "world" {
		t.Errorf("body = %q, want a JSON object with hello=world", w.Body.String())
	}

	// A nil payload must write the status and no body, not the literal "null".
	w = httptest.NewRecorder()
	writeJSON(w, http.StatusNoContent, nil)
	if body := strings.TrimSpace(w.Body.String()); body != "" {
		t.Errorf("nil payload wrote %q, want an empty body", body)
	}
}

// TestChartShow_RejectsBadInput covers the validation added when an unsupported
// ?what= was found returning 500. Asking for a target that does not exist is a
// client mistake; it must not read as a server fault, and it must not reach the
// helm binary at all.
func TestChartShow_RejectsBadInput(t *testing.T) {
	h := helmHandler(&k8s.Client{Clientset: fake.NewSimpleClientset(), Logger: zap.NewNop()})

	cases := []struct {
		name  string
		query string
		want  int
	}{
		{"missing chart", "/catalog/chart?what=values", http.StatusBadRequest},
		{"unsupported target", "/catalog/chart?chart=repo/nginx&what=bogus", http.StatusBadRequest},
		{"target that looks like a flag", "/catalog/chart?chart=repo/nginx&what=--set", http.StatusBadRequest},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			h.ChartShow(w, httptest.NewRequest(http.MethodGet, c.query, nil))
			if w.Code != c.want {
				t.Errorf("status = %d, want %d (body=%s)", w.Code, c.want, w.Body.String())
			}
			if msg := errorBody(t, w); msg == "" {
				t.Error("rejection gave the caller no message")
			}
		})
	}
}

// TestHelmInstall_RejectsBadInput: the install endpoint must refuse an incomplete
// request before shelling out to helm. These are the only install paths safe to
// test without a helm binary, which is precisely why they are worth pinning.
func TestHelmInstall_RejectsBadInput(t *testing.T) {
	h := helmHandler(&k8s.Client{Clientset: fake.NewSimpleClientset(), Logger: zap.NewNop()})

	cases := []struct {
		name string
		body string
	}{
		{"not json", `{`},
		{"no release name", `{"chart":"repo/nginx"}`},
		{"no chart", `{"release_name":"web"}`},
		{"both missing", `{}`},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			h.Install(w, httptest.NewRequest(http.MethodPost, "/helm/install", strings.NewReader(c.body)))
			if w.Code != http.StatusBadRequest {
				t.Errorf("status = %d, want 400 (body=%s)", w.Code, w.Body.String())
			}
		})
	}
}

// TestHelmInstallPreview_RejectsBadInput: the preview endpoint validates exactly
// like install. It renders rather than applies, but it still shells out to helm,
// so an incomplete request must be refused before that happens.
func TestHelmInstallPreview_RejectsBadInput(t *testing.T) {
	h := helmHandler(&k8s.Client{Clientset: fake.NewSimpleClientset(), Logger: zap.NewNop()})

	cases := []struct {
		name string
		body string
	}{
		{"not json", `{`},
		{"no release name", `{"chart":"repo/nginx"}`},
		{"no chart", `{"release_name":"web"}`},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			h.InstallPreview(w, httptest.NewRequest(http.MethodPost, "/helm/install/preview", strings.NewReader(c.body)))
			if w.Code != http.StatusBadRequest {
				t.Errorf("status = %d, want 400 (body=%s)", w.Code, w.Body.String())
			}
		})
	}
}

// TestNotFound_IsReportedAs404 covers the sweep that put every handler onto
// writeK8sError. Before it, a resource that does not exist came back as 500 from
// 166 call sites: the console told an operator the product was broken when they
// had simply named something absent, and every dashboard counting 5xx was noise.
//
// This test previously asserted the wrong behaviour on purpose, with a note
// saying a fix should flip it to 404. That is what happened.
func TestNotFound_IsReportedAs404(t *testing.T) {
	kc := &k8s.Client{Clientset: fake.NewSimpleClientset(), Logger: zap.NewNop()}

	cases := []struct {
		name    string
		route   string
		request string
		handler http.HandlerFunc
	}{
		{"pod", "/namespaces/{namespace}/pods/{name}", "/namespaces/default/pods/nope", podsHandler(kc).Get},
		{"deployment", "/namespaces/{namespace}/deployments/{name}", "/namespaces/default/deployments/nope", deploymentsHandler(kc).Get},
		{"configmap", "/namespaces/{namespace}/configmaps/{name}", "/namespaces/default/configmaps/nope", configMapsHandler(kc).Get},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			r := chi.NewRouter()
			r.Get(c.route, c.handler)
			w := httptest.NewRecorder()
			r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, c.request, nil))
			if w.Code != http.StatusNotFound {
				t.Errorf("status = %d, want 404 (body=%s)", w.Code, w.Body.String())
			}
		})
	}
}

// TestPodsGet_FoundIsServed is the positive control for the test above: the same
// handler on an existing pod must return it, so a 500 there really is about the
// missing object and not a broken fixture.
func TestPodsGet_FoundIsServed(t *testing.T) {
	pod := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "web", Namespace: "default"}}
	kc := &k8s.Client{Clientset: fake.NewSimpleClientset(pod), Logger: zap.NewNop()}
	h := podsHandler(kc)

	r := chi.NewRouter()
	r.Get("/namespaces/{namespace}/pods/{name}", h.Get)

	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/namespaces/default/pods/web", nil))

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "web") {
		t.Errorf("response does not name the pod: %s", w.Body.String())
	}
}
