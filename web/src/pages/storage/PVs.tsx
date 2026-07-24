import { useMemo } from "react";
import { useUrlSearch } from "@/hooks/useUrlState";
import { EmptyRow } from "@/components/EmptyState";
import { TableSkeleton } from "@/components/Skeleton";
import { useOutletContext } from "react-router-dom";
import { listPVs } from "@/api/client";
import type { PVSummary } from "@/api/client";
import { useLiveResource } from "@/hooks/useLiveResource";
import LiveIndicator from "@/components/LiveIndicator";
import { useSortableTable, SortableTh } from "@/hooks/useSortableTable";
import { usePagination, TablePagination } from "@/hooks/usePagination";
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip } from "recharts";

function age(created: string): string {
  const diff = Date.now() - new Date(created).getTime();
  const days = Math.floor(diff / 86400000);
  if (days > 0) return `${days}d`;
  const hours = Math.floor(diff / 3600000);
  if (hours > 0) return `${hours}h`;
  const mins = Math.floor(diff / 60000);
  return `${mins}m`;
}

function statusColor(status: string): string {
  switch (status) {
    case "Bound":
      return "bg-th-ok-s text-th-ok";
    case "Available":
      return "bg-th-info-s text-th-info";
    case "Released":
      return "bg-th-warn-s text-th-warn";
    case "Failed":
      return "bg-th-danger-s text-th-danger";
    default:
      return "bg-th-muted text-th-dim";
  }
}

const STATUS_COLORS: Record<string, string> = {
  Bound: "var(--th-ok)",
  Available: "#3b82f6",
  Released: "var(--th-warn)",
  Failed: "var(--th-danger)",
};

function parseCapacityGi(cap: string): number {
  // Accept binary (Ki–Ei), decimal (K–E), and unit-less (bytes) quantities.
  const match = (cap || "").trim().match(/^(\d+(?:\.\d+)?)\s*([KMGTPE]i?)?$/);
  if (!match) return 0;
  const val = parseFloat(match[1]);
  const mult: Record<string, number> = {
    "": 1,
    Ki: 1024, Mi: 1024 ** 2, Gi: 1024 ** 3, Ti: 1024 ** 4, Pi: 1024 ** 5, Ei: 1024 ** 6,
    K: 1e3, M: 1e6, G: 1e9, T: 1e12, P: 1e15, E: 1e18,
  };
  const bytes = val * (mult[match[2] || ""] ?? 1);
  return bytes / (1024 ** 3); // gibibytes
}

export default function PVs() {
  useOutletContext<{ namespace: string }>();
  const { data: items, loading, error, refresh, watchStatus, live, setLive } = useLiveResource<PVSummary[]>(listPVs, "PersistentVolume", undefined);
  const [search, setSearch] = useUrlSearch();

  const filtered = (items ?? []).filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      (p.storage_class || "").toLowerCase().includes(search.toLowerCase()) ||
      (p.claim_ref || "").toLowerCase().includes(search.toLowerCase()),
  );

  const { sorted, thProps } = useSortableTable(filtered, {
    name: (p) => p.name,
    capacity: (p) => parseCapacityGi(p.capacity),
    reclaim_policy: (p) => p.reclaim_policy,
    status: (p) => p.status,
    storage_class: (p) => p.storage_class,
    claim: (p) => p.claim_ref,
    age: (p) => Date.now() - new Date(p.created_at).getTime(),
  }, { key: "name", urlKey: "" });

  const pager = usePagination(sorted, { pageSize: 25, urlKey: "" });

  const { statusData, totalCapGi, reclaimText, scData } = useMemo(() => {
    const statusCounts: Record<string, number> = {};
    const scCounts: Record<string, number> = {};
    const reclaimCounts: Record<string, number> = {};
    let cap = 0;

    filtered.forEach((p) => {
      statusCounts[p.status] = (statusCounts[p.status] || 0) + 1;
      const sc = p.storage_class || "none";
      scCounts[sc] = (scCounts[sc] || 0) + 1;
      const rp = p.reclaim_policy || "Unknown";
      reclaimCounts[rp] = (reclaimCounts[rp] || 0) + 1;
      cap += parseCapacityGi(p.capacity);
    });

    const statusData = Object.entries(statusCounts).map(([name, value]) => ({ name, value }));
    const scData = Object.entries(scCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, value]) => ({
        name: name.length > 16 ? name.slice(0, 16) + "..." : name,
        value,
      }));
    const reclaimText = Object.entries(reclaimCounts)
      .map(([k, v]) => `${k}: ${v}`)
      .join(", ");

    return { statusData, totalCapGi: cap, reclaimText, scData };
  }, [filtered]);

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-th-heading">Persistent Volumes</h1>
        <div className="flex items-center gap-2">
          <LiveIndicator live={live} status={watchStatus} onToggle={setLive} />
          <button onClick={refresh} className="px-3 py-1.5 text-sm bg-th-accent text-white rounded-lg hover:opacity-90 transition-opacity">
            Refresh
          </button>
        </div>
      </div>

      <input
        type="text"
        placeholder="Search PVs..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full max-w-sm px-3 py-2 bg-th-subtle border border-th-line rounded-lg text-sm text-th-body placeholder:text-th-ghost focus:outline-none focus:ring-1 focus:ring-th-accent"
      />

      {loading && <TableSkeleton />}
      {error && <div className="p-3 bg-th-danger-s text-th-danger rounded-lg text-sm">{error}</div>}

      {/* Visual summary */}
      {!loading && filtered.length > 0 && (
        <div className="grid grid-cols-12 gap-4">
          {/* Status donut */}
          <div className="col-span-12 md:col-span-4 bg-th-panel border border-th-line rounded-xl p-4 shadow-card">
            <h3 className="text-xs font-bold text-th-dim uppercase tracking-wider mb-2">PV Status</h3>
            <div className="flex items-center gap-4">
              <div className="w-24 h-24">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={statusData} cx="50%" cy="50%" innerRadius={24} outerRadius={42} paddingAngle={2} dataKey="value" stroke="none">
                      {statusData.map((d) => <Cell key={d.name} fill={STATUS_COLORS[d.name] || "var(--th-dim)"} />)}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-col gap-1">
                {statusData.map((d) => (
                  <div key={d.name} className="flex items-center gap-2 text-xs">
                    <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: STATUS_COLORS[d.name] || "var(--th-dim)" }} />
                    <span className="text-th-dim w-16">{d.name}</span>
                    <span className="font-semibold text-th-body">{d.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Storage class bar chart */}
          <div className="col-span-12 md:col-span-5 bg-th-panel border border-th-line rounded-xl p-4 shadow-card">
            <h3 className="text-xs font-bold text-th-dim uppercase tracking-wider mb-2">PVs by StorageClass</h3>
            <div className="h-28">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={scData} layout="vertical">
                  <XAxis type="number" tick={{ fontSize: 10, fill: "var(--th-dim)" }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: "var(--th-dim)" }} axisLine={false} tickLine={false} width={110} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "var(--th-panel)", border: "1px solid var(--th-line)", borderRadius: "8px", fontSize: "11px" }}
                    labelStyle={{ color: "var(--th-heading)" }}
                  />
                  <Bar dataKey="value" fill="var(--th-accent)" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Stat cards */}
          <div className="col-span-12 md:col-span-3 bg-th-panel border border-th-line rounded-xl p-4 shadow-card flex flex-col justify-center gap-3">
            <div className="text-center">
              <p className="text-3xl font-black text-th-accent">{filtered.length}</p>
              <p className="text-[10px] text-th-dim uppercase tracking-wider">Total PVs</p>
            </div>
            <div className="border-t border-th-line pt-3 text-center">
              <p className="text-2xl font-bold text-th-info">
                {totalCapGi >= 1024 ? (totalCapGi / 1024).toFixed(1) + " Ti" : totalCapGi.toFixed(0) + " Gi"}
              </p>
              <p className="text-[10px] text-th-dim uppercase tracking-wider">Total Capacity</p>
            </div>
            <div className="border-t border-th-line pt-3 text-center">
              <p className="text-xs text-th-body font-medium">{reclaimText}</p>
              <p className="text-[10px] text-th-dim uppercase tracking-wider mt-0.5">Reclaim Policy</p>
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
                  <SortableTh {...thProps("capacity")}>Capacity</SortableTh>
                  <th className="px-4 py-3 font-medium">Access Modes</th>
                  <SortableTh {...thProps("reclaim_policy")}>Reclaim Policy</SortableTh>
                  <SortableTh {...thProps("status")}>Status</SortableTh>
                  <SortableTh {...thProps("storage_class")}>Storage Class</SortableTh>
                  <SortableTh {...thProps("claim")}>Claim</SortableTh>
                  <SortableTh {...thProps("age")}>Age</SortableTh>
                </tr>
              </thead>
              <tbody>
                {pager.paged.map((p) => (
                  <tr key={p.name} className="border-b border-th-line last:border-0 hover:bg-th-hover transition-colors">
                    <td className="px-4 py-3 font-medium text-th-body max-w-xs truncate" title={p.name}>{p.name}</td>
                    <td className="px-4 py-3 text-th-dim">{p.capacity}</td>
                    <td className="px-4 py-3 text-th-dim text-xs">{(p.access_modes || []).join(", ") || "-"}</td>
                    <td className="px-4 py-3 text-th-dim">{p.reclaim_policy}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusColor(p.status)}`}>
                        {p.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-th-dim">{p.storage_class || "-"}</td>
                    <td className="px-4 py-3 text-th-dim text-xs max-w-xs truncate" title={p.claim_ref}>{p.claim_ref || "-"}</td>
                    <td className="px-4 py-3 text-th-ghost">{age(p.created_at)}</td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <EmptyRow colSpan={8} title="No persistent volumes found" />
                )}
              </tbody>
            </table>
          </div>
          <TablePagination {...pager} label="PVs" />
        </div>
      )}
    </div>
  );
}
