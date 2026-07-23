# SkyVirt KubeUI v1.8.2

Two focused improvements to the security + operations surface.

## Added
- **GitOps-lite: private-repo authentication** — fetch manifests from **private** Git repositories with an access token (GitHub / GitLab). The token is used once per fetch, **never persisted, never logged, and redacted from any error output**. Public repos and the http(s)-only / no-`..` guards are unchanged.

## Changed
- **Upgrade readiness scans live objects, not just Helm** — deprecated / removed-API detection now also reads each live (kubectl-applied) object's `last-applied-configuration` annotation. Resources deployed **outside** Helm — by an operator, CI, or a bare `kubectl apply` — are no longer a blind spot before a cluster version bump. Findings from both scans are merged and deduped.

---

Everything from **v1.8.1** (security-first Command Center) and **v1.8.0** (the full security suite + SIEM forwarding) is included. Full details in the [CHANGELOG](CHANGELOG.md).

🇮🇳 Proudly built in India · Apache-2.0
