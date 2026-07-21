# Changelog

All notable changes to SkyVirt KubeUI are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/), and the project aims to follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **"Open source on GitHub" link** on the sign-in screen and in the sidebar
  footer, pointing to the public repository.

## [1.7.5]

### Fixed

- **Page-size selector now applies.** Choosing a different rows-per-page value
  (e.g. 100/page) on any list was silently ignored — the selection reset back to
  the default. The size now takes effect immediately and persists in the URL
  (`?size=…`), so a chosen page size survives refreshes and shared links.

## [1.7.4]

### Changed

- **Animated distribution bar.** The compact status/type bar on the Pods,
  Services, and Events pages now grows in on load and re-flows smoothly when
  values change on a live refresh (e.g. a pod moving Pending → Running), instead
  of snapping.

## [1.7.3]

### Changed

- **Compact status breakdown restored.** The compact list summaries (1.7.2) kept
  the stat strip but dropped the visual distribution. Added a shared, single-row
  DistributionBar — a thin proportional stacked bar with an inline legend — to
  the Pods (by phase), Services (by type), and Events (by type) pages. The lists
  keep the compact strip and regain an at-a-glance breakdown without a tall
  chart panel.

## [1.7.2]

### Changed

- **Compact list summaries.** The Pods, Services, Resource Quotas, Alerts, and
  Events pages opened with a tall chart-heavy header (pie/donut + bar chart +
  count cards) that pushed the list below the fold and largely duplicated the
  table. Each now uses the shared compact summary strip — a single row of toned
  stat tiles (e.g. Pods → total / running / pending / failed / restarts / nodes)
  — so the list is visible immediately and the numbers are more actionable.
  Removed the associated chart dependencies from those pages.

## [1.7.1]

Final UX-polish pass following the 1.7.0 overhaul. No API changes.

### Fixed

- **Accessibility:** detail-page tabs are now a proper tablist (`role="tablist"`/
  `"tab"`, `aria-selected`, roving tabindex, Left/Right arrow navigation), and
  Endpoints rows can be expanded from the keyboard (Enter/Space, `aria-expanded`).
- Edit/create modals no longer discard a half-filled form when the backdrop is
  clicked mid-save.

### Changed

- **LoadBalancer delete** now uses the same type-to-confirm dialog (with the
  protection check and a success toast) as the Services page, instead of a
  weaker one-click confirm.
- Added the missing success toasts for Service YAML apply, PVC volume expansion,
  and L2 / MetalLB network-resource creation.
- On small screens, a search button exposes the ⌘K command palette (the full
  search box is desktop-only).

## [1.7.0]

An enterprise-grade UX overhaul from a full usability audit — resilience,
consistent feedback, accessibility, and mobile support. No API changes.

### Added

- **Responsive mobile navigation.** The sidebar is now an overlay drawer under
  `md` — a hamburger in the top bar opens it, a dimmed backdrop closes it, and it
  auto-closes on navigation. The console is usable on tablets and phones (content
  is full-width on mobile). Desktop behavior is unchanged.
- **Global error boundary.** A render error in any page previously blanked the
  whole app; it now shows a recoverable fallback (Try again / Back to dashboard /
  Reload + technical detail), keeps the nav alive, and auto-recovers on
  navigation. The 404 page gained a "Go to Dashboard" link.
- **Consistent action feedback.** Every create, edit, and delete now confirms
  with a toast (previously most closed silently).
- **Dashboard data-source health.** The command center surfaces a banner when
  some data sources fail to load, instead of rendering empty values as if the
  cluster were healthy.

### Changed

- **Readable API errors.** Failures now show the backend's message instead of a
  raw `500: {"kind":"Status",...}` blob.
- **Node drain** is no longer presented as a delete — it uses a drain-worded
  confirmation (with a pod-eviction note) instead of asking you to type the node
  name to "delete" it.
- **Safer bulk actions.** Destructive bulk operations require typing the action
  word to confirm, rather than a single click.
- Form-validation gates closed several submittable-but-invalid resources
  (Ingress path without a service, TLS/docker Secret fields, empty CronJob
  schedule, whitespace-only names).

### Fixed

- **Accessibility:** all dialogs (the shared confirm/delete plus the 14
  create/edit modals) now have `role="dialog"`/`aria-modal`, Escape-to-close, and
  an accessible label on the close button — previously none did.
- Sidebar highlighted two items at once on nested routes; empty-state and a
  literal-string rendering bug were corrected.

## [1.6.0]

Fixes from a full code audit (frontend logic, backend Go, security, API
contract, and numeric correctness). No API-shape changes beyond the corrected
field name and status codes noted below.

### Fixed

- **Restart counts always showed 0.** The client read `restart_count` but the
  API sends `restarts`, so every restart readout (Pods list/sort, PodDetail, the
  detail-page rollups, and the Dashboard high-restart alert) was stuck at 0.
- **Pod logs rendered as raw JSON.** The logs client returned the response body
  verbatim instead of parsing the `{ "logs": ... }` envelope, so viewers showed
  the literal JSON with escaped newlines.
- **Secret values were readable by any authenticated role.** The generic
  resource getter returned Secret manifests (base64 data included) with no
  role check, bypassing the redaction on the dedicated endpoint. Raw Secret
  reads now require a write role.
- **CreateSecretModal corrupted non-ASCII secret values** (raw `btoa` is
  latin1-only); now uses the UTF-8-safe encoder.
- **Resource-protection guards failed open** on a transient verification error,
  allowing delete/edit of a protected resource; now fails closed.
- **CronJobs that never ran displayed `1/1/0001`** (Go zero-time); now null.
- Malformed capacity on **Create PV/PVC** returned 500 instead of 400; the audit
  log endpoint could 500 on a negative `offset`; both now validate/clamp.
- **PV total capacity** mis-parsed decimal and byte quantities; the Cost and
  Dashboard **CPU parsers** ignored the microcore (`u`) suffix; Cost labeled
  gibibytes as "GB".
- Not-found / conflict on the generic resource endpoints now return **404 / 409**
  instead of 500.

### Changed

- The server logs a prominent warning when `AUTH_ENABLED` is not `true` (every
  request is served as a cluster admin in that mode).
- Helm chart references and repo URLs are validated (dash-guard + scheme check)
  to prevent flag injection; the exec terminal keeps its session alive with a
  keepalive ping and tears down cleanly on client disconnect.

## [1.5.0]

A usability and accessibility polish pass across the observability, operations,
and config pages. No API changes.

### Added

- **Colorblind-safe status primitive.** A shared `StatusBadge` / `StatusDot`
  renders health as three redundant cues — a distinct shape glyph (● / ▲ / ✕), a
  text label, and the shared status color — so status never rides on color alone
  (WCAG 1.4.1) and stays legible in grayscale.
- **Cluster Version** page rebuilt: surfaces real per-node readiness (previously
  fetched but unused), a summary strip (nodes / ready / versions / runtimes), a
  sortable node table, version-skew guidance, node links, and an empty state.
- **Cost Estimation**: custom CPU/memory rates now persist across reloads (new
  `useLocalStorage` hook); an **Idle / Reclaimable** figure turns capacity and
  usage into a single "what am I wasting" signal; the namespace table is sortable.
- **Resource Quotas**: over-limit usage (used ≥ hard), previously clamped to a
  full bar and invisible, is flagged with an "OVER" tag and tinted card, a "%"
  tag at ≥ 90%, and an "At/Over Limit" summary count.
- **Designed empty states** on Quotas, Limit Ranges, and Events — each explains
  the resource and (where applicable) offers a create action, and distinguishes
  an empty scope from a no-match search. Limit Ranges also gains a summary strip.
- **Monitoring**: the node-metrics table is sortable, defaulting to hottest CPU.

### Changed

- Dashboard node cards now use the labeled `StatusDot` instead of a color-only
  pulsing dot.

### Fixed

- **Backup no longer silently drops Secrets.** YAML export omitted Secret
  manifests entirely while Summary counted them. It's now an explicit,
  safe-by-default choice: an "Include Secrets" opt-in (off by default, with a
  sensitive-data caution) and a note in the page description.

## [1.4.0]

Reworks the Service Mesh view and trims the frontend bundle.

### Changed

- **Service Mesh → Service Traffic Map.** The old view was a force-directed graph
  of namespace → service → pod boxes you had to click to expand, and it never
  showed the path traffic actually takes. It is now a deterministic three-lane
  map — **Ingress host → Service → backing endpoints** — colored end-to-end by
  backend health. Exposed services (ingress-routed or LoadBalancer/NodePort) lead
  so the entry points sit up top, then degraded-first; each service shows its
  namespace, type, and port, and each backend shows real endpoint health
  (`N/M ready`, `no endpoints`, or `manual` for selector-less services). Broken
  paths read at a glance — their edges are dashed and red. Includes a summary
  strip, highlight search, and click-through to the service or ingress. No layout
  library, no jitter, no click-to-expand.

### Removed

- Dropped the `@xyflow/react` and `dagre` dependencies — the traffic map is drawn
  directly, and all three topology views (cluster map, heatmap, traffic map) are
  now library-free. The Service Mesh page bundle fell from ~265 KB to ~7 KB.

## [1.3.0]

### Added

- **Security Posture** (Observability → Security). A read-only scan of the cluster
  for common misconfigurations, with a headline score, severity breakdown, and a
  remediation per finding:
  - **Workloads** — privileged containers, hostPath volumes, shared host
    namespaces (hostNetwork/PID/IPC), and dangerous added capabilities, reported
    per resource and deduplicated so an N-replica workload appears once.
  - Near-universal hygiene checks (privilege escalation allowed, may run as root,
    no resource limits) are **aggregated** into one finding each with a count
    (e.g. "20 of 61 workloads…"), keeping the panel actionable.
  - **Namespaces** — missing NetworkPolicy or Pod Security Standard.
  - **RBAC** — non-system subjects bound to `cluster-admin`.

  New `GET /api/v1/security/posture`. The page is searchable, sortable, and
  paginated with the same URL-state model as the other lists.

## [1.2.0]

Adds an audit log of console actions, plus deploy/packaging hygiene.

### Added

- **Audit Log** (Observability → Audit Log). Records every mutating action taken
  through the console — create / update / delete / scale / restart / cordon /
  exec / apply — with the user, role, target resource, HTTP method, and result,
  **including denied and failed attempts** (useful for security review). It is
  store-agnostic: an in-memory ring buffer by default (works standalone, no
  external dependency) and a **durable PostgreSQL backend** when a database is
  configured. The page shows a summary (actions / succeeded / denied / failed /
  users) over a searchable, sortable, paginated table. New `GET /api/v1/audit`.

### Changed

- **Chart deploys lean:** `postgresql.enabled` now defaults to `false`. KubeUI is
  stateless (the audit log uses an in-memory buffer by default); enable the
  database only for durable audit retention. Previously the chart spun up an
  unused PostgreSQL by default.
- **Go module path** renamed to `github.com/straightarctech/skyvirt-kubeui` so
  `go install …@latest` resolves against the public repo.
- Hub-publish tooling and the `values-hub` overlay are versioned from the single
  `VERSION` source (no more manual edits / drift).

### Fixed

- Removed stray build binaries that had been committed at the repo root.

## [1.1.0]

A large UX and productivity release: the rest of the design/accessibility
reassessment (Phases B & C), form-based editing across the common resource
kinds, richer networking pages, and daily-driver features (deep-linked views,
saved views, cross-kind search). No breaking API changes.

### Added

- **Form-based, merge-safe Edit** for Services, Ingress, LoadBalancer,
  ConfigMaps, Secrets, Deployments, StatefulSets, DaemonSets, Jobs, and CronJobs.
  Each loads the live object, pre-fills a focused form, and merges changes back —
  so fields the form doesn't manage (labels, annotations, probes, volumes,
  clusterIP, valueFrom env…) are never dropped. Jobs edit only the mutable fields
  (a Job's pod template is immutable); Secrets edit base64 data safely.
- **LoadBalancer & Services enrichment** — Create Load Balancer flow with MetalLB
  address-pool selection, a **Backends** column showing real endpoint health
  (ready/total), Cluster IP, and consistent summary strips.
- **Expand Volume** for PVCs — size-parsing with a shrink guard, a StorageClass
  `allowVolumeExpansion` pre-check, current-size prefill, and quick presets.
- **Deep-linked list state** — search, label filter, sort, and page/size live in
  the URL, so a list's view survives reload and can be shared by copying the link.
- **Saved views** — name and store a list's current filter/sort (per-user, local),
  and re-apply it in one click from the top bar.
- **Global cross-kind search** — the ⌘K palette now finds resources across 18
  kinds cluster-wide, jumping straight to a detail page or a filtered list.
- **Table density toggle** — compact/comfortable rows app-wide, persisted.
- **Design-token catalog** at `/design` — every theme/status token rendered live
  from the CSS with its measured WCAG contrast and pass/fail badge.
- **Semantic status system** — a single source of truth (`lib/status.ts` +
  `--status-*` tokens) so green/amber/red/gray mean the same thing everywhere,
  audited on both theme backgrounds.
- **Designed empty states** and **universal summary strips** across list pages.

### Changed

- **Light theme depth** — softer, layered card elevation so panels lift off the
  page.
- **Topology** — namespace/workload labels get a halo so they stay legible over
  packed pods; status uses the shared semantic palette.

### Fixed

- **Keyboard focus** — a visible, theme-aware focus ring on every interactive
  element (light theme previously had none).
- **Colorblind-safe status everywhere** — status is conveyed by icon/shape + label
  + color, never color alone.
- **Latent crash** — a sort accessor referencing a below-declared helper could
  white-screen when that sort was active on first render (exposed by deep-linked
  sort); converted to a hoisted function.
- Recharts pie/cell fills that used `var(--…)` (which doesn't resolve in SVG
  attributes) now use the shared palette, so status slices render correctly.

## [1.0.1]

Accessibility and readability pass (accessibility audit, Phase A). No API changes.

### Fixed

- **Text contrast (WCAG 2.2 AA).** The faintest text token failed AA in both
  themes (2.56:1 light / 3.06:1 dark) yet was used for real content — pod ages,
  empty states, units. Darkened `--th-ghost` and `--th-dim` so every text token
  now clears 4.5:1 against every surface it renders on, in both themes.
- **Pinned Actions column.** On wide resource tables the row controls (Diagnose /
  Logs / Delete) could scroll out of view; the trailing Actions column is now
  pinned to the right edge at any viewport width.
- **Colorblind-safe status in Topology.** Cluster-map pod health no longer relies
  on color alone — failed pods carry a bold ring and `!` glyph, pending pods a
  dashed ring (WCAG 1.4.1 Use of Color).

### Added

- **Contrast regression test** (`internal/theme`) — parses the theme tokens and
  fails the build if any text token drops below its AA floor in either theme.

## [1.0.0]

Initial public release of SkyVirt KubeUI — a fast, single-binary Kubernetes
management console with an embedded React UI.

### Highlights

- Full resource management across Workloads, Config, Networking, Storage, Nodes,
  Observability, and Operations, with sorting, kubectl-style label filtering, and
  pagination on every list.
- **Real-time updates** — informer-backed watch with in-place row patching on the
  hot paths (Pods, Deployments, Services); no manual refresh.
- **One-click Diagnose** for pods and workloads — root cause assembled from
  container states, events, node health, and previous-crash logs — with optional
  on-prem **AI explanations** and **plan-gated apply-fix**.
- **Topology** — circle-packing cluster map, resource heatmap, and service-mesh
  graph.
- **Bulk multi-select actions**, full CRUD, YAML apply/edit, exec/logs, RBAC, and
  MetalLB / VLAN networking management.
- **Multi-cluster switching** that preserves per-cluster credential isolation.
- Air-gap friendly: a single binary, one Helm release, no Prometheus/GitOps/cloud
  dependency required. SSO and per-cluster derived-secret auth; runs standalone or
  inside SkyVirtHCI.

[Unreleased]: https://github.com/straightarctech/skyvirt-kubeui/compare/v1.7.5...HEAD
[1.7.5]: https://github.com/straightarctech/skyvirt-kubeui/compare/v1.7.4...v1.7.5
[1.7.4]: https://github.com/straightarctech/skyvirt-kubeui/compare/v1.7.3...v1.7.4
[1.7.3]: https://github.com/straightarctech/skyvirt-kubeui/compare/v1.7.2...v1.7.3
[1.7.2]: https://github.com/straightarctech/skyvirt-kubeui/compare/v1.7.1...v1.7.2
[1.7.1]: https://github.com/straightarctech/skyvirt-kubeui/compare/v1.7.0...v1.7.1
[1.7.0]: https://github.com/straightarctech/skyvirt-kubeui/compare/v1.6.0...v1.7.0
[1.6.0]: https://github.com/straightarctech/skyvirt-kubeui/compare/v1.5.0...v1.6.0
[1.5.0]: https://github.com/straightarctech/skyvirt-kubeui/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/straightarctech/skyvirt-kubeui/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/straightarctech/skyvirt-kubeui/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/straightarctech/skyvirt-kubeui/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/straightarctech/skyvirt-kubeui/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/straightarctech/skyvirt-kubeui/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/straightarctech/skyvirt-kubeui/releases/tag/v1.0.0
