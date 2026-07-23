package api

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/gorilla/websocket"

	"github.com/straightarctech/skyvirt-kubeui/internal/k8s"
	"k8s.io/apimachinery/pkg/api/meta"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/watch"
)

// watchObjectMappers convert a changed object into the same summary shape the
// list endpoint returns, enabling typed deltas (patch-in-place) for hot kinds.
// Kinds without a mapper fall back to the Phase-1 signal → refetch behavior.
var watchObjectMappers = map[string]func(*unstructured.Unstructured) (any, error){
	"Pod":        k8s.PodSummaryFromUnstructured,
	"Deployment": k8s.DeploymentSummaryFromUnstructured,
	"Service":    k8s.ServiceSummaryFromUnstructured,
}

const (
	watchPongWait   = 60 * time.Second
	watchPingPeriod = (watchPongWait * 9) / 10
	watchWriteWait  = 10 * time.Second
)

// WatchHandler streams Kubernetes watch events for a kind over a WebSocket.
type WatchHandler struct {
	kc *k8s.Client
}

func watchHandler(kc *k8s.Client) *WatchHandler {
	return &WatchHandler{kc: kc}
}

// watchMessage is the compact change signal sent to the client. Phase 1 carries
// only identity — the frontend coalesces these and refetches the typed list.
type watchMessage struct {
	Type            string          `json:"type"` // ADDED | MODIFIED | DELETED | ERROR
	Kind            string          `json:"kind"`
	Namespace       string          `json:"namespace,omitempty"`
	Name            string          `json:"name,omitempty"`
	ResourceVersion string          `json:"resourceVersion,omitempty"`
	Error           string          `json:"error,omitempty"`
	// Object is the mapped summary for kinds with a watchObjectMapper (typed
	// deltas); absent for other kinds (the client refetches instead).
	Object json.RawMessage `json:"object,omitempty"`
}

// Watch upgrades to a WebSocket and streams watch events for the requested kind.
//
// Query params:
//
//	kind      (required) - resource kind, e.g. "Pod" (CRDs resolved via GVR search)
//	namespace (optional) - namespace, or "" / "all" for cluster-wide
func (h *WatchHandler) Watch(w http.ResponseWriter, r *http.Request) {
	kind := r.URL.Query().Get("kind")
	if kind == "" {
		writeError(w, http.StatusBadRequest, "kind is required")
		return
	}
	namespace := r.URL.Query().Get("namespace")

	conn, err := wsUpgrader.Upgrade(w, r, nil)
	if err != nil {
		return // Upgrade already wrote the error.
	}
	defer conn.Close()

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	// Reader goroutine: drains control frames (pong) and detects client close.
	conn.SetReadLimit(512)
	_ = conn.SetReadDeadline(time.Now().Add(watchPongWait))
	conn.SetPongHandler(func(string) error {
		return conn.SetReadDeadline(time.Now().Add(watchPongWait))
	})
	go func() {
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				cancel()
				return
			}
		}
	}()

	ping := time.NewTicker(watchPingPeriod)
	defer ping.Stop()

	send := func(m watchMessage) error {
		_ = conn.SetWriteDeadline(time.Now().Add(watchWriteWait))
		return conn.WriteJSON(m)
	}

	// Re-watch loop: an apiserver watch expires periodically (channel closes) —
	// we transparently re-establish it from the last resourceVersion. A 410-style
	// watch.Error resets the resourceVersion to re-list from current.
	var rv string
	for {
		wi, err := h.kc.WatchResource(ctx, kind, namespace, rv)
		if err != nil {
			_ = send(watchMessage{Type: "ERROR", Kind: kind, Error: err.Error()})
			return // client reconnects with its own backoff
		}
		reconnect := streamWatch(ctx, conn, ping, send, wi, kind, &rv)
		wi.Stop()
		if !reconnect {
			return
		}
	}
}

// streamWatch pumps one watch.Interface to the client until the channel closes
// (returns true → re-watch) or the connection/context ends (returns false).
func streamWatch(
	ctx context.Context,
	conn *websocket.Conn,
	ping *time.Ticker,
	send func(watchMessage) error,
	wi watch.Interface,
	kind string,
	rv *string,
) bool {
	ch := wi.ResultChan()
	for {
		select {
		case <-ctx.Done():
			return false
		case <-ping.C:
			_ = conn.SetWriteDeadline(time.Now().Add(watchWriteWait))
			if err := conn.WriteControl(websocket.PingMessage, nil, time.Now().Add(watchWriteWait)); err != nil {
				return false
			}
		case ev, ok := <-ch:
			if !ok {
				return true // watch expired — re-establish from *rv
			}
			if ev.Type == watch.Error {
				*rv = "" // 410 Gone / expired — re-list from current
				return true
			}
			accessor, err := meta.Accessor(ev.Object)
			if err != nil {
				continue
			}
			*rv = accessor.GetResourceVersion()
			if ev.Type == watch.Bookmark {
				continue // advance rv only; don't wake the client
			}

			// Typed delta: attach the mapped summary for hot kinds so the client
			// patches in place instead of refetching the whole list.
			var objJSON json.RawMessage
			if mapper, ok := watchObjectMappers[kind]; ok && ev.Type != watch.Deleted {
				if u, ok := ev.Object.(*unstructured.Unstructured); ok {
					if summary, mErr := mapper(u); mErr == nil {
						if b, jErr := json.Marshal(summary); jErr == nil {
							objJSON = b
						}
					}
				}
			}

			if err := send(watchMessage{
				Type:            string(ev.Type),
				Kind:            kind,
				Namespace:       accessor.GetNamespace(),
				Name:            accessor.GetName(),
				ResourceVersion: *rv,
				Object:          objJSON,
			}); err != nil {
				return false
			}
		}
	}
}
