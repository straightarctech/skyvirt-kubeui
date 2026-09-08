package api

import (
	"context"
	"io"
	"net/http"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/gorilla/websocket"

	"github.com/straightarctech/skyvirt-kubeui/internal/k8s"
	"k8s.io/client-go/tools/remotecommand"
)

// execPingPeriod is how often the exec socket sends a keepalive ping. A failed
// ping write means the client is gone, so we cancel the pod-exec stream instead
// of leaking the SPDY session and its goroutine on a half-open connection.
const execPingPeriod = 30 * time.Second

var wsUpgrader = websocket.Upgrader{
	ReadBufferSize:  4096,
	WriteBufferSize: 4096,
	CheckOrigin:     IsAllowedOrigin,
}

// ExecHandler serves the pod exec WebSocket endpoint.
type ExecHandler struct {
	kc *k8s.Client
}

func execHandler(kc *k8s.Client) *ExecHandler {
	return &ExecHandler{kc: kc}
}

// Exec upgrades the HTTP connection to a WebSocket, then connects to the pod
// via SPDY remotecommand and pipes stdin/stdout/stderr between the WebSocket
// client and the container shell.
//
// Query params:
//
//	container (optional) - target container name
//	command   (optional) - command to run (default: /bin/sh)
func (h *ExecHandler) Exec(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "namespace")
	podName := chi.URLParam(r, "name")
	container := r.URL.Query().Get("container")
	command := r.URL.Query().Get("command")
	if command == "" {
		command = "/bin/sh"
	}

	// Build the SPDY exec request via the k8s client helper.
	execReq := h.kc.GetExecRequest(ns, podName, container, []string{command})

	// Create the SPDY executor.
	exec, err := remotecommand.NewSPDYExecutor(h.kc.RestConfig, "POST", execReq.URL())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "creating SPDY executor: "+err.Error())
		return
	}

	// Upgrade to WebSocket.
	conn, err := wsUpgrader.Upgrade(w, r, nil)
	if err != nil {
		// Upgrade already wrote the error response.
		return
	}
	defer conn.Close()

	// Adapter: pipe WebSocket <-> SPDY streams.
	wsStream := &wsStreamAdapter{conn: conn}

	// Keepalive: a hijacked request's context is no longer cancelled on client
	// disconnect, so ping periodically and cancel the stream when a ping write
	// fails (client gone) rather than leaking the exec session. WriteControl is
	// safe to call concurrently with the adapter's writes.
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	go func() {
		t := time.NewTicker(execPingPeriod)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				if werr := conn.WriteControl(websocket.PingMessage, nil, time.Now().Add(5*time.Second)); werr != nil {
					cancel()
					return
				}
			}
		}
	}()

	// Stream blocks until the command finishes or the connection breaks.
	err = exec.StreamWithContext(ctx, remotecommand.StreamOptions{
		Stdin:  wsStream,
		Stdout: wsStream,
		Stderr: wsStream,
		Tty:    true,
	})
	if err != nil {
		// Surface the failure (missing shell, RBAC denial, container gone)
		// in the terminal instead of a silent disconnect.
		_, _ = wsStream.Write([]byte("\r\n[exec error] " + err.Error() + "\r\n"))
	}
}

// wsStreamAdapter adapts a gorilla/websocket.Conn to the io.Reader / io.Writer
// interfaces that remotecommand.StreamOptions expects.
type wsStreamAdapter struct {
	conn   *websocket.Conn
	wmu    sync.Mutex // protects writes
	rmu    sync.Mutex // protects reads and reader state
	reader io.Reader  // leftover bytes from a partially-read WebSocket message
}

// Read satisfies io.Reader — it reads data from incoming WebSocket messages.
func (ws *wsStreamAdapter) Read(p []byte) (int, error) {
	ws.rmu.Lock()
	defer ws.rmu.Unlock()

	// If we have leftover bytes from a previous message, consume those first.
	if ws.reader != nil {
		n, err := ws.reader.Read(p)
		if err == io.EOF {
			ws.reader = nil
			if n > 0 {
				return n, nil
			}
			// Fall through to read the next message.
		} else {
			return n, err
		}
	}

	_, reader, err := ws.conn.NextReader()
	if err != nil {
		return 0, err
	}
	ws.reader = reader
	return ws.reader.Read(p)
}

// Write satisfies io.Writer — it sends data as a WebSocket binary message.
func (ws *wsStreamAdapter) Write(p []byte) (int, error) {
	ws.wmu.Lock()
	defer ws.wmu.Unlock()
	err := ws.conn.WriteMessage(websocket.BinaryMessage, p)
	if err != nil {
		return 0, err
	}
	return len(p), nil
}
