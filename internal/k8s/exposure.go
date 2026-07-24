package k8s

import (
	"context"
	"fmt"
	"sort"
	"strings"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// ExposureItem is one externally reachable entry — a Service that leaves the
// cluster (LoadBalancer / NodePort) or an Ingress route.
type ExposureItem struct {
	Severity  string `json:"severity"` // high | medium | low
	Type      string `json:"type"`     // LoadBalancer | NodePort | Ingress
	Namespace string `json:"namespace"`
	Name      string `json:"name"`
	Address   string `json:"address,omitempty"` // LB IP/host, node:nodePort, or ingress host(s)
	Ports     string `json:"ports,omitempty"`
	TLS       *bool  `json:"tls,omitempty"` // Ingress only
	Detail    string `json:"detail,omitempty"`
}

// ExposureReport is the cluster's external attack surface.
type ExposureReport struct {
	Items         []ExposureItem `json:"items"`
	Counts        map[string]int `json:"counts"` // by severity
	LoadBalancers int            `json:"load_balancers"`
	NodePorts     int            `json:"node_ports"`
	Ingresses     int            `json:"ingresses"`
	PlaintextIng  int            `json:"plaintext_ingresses"`
}

var exposureSevRank = map[string]int{"high": 3, "medium": 2, "low": 1}

// ExposureAudit inventories everything reachable from outside the cluster:
// LoadBalancer and NodePort Services, and Ingress routes — flagging Ingresses
// served without TLS. It is read-only. Severity reflects reach: a LoadBalancer
// (routable IP) is higher than a NodePort, and a plaintext Ingress higher than
// one with TLS.
func (c *Client) ExposureAudit(ctx context.Context) (*ExposureReport, error) {
	rep := &ExposureReport{Counts: map[string]int{"high": 0, "medium": 0, "low": 0}}

	svcs, err := c.Clientset.CoreV1().Services("").List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	for i := range svcs.Items {
		s := &svcs.Items[i]
		switch s.Spec.Type {
		case corev1.ServiceTypeLoadBalancer:
			rep.LoadBalancers++
			rep.Items = append(rep.Items, ExposureItem{
				Severity: "high", Type: "LoadBalancer", Namespace: s.Namespace, Name: s.Name,
				Address: lbAddress(s), Ports: servicePorts(s),
				Detail: "routable from outside the cluster"})
		case corev1.ServiceTypeNodePort:
			rep.NodePorts++
			rep.Items = append(rep.Items, ExposureItem{
				Severity: "medium", Type: "NodePort", Namespace: s.Namespace, Name: s.Name,
				Address: nodePortAddress(s), Ports: servicePorts(s),
				Detail: "reachable on every node's IP"})
		}
	}

	ings, err := c.Clientset.NetworkingV1().Ingresses("").List(ctx, metav1.ListOptions{})
	if err == nil {
		for i := range ings.Items {
			ing := &ings.Items[i]
			rep.Ingresses++
			tlsHosts := map[string]bool{}
			for _, t := range ing.Spec.TLS {
				for _, h := range t.Hosts {
					tlsHosts[h] = true
				}
			}
			var hosts []string
			allTLS := len(ing.Spec.TLS) > 0
			for _, rule := range ing.Spec.Rules {
				if rule.Host != "" {
					hosts = append(hosts, rule.Host)
					if !tlsHosts[rule.Host] {
						allTLS = false
					}
				}
			}
			tls := allTLS
			sev := "low"
			detail := "TLS terminated"
			if !tls {
				sev = "medium"
				detail = "served without TLS (plaintext HTTP)"
				rep.PlaintextIng++
			}
			rep.Items = append(rep.Items, ExposureItem{
				Severity: sev, Type: "Ingress", Namespace: ing.Namespace, Name: ing.Name,
				Address: strings.Join(hosts, ", "), TLS: &tls, Detail: detail})
		}
	}

	for _, it := range rep.Items {
		rep.Counts[it.Severity]++
	}
	sort.SliceStable(rep.Items, func(a, b int) bool {
		ia, ib := rep.Items[a], rep.Items[b]
		if exposureSevRank[ia.Severity] != exposureSevRank[ib.Severity] {
			return exposureSevRank[ia.Severity] > exposureSevRank[ib.Severity]
		}
		if ia.Namespace != ib.Namespace {
			return ia.Namespace < ib.Namespace
		}
		return ia.Name < ib.Name
	})
	return rep, nil
}

func servicePorts(s *corev1.Service) string {
	var parts []string
	for _, p := range s.Spec.Ports {
		seg := fmt.Sprintf("%d", p.Port)
		if p.NodePort != 0 {
			seg += fmt.Sprintf(":%d", p.NodePort)
		}
		if p.Protocol != "" && p.Protocol != corev1.ProtocolTCP {
			seg += "/" + string(p.Protocol)
		}
		parts = append(parts, seg)
	}
	return strings.Join(parts, ", ")
}

func lbAddress(s *corev1.Service) string {
	var addrs []string
	for _, ing := range s.Status.LoadBalancer.Ingress {
		if ing.IP != "" {
			addrs = append(addrs, ing.IP)
		} else if ing.Hostname != "" {
			addrs = append(addrs, ing.Hostname)
		}
	}
	if len(addrs) == 0 {
		return "pending"
	}
	return strings.Join(addrs, ", ")
}

func nodePortAddress(s *corev1.Service) string {
	var np []string
	for _, p := range s.Spec.Ports {
		if p.NodePort != 0 {
			np = append(np, fmt.Sprintf("<node>:%d", p.NodePort))
		}
	}
	return strings.Join(np, ", ")
}
