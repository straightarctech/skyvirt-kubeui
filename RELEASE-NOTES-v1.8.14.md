# SkyVirt KubeUI v1.8.14

Helm charts get a real form, installs can be previewed before they touch the cluster, and four quiet wrong answers are fixed.

## Schema-driven values forms

When a chart ships `values.schema.json`, the App Catalog install and the Helm values-upgrade modal now render a form: typed inputs, titles, descriptions, defaults, enums and validation. Raw YAML is always one tab away, and anything the form cannot represent — arrays of objects such as tolerations or volumeMounts — is routed to that tab rather than dropped.

Local `$ref` is resolved, because real charts are built on it: cert-manager's schema is a single `$ref` over 278 definitions, and renders 133 fields instead of none.

The form never rewrites the chart's `values.yaml`. A values file is mostly comments, and those comments are its documentation. The form sends a sparse overlay of only the keys you changed, as a second `-f` after the base, so Helm merges it last and the chart's defaults arrive byte-for-byte. On upgrade, the overlay rides on the release's current values.

## Preview an install

`POST /helm/install/preview` runs the install as a dry run and shows the manifests it would create, in the same diff view the upgrade preview already uses. The preview drops `--wait` and `--create-namespace`, so reading it never changes the cluster.

## Fixed

- **404, not 500, for something that does not exist.** 166 handlers turned every Kubernetes API error into a 500. A typo in a pod name told the operator the console was broken, and every 5xx alert counted typos. API errors now map to 404, 409, 400, 403 or 401; genuine server faults still answer 500.
- **Outage severity.** Losing most of a workload's replicas now reads as critical. Before, 1 of 100 available was a "warning", exactly like 99 of 100.
- **Placement audit.** A Deployment and a StatefulSet with the same name in one namespace were judged as one workload, so a well-spread Deployment could hide a StatefulSet packed onto a single node.
- **Release image guard.** It grepped the binary for the version string, which matches by chance. It now runs the image and reads the version the process reports.

## Upgrading

No configuration changes and no migration. The Helm chart, API and permissions are unchanged apart from the new preview endpoint.
