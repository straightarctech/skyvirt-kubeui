import { useState, useMemo } from "react";
import { useUrlSearch } from "@/hooks/useUrlState";
import { EmptyRow } from "@/components/EmptyState";
import { TableSkeleton } from "@/components/Skeleton";
import { useOutletContext } from "react-router-dom";
import { listCRDs, listCRDInstances } from "@/api/client";
import type { CRDSummary } from "@/api/client";
import { useLiveResource } from "@/hooks/useLiveResource";
import LiveIndicator from "@/components/LiveIndicator";
import { useSortableTable, SortableTh } from "@/hooks/useSortableTable";
import { usePagination, TablePagination } from "@/hooks/usePagination";
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";

const GROUP_COLORS = ["#6366f1", "#a855f7", "#3b82f6", "#22c55e", "#f59e0b", "#ef4444"];

function age(created: string): string {
  const diff = Date.now() - new Date(created).getTime();
  const days = Math.floor(diff / 86400000);
  if (days > 0) return `${days}d`;
  const hours = Math.floor(diff / 3600000);
  if (hours > 0) return `${hours}h`;
  const mins = Math.floor(diff / 60000);
  return `${mins}m`;
}

export default function CRDs() {
  useOutletContext<{ namespace: string }>();
  const { data: items, loading, error, refresh, watchStatus, live, setLive } = useLiveResource<CRDSummary[]>(listCRDs, "CustomResourceDefinition", undefined);
  const [search, setSearch] = useUrlSearch();
  const [instancesFor, setInstancesFor] = useState<CRDSummary | null>(null);
  const [instances, setInstances] = useState<Record<string, unknown>[] | null>(null);
  const [instancesError, setInstancesError] = useState<string | null>(null);

  const viewInstances = async (c: CRDSummary) => {
    setInstancesFor(c);
    setInstances(null);
    setInstancesError(null);
    try {
      const resource = c.name.split(".")[0]; // CRD name is <plural>.<group>
      const res = await listCRDInstances(c.group, c.version, resource);
      setInstances(res || []);
    } catch (e) {
      setInstancesError(e instanceof Error ? e.message : String(e));
    }
  };

  const filtered = (items ?? []).filter(
    (c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.group.toLowerCase().includes(search.toLowerCase()) ||
      c.kind.toLowerCase().includes(search.toLowerCase()),
  );

  const { sorted, thProps } = useSortableTable(filtered, {
    name: (c) => c.name,
    group: (c) => c.group,
    version: (c) => c.version,
    kind: (c) => c.kind,
    scope: (c) => c.scope,
    age: (c) => Date.now() - new Date(c.created_at).getTime(),
  }, { key: "name", urlKey: "" });

  const pager = usePagination(sorted, { pageSize: 25, urlKey: "" });

  const groupData = useMemo(() => {
    const counts: Record<string, number> = {};
    filtered.forEach((c) => { counts[c.group] = (counts[c.group] || 0) + 1; });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, value]) => ({ name, value }));
  }, [filtered]);

  const namespacedCount = useMemo(() => filtered.filter((c) => c.scope === "Namespaced").length, [filtered]);

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-th-heading">Custom Resource Definitions</h1>
        <div className="flex items-center gap-2">
          <LiveIndicator live={live} status={watchStatus} onToggle={setLive} />
          <button onClick={refresh} className="px-3 py-1.5 text-sm bg-th-accent text-white rounded-lg hover:opacity-90 transition-opacity">
            Refresh
          </button>
        </div>
      </div>

      <input
        type="text"
        placeholder="Search CRDs..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full max-w-sm px-3 py-2 bg-th-subtle border border-th-line rounded-lg text-sm text-th-body placeholder:text-th-ghost focus:outline-none focus:ring-1 focus:ring-th-accent"
      />

      {loading && <TableSkeleton />}
      {error && <div className="p-3 bg-th-danger-s text-th-danger rounded-lg text-sm">{error}</div>}

      {!loading && filtered.length > 0 && (
        <div className="grid grid-cols-12 gap-4">
          <div className="col-span-12 md:col-span-4 bg-th-panel border border-th-line rounded-xl p-4 shadow-card">
            <h3 className="text-xs font-bold text-th-dim uppercase tracking-wider mb-2">By Group</h3>
            <div className="flex items-center gap-4">
              <div className="w-24 h-24">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart><Pie data={groupData} cx="50%" cy="50%" innerRadius={24} outerRadius={42} paddingAngle={2} dataKey="value" stroke="none">
                    {groupData.map((_, i) => <Cell key={i} fill={GROUP_COLORS[i % GROUP_COLORS.length]} />)}
                  </Pie></PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-col gap-1">
                {groupData.slice(0, 5).map((d, i) => (
                  <div key={d.name} className="flex items-center gap-2 text-xs">
                    <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: GROUP_COLORS[i % GROUP_COLORS.length] }} />
                    <span className="text-th-dim truncate">{d.name}</span>
                    <span className="font-semibold text-th-body">{d.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="col-span-12 md:col-span-8 flex gap-4">
            <div className="flex-1 bg-th-panel border border-th-line rounded-xl p-4 shadow-card flex flex-col items-center justify-center">
              <p className="text-3xl font-black text-th-accent">{filtered.length}</p>
              <p className="text-[10px] text-th-dim uppercase tracking-wider">CRDs</p>
            </div>
            <div className="flex-1 bg-th-panel border border-th-line rounded-xl p-4 shadow-card flex flex-col items-center justify-center">
              <p className="text-3xl font-black text-th-info">{namespacedCount}</p>
              <p className="text-[10px] text-th-dim uppercase tracking-wider">Namespaced</p>
            </div>
            <div className="flex-1 bg-th-panel border border-th-line rounded-xl p-4 shadow-card flex flex-col items-center justify-center">
              <p className="text-3xl font-black text-th-ok">{new Set(filtered.map((c) => c.group)).size}</p>
              <p className="text-[10px] text-th-dim uppercase tracking-wider">Groups</p>
            </div>
          </div>
        </div>
      )}

      {!loading && (
        <div className="bg-th-panel border border-th-line rounded-xl overflow-hidden shadow-card">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-th-dim bg-th-subtle border-b border-th-line">
                  <SortableTh {...thProps("name")}>Name</SortableTh>
                  <SortableTh {...thProps("group")}>Group</SortableTh>
                  <SortableTh {...thProps("version")}>Version</SortableTh>
                  <SortableTh {...thProps("kind")}>Kind</SortableTh>
                  <SortableTh {...thProps("scope")}>Scope</SortableTh>
                  <SortableTh {...thProps("age")}>Age</SortableTh>
                  <th className="px-4 py-3 font-medium">Instances</th>
                </tr>
              </thead>
              <tbody>
                {pager.paged.map((c) => (
                  <tr key={c.name} className="border-b border-th-line last:border-0 hover:bg-th-hover transition-colors">
                    <td className="px-4 py-3 font-medium text-th-body text-xs max-w-xs truncate" title={c.name}>
                      {c.name}
                    </td>
                    <td className="px-4 py-3 text-th-dim text-xs">{c.group}</td>
                    <td className="px-4 py-3 text-th-dim">{c.version}</td>
                    <td className="px-4 py-3 text-th-body">{c.kind}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-medium ${
                          c.scope === "Namespaced"
                            ? "bg-th-info-s text-th-info"
                            : "bg-th-warn-s text-th-warn"
                        }`}
                      >
                        {c.scope}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-th-ghost">{age(c.created_at)}</td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => viewInstances(c)}
                        className="px-2 py-1 text-xs bg-th-info-s text-th-info rounded hover:opacity-80"
                      >View</button>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <EmptyRow colSpan={7} title="No CRDs found" />
                )}
              </tbody>
            </table>
          </div>
          <TablePagination {...pager} label="CRDs" />
        </div>
      )}

      {/* Instances modal */}
      {instancesFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setInstancesFor(null)}>
          <div className="bg-th-panel border border-th-line rounded-xl shadow-2xl w-full max-w-2xl p-6 space-y-4 mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-th-heading">{instancesFor.kind} instances</h2>
              <button onClick={() => setInstancesFor(null)} className="text-th-dim hover:text-th-body transition-colors">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            {instancesError && <div className="p-2 bg-th-danger-s text-th-danger rounded text-sm">{instancesError}</div>}
            {!instances && !instancesError && (
              <div className="flex items-center justify-center h-24">
                <div className="w-6 h-6 border-2 border-th-accent border-t-transparent rounded-full animate-spin" />
              </div>
            )}
            {instances && (
              <div className="max-h-[50vh] overflow-y-auto border border-th-line rounded-lg divide-y divide-th-line">
                {instances.length === 0 && (
                  <p className="px-4 py-6 text-center text-sm text-th-ghost">No instances of this resource exist yet</p>
                )}
                {instances.map((inst, i) => {
                  const meta = (inst as { metadata?: { name?: string; namespace?: string; creationTimestamp?: string } }).metadata || {};
                  return (
                    <div key={i} className="flex items-center justify-between px-4 py-2">
                      <div className="min-w-0">
                        <p className="text-sm text-th-body font-medium truncate">{meta.name || "(unnamed)"}</p>
                        {meta.namespace && <p className="text-xs text-th-ghost">{meta.namespace}</p>}
                      </div>
                      {meta.creationTimestamp && (
                        <span className="text-xs text-th-ghost shrink-0">{age(meta.creationTimestamp)}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
