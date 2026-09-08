import { useState, useMemo } from "react";
import { useUrlSearch } from "@/hooks/useUrlState";
import { EmptyRow } from "@/components/EmptyState";
import { TableSkeleton } from "@/components/Skeleton";
import { Link } from "react-router-dom";
import { listNodes, cordonNode, uncordonNode, topNodes } from "@/api/client";
import type { NodeSummary, NodeMetrics } from "@/api/client";
import { useResource } from "@/hooks/useResource";
import { useLiveResource } from "@/hooks/useLiveResource";
import LiveIndicator from "@/components/LiveIndicator";
import { useSortableTable, SortableTh } from "@/hooks/useSortableTable";
import { usePagination, TablePagination } from "@/hooks/usePagination";
import { useRowSelection } from "@/hooks/useRowSelection";
import BulkActionBar, { SelectCheckbox } from "@/components/BulkActionBar";
import ConfirmModal from "@/components/ConfirmModal";
import DrainModal from "@/components/DrainModal";
import { useToast } from "@/components/Toast";
import { RingGauge, BarMeter } from "@/components/viz";

function StatusBadge({ status }: { status: string }) {
  const colors = status === "Ready"
    ? "bg-th-ok-s text-th-ok"
    : "bg-th-danger-s text-th-danger";
  return <span className={`px-2 py-0.5 rounded text-xs font-medium ${colors}`}>{status}</span>;
}

export default function NodeList() {
  const { data: nodes, loading, error, refresh, watchStatus, live, setLive } = useLiveResource<NodeSummary[]>(listNodes, "Node", undefined);
  const { data: metrics } = useResource<NodeMetrics[]>(() => topNodes(), []);
  const metricsMap = useMemo(() => new Map((metrics ?? []).map((m) => [m.name, m])), [metrics]);
  const toast = useToast();
  const [search, setSearch] = useUrlSearch();
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [pending, setPending] = useState<{ name: string; label: string; fn: () => Promise<void> } | null>(null);
  const [drainNodeName, setDrainNodeName] = useState<string | null>(null);

  const filtered = (nodes ?? []).filter((n) =>
    n.name.toLowerCase().includes(search.toLowerCase()) ||
    n.internal_ip.includes(search),
  );

  const { sorted, thProps } = useSortableTable(filtered, {
    name: (n) => n.name,
    status: (n) => n.status,
    roles: (n) => (n.roles || []).join(","),
    version: (n) => n.version,
    ip: (n) => n.internal_ip,
    cpu: (n) => metricsMap.get(n.name)?.cpu_percent ?? 0,
    memory: (n) => metricsMap.get(n.name)?.memory_percent ?? 0,
  }, { key: "name", urlKey: "" });

  const pager = usePagination(sorted, { pageSize: 25, urlKey: "" });
  const sel = useRowSelection<NodeSummary>((n) => n.name);

  const handleAction = (name: string, action: () => Promise<void>, label: string) => {
    setPending({ name, label, fn: action });
  };

  const runPending = async () => {
    if (!pending) return;
    setActionLoading(pending.name);
    try {
      await pending.fn();
      toast.success(`${pending.label} ${pending.name} succeeded`);
      refresh();
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-th-heading">Nodes</h1>
        <div className="flex items-center gap-2">
          <LiveIndicator live={live} status={watchStatus} onToggle={setLive} />
          <button onClick={refresh} className="px-3 py-1.5 text-sm bg-th-accent text-white rounded-lg hover:opacity-90 transition-opacity">
            Refresh
          </button>
        </div>
      </div>

      <input
        type="text"
        placeholder="Search nodes..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full max-w-sm px-3 py-2 bg-th-subtle border border-th-line rounded-lg text-sm text-th-body placeholder:text-th-ghost focus:outline-none focus:ring-1 focus:ring-th-accent"
      />

      {loading && <TableSkeleton />}
      {error && <div className="p-3 bg-th-danger-s text-th-danger rounded-lg text-sm">{error}</div>}

      {!loading && filtered.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((n) => {
            const m = metricsMap.get(n.name);
            const cpu = m?.cpu_percent ?? 0;
            const mem = m?.memory_percent ?? 0;
            return (
              <div key={n.name} className="bg-th-panel border border-th-line rounded-xl p-4 shadow-card">
                <div className="flex items-center justify-between mb-3">
                  <div className="min-w-0">
                    <Link to={`/nodes/${n.name}`} className="text-sm font-semibold text-th-accent hover:underline truncate block">{n.name}</Link>
                    <p className="text-[11px] text-th-ghost truncate">{n.roles.join(", ") || "worker"} · {n.internal_ip}</p>
                  </div>
                  <StatusBadge status={n.status} />
                </div>
                <div className="flex items-center justify-around">
                  <div className="flex flex-col items-center gap-1">
                    <RingGauge value={cpu} size={68} sublabel="CPU" />
                  </div>
                  <div className="flex flex-col items-center gap-1">
                    <RingGauge value={mem} size={68} sublabel="MEM" />
                  </div>
                  <div className="flex flex-col items-center justify-center">
                    <span className="text-2xl font-bold text-th-heading tabular-nums">{n.version.replace(/^v/, "").split("+")[0]}</span>
                    <span className="text-[10px] text-th-ghost uppercase tracking-wider">version</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!loading && (
        <div className="bg-th-panel border border-th-line rounded-xl overflow-hidden shadow-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-th-dim bg-th-subtle border-b border-th-line">
                <th className="pl-4 pr-1 py-3 w-8"><SelectCheckbox ariaLabel="Select all nodes on this page" checked={sel.allSelected(pager.paged)} indeterminate={sel.someSelected(pager.paged)} onChange={() => sel.toggleAll(pager.paged)} /></th>
                <SortableTh {...thProps("name")}>Name</SortableTh>
                <SortableTh {...thProps("status")}>Status</SortableTh>
                <SortableTh {...thProps("roles")}>Roles</SortableTh>
                <SortableTh {...thProps("version")}>Version</SortableTh>
                <SortableTh {...thProps("ip")}>IP</SortableTh>
                <SortableTh {...thProps("cpu")}>CPU</SortableTh>
                <SortableTh {...thProps("memory")}>Memory</SortableTh>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pager.paged.map((n) => (
                <tr key={n.name} className={`border-b border-th-line last:border-0 hover:bg-th-hover transition-colors ${sel.isSelected(n.name) ? "bg-th-accent/5" : ""}`}>
                  <td className="pl-4 pr-1 py-3"><SelectCheckbox ariaLabel={`Select ${n.name}`} checked={sel.isSelected(n.name)} onChange={() => sel.toggle(n.name)} /></td>
                  <td className="px-4 py-3 font-medium"><Link to={`/nodes/${n.name}`} className="text-th-accent hover:underline">{n.name}</Link></td>
                  <td className="px-4 py-3"><StatusBadge status={n.status} /></td>
                  <td className="px-4 py-3 text-th-dim">{n.roles.join(", ")}</td>
                  <td className="px-4 py-3 text-th-dim">{n.version}</td>
                  <td className="px-4 py-3 text-th-dim font-mono text-xs">{n.internal_ip}</td>
                  <td className="px-4 py-3"><BarMeter value={metricsMap.get(n.name)?.cpu_percent ?? 0} width={80} /></td>
                  <td className="px-4 py-3"><BarMeter value={metricsMap.get(n.name)?.memory_percent ?? 0} width={80} /></td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      {n.unschedulable ? (
                        <button
                          onClick={() => handleAction(n.name, () => uncordonNode(n.name), "Uncordon")}
                          disabled={actionLoading === n.name}
                          className="px-2 py-1 text-xs bg-th-ok-s text-th-ok rounded hover:opacity-80"
                        >
                          Uncordon
                        </button>
                      ) : (
                        <button
                          onClick={() => handleAction(n.name, () => cordonNode(n.name), "Cordon")}
                          disabled={actionLoading === n.name}
                          className="px-2 py-1 text-xs bg-th-warn-s text-th-warn rounded hover:opacity-80"
                        >
                          Cordon
                        </button>
                      )}
                      <button
                        onClick={() => setDrainNodeName(n.name)}
                        disabled={actionLoading === n.name}
                        className="px-2 py-1 text-xs bg-th-danger-s text-th-danger rounded hover:opacity-80"
                      >
                        Drain
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <EmptyRow colSpan={9} title="No nodes found" hint="No nodes match your search. Cluster nodes appear here as they register." />
              )}
            </tbody>
          </table>
          <TablePagination {...pager} label="nodes" />
          <BulkActionBar
            selected={sel.selectedRows(nodes ?? [])}
            noun="nodes"
            onClear={sel.clear}
            onComplete={refresh}
            actions={[
              { label: "Cordon", gerund: "Cordoning", run: (n) => cordonNode(n.name) },
              { label: "Uncordon", gerund: "Uncordoning", run: (n) => uncordonNode(n.name) },
            ]}
          />
        </div>
      )}
      <ConfirmModal
        open={pending !== null}
        onClose={() => setPending(null)}
        onConfirm={runPending}
        title={`${pending?.label ?? ""} Node`}
        message={
          <span>
            {pending?.label} node <span className="font-semibold text-th-heading">{pending?.name}</span>?
            {pending?.label === "Drain" && (
              <span className="mt-1 block text-xs text-th-warn">This cordons the node and evicts all its pods.</span>
            )}
          </span>
        }
        confirmLabel={pending?.label}
        variant="warning"
      />
      {drainNodeName && (
        <DrainModal nodeName={drainNodeName} onClose={() => setDrainNodeName(null)} onDone={refresh} />
      )}
    </div>
  );
}
