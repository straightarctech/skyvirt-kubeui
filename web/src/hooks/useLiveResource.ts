import { useCallback, useEffect, useRef, useState } from "react";
import { useResource } from "@/hooks/useResource";
import { useWatch, openWatchConnection, type WatchStatus, type WatchEvent } from "@/hooks/useWatch";

interface UseLiveResourceResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
  /** Live-connection status for the <LiveIndicator>. */
  watchStatus: WatchStatus;
  /** Whether the user has live updates turned on. */
  live: boolean;
  setLive: (v: boolean) => void;
}

const COALESCE_MS = 500;

/**
 * useResource + a real-time watch.
 *
 * Phase 1 (default): watch events are change *signals* — a burst is coalesced
 * into a single refetch of the existing typed list, so every endpoint + renderer
 * is reused as-is.
 *
 * Phase 2 (opt-in via opts.keyOf, for a list of rows): when a delta carries the
 * mapped object, the row is patched IN PLACE (upsert on ADDED/MODIFIED, remove
 * on DELETED) — no re-list. Deltas without an object fall back to a refetch.
 */
export function useLiveResource<T>(
  fetcher: () => Promise<T>,
  kind: string,
  namespace: string | undefined,
  deps: unknown[] = [],
  opts?: { keyOf: (row: unknown) => string },
): UseLiveResourceResult<T> {
  const { data: fetched, loading, error, refresh } = useResource<T>(fetcher, deps);
  const [live, setLive] = useState(true);
  const keyOf = opts?.keyOf;

  // Local patchable copy for typed-delta mode; re-syncs on every (re)fetch.
  const [patched, setPatched] = useState<T | null>(fetched);
  useEffect(() => { setPatched(fetched); }, [fetched]);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  const coalescedRefresh = useCallback(() => {
    if (timer.current) return;
    timer.current = setTimeout(() => { timer.current = null; refreshRef.current(); }, COALESCE_MS);
  }, []);

  const onEvent = useCallback((ev: WatchEvent) => {
    if (keyOf && (ev.type === "DELETED" || ((ev.type === "ADDED" || ev.type === "MODIFIED") && ev.object))) {
      const evKey = `${ev.namespace ?? ""}/${ev.name ?? ""}`;
      setPatched((cur) => {
        const arr = Array.isArray(cur) ? [...(cur as unknown[])] : [];
        const idx = arr.findIndex((r) => keyOf(r) === evKey);
        if (ev.type === "DELETED") {
          if (idx >= 0) arr.splice(idx, 1);
        } else if (idx >= 0) {
          arr[idx] = ev.object;
        } else {
          arr.push(ev.object);
        }
        return arr as unknown as T;
      });
      return;
    }
    coalescedRefresh();
  }, [keyOf, coalescedRefresh]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const watchStatus = useWatch({ kind, namespace, enabled: live, onEvent });

  return { data: keyOf ? patched : fetched, loading, error, refresh, watchStatus, live, setLive };
}

export interface WatchSub {
  kind: string;
  namespace?: string;
}

interface UseLiveResourcesResult {
  watchStatus: WatchStatus;
  live: boolean;
  setLive: (v: boolean) => void;
}

/**
 * Multi-kind sibling of useLiveResource, for pages that render several resource
 * kinds (e.g. RBAC roles+bindings, MetalLB pools+advertisements). Opens one
 * watch per sub and, on any change, fires a single coalesced `onChange` — the
 * page wires that to refresh all its lists. Returns one aggregated status +
 * pause control to drive a single <LiveIndicator>.
 */
export function useLiveResources(subs: WatchSub[], onChange: () => void): UseLiveResourcesResult {
  const [live, setLive] = useState(true);
  const [watchStatus, setWatchStatus] = useState<WatchStatus>("connecting");

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  // Stable key so a new subs array literal each render doesn't churn connections.
  const key = subs.map((s) => `${s.kind}/${s.namespace ?? ""}`).join(",");

  useEffect(() => {
    if (!live) {
      setWatchStatus("paused");
      return;
    }
    const statuses = new Array<WatchStatus>(subs.length).fill("connecting");
    // Sticky per-sub: a watch that ever errors (e.g. an uninstalled CRD like
    // Multus NAD) shouldn't hold the whole indicator at "Connecting" forever —
    // the working watches still deliver live updates.
    const errored = new Array<boolean>(subs.length).fill(false);
    const aggregate = () => {
      if (statuses.every((s) => s === "paused")) { setWatchStatus("paused"); return; }
      const ok = statuses.map((s, i) => s === "live" || errored[i]);
      if (ok.every(Boolean) && statuses.some((s) => s === "live")) setWatchStatus("live");
      else if (errored.every(Boolean)) setWatchStatus("error");
      else setWatchStatus("connecting");
    };
    const fire = () => {
      if (timer.current) return;
      timer.current = setTimeout(() => {
        timer.current = null;
        onChangeRef.current();
      }, COALESCE_MS);
    };
    const closers = subs.map((s, i) =>
      openWatchConnection({
        kind: s.kind,
        namespace: s.namespace,
        onEvent: fire,
        onStatus: (st) => { statuses[i] = st; if (st === "error") errored[i] = true; aggregate(); },
      }),
    );
    return () => closers.forEach((close) => close());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, live]);

  return { watchStatus, live, setLive };
}
