# SkyVirt KubeUI v1.8.5

An operations-and-audit release: the audit trail now survives restarts and names what changed, Helm upgrades preview their diff before they run, and node drains respect disruption budgets.

## Added
- **Durable audit log** — the record of who did what through the UI now **survives a pod restart** with **no external database**. Recent actions are kept in memory for speed and flushed (compressed) to a ConfigMap in KubeUI's own namespace, reloaded on start. Air-gap friendly, no CRD. Point `DATABASE_URL` at Postgres for the higher-volume, queryable backend instead.
- **Helm: edit values → preview diff → upgrade** — open a release, edit its full `values.yaml`, and **Preview changes** renders the upgrade with `--dry-run` and shows a diff of the current vs proposed manifest **before anything is applied**. Then apply with confidence.
- **Disruption-budget-aware node drain** — draining a node now evicts pods through the Kubernetes **Eviction API**, so a drain can never take a service below its **PodDisruptionBudget**. A new **drain plan** previews exactly what will be evicted, what is left in place (DaemonSet, static, and completed pods), and which pods a PDB guards — before you commit.
- **Audit-log forwarding to your SIEM** — audit events can be streamed to an external SIEM over syslog (RFC 5424) or HTTP JSON, alongside the existing vulnerability, certificate-expiry, and posture signals. Cursor-based and de-duplicated, so nothing is sent twice.

## Changed
- **Audit entries now name the resource** — actions that create a resource record the object's name (from the request body or manifest) rather than just its kind, and namespace create/delete are labelled correctly. Cleaner attribution across the whole trail.

## Fixed
- **Helm upgrade** no longer mangles YAML values (the old form parsed them as `key=value` lines) and correctly carries the chart reference, so values-only upgrades work.

---

Includes everything from **v1.8.4** (drift timeline), **v1.8.3** (kubeconfig + SA-token expiry), **v1.8.2** (GitOps private-repo auth, live-object API scan), **v1.8.1**, and **v1.8.0**. Full details in the [CHANGELOG](CHANGELOG.md).

🇮🇳 Proudly built in India · Apache-2.0
