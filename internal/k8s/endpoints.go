package k8s

import (
	"context"
	"fmt"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

type EndpointAddress struct {
	IP        string `json:"ip"`
	NodeName  string `json:"node_name"`
	TargetRef string `json:"target_ref"`
}

type EndpointPort struct {
	Name     string `json:"name"`
	Port     int32  `json:"port"`
	Protocol string `json:"protocol"`
}

type EndpointSummary struct {
	Name        string            `json:"name"`
	Namespace   string            `json:"namespace"`
	Subsets     int               `json:"subsets"`
	Addresses   int               `json:"addresses"`
	Ports       []EndpointPort    `json:"ports"`
	Ready       int               `json:"ready"`
	NotReady    int               `json:"not_ready"`
	ReadyAddrs  []EndpointAddress `json:"ready_addrs,omitempty"`
	NotReadyAddrs []EndpointAddress `json:"not_ready_addrs,omitempty"`
	Labels      map[string]string `json:"labels"`
	CreatedAt   time.Time         `json:"created_at"`
}

func (c *Client) ListEndpoints(ctx context.Context, namespace string) ([]EndpointSummary, error) {
	list, err := c.Clientset.CoreV1().Endpoints(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("listing endpoints: %w", err)
	}
	out := make([]EndpointSummary, len(list.Items))
	for i := range list.Items {
		ep := &list.Items[i]
		var ready, notReady int
		var ports []EndpointPort
		var readyAddrs, notReadyAddrs []EndpointAddress
		for _, subset := range ep.Subsets {
			ready += len(subset.Addresses)
			notReady += len(subset.NotReadyAddresses)
			for _, a := range subset.Addresses {
				ea := EndpointAddress{IP: a.IP}
				if a.NodeName != nil {
					ea.NodeName = *a.NodeName
				}
				if a.TargetRef != nil {
					ea.TargetRef = a.TargetRef.Name
				}
				readyAddrs = append(readyAddrs, ea)
			}
			for _, a := range subset.NotReadyAddresses {
				ea := EndpointAddress{IP: a.IP}
				if a.NodeName != nil {
					ea.NodeName = *a.NodeName
				}
				if a.TargetRef != nil {
					ea.TargetRef = a.TargetRef.Name
				}
				notReadyAddrs = append(notReadyAddrs, ea)
			}
			for _, p := range subset.Ports {
				ports = append(ports, EndpointPort{
					Name:     p.Name,
					Port:     p.Port,
					Protocol: string(p.Protocol),
				})
			}
		}
		out[i] = EndpointSummary{
			Name:          ep.Name,
			Namespace:     ep.Namespace,
			Subsets:       len(ep.Subsets),
			Addresses:     ready + notReady,
			Ports:         ports,
			Ready:         ready,
			NotReady:      notReady,
			ReadyAddrs:    readyAddrs,
			NotReadyAddrs: notReadyAddrs,
			Labels:        ep.Labels,
			CreatedAt:     ep.CreationTimestamp.Time,
		}
	}
	return out, nil
}
