import { useEffect, useRef, useState } from "react";
import { getAuthToken } from "@/hooks/useAuth";

/**
 * "unavailable" = the server says this kind has no API endpoint in this cluster
 * (an optional operator such as MetalLB or Multus isn't installed). Permanent,
 * expected, and NOT an error to retry — distinct from "error" (transient).
 */
export type WatchStatus = "connecting" | "live" | "paused" | "error" | "unavailable";

export interface WatchEvent {
  type: "ADDED" | "MODIFIED" | "DELETED" | "ERROR";
  kind: string;
  namespace?: string;
  name?: string;
  resourceVersion?: string;
  error?: string;
  /** Classifies an ERROR frame; "not_installed" is permanent. */
  code?: string;
  /** Mapped summary for hot kinds (typed deltas); absent → client refetches. */
  object?: unknown;
}

const BASE_BACKOFF = 500;
const MAX_BACKOFF = 15000;
/**
 * A connection must survive this long before it counts as healthy enough to
 * reset the backoff. Without it, a socket that upgrades cleanly and is then
 * closed immediately by the server (unwatchable kind) resets the backoff on
 * every open → a 500ms reconnect loop that flickers the whole page.
 */
const STABLE_MS = 5000;

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
  let backoff = BASE_BACKOFF;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;
  // Per-connection state, used to decide whether a close is worth retrying fast.
  let openedAt = 0;
  let sawError = false;

  const connect = () => {
    if (closed || document.hidden) return;
    onStatus("connecting");
    const token = getAuthToken();
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const q = new URLSearchParams({ kind });
    if (namespace && namespace !== "all") q.set("namespace", namespace);
    if (token) q.set("token", token);
    ws = new WebSocket(`${proto}//${window.location.host}/api/v1/watch?${q.toString()}`);
    ws.onopen = () => { openedAt = Date.now(); sawError = false; onStatus("live"); };
    ws.onmessage = (e) => {
      try {
        const ev = JSON.parse(e.data) as WatchEvent;
        if (ev.type === "ERROR") {
          sawError = true;
          if (ev.code === "not_installed") {
            // The kind doesn't exist here — reconnecting can never help.
            closed = true;
            onStatus("unavailable");
            ws?.close();
            return;
          }
          onStatus("error");
          return; // an error is not a change signal — never trigger a refetch
        }
        onEvent(ev);
      } catch { /* ignore malformed frames */ }
    };
    ws.onclose = () => {
      if (closed) return;
      // Only a connection that stayed up and healthy earns a fast retry;
      // otherwise keep backing off so a permanently-failing watch idles.
      if (!sawError && openedAt > 0 && Date.now() - openedAt >= STABLE_MS) backoff = BASE_BACKOFF;
      onStatus(sawError ? "error" : "connecting");
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
