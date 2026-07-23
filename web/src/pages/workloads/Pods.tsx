import { useState, useMemo } from "react";
import { useUrlSearch } from "@/hooks/useUrlState";
import { EmptyRow } from "@/components/EmptyState";
import { TableSkeleton } from "@/components/Skeleton";
import { useOutletContext, Link } from "react-router-dom";
import { listPods, deletePod, getPodLogs } from "@/api/client";
import type { PodSummary } from "@/api/client";
import { useLiveResource } from "@/hooks/useLiveResource";
import LiveIndicator from "@/components/LiveIndicator";
import { useSortableTable, SortableTh } from "@/hooks/useSortableTable";
import { usePagination, TablePagination } from "@/hooks/usePagination";
import { useRowSelection } from "@/hooks/useRowSelection";
import BulkActionBar, { SelectCheckbox } from "@/components/BulkActionBar";
import { useLabelSelector, LabelSelectorInput } from "@/hooks/useLabelSelector";
import { RatioMeter } from "@/components/viz";
import DeleteConfirmModal from "@/components/DeleteConfirmModal";
import DiagnoseModal from "@/components/DiagnoseModal";
import { StatStrip } from "@/components/ResourceSummary";
import { DistributionBar } from "@/components/DistributionBar";

function age(created: string): string {
  const diff = Date.now() - new Date(created).getTime();
  const days = Math.floor(diff / 86400000);
  if (days > 0) return `${days}d`;
  const hours = Math.floor(diff / 3600000);
  if (hours > 0) return `${hours}h`;
  const mins = Math.floor(diff / 60000);
  return `${mins}m`;
}

function podStatusColor(status: string): string {
  switch (status) {
    case "Running":
      return "bg-th-ok-s text-th-ok";
    case "Succeeded":
      return "bg-th-info-s text-th-info";
    case "Pending":
      return "bg-th-warn-s text-th-warn";
    case "Failed":
    case "CrashLoopBackOff":
    case "Error":
      return "bg-th-danger-s text-th-danger";
    default:
      return "bg-th-muted text-th-dim";
  }
}

export default function Pods() {
  const { namespace } = useOutletContext<{ namespace: string }>();
  const { data: pods, loading, error, refresh, watchStatus, live, setLive } = useLiveResource<PodSummary[]>(
    () => listPods(namespace),
    "Pod",
    namespace,
    [namespace],
    { keyOf: (p) => `${(p as PodSummary).namespace}/${(p as PodSummary).name}` },
  );
  const [search, setSearch] = useUrlSearch();
  const [logsPod, setLogsPod] = useState<{ ns: string; name: string; container?: string } | null>(null);
  const [logs, setLogs] = useState("");
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ ns: string; name: string } | null>(null);
  const [diagnose, setDiagnose] = useState<{ ns: string; name: string } | null>(null);

  const labelSel = useLabelSelector({ urlKey: "" });
  const textFiltered = (pods ?? []).filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.namespace.toLowerCase().includes(search.toLowerCase()) ||
      p.status.toLowerCase().includes(search.toLowerCase()) ||
      (p.node || "").toLowerCase().includes(search.toLowerCase()),
  );
  const filtered = textFiltered.filter((p) => labelSel.match(p.labels));

  const { sorted, thProps } = useSortableTable(filtered, {
    name: (p) => p.name,
    namespace: (p) => p.namespace,
    status: (p) => p.status,
    ready: (p) => (p.containers || []).filter((c) => c.ready).length,
    node: (p) => p.node || "",
    ip: (p) => p.ip || "",
    restarts: (p) => totalRestarts(p),
    age: (p) => Date.now() - new Date(p.created_at).getTime(),
  }, { key: "name", urlKey: "" });

  const pager = usePagination(sorted, { pageSize: 25, urlKey: "" });
  const sel = useRowSelection<PodSummary>((p) => `${p.namespace}/${p.name}`);

  const handleViewLogs = async (ns: string, name: string, container?: string) => {
    setLogsPod({ ns, name, container });
    setLogsLoading(true);
    setLogsError(null);
    setLogs("");
    try {
      const text = await getPodLogs(ns, name, container, 200);
      setLogs(text);
    } catch (e) {
      setLogsError(e instanceof Error ? e.message : String(e));
    } finally {
      setLogsLoading(false);
    }
  };

  // Function declaration (hoisted) so the sort accessor above can call it even
  // when `?sort=restarts` makes that column active on first render — a const
  // arrow here would hit the temporal dead zone and white-screen.
  function totalRestarts(p: PodSummary) {
    return (p.containers || []).reduce((sum, c) => sum + (c.restarts || 0), 0);
  }

  const stats = useMemo(() => {
    const inSet = (s: string, set: string[]) => set.includes(s);
    let running = 0, pending = 0, failed = 0, succeeded = 0, restarts = 0;
    for (const p of filtered) {
      if (p.status === "Running") running++;
      else if (inSet(p.status, ["Pending", "ContainerCreating", "PodInitializing", "Terminating"])) pending++;
      else if (inSet(p.status, ["Failed", "CrashLoopBackOff", "Error", "ImagePullBackOff", "ErrImagePull", "OOMKilled", "Evicted"])) failed++;
      else if (inSet(p.status, ["Succeeded", "Completed"])) succeeded++;
      restarts += totalRestarts(p);
    }
    const nodes = new Set(filtered.map((p) => p.node).filter(Boolean)).size;
    const other = filtered.length - running - pending - failed - succeeded;
    return { total: filtered.length, running, pending, failed, succeeded, other, restarts, nodes };
  }, [filtered]);

  // Compact status-distribution segments for the inline bar.
  const statusBar = useMemo(() => [
    { label: "Running", value: stats.running, color: "var(--th-ok)" },
    { label: "Pending", value: stats.pending, color: "var(--th-warn)" },
    { label: "Failed", value: stats.failed, color: "var(--th-danger)" },
    { label: "Succeeded", value: stats.succeeded, color: "#6366f1" },
    { label: "Other", value: stats.other, color: "var(--th-dim)" },
  ], [stats]);

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-th-heading">Pods</h1>
        <div className="flex items-center gap-2">
          <LiveIndicator live={live} status={watchStatus} onToggle={setLive} />
          <button onClick={refresh} className="px-3 py-1.5 text-sm bg-th-accent text-white rounded-lg hover:opacity-90 transition-opacity">
            Refresh
          </button>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <input
          type="text"
          placeholder="Search pods..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full sm:max-w-sm px-3 py-2 bg-th-subtle border border-th-line rounded-lg text-sm text-th-body placeholder:text-th-ghost focus:outline-none focus:ring-1 focus:ring-th-accent"
        />
        <LabelSelectorInput
          value={labelSel.query}
          onChange={labelSel.setQuery}
          matched={filtered.length}
          total={textFiltered.length}
          invalid={labelSel.invalid}
          className="w-full sm:max-w-sm"
        />
      </div>

      {loading && <TableSkeleton />}
      {error && <div className="p-3 bg-th-danger-s text-th-danger rounded-lg text-sm">{error}</div>}

      {!loading && filtered.length > 0 && (
        <>
          <StatStrip stats={[
            { label: "Pods", value: stats.total, tone: "accent" },
            { label: "Running", value: stats.running, tone: "ok" },
            { label: "Pending", value: stats.pending, tone: stats.pending ? "warn" : "neutral" },
            { label: "Failed", value: stats.failed, tone: stats.failed ? "error" : "neutral" },
            { label: "Restarts", value: stats.restarts, tone: stats.restarts ? "warn" : "neutral" },
            { label: "Nodes", value: stats.nodes, tone: "info" },
          ]} />
          <DistributionBar segments={statusBar} />
        </>
      )}

      {/* Log viewer modal */}
      {logsPod && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-th-panel border border-th-line rounded-xl shadow-card w-full max-w-3xl max-h-[80vh] flex flex-col m-4">
            <div className="flex items-center justify-between px-4 py-3 border-b border-th-line">
              <h3 className="text-sm font-medium text-th-heading">
                Logs: {logsPod.ns}/{logsPod.name}
                {logsPod.container ? ` (${logsPod.container})` : ""}
              </h3>
              <button onClick={() => setLogsPod(null)} className="text-th-dim hover:text-th-body">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4">
              {logsLoading && (
                <div className="flex items-center justify-center h-32">
                  <div className="w-6 h-6 border-2 border-th-accent border-t-transparent rounded-full animate-spin" />
                </div>
              )}
              {logsError && <div className="p-3 bg-th-danger-s text-th-danger rounded-lg text-sm">{logsError}</div>}
              {!logsLoading && !logsError && (
                <pre className="text-xs text-th-body font-mono whitespace-pre-wrap break-all bg-th-subtle rounded-lg p-3">
                  {logs || "No logs available"}
                </pre>
              )}
            </div>
          </div>
        </div>
      )}

      {!loading && (
        <div className="bg-th-panel border border-th-line rounded-xl overflow-hidden shadow-card">
          <div className="overflow-x-auto pin-actions">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-th-dim bg-th-subtle border-b border-th-line">
                  <th className="pl-4 pr-1 py-3 w-8">
                    <SelectCheckbox
                      ariaLabel="Select all pods on this page"
                      checked={sel.allSelected(pager.paged)}
                      indeterminate={sel.someSelected(pager.paged)}
                      onChange={() => sel.toggleAll(pager.paged)}
                    />
                  </th>
                  <SortableTh {...thProps("name")}>Name</SortableTh>
                  <SortableTh {...thProps("namespace")}>Namespace</SortableTh>
                  <SortableTh {...thProps("status")}>Status</SortableTh>
                  <SortableTh {...thProps("ready")}>Ready</SortableTh>
                  <SortableTh {...thProps("node")}>Node</SortableTh>
                  <SortableTh {...thProps("ip")}>IP</SortableTh>
                  <SortableTh {...thProps("restarts")}>Restarts</SortableTh>
                  <SortableTh {...thProps("age")}>Age</SortableTh>
                  <th className="px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pager.paged.map((p) => {
                  const key = `${p.namespace}/${p.name}`;
                  const restarts = totalRestarts(p);
                  return (
                    <tr key={key} className={`border-b border-th-line last:border-0 hover:bg-th-hover transition-colors ${sel.isSelected(key) ? "bg-th-accent/5" : ""}`}>
                      <td className="pl-4 pr-1 py-3">
                        <SelectCheckbox ariaLabel={`Select ${p.name}`} checked={sel.isSelected(key)} onChange={() => sel.toggle(key)} />
                      </td>
                      <td className="px-4 py-3 font-medium max-w-xs truncate" title={p.name}><Link to={`/workloads/pods/${p.namespace}/${p.name}`} className="text-th-accent hover:underline">{p.name}</Link></td>
                      <td className="px-4 py-3 text-th-dim">{p.namespace}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${podStatusColor(p.status)}`}>
                          {p.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <RatioMeter ready={(p.containers || []).filter((c) => c.ready).length} total={(p.containers || []).length} width={64} />
                      </td>
                      <td className="px-4 py-3 text-th-dim text-xs">{p.node || "-"}</td>
                      <td className="px-4 py-3 text-th-dim font-mono text-xs">{p.ip || "-"}</td>
                      <td className="px-4 py-3">
                        <span className={restarts > 0 ? "text-th-warn" : "text-th-dim"}>{restarts}</span>
                      </td>
                      <td className="px-4 py-3 text-th-ghost">{age(p.created_at)}</td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          <button
                            onClick={() => setDiagnose({ ns: p.namespace, name: p.name })}
                            className="px-2 py-1 text-xs bg-th-accent/10 text-th-accent rounded hover:opacity-80"
                            title="Diagnose issues with this pod"
                          >
                            Diagnose
                          </button>
                          <button
                            onClick={() => handleViewLogs(p.namespace, p.name)}
                            className="px-2 py-1 text-xs bg-th-info-s text-th-info rounded hover:opacity-80"
                          >
                            Logs
                          </button>
                          <button
                            onClick={() => setDeleteTarget({ ns: p.namespace, name: p.name })}
                            className="px-2 py-1 text-xs bg-th-danger-s text-th-danger rounded hover:opacity-80"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <EmptyRow colSpan={10} title="No pods found" hint="No pods match your search or filters, or this namespace has none yet." />
                )}
              </tbody>
            </table>
          </div>
          <TablePagination {...pager} label="pods" />
        </div>
      )}
      <BulkActionBar
        selected={sel.selectedRows(pods ?? [])}
        noun="pods"
        onClear={sel.clear}
        onComplete={refresh}
        actions={[
          { label: "Delete", danger: true, gerund: "Deleting", run: (p) => deletePod(p.namespace, p.name) },
        ]}
      />
      <DeleteConfirmModal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onDeleted={refresh}
        resourceType="Pod"
        resourceName={deleteTarget?.name ?? ""}
        namespace={deleteTarget?.ns}
        kind="Pod"
        deleteFn={() => deletePod(deleteTarget!.ns, deleteTarget!.name)}
      />
      {diagnose && (
        <DiagnoseModal namespace={diagnose.ns} name={diagnose.name} onClose={() => setDiagnose(null)} />
      )}
    </div>
  );
}
