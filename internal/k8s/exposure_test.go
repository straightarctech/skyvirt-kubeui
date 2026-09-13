package k8s

import (
	"context"
	"testing"

	"go.uber.org/zap"
	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"
)

// TestServicePorts pins the port formatting, including the deliberate omission
// of the default TCP protocol — printing "/TCP" on every row would be noise.
func TestServicePorts(t *testing.T) {
	cases := []struct {
		name  string
		ports []corev1.ServicePort
		want  string
	}{
		{"no ports", nil, ""},
		{"plain port", []corev1.ServicePort{{Port: 80}}, "80"},
		{"tcp is not spelled out", []corev1.ServicePort{{Port: 80, Protocol: corev1.ProtocolTCP}}, "80"},
		{"non-tcp protocol is shown", []corev1.ServicePort{{Port: 53, Protocol: corev1.ProtocolUDP}}, "53/UDP"},
		{"node port is appended", []corev1.ServicePort{{Port: 80, NodePort: 30080}}, "80:30080"},
		{"multiple ports are joined", []corev1.ServicePort{{Port: 80}, {Port: 443}}, "80, 443"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			svc := &corev1.Service{Spec: corev1.ServiceSpec{Ports: c.ports}}
			if got := servicePorts(svc); got != c.want {
				t.Errorf("servicePorts = %q, want %q", got, c.want)
			}
		})
	}
}

// TestLbAddress: IP is preferred over hostname, and an unprovisioned load
// balancer reports the literal "pending" rather than an empty cell.
func TestLbAddress(t *testing.T) {
	cases := []struct {
		name    string
		ingress []corev1.LoadBalancerIngress
		want    string
	}{
		{"no address yet", nil, "pending"},
		{"ip", []corev1.LoadBalancerIngress{{IP: "10.0.0.5"}}, "10.0.0.5"},
		{"hostname when no ip", []corev1.LoadBalancerIngress{{Hostname: "lb.example"}}, "lb.example"},
		{"ip wins over hostname", []corev1.LoadBalancerIngress{{IP: "10.0.0.5", Hostname: "lb.example"}}, "10.0.0.5"},
		{"multiple joined", []corev1.LoadBalancerIngress{{IP: "10.0.0.5"}, {IP: "10.0.0.6"}}, "10.0.0.5, 10.0.0.6"},
		{"entry with neither is skipped", []corev1.LoadBalancerIngress{{}}, "pending"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			svc := &corev1.Service{Status: corev1.ServiceStatus{LoadBalancer: corev1.LoadBalancerStatus{Ingress: c.ingress}}}
			if got := lbAddress(svc); got != c.want {
				t.Errorf("lbAddress = %q, want %q", got, c.want)
			}
		})
	}
}

// TestNodePortAddress renders the placeholder host form, and stays empty when no
// node port has been assigned.
func TestNodePortAddress(t *testing.T) {
	svc := &corev1.Service{Spec: corev1.ServiceSpec{Ports: []corev1.ServicePort{{Port: 80, NodePort: 30080}, {Port: 443, NodePort: 30443}}}}
	if want := "<node>:30080, <node>:30443"; nodePortAddress(svc) != want {
		t.Errorf("nodePortAddress = %q, want %q", nodePortAddress(svc), want)
	}
	none := &corev1.Service{Spec: corev1.ServiceSpec{Ports: []corev1.ServicePort{{Port: 80}}}}
	if got := nodePortAddress(none); got != "" {
		t.Errorf("nodePortAddress(no nodePort) = %q, want empty", got)
	}
}

func svcOfType(ns, name string, t corev1.ServiceType) *corev1.Service {
	return &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: ns},
		Spec:       corev1.ServiceSpec{Type: t, Ports: []corev1.ServicePort{{Port: 80}}},
	}
}

// TestExposureAudit_ServiceSeverities pins the ranking between the two service
// types that actually expose something, and that ClusterIP is ignored entirely.
func TestExposureAudit_ServiceSeverities(t *testing.T) {
	kc := &Client{
		Clientset: fake.NewSimpleClientset(
			svcOfType("default", "lb", corev1.ServiceTypeLoadBalancer),
			svcOfType("default", "np", corev1.ServiceTypeNodePort),
			svcOfType("default", "cip", corev1.ServiceTypeClusterIP),
			svcOfType("default", "ext", corev1.ServiceTypeExternalName),
		),
		Logger: zap.NewNop(),
	}
	rep, err := kc.ExposureAudit(context.Background())
	if err != nil {
		t.Fatalf("ExposureAudit: %v", err)
	}
	if len(rep.Items) != 2 {
		t.Fatalf("got %d items, want 2 — ClusterIP and ExternalName expose nothing: %+v", len(rep.Items), rep.Items)
	}
	// Sorted high first.
	if rep.Items[0].Type != "LoadBalancer" || rep.Items[0].Severity != "high" {
		t.Errorf("first item = %s/%s, want LoadBalancer/high", rep.Items[0].Type, rep.Items[0].Severity)
	}
	if rep.Items[1].Type != "NodePort" || rep.Items[1].Severity != "medium" {
		t.Errorf("second item = %s/%s, want NodePort/medium", rep.Items[1].Type, rep.Items[1].Severity)
	}
	if rep.LoadBalancers != 1 || rep.NodePorts != 1 {
		t.Errorf("LoadBalancers/NodePorts = %d/%d, want 1/1", rep.LoadBalancers, rep.NodePorts)
	}
}

// TestExposureAudit_CountsAlwaysCarryEveryKey: the counts map is pre-seeded, so
// a UI reading Counts["high"] never hits a missing key.
func TestExposureAudit_CountsAlwaysCarryEveryKey(t *testing.T) {
	kc := &Client{Clientset: fake.NewSimpleClientset(), Logger: zap.NewNop()}
	rep, err := kc.ExposureAudit(context.Background())
	if err != nil {
		t.Fatalf("ExposureAudit: %v", err)
	}
	for _, k := range []string{"high", "medium", "low"} {
		if _, ok := rep.Counts[k]; !ok {
			t.Errorf("Counts is missing key %q: %+v", k, rep.Counts)
		}
	}
}

func ingressWith(name string, tls []networkingv1.IngressTLS, hosts ...string) *networkingv1.Ingress {
	ing := &networkingv1.Ingress{
		ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: "default"},
		Spec:       networkingv1.IngressSpec{TLS: tls},
	}
	for _, h := range hosts {
		ing.Spec.Rules = append(ing.Spec.Rules, networkingv1.IngressRule{Host: h})
	}
	return ing
}

// TestExposureAudit_IngressTLS pins the "is every routed host actually covered
// by TLS?" rule. Partial coverage must NOT read as secure — that is the case a
// naive len(spec.tls) > 0 check gets wrong, and it is the whole point of the
// per-host comparison.
func TestExposureAudit_IngressTLS(t *testing.T) {
	cases := []struct {
		name    string
		ingress *networkingv1.Ingress
		wantSev string
		wantTLS bool
	}{
		{
			"every host covered",
			ingressWith("full", []networkingv1.IngressTLS{{Hosts: []string{"a.example"}}}, "a.example"),
			"low", true,
		},
		{
			"no tls block at all",
			ingressWith("plain", nil, "a.example"),
			"medium", false,
		},
		{
			// Two routed hosts, only one in the TLS block: the other is served
			// plaintext, so the ingress as a whole is not TLS.
			"partial coverage is not secure",
			ingressWith("partial", []networkingv1.IngressTLS{{Hosts: []string{"a.example"}}}, "a.example", "b.example"),
			"medium", false,
		},
		{
			// A default/wildcard cert with no rule hosts: nothing contradicts it.
			"tls block with no routed hosts stays low",
			ingressWith("wildcard", []networkingv1.IngressTLS{{SecretName: "wildcard-cert"}}),
			"low", true,
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			kc := &Client{Clientset: fake.NewSimpleClientset(c.ingress), Logger: zap.NewNop()}
			rep, err := kc.ExposureAudit(context.Background())
			if err != nil {
				t.Fatalf("ExposureAudit: %v", err)
			}
			if len(rep.Items) != 1 {
				t.Fatalf("got %d items, want 1: %+v", len(rep.Items), rep.Items)
			}
			it := rep.Items[0]
			if it.Severity != c.wantSev {
				t.Errorf("Severity = %q, want %q", it.Severity, c.wantSev)
			}
			if it.TLS == nil {
				t.Fatal("TLS pointer is nil, want a set value")
			}
			if *it.TLS != c.wantTLS {
				t.Errorf("TLS = %v, want %v", *it.TLS, c.wantTLS)
			}
			wantPlaintext := 0
			if !c.wantTLS {
				wantPlaintext = 1
			}
			if rep.PlaintextIng != wantPlaintext {
				t.Errorf("PlaintextIng = %d, want %d", rep.PlaintextIng, wantPlaintext)
			}
		})
	}
}
