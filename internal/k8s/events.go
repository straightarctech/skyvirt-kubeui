package k8s

import (
	"context"
	"fmt"
	"sort"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// EventSummary is the API-friendly event representation.
type EventSummary struct {
	Namespace      string    `json:"namespace"`
	Name           string    `json:"name"`
	Type           string    `json:"type"`
	Reason         string    `json:"reason"`
	Message        string    `json:"message"`
	RegardingKind  string    `json:"regarding_kind"`
	RegardingName  string    `json:"regarding_name"`
	Source         string    `json:"source"`
	Count          int32     `json:"count"`
	FirstSeen      time.Time `json:"first_seen"`
	LastSeen       time.Time `json:"last_seen"`
}

func eventSource(ev *corev1.Event) string {
	if ev.Source.Component != "" {
		s := ev.Source.Component
		if ev.Source.Host != "" {
			s += "/" + ev.Source.Host
		}
		return s
	}
	if ev.ReportingController != "" {
		return ev.ReportingController
	}
	return ""
}

func toEventSummary(ev *corev1.Event) EventSummary {
	firstSeen := ev.FirstTimestamp.Time
	lastSeen := ev.LastTimestamp.Time
	if firstSeen.IsZero() && ev.EventTime.Time != (time.Time{}) {
		firstSeen = ev.EventTime.Time
	}
	if lastSeen.IsZero() {
		lastSeen = firstSeen
	}

	return EventSummary{
		Namespace:     ev.Namespace,
		Name:          ev.Name,
		Type:          ev.Type,
		Reason:        ev.Reason,
		Message:       ev.Message,
		RegardingKind: ev.InvolvedObject.Kind,
		RegardingName: ev.InvolvedObject.Name,
		Source:        eventSource(ev),
		Count:         ev.Count,
		FirstSeen:     firstSeen,
		LastSeen:      lastSeen,
	}
}

// ListEvents returns events in a namespace sorted by last timestamp descending.
// Pass "" for all namespaces.
func (c *Client) ListEvents(ctx context.Context, namespace string) ([]EventSummary, error) {
	list, err := c.Clientset.CoreV1().Events(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("listing events: %w", err)
	}
	out := make([]EventSummary, len(list.Items))
	for i := range list.Items {
		out[i] = toEventSummary(&list.Items[i])
	}
	// Sort by last_seen descending.
	sort.Slice(out, func(i, j int) bool {
		return out[i].LastSeen.After(out[j].LastSeen)
	})
	return out, nil
}
