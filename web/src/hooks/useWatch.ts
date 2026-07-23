import { useEffect, useRef, useState } from "react";
import { getAuthToken } from "@/hooks/useAuth";

export type WatchStatus = "connecting" | "live" | "paused" | "error";

export interface WatchEvent {
  type: "ADDED" | "MODIFIED" | "DELETED" | "ERROR";
  kind: string;
  namespace?: string;
  name?: string;
  resourceVersion?: string;
  error?: string;
  /** Mapped summary for hot kinds (typed deltas); absent → client refetches. */
  object?: unknown;
}

const MAX_BACKOFF = 15000;

/**
 * Opens a single watch WebSocket to /api/v1/watch with exponential-backoff
 * reconnect, pause-on-tab-hidden, and status callbacks. Framework-agnostic —
 * returns a close function. Shared by useWatch (one kind) and useLiveResources
 * (several kinds behind one indicator).
 */
export function openWatchConnection(opts: {
  kind: string;
  namespace?: string;
  onEvent: (ev: WatchEvent) => void;
  onStatus: (s: WatchStatus) => void;
}): () => void {
  const { kind, namespace, onEvent, onStatus } = opts;
  let ws: WebSocket | null = null;
  let backoff = 500;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  const connect = () => {
    if (closed || document.hidden) return;
    onStatus("connecting");
    const token = getAuthToken();
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const q = new URLSearchParams({ kind });
    if (namespace && namespace !== "all") q.set("namespace", namespace);
    if (token) q.set("token", token);
    ws = new WebSocket(`${proto}//${window.location.host}/api/v1/watch?${q.toString()}`);
    ws.onopen = () => { backoff = 500; onStatus("live"); };
    ws.onmessage = (e) => {
      try {
        const ev = JSON.parse(e.data) as WatchEvent;
        if (ev.type === "ERROR") onStatus("error");
        onEvent(ev);
      } catch { /* ignore malformed frames */ }
    };
    ws.onclose = () => {
      if (closed) return;
      onStatus("connecting");
      scheduleReconnect();
    };
    ws.onerror = () => { ws?.close(); };
  };

  const scheduleReconnect = () => {
    if (closed || reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      backoff = Math.min(backoff * 2, MAX_BACKOFF);
      connect();
    }, backoff);
  };

  const onVisibility = () => {
    if (document.hidden) {
      onStatus("paused");
      ws?.close();
    } else if (!ws || ws.readyState === WebSocket.CLOSED) {
      connect();
    }
  };

  document.addEventListener("visibilitychange", onVisibility);
  connect();

  return () => {
    closed = true;
    document.removeEventListener("visibilitychange", onVisibility);
    if (reconnectTimer) clearTimeout(reconnectTimer);
    ws?.close();
  };
}

interface UseWatchOptions {
  kind: string;
  namespace?: string;
  enabled?: boolean;
  onEvent: (ev: WatchEvent) => void;
}

/**
 * Subscribe to live changes for a single kind. Returns the connection status.
 * Closes on unmount, when disabled, or when the tab is hidden (resumes on show).
 */
export function useWatch({ kind, namespace, enabled = true, onEvent }: UseWatchOptions): WatchStatus {
  const [status, setStatus] = useState<WatchStatus>("connecting");
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!enabled) {
      setStatus("paused");
      return;
    }
    return openWatchConnection({
      kind,
      namespace,
      onEvent: (ev) => onEventRef.current(ev),
      onStatus: setStatus,
    });
  }, [kind, namespace, enabled]);

  return status;
}
