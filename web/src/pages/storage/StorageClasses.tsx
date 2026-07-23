import { useState, useMemo } from "react";
import { useUrlSearch } from "@/hooks/useUrlState";
import { EmptyRow } from "@/components/EmptyState";
import { TableSkeleton } from "@/components/Skeleton";
import { useOutletContext } from "react-router-dom";
import { listStorageClasses } from "@/api/client";
import type { StorageClassSummary } from "@/api/client";
import { useLiveResource } from "@/hooks/useLiveResource";
import LiveIndicator from "@/components/LiveIndicator";
import { useSortableTable, SortableTh } from "@/hooks/useSortableTable";
import { usePagination, TablePagination } from "@/hooks/usePagination";
import EditYAMLModal from "@/components/EditYAMLModal";
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";

const COLORS = ["#6366f1", "#a855f7", "#3b82f6", "#22c55e", "#f59e0b", "#ef4444"];

function age(created: string): string {
  const diff = Date.now() - new Date(created).getTime();
  const days = Math.floor(diff / 86400000);
  if (days > 0) return `${days}d`;
  const hours = Math.floor(diff / 3600000);
  if (hours > 0) return `${hours}h`;
  const mins = Math.floor(diff / 60000);
  return `${mins}m`;
}

export default function StorageClasses() {
  useOutletContext<{ namespace: string }>();
  const { data: items, loading, error, refresh, watchStatus, live, setLive } = useLiveResource<StorageClassSummary[]>(listStorageClasses, "StorageClass", undefined);
  const [search, setSearch] = useUrlSearch();
  const [editYaml, setEditYaml] = useState<string | null>(null);

  const filtered = (items ?? []).filter(
    (s) =>
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.provisioner.toLowerCase().includes(search.toLowerCase()),
  );

  const { sorted, thProps } = useSortableTable(filtered, {
    name: (s) => s.name,
    provisioner: (s) => s.provisioner,
    reclaim_policy: (s) => s.reclaim_policy,
    volume_binding_mode: (s) => s.volume_binding_mode,
    is_default: (s) => (s.is_default ? 1 : 0),
    age: (s) => Date.now() - new Date(s.created_at).getTime(),
  }, { key: "name", urlKey: "" });

  const pager = usePagination(sorted, { pageSize: 25, urlKey: "" });

  const provisionerData = useMemo(() => {
    const counts: Record<string, number> = {};
    filtered.forEach((s) => { counts[s.provisioner] = (counts[s.provisioner] || 0) + 1; });
    return Object.entries(counts).map(([name, value]) => ({
      name: name.length > 20 ? name.slice(0, 20) + "..." : name,
      fullName: name,
      value,
    }));
  }, [filtered]);

  const defaultCount = useMemo(() => filtered.filter((s) => s.is_default).length, [filtered]);

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-th-heading">Storage Classes</h1>
        <div className="flex items-center gap-2">
          <LiveIndicator live={live} status={watchStatus} onToggle={setLive} />
          <button onClick={refresh} className="px-3 py-1.5 text-sm bg-th-accent text-white rounded-lg hover:opacity-90 transition-opacity">
            Refresh
          </button>
        </div>
      </div>

      <input
        type="text"
        placeholder="Search storage classes..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full max-w-sm px-3 py-2 bg-th-subtle border border-th-line rounded-lg text-sm text-th-body placeholder:text-th-ghost focus:outline-none focus:ring-1 focus:ring-th-accent"
      />

      {loading && <TableSkeleton />}
      {error && <div className="p-3 bg-th-danger-s text-th-danger rounded-lg text-sm">{error}</div>}

      {!loading && filtered.length > 0 && (
        <div className="grid grid-cols-12 gap-4">
          <div className="col-span-12 md:col-span-4 bg-th-panel border border-th-line rounded-xl p-4 shadow-card">
            <h3 className="text-xs font-bold text-th-dim uppercase tracking-wider mb-2">Provisioners</h3>
            <div className="flex items-center gap-4">
              <div className="w-24 h-24">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart><Pie data={provisionerData} cx="50%" cy="50%" innerRadius={24} outerRadius={42} paddingAngle={3} dataKey="value" stroke="none">
                    {provisionerData.map((d, i) => <Cell key={d.fullName} fill={COLORS[i % COLORS.length]} />)}
                  </Pie></PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-col gap-1">
                {provisionerData.map((d, i) => (
                  <div key={d.fullName} className="flex items-center gap-2 text-xs" title={d.fullName}>
                    <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                    <span className="text-th-dim">{d.name}</span>
                    <span className="font-semibold text-th-body">{d.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="col-span-12 md:col-span-8 flex gap-4">
            <div className="flex-1 bg-th-panel border border-th-line rounded-xl p-4 shadow-card flex flex-col items-center justify-center">
              <p className="text-3xl font-black text-th-accent">{filtered.length}</p>
              <p className="text-[10px] text-th-dim uppercase tracking-wider">Total Classes</p>
            </div>
            <div className="flex-1 bg-th-panel border border-th-line rounded-xl p-4 shadow-card flex flex-col items-center justify-center">
              <p className="text-3xl font-black text-th-ok">{defaultCount}</p>
              <p className="text-[10px] text-th-dim uppercase tracking-wider">Default</p>
            </div>
            <div className="flex-1 bg-th-panel border border-th-line rounded-xl p-4 shadow-card flex flex-col items-center justify-center">
              <p className="text-3xl font-black text-th-info">{provisionerData.length}</p>
              <p className="text-[10px] text-th-dim uppercase tracking-wider">Provisioners</p>
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
                  <SortableTh {...thProps("provisioner")}>Provisioner</SortableTh>
                  <SortableTh {...thProps("reclaim_policy")}>Reclaim Policy</SortableTh>
                  <SortableTh {...thProps("volume_binding_mode")}>Volume Binding Mode</SortableTh>
                  <SortableTh {...thProps("is_default")}>Default</SortableTh>
                  <SortableTh {...thProps("age")}>Age</SortableTh>
                  <th className="px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pager.paged.map((s) => (
                  <tr key={s.name} className="border-b border-th-line last:border-0 hover:bg-th-hover transition-colors">
                    <td className="px-4 py-3 font-medium text-th-body">
                      <div className="flex items-center gap-2">
                        {s.name}
                        {s.is_default && (
                          <span className="px-1.5 py-0.5 bg-th-accent/20 text-th-accent rounded text-xs">default</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-th-dim text-xs font-mono">{s.provisioner}</td>
                    <td className="px-4 py-3 text-th-dim">{s.reclaim_policy}</td>
                    <td className="px-4 py-3 text-th-dim">{s.volume_binding_mode}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${s.is_default ? "bg-th-ok-s text-th-ok" : "bg-th-muted text-th-dim"}`}>
                        {s.is_default ? "Yes" : "No"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-th-ghost">{age(s.created_at)}</td>
                    <td className="px-4 py-3">
                      <button onClick={() => setEditYaml(s.name)}
                        className="px-2 py-1 text-xs bg-th-subtle text-th-body border border-th-line rounded hover:opacity-80">YAML</button>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <EmptyRow colSpan={7} title="No storage classes found" />
                )}
              </tbody>
            </table>
          </div>
          <TablePagination {...pager} label="storage classes" />
        </div>
      )}
      {editYaml && (
        <EditYAMLModal
          kind="StorageClass"
          name={editYaml}
          onClose={() => setEditYaml(null)}
          onUpdated={refresh}
        />
      )}
    </div>
  );
}
