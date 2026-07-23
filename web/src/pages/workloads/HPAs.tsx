import { useState, useMemo } from "react";
import { useUrlSearch } from "@/hooks/useUrlState";
import { EmptyRow } from "@/components/EmptyState";
import { TableSkeleton } from "@/components/Skeleton";
import { useOutletContext } from "react-router-dom";
import { listHPAs, deleteHPA } from "@/api/client";
import type { HPASummary } from "@/api/client";
import { useLiveResource } from "@/hooks/useLiveResource";
import LiveIndicator from "@/components/LiveIndicator";
import { useSortableTable, SortableTh } from "@/hooks/useSortableTable";
import { usePagination, TablePagination } from "@/hooks/usePagination";
import { BarMeter } from "@/components/viz";
import DeleteConfirmModal from "@/components/DeleteConfirmModal";
import CreateHPAModal from "@/components/CreateHPAModal";
import EditYAMLModal from "@/components/EditYAMLModal";
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";

const NS_COLORS = ["#6366f1", "#a855f7", "#3b82f6", "#22c55e", "#f59e0b", "#ef4444"];

function age(created: string): string {
  const diff = Date.now() - new Date(created).getTime();
  const days = Math.floor(diff / 86400000);
  if (days > 0) return `${days}d`;
  const hours = Math.floor(diff / 3600000);
  if (hours > 0) return `${hours}h`;
  return `${Math.floor(diff / 60000)}m`;
}

export default function HPAs() {
  const { namespace } = useOutletContext<{ namespace: string }>();
  const { data: items, loading, error, refresh, watchStatus, live, setLive } = useLiveResource<HPASummary[]>(
    () => listHPAs(namespace),
    "HorizontalPodAutoscaler",
    namespace,
    [namespace],
  );
  const [search, setSearch] = useUrlSearch();
  const [showCreate, setShowCreate] = useState(false);
  const [editYaml, setEditYaml] = useState<{ ns: string; name: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ ns: string; name: string } | null>(null);

  const filtered = (items ?? []).filter(
    (h) =>
      h.name.toLowerCase().includes(search.toLowerCase()) ||
      h.namespace.toLowerCase().includes(search.toLowerCase()) ||
      h.target_name.toLowerCase().includes(search.toLowerCase()),
  );

  const { sorted, thProps } = useSortableTable(filtered, {
    name: (h) => h.name,
    namespace: (h) => h.namespace,
    target: (h) => h.target_name,
    minmax: (h) => h.min_replicas,
    replicas: (h) => h.current_replicas,
    age: (h) => Date.now() - new Date(h.created_at).getTime(),
  }, { key: "name", urlKey: "" });

  const pager = usePagination(sorted, { pageSize: 25, urlKey: "" });

  const nsData = useMemo(() => {
    const counts: Record<string, number> = {};
    filtered.forEach((h) => { counts[h.namespace] = (counts[h.namespace] || 0) + 1; });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, value]) => ({ name, value }));
  }, [filtered]);

  const atMax = useMemo(() => filtered.filter((h) => h.current_replicas >= h.max_replicas).length, [filtered]);
  const scalingNow = useMemo(() => filtered.filter((h) => h.desired_replicas !== h.current_replicas).length, [filtered]);

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-th-heading">Horizontal Pod Autoscalers</h1>
        <div className="flex items-center gap-2">
          <LiveIndicator live={live} status={watchStatus} onToggle={setLive} />
          <button onClick={() => setShowCreate(true)} className="px-3 py-1.5 text-sm bg-th-ok text-white rounded-lg hover:opacity-90 transition-opacity">
            Create
          </button>
          <button onClick={refresh} className="px-3 py-1.5 text-sm bg-th-accent text-white rounded-lg hover:opacity-90 transition-opacity">
            Refresh
          </button>
        </div>
      </div>

      <input
        type="text"
        placeholder="Search HPAs..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full max-w-sm px-3 py-2 bg-th-subtle border border-th-line rounded-lg text-sm text-th-body placeholder:text-th-ghost focus:outline-none focus:ring-1 focus:ring-th-accent"
      />

      {loading && <TableSkeleton />}
      {error && <div className="p-3 bg-th-danger-s text-th-danger rounded-lg text-sm">{error}</div>}

      {!loading && filtered.length > 0 && (
        <div className="grid grid-cols-12 gap-4">
          <div className="col-span-12 md:col-span-4 bg-th-panel border border-th-line rounded-xl p-4 shadow-card">
            <h3 className="text-xs font-bold text-th-dim uppercase tracking-wider mb-2">By Namespace</h3>
            <div className="flex items-center gap-4">
              <div className="w-24 h-24">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart><Pie data={nsData} cx="50%" cy="50%" innerRadius={24} outerRadius={42} paddingAngle={2} dataKey="value" stroke="none">
                    {nsData.map((_, i) => <Cell key={i} fill={NS_COLORS[i % NS_COLORS.length]} />)}
                  </Pie></PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-col gap-1">
                {nsData.slice(0, 5).map((d, i) => (
                  <div key={d.name} className="flex items-center gap-2 text-xs">
                    <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: NS_COLORS[i % NS_COLORS.length] }} />
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
              <p className="text-[10px] text-th-dim uppercase tracking-wider">Autoscalers</p>
            </div>
            <div className="flex-1 bg-th-panel border border-th-line rounded-xl p-4 shadow-card flex flex-col items-center justify-center">
              <p className="text-3xl font-black text-th-info">{scalingNow}</p>
              <p className="text-[10px] text-th-dim uppercase tracking-wider">Scaling Now</p>
            </div>
            <div className="flex-1 bg-th-panel border border-th-line rounded-xl p-4 shadow-card flex flex-col items-center justify-center">
              <p className={`text-3xl font-black ${atMax > 0 ? "text-th-warn" : "text-th-ok"}`}>{atMax}</p>
              <p className="text-[10px] text-th-dim uppercase tracking-wider">At Max Replicas</p>
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
                  <SortableTh {...thProps("name")}>Name</SortableTh>
                  <SortableTh {...thProps("namespace")}>Namespace</SortableTh>
                  <SortableTh {...thProps("target")}>Target</SortableTh>
                  <th className="px-4 py-3 font-medium">Metrics</th>
                  <SortableTh {...thProps("minmax")}>Min / Max</SortableTh>
                  <SortableTh {...thProps("replicas")}>Replicas</SortableTh>
                  <SortableTh {...thProps("age")}>Age</SortableTh>
                  <th className="px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pager.paged.map((h) => {
                  const key = `${h.namespace}/${h.name}`;
                  const atCeiling = h.current_replicas >= h.max_replicas;
                  return (
                    <tr key={key} className="border-b border-th-line last:border-0 hover:bg-th-hover transition-colors">
                      <td className="px-4 py-3 font-medium text-th-body">{h.name}</td>
                      <td className="px-4 py-3 text-th-dim">{h.namespace}</td>
                      <td className="px-4 py-3 text-th-dim">
                        <span className="text-th-ghost">{h.target_kind}/</span>{h.target_name}
                      </td>
                      <td className="px-4 py-3 text-th-dim text-xs">
                        {(h.metrics || []).length > 0 ? h.metrics.join(", ") : "-"}
                      </td>
                      <td className="px-4 py-3 text-th-dim">{h.min_replicas} / {h.max_replicas}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium shrink-0 ${atCeiling ? "bg-th-warn-s text-th-warn" : "bg-th-ok-s text-th-ok"}`}>
                            {h.current_replicas} → {h.desired_replicas}
                          </span>
                          <BarMeter
                            value={h.max_replicas > h.min_replicas ? ((h.current_replicas - h.min_replicas) / (h.max_replicas - h.min_replicas)) * 100 : 0}
                            width={56} showPct={false}
                            color={atCeiling ? "var(--th-warn)" : "var(--th-accent)"}
                          />
                        </div>
                      </td>
                      <td className="px-4 py-3 text-th-ghost">{age(h.created_at)}</td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          <button
                            onClick={() => setEditYaml({ ns: h.namespace, name: h.name })}
                            className="px-2 py-1 text-xs bg-th-info-s text-th-info rounded hover:opacity-80"
                          >Edit</button>
                          <button
                            onClick={() => setDeleteTarget({ ns: h.namespace, name: h.name })}
                            className="px-2 py-1 text-xs bg-th-danger-s text-th-danger rounded hover:opacity-80"
                          >Delete</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <EmptyRow colSpan={8} title="No autoscalers found — create one to scale workloads on CPU or memory pressure" />
                )}
              </tbody>
            </table>
          </div>
          <TablePagination {...pager} label="HPAs" />
        </div>
      )}

      {showCreate && (
        <CreateHPAModal
          defaultNamespace={namespace !== "all" ? namespace : undefined}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); refresh(); }}
        />
      )}
      {editYaml && (
        <EditYAMLModal
          kind="HorizontalPodAutoscaler"
          namespace={editYaml.ns}
          name={editYaml.name}
          onClose={() => setEditYaml(null)}
          onUpdated={refresh}
        />
      )}
      <DeleteConfirmModal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onDeleted={refresh}
        resourceType="HPA"
        resourceName={deleteTarget?.name ?? ""}
        namespace={deleteTarget?.ns}
        kind="HorizontalPodAutoscaler"
        deleteFn={() => deleteHPA(deleteTarget!.ns, deleteTarget!.name)}
      />
    </div>
  );
}
