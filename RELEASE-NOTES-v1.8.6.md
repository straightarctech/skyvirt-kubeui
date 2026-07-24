# SkyVirt KubeUI v1.8.6

A big security-and-operations release. The security posture grows from a score into a full suite — who can reach admin, what's hardened, what's exposed, where your images come from — and operations gains a whole-cluster triage board, a pre-upgrade go/no-go, GitOps auto-sync, and faster drift capture. Every scan is read-only and needs no extra operator.

## Security

- **Who can reach cluster-admin** — beyond flagging bindings named `cluster-admin`, KubeUI now finds every subject that can *grant itself* admin: bound to an admin-equivalent role, or holding a self-escalation primitive (writing RBAC bindings, `escalate`, `bind`, `impersonate`), across ClusterRoleBindings and RoleBindings — each with the exact path.
- **Workload hardening audit** (Polaris-style, no scanner) — flags privileged containers, host namespaces, hostPath mounts, root execution, and dangerous added capabilities, per workload, worst-first.
- **External exposure** — one inventory of everything reachable from outside the cluster: LoadBalancer and NodePort services, and Ingress routes, with plaintext (no-TLS) ingresses flagged.
- **Internal exposure (NetworkPolicy coverage)** — the lateral-movement surface: workloads no ingress NetworkPolicy restricts, so any pod can reach them.
- **Image provenance** — a registry inventory and a flag on mutable `:latest`/untagged image references that can't be reproduced or rolled back. Air-gap governance, no scanner.
- **Posture score** now folds in escalation paths and certificate expiry alongside the existing workload, network, and RBAC checks.

## Operations

- **Cluster Health triage** — a whole-cluster "what's broken right now" board, complementing the per-resource Diagnose: crash-looping / image-pull / config-error and unschedulable pods, **OOMKilled** and flapping (high-restart) workloads, NotReady or memory/disk-pressured nodes, pending/lost volumes, and failed jobs — ranked.
- **Orphaned & unused resources** — a review list: services whose selector matches no ready endpoints (traffic blackholes) and bound PVCs no pod mounts (wasted storage).
- **Pre-upgrade go/no-go** — one `PASS` / `WARN` / `BLOCK` verdict for "is this cluster safe to upgrade?", rolled up from deprecated APIs, certificate expiry, node health, and disruption budgets.
- **GitOps auto-sync** — GitOps-lite grows persistent sources reconciled on a schedule: it detects drift (server-side, via an apply dry-run so defaulting noise never reads as false drift) and, when auto-apply is on, heals it. No Argo or Flux controller to operate.
- **Configuration drift, faster** — the drift timeline now captures changes on a short reconcile (about a minute) instead of only every 30 minutes, so a change made between the old ticks is still recorded.

## Under the hood

- Requires **Go 1.26**.

---

Includes everything from **v1.8.5** (durable audit log, Helm values-edit → dry-run diff → upgrade, disruption-budget-aware node drain, audit-log SIEM forwarding) and earlier. Full details in the [CHANGELOG](CHANGELOG.md).

🇮🇳 Proudly built in India · Apache-2.0
