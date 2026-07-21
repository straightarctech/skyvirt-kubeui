import { useState } from "react";
import { TableSkeleton } from "@/components/Skeleton";
import { useOutletContext } from "react-router-dom";
import {
  listNamespaces, listDeployments, listServices, listConfigMaps,
  listSecrets, listPVCs, getResourceYAML,
} from "@/api/client";
import type { NamespaceSummary } from "@/api/client";
import { useResource } from "@/hooks/useResource";
import jsYaml from "js-yaml";

type ResourceRef = { kind: string; namespace: string; name: string };

export default function Backup() {
  useOutletContext<{ namespace: string }>();
  const { data: namespaces, loading } = useResource<NamespaceSummary[]>(() => listNamespaces(), []);
  const [selectedNs, setSelectedNs] = useState("all");
  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState<string | null>(null);
  const [exportMode, setExportMode] = useState<"summary" | "yaml">("yaml");
  const [includeSecrets, setIncludeSecrets] = useState(false);
  const [progress, setProgress] = useState("");

  const handleExport = async () => {
    setExporting(true);
    setExportResult(null);
    setProgress("Listing resources...");
    try {
      const ns = selectedNs === "all" ? undefined : selectedNs;
      const [deps, svcs, cms, secrets, pvcs] = await Promise.all([
        listDeployments(ns),
        listServices(ns),
        listConfigMaps(ns),
        listSecrets(ns),
        listPVCs(ns),
      ]);

      if (exportMode === "summary") {
        const summary = [
          `# Kubernetes Resource Export`,
          `# Date: ${new Date().toISOString()}`,
          `# Namespace: ${selectedNs}`,
          ``,
          `## Summary: ${deps.length} Deployments, ${svcs.length} Services, ${cms.length} ConfigMaps, ${secrets.length} Secrets, ${pvcs.length} PVCs`,
          ``,
          `## Deployments`,
          ...deps.map((d) => `- ${d.namespace}/${d.name} (replicas: ${d.replicas}, images: ${(d.images || []).join(", ")})`),
          ``,
          `## Services`,
          ...svcs.map((s) => `- ${s.namespace}/${s.name} (type: ${s.type}, clusterIP: ${s.cluster_ip})`),
          ``,
          `## ConfigMaps`,
          ...cms.map((c) => `- ${c.namespace}/${c.name} (keys: ${c.data_count})`),
          ``,
          `## Secrets`,
          ...secrets.map((s) => `- ${s.namespace}/${s.name} (type: ${s.type})`),
          ``,
          `## PersistentVolumeClaims`,
          ...pvcs.map((p) => `- ${p.namespace}/${p.name} (${p.capacity}, ${p.access_modes?.join(",") || "-"}, ${p.status})`),
        ].join("\n");
        setExportResult(summary);
      } else {
        // YAML export — fetch actual manifests. Secrets are excluded unless the
        // user opts in, since their manifests carry (base64) sensitive data and
        // this file downloads straight to the browser.
        const refs: ResourceRef[] = [
          ...deps.map((d) => ({ kind: "Deployment", namespace: d.namespace, name: d.name })),
          ...svcs.map((s) => ({ kind: "Service", namespace: s.namespace, name: s.name })),
          ...cms.map((c) => ({ kind: "ConfigMap", namespace: c.namespace, name: c.name })),
          ...pvcs.map((p) => ({ kind: "PersistentVolumeClaim", namespace: p.namespace, name: p.name })),
          ...(includeSecrets ? secrets.map((s) => ({ kind: "Secret", namespace: s.namespace, name: s.name })) : []),
        ];

        const yamls: string[] = [];
        for (let i = 0; i < refs.length; i++) {
          const ref = refs[i];
          setProgress(`Exporting ${ref.kind} ${ref.namespace}/${ref.name} (${i + 1}/${refs.length})`);
          try {
            const data = await getResourceYAML(ref.kind, ref.namespace, ref.name);
            // Strip managed fields and status for clean export
            const clean = { ...data } as Record<string, unknown>;
            if (clean.metadata && typeof clean.metadata === "object") {
              const meta = { ...(clean.metadata as Record<string, unknown>) };
              delete meta.managedFields;
              delete meta.resourceVersion;
              delete meta.uid;
              delete meta.creationTimestamp;
              delete meta.generation;
              clean.metadata = meta;
            }
            delete clean.status;
            yamls.push(jsYaml.dump(clean, { indent: 2, lineWidth: -1, noRefs: true }));
          } catch {
            yamls.push(`# Failed to export ${ref.kind} ${ref.namespace}/${ref.name}\n`);
          }
        }
        setExportResult(yamls.join("---\n"));
      }
    } catch (e) {
      setExportResult(`Export failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      setExporting(false);
      setProgress("");
    }
  };

  const downloadExport = () => {
    if (!exportResult) return;
    const ext = exportMode === "yaml" ? "yaml" : "md";
    const blob = new Blob([exportResult], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `k8s-backup-${selectedNs}-${new Date().toISOString().slice(0, 10)}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <h1 className="text-2xl font-bold text-th-heading">Resource Backup & Export</h1>

      <div className="bg-th-panel border border-th-line rounded-xl p-4 shadow-card">
        <p className="text-sm text-th-dim">
          Export Kubernetes resource manifests as YAML for backup, migration, or GitOps.
          YAML mode exports clean manifests (without status/managed fields). Summary mode exports a resource inventory.
          Secret manifests are excluded by default — enable “Include Secrets” to add them.
        </p>
      </div>

      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs text-th-dim mb-1">Namespace</label>
          <select
            value={selectedNs}
            onChange={(e) => setSelectedNs(e.target.value)}
            className="px-3 py-2 bg-th-subtle border border-th-line rounded-lg text-sm text-th-body focus:outline-none focus:ring-1 focus:ring-th-accent min-w-[200px]"
          >
            <option value="all">All Namespaces</option>
            {(namespaces ?? []).map((ns) => (
              <option key={ns.name} value={ns.name}>{ns.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs text-th-dim mb-1">Format</label>
          <div className="flex gap-1 bg-th-subtle rounded-lg p-0.5">
            <button
              onClick={() => setExportMode("yaml")}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${exportMode === "yaml" ? "bg-th-panel text-th-body shadow-sm" : "text-th-dim"}`}
            >
              YAML Manifests
            </button>
            <button
              onClick={() => setExportMode("summary")}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${exportMode === "summary" ? "bg-th-panel text-th-body shadow-sm" : "text-th-dim"}`}
            >
              Summary
            </button>
          </div>
        </div>

        {exportMode === "yaml" && (
          <label className="flex items-center gap-2 text-xs text-th-dim cursor-pointer select-none pb-2" title="Secret manifests contain base64-encoded sensitive data">
            <input
              type="checkbox"
              checked={includeSecrets}
              onChange={(e) => setIncludeSecrets(e.target.checked)}
              className="accent-th-warn"
            />
            Include Secrets
            {includeSecrets && <span className="text-th-warn">⚠ contains sensitive data</span>}
          </label>
        )}

        <button
          onClick={handleExport}
          disabled={exporting}
          className="px-4 py-2 text-sm bg-th-accent text-white rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {exporting ? "Exporting..." : "Export"}
        </button>
        {exportResult && (
          <button
            onClick={downloadExport}
            className="px-4 py-2 text-sm bg-th-ok text-white rounded-lg hover:opacity-90 transition-opacity"
          >
            Download .{exportMode === "yaml" ? "yaml" : "md"}
          </button>
        )}
      </div>

      {progress && (
        <div className="text-xs text-th-dim animate-pulse">{progress}</div>
      )}

      {loading && <TableSkeleton />}

      {exportResult && (
        <div className="bg-th-panel border border-th-line rounded-xl shadow-card overflow-hidden">
          <div className="px-4 py-2 bg-th-subtle border-b border-th-line flex items-center justify-between">
            <span className="text-xs text-th-dim">{exportMode === "yaml" ? "YAML Manifests" : "Summary"}</span>
            <span className="text-xs text-th-ghost">{exportResult.split("\n").length} lines</span>
          </div>
          <pre className="p-4 text-xs font-mono text-th-body overflow-auto max-h-[500px] whitespace-pre-wrap">
            {exportResult}
          </pre>
        </div>
      )}
    </div>
  );
}
