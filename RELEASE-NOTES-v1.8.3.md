# SkyVirt KubeUI v1.8.3

The expiry radar grows up: it now watches **every credential that silently expires**, not just TLS certs.

## Changed
- **Certificate & credential expiry** — beyond `tls.crt`/`ca.crt` Secrets, the radar now also reports:
  - **kubeconfig client certs** — parses embedded `client-certificate-data` in kubeconfig Secrets (the cluster-admin / CI kubeconfigs nobody remembers to rotate) and reports each user's cert expiry.
  - **ServiceAccount tokens** — decodes the token JWT's `exp`, or flags **legacy non-expiring tokens as long-lived** — a credential a modern cluster should replace with a bound (projected) token.

  Only public certificates / token metadata are ever read — **never a private key**. The page gains a credential-**Type** column and a **Long-lived** count; long-lived tokens are correctly excluded from the "expiring ≤30d" count and from SIEM forwarding (they're a hygiene flag, not an expiry event).

---

Includes everything from **v1.8.2** (GitOps private-repo auth, live-object deprecated-API scan), **v1.8.1**, and **v1.8.0**. Full details in the [CHANGELOG](CHANGELOG.md).

🇮🇳 Proudly built in India · Apache-2.0
