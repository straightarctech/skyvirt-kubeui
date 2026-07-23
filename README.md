<div align="center">

<img src="docs/assets/skyvirt-kubeui-logo.svg" alt="SkyVirt KubeUI" height="72">

<h1>SkyVirt KubeUI</h1>

**The security-first Kubernetes console that ships done — free and open source.**

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache%202.0-4F46E5.svg)](LICENSE)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-7C3AED.svg)](CONTRIBUTING.md)
[![DCO](https://img.shields.io/badge/DCO-required-informational.svg)](DCO)
![Made in India](https://img.shields.io/badge/Made%20in-India-FF9933.svg)

### [▶&nbsp; Live demo](https://kube.straightarc.com) &nbsp;·&nbsp; [What's new (v1.8.4)](RELEASE-NOTES-v1.8.4.md) &nbsp;·&nbsp; [Report a bug](https://github.com/straightarctech/skyvirt-kubeui/issues) &nbsp;·&nbsp; [Contribute](CONTRIBUTING.md)

</div>

<p align="center">
  <img src="docs/assets/dashboard.png" alt="SkyVirt KubeUI Command Center — cluster health, nodes, workloads, networking, storage and security posture in one console" width="100%">
</p>

An enterprise-grade Kubernetes management console: a single Go binary with an
embedded React UI that gives cluster admins full visibility and control —
workloads, networking, storage, config, RBAC, Helm, observability — without
needing `kubectl` on their desk.

It's **real-time by default, air-gap ready, and needs no cloud, Prometheus,
or GitOps controller** to run. Released under Apache-2.0 by
[StraightArc Technologies](https://straightarc.com). Website:
**[kube.straightarc.com](https://kube.straightarc.com)**.

Created by **[Tarun Kumar Kushwaha](https://github.com/tarunkr)** — original
author and lead maintainer.

KubeUI runs standalone on any cluster, or as the Kubernetes console inside
SkyVirtHCI — the HCI engine deploys it *into* tenant clusters via
`POST /k8s/clusters/{id}/deploy-kubeui`.

## Highlights

### 🔒 Security & posture — first-class, not a plugin

- **Image vulnerabilities** — continuous CVE scanning (Trivy Operator), shown
  right next to the workload running each image and sorted worst-first.
- **RBAC access review** — answer "can this subject do X?" (SubjectAccessReview)
  and run a risky-binding sweep that flags who can actually reach cluster-admin
  or is bound to everyone-groups.
- **Certificate & credential expiry** — server-side scan of TLS secrets,
  kubeconfig client certs, and ServiceAccount tokens — flagging expired,
  soon-to-expire, and long-lived credentials before they page you.
- **Config drift & timeline** — see where live objects have diverged from their
  declared shape, field by field — and diff any two points in a resource's
  snapshot history over time.
- **SIEM / SOC forwarding** — ship CVEs, misconfigurations (Trivy config-audit),
  expiring certs and risky RBAC to your SIEM over syslog or HEC — on demand or
  on a server-side schedule.
- **Secrets, RBAC & governance** — ConfigMaps, Secrets (masked entry),
  cluster/namespace RBAC, Quotas, Limit Ranges, PDBs, Priority Classes,
  ServiceAccounts, CRDs with instance browsing, admission webhooks.
- **Safety rails** — type-to-confirm deletes, annotation-based resource
  protection locks (cannot be stripped via a YAML edit), read-only deploy mode.

### ⚙️ Operations & management

- **Real-time, no refresh** — every list streams live over an informer-backed
  watch, patching rows in place on the hot paths (Pods, Deployments, Services).
- **One-click Diagnose** — root cause for any failing pod or workload, assembled
  from container states, events, node health and previous-crash logs, with
  optional **on-prem AI explanations** and **plan-gated apply-fix** (nothing runs
  without your approval, nothing leaves your network).
- **Workloads** — Deployments, StatefulSets, DaemonSets, Jobs, CronJobs, Pods,
  Autoscalers: full CRUD, scale/rollback/restart, suspend/resume, drill-down
  detail pages with pods, events and live YAML editing.
- **Backup & DR** — Velero-backed backups, restores and schedules, from the console.
- **Helm & app catalog** — one-click installs from a curated catalog, plus
  install/upgrade/rollback/uninstall with in-repo chart search, values and history.
- **Upgrade readiness** — scan Helm releases **and live objects** for deprecated /
  removed Kubernetes APIs before you bump the cluster version.
- **Networking** — Services (with endpoint IP drill-down), Ingress, Network
  Policies, LoadBalancers, L2 networks.
- **Topology** — zoomable circle-packing cluster map, resource heatmap, and a
  live service-mesh graph.
- **Command palette** — `Ctrl/Cmd+K` fuzzy-jumps to any page or any
  pod/deployment/service/node/namespace by name.
- **Pod exec & logs** — in-browser terminal (WebSocket) and log viewer.
- **Bulk actions & sharp filters** — multi-select delete/restart/scale/cordon;
  kubectl-style label selectors, sorting and pagination on every resource.
- **Multi-cluster switching** — one console, per-cluster credential isolation.
- **NOC dashboard** — cluster-wide health, capacity, top consumers, events.

## Quick start

```bash
make            # builds web UI + embeds it into bin/kubeui
./bin/kubeui    # listens on :8080, uses in-cluster config or ~/.kube/config
```

Docker / Helm:

```bash
make docker
helm install kubeui deploy/helm/skyvirthci-kubeui -n kubeui-system --create-namespace
```

## Configuration (environment)

| Variable | Default | Description |
|---|---|---|
| `LISTEN_ADDR` | `:8080` | HTTP listen address |
| `AUTH_ENABLED` | `false` | Require JWT auth on the API. **Fails startup if enabled without `JWT_SECRET`.** |
| `JWT_SECRET` | — | HMAC secret for JWT validation (engine-compatible claims: `uid`, `tid`, `role`) |
| `ENGINE_URL` | — | SkyVirtHCI engine URL used to proxy login/refresh |
| `KUBEUI_READ_ONLY` | `false` | Disable every create/edit/delete operation and pod exec |
| `KUBEUI_WRITE_ROLES` | `admin,operator` | Comma-separated roles allowed to mutate; all other authenticated roles are read-only |
| `CORS_ORIGINS` | *(same-origin only)* | Comma-separated origin allowlist for cross-origin API/WebSocket access. Unset = only the UI's own host. |
| `DATABASE_URL` | — | Optional PostgreSQL DSN for persistent app data |

Authorization model: `GET` is readable by any authenticated user; every
mutating route — including the exec WebSocket — requires one of the
`KUBEUI_WRITE_ROLES`. `KUBEUI_READ_ONLY=true` overrides everything.

## Development

```bash
cd web && npm ci && npm run dev   # Vite dev server (proxy to :8080)
go run ./cmd/kubeui               # API + embedded (last-built) UI
make vet test                     # quality gates
```

Repo layout: `cmd/kubeui` (entrypoint, embeds `web/dist`), `internal/api`
(chi routes, auth/authz middleware), `internal/k8s` (client-go wrappers),
`internal/auth` (JWT), `web/` (React + Tailwind + Vite), `deploy/helm/`.

## Contributing

We'd love your help — bug reports, ideas, docs, and pull requests are all
welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) (note the **DCO
sign-off**: `git commit -s`) and our [Code of Conduct](CODE_OF_CONDUCT.md).
Project governance and the maintainer list are in
[GOVERNANCE.md](GOVERNANCE.md) and [MAINTAINERS.md](MAINTAINERS.md). Found a
security issue? See [SECURITY.md](SECURITY.md) — please report privately.

## Ecosystem

SkyVirt KubeUI is part of the **SkyVirt** platform by StraightArc Technologies:

- **[SkyVirtHCI](https://hci.straightarc.com)** — hyperconverged virtualization:
  VMs, containers and Kubernetes, resilient storage, SDN, backup and DR.
- **[SecSphere SOC](https://secsphere.straightarc.com)** — AI-native SIEM, XDR
  and SOC platform.
- **[SkyVirtRange](https://range.straightarc.com)** — India's sovereign,
  air-gap-native national cyber-exercise platform.

## License

Copyright © 2026 StraightArc Technologies Pvt. Ltd.

Licensed under the **[Apache License 2.0](LICENSE)**. See [NOTICE](NOTICE) for
attribution.
