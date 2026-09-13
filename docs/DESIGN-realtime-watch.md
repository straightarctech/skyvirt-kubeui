# Design — Real-time watch on lists (Roadmap #1)

Goal: lists and detail pages update **live** as cluster state changes, instead of
needing a manual Refresh. This is the single biggest "feel" gap vs Rancher (whose
Steve API is watch-native) and the foundation bulk-actions / diagnose flows build on.

## Current state (grounded in code)

- **Backend** (`internal/k8s/client.go`): `k8s.Client` wraps a typed `Clientset`, a
  `DynamicClient`, and a metrics client. **No informers** — every handler does a direct
  `.List()`. Routes are chi under `/api/v1`, JWT-protected.
- **WebSockets already work**: `internal/api/exec.go` uses `gorilla/websocket`
  (`wsUpgrader`) for pod exec; the logging middleware's `statusWriter` implements
  `http.Hijacker` (`internal/api/middleware.go:49`) so upgrades pass through.
- **WS auth is already solved**: `internal/auth/auth.go:93` reads the JWT from the
  `?token=` query param on upgrade requests (browsers can't set headers on WS). A new
  watch endpoint inherits this automatically.
- **Frontend** (`web/src/hooks/useResource.ts`): one-shot fetch + manual `refresh()`;
  **every list page uses it**. WS client pattern already exists (`PodDetail.tsx`,
  `Terminal.tsx`): `wss?://host/api/v1/…?token=<jwt>`.
- **GVR resolver** (`internal/k8s/apply.go` `findGVKForKind`): resolves any kind → GVR
  incl. CRDs. A single dynamic-client watch can therefore watch anything.

## Approach — phased, lowest-risk first

Three backend options were considered:

| Option | What | Verdict |
|--------|------|---------|
| **A. Per-subscription watch proxy** (dynamic client `.Watch()` per WS) | Each open list opens a WS; backend streams that GVR's events | **Chosen for Phase 1–2.** Simple, CRD-agnostic (reuses GVR resolver), adequate for a single-cluster console with a handful of operators. |
| B. SharedInformerFactory | Shared informer cache; WS subscribers get deltas from cache | Phase 3 if concurrent-tab watch count becomes a load problem. More complex (lifecycle, memory, dynamic informers). |
| C. ETag/resourceVersion polling | Cheap-ish poll | Not real-time; rejected. |

The REST list endpoints return **mapped summaries** (e.g. `PodSummary`), not raw
objects — so the watch can't naively stream raw objects and have them match. That
splits Phase 1 from Phase 2.

### Phase 1 — "live refresh" via watch-signal  (size: **M**, ~2–3 days)
The WS streams **compact change signals**; the frontend **debounced-refetches** the
existing typed list. Reuses every existing list endpoint + all rendering unchanged.

- **New endpoint** `GET /api/v1/watch?kind=Pod&namespace=<ns|all>&token=<jwt>` (WS upgrade).
  Resolve GVR via `findGVKForKind`, call `DynamicClient.Resource(gvr).Namespace(ns).Watch(ctx, …)`,
  and for each event send:
  ```json
  { "type": "ADDED|MODIFIED|DELETED|BOOKMARK|ERROR",
    "kind": "Pod", "namespace": "x", "name": "y", "resourceVersion": "123" }
  ```
  Handle `410 Gone` (expired RV) by re-issuing the watch server-side; ping/pong keepalive.
- **Frontend hook** `useLiveResource(fetcher, {kind, namespace})` = `useResource` +
  a `useWatch` WS that, on any event for that resource, **coalesces (≈500 ms) then
  calls `refresh()`**. A `<LiveIndicator>` (green "Live" / grey "Paused", click to
  toggle) sits in the page header; auto-reconnect with backoff; pause on tab-hidden.
- **Pilot pages**: Pods, Deployments, Events (highest churn). Then sweep the rest by
  swapping `useResource` → `useLiveResource` (the wiring is mechanical, like pagination).

Trade-off: a change burst triggers a full re-list (mitigated by coalescing). Perfectly
acceptable for the pilot and eliminates the Refresh button.

### Phase 2 — typed deltas (size: **M**)
For the heaviest lists (Pods), stream the **mapped summary** in the event `object`
field and patch rows in place (add/update/remove) — no re-list. Requires refactoring
each resource's per-item mapping out of its `List()` into a shared `mapX(obj)` used by
both List and Watch. Start with Pods, extend opportunistically.

### Phase 3 — SharedInformerFactory (size: **L**)
Only if N concurrent tabs × M open lists creates too many apiserver watches. Shared
informers collapse that to one watch per type and also warm the initial list.

## Files to touch (Phase 1)

**Backend**
- `internal/k8s/watch.go` *(new)* — `WatchResource(ctx, kind, namespace) (watch.Interface, error)`
  using `resolveGVR` + `DynamicClient…Watch`; wraps re-watch on `410`.
- `internal/api/watch.go` *(new)* — WS handler: reuse `wsUpgrader`; stream events;
  ping/pong; close on client gone / ctx cancel.
- `internal/api/router.go` — `api.Get("/watch", wh.Watch)` inside the JWT group.

**Frontend**
- `web/src/hooks/useWatch.ts` *(new)* — open WS to `/api/v1/watch`, reconnect w/ backoff,
  `onEvent` callback, pause/resume, close on unmount.
- `web/src/hooks/useLiveResource.ts` *(new)* — `useResource` + `useWatch` → coalesced refresh.
- `web/src/components/LiveIndicator.tsx` *(new)* — live/paused pill.
- Wire Pods / Deployments / Events (`useResource` → `useLiveResource`).

## Cross-cutting concerns
- **Reconnect / 410 Gone**: Phase 1 refetches on (re)connect, so expired-RV and dropped
  connections self-heal. Backend restarts the apiserver watch on 410.
- **Namespace scope**: `All Namespaces` → cluster-wide watch; single-ns → namespaced.
- **Backpressure**: coalesce refetch (P1) / batch deltas (P2); cap events/sec.
- **Lifecycle**: frontend closes the WS on unmount / route change; backend cancels the
  watch on WS close. Cap concurrent watches per connection.
- **Auth/RBAC**: inherits the JWT middleware (`?token=`) and the console's cluster-scoped
  client — same permissions as the REST reads.
- **Metrics are NOT watchable** (metrics API has no watch) — live CPU/mem stays on the
  existing client-rolling poll; watch covers resource objects only.

## Effort summary
Phase 1 **M** (~2–3 days) delivers the visible win (no more Refresh button on the pilot
pages + a live indicator). Phase 2 **M** removes re-list on the hot paths. Phase 3 **L**
only if scale demands it. Recommend building Phase 1, validating on UAT, then sweeping.
