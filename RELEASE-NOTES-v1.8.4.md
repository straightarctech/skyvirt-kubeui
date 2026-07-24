# SkyVirt KubeUI v1.8.4

Drift detection grows a memory: a **timeline** of how each resource changed over time.

## Added
- **Configuration drift timeline** — beyond the single live-vs-last-applied comparison, KubeUI now keeps a **snapshot history** of each resource and lets you **diff any two points in time**.
  - **How it's stored:** snapshots live in ConfigMaps in KubeUI's own namespace — **air-gap friendly, survives a restart, no CRD and no external database**. Each snapshot is the noise-stripped spec (never secret material), deduped by content hash, with bounded retention.
  - **How it's captured:** on demand ("Snapshot now"), or automatically every 30 minutes for namespaces you opt in with the label `kubeui.io/track-drift=true` — so there are no surprise writes to clusters you didn't choose.
  - **In the UI:** the Drift page gains a tracked-timelines table and a per-resource timeline; pick any two points to see exactly what changed between them.

---

Includes everything from **v1.8.3** (kubeconfig + SA-token expiry), **v1.8.2** (GitOps private-repo auth, live-object API scan), **v1.8.1**, and **v1.8.0**. Full details in the [CHANGELOG](CHANGELOG.md).

🇮🇳 Proudly built in India · Apache-2.0
