# SkyVirt KubeUI v1.8.1

The Command Center now **leads with security**. A new Security Posture band puts your cluster's risk front and centre on the main dashboard — no extra clicks.

![Command Center — Security Posture](https://raw.githubusercontent.com/straightarctech/skyvirt-kubeui/main/docs/assets/dashboard.png)

## New
- **Security Posture on the dashboard** — posture score, critical / high image CVEs, risky RBAC bindings, expiring certificates, and posture issues. Each tile is tone-colored and one click from its detail page. Scans are optional and degrade gracefully when a scanner (e.g. Trivy) isn't installed.

## Fixed
- **Dashboard card alignment** — the quick-stats grid now fills its column and bottom-aligns with the cluster-health card.

---

Everything from **v1.8.0** is included — the full security suite (image CVEs, RBAC access review, cert expiry, config drift, deprecated-API scan), SIEM / SOC forwarding, backup & DR, app catalog, GitOps-lite, and enterprise Helm. Full details in the [CHANGELOG](CHANGELOG.md).

🇮🇳 Proudly built in India · Apache-2.0
