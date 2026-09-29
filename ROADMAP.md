# Roadmap

This is a living, high-level view of where SkyVirt KubeUI is going. It is not a
commitment or a schedule — priorities shift with community input. The
authoritative, up-to-date plan lives in
[GitHub Issues](https://github.com/straightarctech/skyvirt-kubeui/issues)
and Milestones; this file is the map above them.

Have an idea or a need? [Open an issue](https://github.com/straightarctech/skyvirt-kubeui/issues/new/choose)
— roadmap items come from real use cases, and we prioritise with the community.

## Guiding principles

- **Air-gap first.** Everything must work fully on-prem, offline, with no cloud,
  metrics stack, or GitOps controller required.
- **Real-time by default.** The console should reflect the cluster as it is now.
- **Operate, don't just observe.** Diagnose and (safely, with approval) fix.
- **Single binary, one Helm release.** Easy to run, easy to trust.
- **Open and vendor-neutral.** Governed in the open (see `GOVERNANCE.md`).

## Now — shipped

- Full resource management across Workloads, Config, Networking, Storage, Nodes,
  Observability and Operations, with sorting, kubectl-style label filtering and
  pagination on every list.
- **Real-time updates** — informer-backed watch with in-place row patching on the
  hot paths (Pods, Deployments, Services); Phase-1 signal→refetch elsewhere.
- **One-click Diagnose** for pods and workloads, with optional **on-prem AI
  explanations** and **plan-gated apply-fix**.
- **Topology** — circle-packing cluster map, resource heatmap, service-mesh graph.
- **Bulk multi-select actions**, full CRUD, YAML apply/edit, exec/logs, RBAC,
  MetalLB / VLAN networking.
- **Multi-cluster switching** with per-cluster credential isolation.
- SSO + per-cluster derived-secret auth; Helm chart; runs standalone or inside
  SkyVirtHCI.

## Next — near term

- Extend **typed-delta live updates** to more resource kinds.
- Broaden **Diagnose** coverage (more failure classes, StatefulSet/DaemonSet
  depth) and richer AI-assisted remediation.
- **Saved views** and **column customization** (per-user, per-resource).
- **Global resource search** across all kinds, cluster-wide, including CRDs.
- **Security posture panel** — surface pods without limits, privileged/hostPath
  workloads, namespaces without NetworkPolicies, over-broad RBAC.
- **Quota / LimitRange** usage visualization polish.

## Later — exploratory

- **Audit log viewer** and **multi-pod live log streaming**.
- **Form-based create wizards** and a lightweight app catalog.
- **Prometheus-free right-sizing** recommendations.
- **GitOps-lite** — point at a Git repo, preview a diff, sync with drift
  detection, without a heavyweight controller.
- **Extensibility / plugins** so the community can add resource views.
- Deeper **infrastructure-aware topology** (where the underlying platform exposes
  it): pod → service → load-balancer pool → node.

## How releases work

We aim to follow [Semantic Versioning](https://semver.org/). Notable changes are
recorded in [CHANGELOG.md](CHANGELOG.md).
