# SkyVirt KubeUI v1.8.12

A networking release. Attaching a workload to a VLAN, or announcing a load-balancer address out of one, used to mean knowing names that exist only on the node — and getting one wrong produced a resource that applied cleanly and failed somewhere else entirely. KubeUI now asks the platform what the networks are, offers them by the names an operator already uses, and says out loud when it cannot attach to one instead of leaving it out of the list.

## Networking

- **Open vSwitch attachments.** The Network Attachment form only ever emitted `type: bridge` — the Linux-bridge CNI plugin. On an OVS host that plugin cannot attach to anything, and it fails in the worst way: the attachment is created happily and the pod that references it fails at start, far from the form that produced it. There is now a plugin selector, defaulting to OVS, emitting `type: ovs` with the bridge named exactly as `ovs-vsctl` knows it. Requires `ovs-cni` on the cluster; the Linux-bridge form is kept for clusters whose nodes really do use one.
- **Pick a network, not a bridge name.** When the console runs inside a managed cluster it asks the platform for its logical networks and offers `VLAN-10 — VLAN 10 on trunk0`, filling bridge, VLAN and MTU. Every field stays editable. Standalone consoles fall back to plain text fields, so nothing regresses.
- **MTU travels with the network.** A VLAN configured at 9000 attached at the CNI default of 1500 is a silent black hole for large frames — not an error anyone would connect back to this form.
- **Advertisement interfaces come from the nodes.** The Interfaces field on an L2Advertisement decides which host interface answers ARP for a pool's addresses, and it was free text. It now offers what the cluster's nodes actually report, with VLAN, address and state. Interfaces present on only some nodes are labelled as such — an advertisement is cluster-wide, so that one announces from only those nodes.
- **Interfaces are labelled with what they carry.** `VLAN-20 (trunk0.20) — VLAN 20 — DR · Storage`, rather than a bare kernel name. The kernel name stays, because MetalLB announces out of a named interface and a friendly label alone would name something no node has.
- **A network nothing can announce is now visible, with the reason.** It used to be dropped from the list silently, which reads as "you never created it" rather than "nothing on any node can announce it". And when interface-to-network matching is simply unavailable, KubeUI says so instead of rendering an empty label — "could not match" and "belongs to no network" are different claims.
- **The empty L2Advertisement can be created again.** Leaving IP Pools and Interfaces blank is the documented way to say "all pools, all interfaces", but the builder emitted a bare `spec:` — which YAML reads as null and the CRD rejects, blaming a type. It is now written as `{}`. Empty pool addresses and empty names are refused up front with a message that names the field.
- **No more reconnect storm on a cluster without MetalLB or Multus.** The L2 Networking page sat at "Reconnecting" and repainted twice a second. An unresolvable kind is now permanent and quiet — a muted "No live data" and a neutral "not installed" notice — and a failing list no longer flickers its skeleton on every background refresh.

## Observability & health

Shipped in v1.8.7, and new to anyone upgrading from v1.8.6:

- **Rightsizing** — a new Observability page comparing each workload's live usage against what it requests. It names the three ways that goes wrong: no requests at all (no scheduling or QoS guarantee), using more than requested (memory means OOM risk, CPU means throttling), and using far less than requested (capacity nobody is using). A capacity signal rather than a currency one — the Cost page already covers spend. Usage is a point-in-time sample, so it is offered as a pointer, not a recommendation.
- **Availability risks**, on Cluster Health — what breaks if a node dies. A multi-replica workload whose pods all landed on the same node has the appearance of redundancy and none of the substance; that is flagged high. Single-replica workloads are flagged medium.
- **Health-probe coverage**, on Cluster Health — containers with no readiness probe (traffic reaches the pod before it is ready) or no liveness probe (a hung container is never restarted), named individually.

## Under the hood

- `make docker` rebuilds the binary it packages, and then verifies the image contains the version string it is tagged with. A tag is a label; the binary is the artifact.
- The Helm chart no longer declares one version and pulls another — `make check-version` now checks every file `make sync-version` writes.

---

This is the first public release since **v1.8.6**, so it carries v1.8.7 through v1.8.12. It includes everything from **v1.8.6** (cluster-admin reach analysis, workload hardening, external exposure and NetworkPolicy coverage, image provenance, cluster health triage, pre-upgrade go/no-go, GitOps auto-sync) and earlier. Full details in the [CHANGELOG](CHANGELOG.md).

🇮🇳 Proudly built in India · Apache-2.0
