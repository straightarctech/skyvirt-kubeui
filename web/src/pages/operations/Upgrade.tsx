import { useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { Link } from "react-router-dom";
import { TableSkeleton } from "@/components/Skeleton";
import { StatStrip } from "@/components/ResourceSummary";
import { StatusBadge } from "@/components/StatusBadge";
import { EmptyState } from "@/components/EmptyState";
import { useSortableTable, SortableTh } from "@/hooks/useSortableTable";
import { listNodes, scanDeprecatedAPIs } from "@/api/client";
import type { NodeSummary, APIFinding } from "@/api/client";
import { useResource } from "@/hooks/useResource";

export default function Upgrade() {
  useOutletContext<{ namespace: string }>();
  const { data: nodes, loading, error, refresh } = useResource<NodeSummary[]>(() => listNodes(), []);

  const list = nodes ?? [];

  const versions = useMemo(() => {
    const m = new Map<string, string[]>();
    list.forEach((n) => {
      if (!m.has(n.version)) m.set(n.version, []);
      m.get(n.version)!.push(n.name);
    });
    // Newest version first so the "target" version leads.
    return [...m.entries()].sort((a, b) =>
      b[0].localeCompare(a[0], undefined, { numeric: true }));
  }, [list]);

  const readyCount = list.filter((n) => n.status === "Ready").length;
  const runtimes = new Set(list.map((n) => n.container_runtime)).size;
  const uniform = versions.length <= 1;

  const { sorted, thProps } = useSortableTable(
    list,
    {
      name: (n) => n.name,
      status: (n) => n.status,
      version: (n) => n.version,
      os: (n) => n.os,
      kernel: (n) => n.kernel_version,
      runtime: (n) => n.container_runtime,
      arch: (n) => n.architecture,
    },
    { key: "name", urlKey: "upgrade" },
  );

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-th-heading">Cluster Version</h1>
        <button onClick={refresh} className="px-3 py-1.5 text-sm bg-th-accent text-white rounded-lg hover:opacity-90 transition-opacity">Refresh</button>
      </div>

      {loading && <TableSkeleton />}
      {error && <div className="p-3 bg-th-danger-s text-th-danger rounded-lg text-sm">{error}</div>}

      {!loading && !error && (
        list.length === 0 ? (
          <EmptyState title="No nodes found" hint="The cluster reported no nodes — check your connection to the API server." />
        ) : (
          <>
            <StatStrip stats={[
              { label: "Nodes", value: list.length, tone: "accent" },
              { label: "Ready", value: `${readyCount}/${list.length}`, tone: readyCount === list.length ? "ok" : "error" },
              { label: "K8s Versions", value: versions.length, tone: uniform ? "ok" : "warn" },
              { label: "Runtimes", value: runtimes, tone: runtimes > 1 ? "warn" : "neutral" },
            ]} />

            {/* Version consistency */}
            <div className="bg-th-panel border border-th-line rounded-xl p-4 shadow-card">
              <div className="flex items-center gap-2 mb-3">
                <StatusBadge
                  kind={uniform ? "ok" : "warn"}
                  label={uniform ? "Uniform" : "Version skew"}
                />
                <h3 className="font-medium text-th-body">
                  {uniform
                    ? "All nodes run the same Kubernetes version"
                    : "Nodes are on different Kubernetes versions"}
                </h3>
              </div>
              {!uniform && (
                <p className="text-xs text-th-dim mb-3">
                  Control-plane and kubelet skew is supported only within the documented
                  window — upgrade the trailing nodes to converge on the target version.
                </p>
              )}
              <div className="space-y-1.5">
                {versions.map(([version, nodeNames]) => (
                  <div key={version} className="flex items-baseline gap-2">
                    <span className="px-2 py-0.5 rounded text-xs font-medium bg-th-info-s text-th-info font-mono shrink-0">{version}</span>
                    <span className="text-sm text-th-dim">
                      {nodeNames.length} node{nodeNames.length === 1 ? "" : "s"} · {nodeNames.join(", ")}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Node details */}
            <div className="bg-th-panel border border-th-line rounded-xl overflow-hidden shadow-card">
              <h3 className="px-4 py-3 font-medium text-th-body bg-th-subtle border-b border-th-line">Node Details</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-th-dim bg-th-subtle border-b border-th-line">
                      <SortableTh {...thProps("name")}>Node</SortableTh>
                      <SortableTh {...thProps("status")}>Status</SortableTh>
                      <SortableTh {...thProps("version")}>K8s Version</SortableTh>
                      <SortableTh {...thProps("os")}>OS</SortableTh>
                      <SortableTh {...thProps("kernel")}>Kernel</SortableTh>
                      <SortableTh {...thProps("runtime")}>Runtime</SortableTh>
                      <SortableTh {...thProps("arch")}>Architecture</SortableTh>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((n) => (
                      <tr key={n.name} className="border-b border-th-line last:border-0 hover:bg-th-hover transition-colors">
                        <td className="px-4 py-2 font-medium text-th-body">
                          <Link to={`/nodes/${n.name}`} className="hover:text-th-accent transition-colors">{n.name}</Link>
                        </td>
                        <td className="px-4 py-2"><StatusBadge status={n.status} /></td>
                        <td className="px-4 py-2 font-mono text-xs text-th-dim">{n.version}</td>
                        <td className="px-4 py-2 text-th-dim text-xs">{n.os}</td>
                        <td className="px-4 py-2 text-th-dim text-xs">{n.kernel_version}</td>
                        <td className="px-4 py-2 text-th-dim text-xs">{n.container_runtime}</td>
                        <td className="px-4 py-2 text-th-dim text-xs">{n.architecture}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )
      )}

      <DeprecatedAPIScan />
    </div>
  );
}

function DeprecatedAPIScan() {
  const [findings, setFindings] = useState<APIFinding[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState("");

  const run = async () => {
    setScanning(true);
    setError("");
    try {
      setFindings(await scanDeprecatedAPIs());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Scan failed");
    } finally {
      setScanning(false);
    }
  };

  return (
    <div className="space-y-3 rounded-xl border border-th-line bg-th-panel p-5 shadow-card">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-th-heading">Upgrade readiness — deprecated APIs</h2>
          <p className="mt-0.5 text-xs text-th-dim">
            Scans your Helm releases for API versions that are removed in newer Kubernetes. Fix these before upgrading.
          </p>
        </div>
        <button onClick={run} disabled={scanning} className="rounded-lg bg-th-accent px-3 py-1.5 text-sm text-white hover:opacity-90 disabled:opacity-50">
          {scanning ? "Scanning…" : "Run scan"}
        </button>
      </div>
      {error && <p className="text-xs text-th-danger">{error}</p>}
      {findings !== null &&
        (findings.length === 0 ? (
          <div className="flex items-center gap-2 rounded-lg bg-th-ok-s px-3 py-2 text-sm text-th-ok">
            ✓ No deprecated APIs found in your Helm releases — you're clear to upgrade.
          </div>
        ) : (
          <div>
            <p className="mb-2 text-sm text-th-warn">{findings.length} deprecated API use(s) found — resolve before upgrading.</p>
            <div className="overflow-hidden rounded-lg border border-th-line">
              <table className="w-full text-sm">
                <thead className="bg-th-subtle text-left text-xs text-th-ghost">
                  <tr>
                    <th className="px-3 py-2">Kind</th>
                    <th className="px-3 py-2">API version</th>
                    <th className="px-3 py-2">Removed in</th>
                    <th className="px-3 py-2">Use instead</th>
                    <th className="px-3 py-2">Source</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-th-line">
                  {findings.map((f, i) => (
                    <tr key={i} className="hover:bg-th-hover">
                      <td className="px-3 py-2 font-medium text-th-body">
                        {f.kind} {f.name && <span className="text-th-ghost">{f.name}</span>}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-th-danger">{f.api_version}</td>
                      <td className="px-3 py-2"><span className="rounded bg-th-danger-s px-1.5 py-0.5 text-xs text-th-danger">v{f.removed_in}</span></td>
                      <td className="px-3 py-2 font-mono text-xs text-th-ok">{f.replacement}</td>
                      <td className="px-3 py-2 text-xs text-th-dim">{f.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
    </div>
  );
}
