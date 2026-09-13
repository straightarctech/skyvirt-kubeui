# SkyVirt KubeUI v1.8.13

A correctness release. Nothing an operator sees moves — no new pages, no changed behaviour, no upgrade steps. What changed is how much of the security and health analysis is now held in place by tests.

## Why this release exists

The posture engines carry the judgement calls this console is trusted for: what counts as critical, when a credential is "expiring", which replica layout is a genuine risk, which deprecated API blocks an upgrade. Certificate expiry, cluster-admin reach, deprecated-API readiness, workload hardening, rightsizing, and the probe, availability, exposure and orphan audits had no tests at all.

That matters more here than a coverage number usually does, because these engines fail quietly. A threshold off by one, or date arithmetic that truncates the wrong way, does not crash — it produces a plausible wrong answer on a security dashboard. A plausible wrong answer is worse than an obvious failure, because it gets believed and acted on.

## What is now pinned down

- **Certificate expiry arithmetic.** Days-remaining truncates toward zero, so a certificate that expired twelve hours ago and one expiring in eleven hours both read as `0` days — only the `expired` flag separates them. ServiceAccount tokens with no `exp` claim are reported as long-lived rather than as expired at the epoch.
- **Cluster-admin reach.** The five ways a role grants escalation — full wildcard, write on RBAC bindings, `escalate`, `bind`, `impersonate` — and which three of them are critical rather than high. A wildcard requires all of verbs, groups and resources to be `*`; two out of three is not one.
- **Deprecated-API matching.** Lookups match the apiVersion and kind together, never the group alone. `extensions/v1beta1` was removed in 1.16 for Deployment but survived to 1.22 for Ingress, and reporting one version for the whole group would plan the wrong cluster upgrade.
- **Workload hardening rules.** A container that simply omits a security context is reported for privilege escalation and for running as root — silence is not consent. Capability names match case-insensitively, host-path mounts are reported per volume, and init containers are scanned.
- **Rightsizing thresholds.** A workload over both its CPU and memory request reports the memory finding only, and counts once. Over-provisioning never raises severity. The under-20% rule is a strict comparison, so a workload sitting exactly at twenty percent is left alone.
- **Availability, probes, exposure, orphans and NetworkPolicy coverage** — including that an unset `policyTypes` defaults to ingress, that only ready endpoint addresses keep a service alive, and that an ingress whose TLS block covers some but not all of its routed hosts is not secure.

## How it was verified

Passing tests prove nothing on their own, so each guard was checked against a deliberately broken build. Sixteen mutations were applied to the engines one at a time — thresholds flipped, a severity reason dropped, a branch loosened, an early return removed, a per-host TLS check deleted — and every one turned its guarding test red. One test had to be strengthened to earn that: a single-replica fixture could not observe the behaviour it claimed to cover.

Statement coverage of the engine package moved from 0.8% to 19.8%, measured by removing the new files and re-running rather than asserted.

## Under the hood

- `make install-hooks` installs the repository's commit-message policy hooks. The hook directory is internal to the maintainers' repository, so this target does nothing in a published snapshot and says so.

---

Upgrading from **v1.8.12** requires nothing: the binary, the chart and the API are unchanged. See the [CHANGELOG](CHANGELOG.md) for the full history.

🇮🇳 Proudly built in India · Apache-2.0
