import { useState, useMemo } from "react";
import { useUrlSearch } from "@/hooks/useUrlState";
import { EmptyRow } from "@/components/EmptyState";
import { TableSkeleton } from "@/components/Skeleton";
import { useOutletContext } from "react-router-dom";
import { listEndpoints } from "@/api/client";
import type { EndpointSummary } from "@/api/client";
import { useLiveResource } from "@/hooks/useLiveResource";
import LiveIndicator from "@/components/LiveIndicator";
import { RatioMeter } from "@/components/viz";
import { useSortableTable, SortableTh } from "@/hooks/useSortableTable";
import { usePagination, TablePagination } from "@/hooks/usePagination";
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";

const READY_COLORS: Record<string, string> = { Ready: "var(--th-ok)", "Not Ready": "var(--th-warn)" };

function age(created: string): string {
  const diff = Date.now() - new Date(created).getTime();
  const days = Math.floor(diff / 86400000);
  if (days > 0) return `${days}d`;
  const hours = Math.floor(diff / 3600000);
  if (hours > 0) return `${hours}h`;
  return `${Math.floor(diff / 60000)}m`;
}

export default function Endpoints() {
  const { namespace } = useOutletContext<{ namespace: string }>();
  const { data: items, loading, error, refresh, watchStatus, live, setLive } = useLiveResource<EndpointSummary[]>(
    () => listEndpoints(namespace),
    "Endpoints",
    namespace,
    [namespace],
  );
  const [search, setSearch] = useUrlSearch();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const filtered = (items ?? []).filter(
    (e) =>
      e.name.toLowerCase().includes(search.toLowerCase()) ||
      e.namespace.toLowerCase().includes(search.toLowerCase()),
  );

  const { sorted, thProps } = useSortableTable(filtered, {
    name: (e) => e.name,
    namespace: (e) => e.namespace,
    ready: (e) => e.ready,
    not_ready: (e) => e.not_ready,
    age: (e) => Date.now() - new Date(e.created_at).getTime(),
  }, { key: "name", urlKey: "" });

  const pager = usePagination(sorted, { pageSize: 25, urlKey: "" });

  const totalReady = useMemo(() => filtered.reduce((s, e) => s + (e.ready || 0), 0), [filtered]);
  const totalNotReady = useMemo(() => filtered.reduce((s, e) => s + (e.not_ready || 0), 0), [filtered]);

  const readinessData = useMemo(() => {
    const data: { name: string; value: number }[] = [];
    if (totalReady > 0) data.push({ name: "Ready", value: totalReady });
    if (totalNotReady > 0) data.push({ name: "Not Ready", value: totalNotReady });
    return data;
  }, [totalReady, totalNotReady]);

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-th-heading">Endpoints</h1>
        <div className="flex items-center gap-2">
          <LiveIndicator live={live} status={watchStatus} onToggle={setLive} />
          <button onClick={refresh} className="px-3 py-1.5 text-sm bg-th-accent text-white rounded-lg hover:opacity-90 transition-opacity">Refresh</button>
        </div>
      </div>

      <input
        type="text"
        placeholder="Search endpoints..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full max-w-sm px-3 py-2 bg-th-subtle border border-th-line rounded-lg text-sm text-th-body placeholder:text-th-ghost focus:outline-none focus:ring-1 focus:ring-th-accent"
      />

      {loading && <TableSkeleton />}
      {error && <div className="p-3 bg-th-danger-s text-th-danger rounded-lg text-sm">{error}</div>}

      {!loading && filtered.length > 0 && (
        <div className="grid grid-cols-12 gap-4">
          <div className="col-span-12 md:col-span-4 bg-th-panel border border-th-line rounded-xl p-4 shadow-card">
            <h3 className="text-xs font-bold text-th-dim uppercase tracking-wider mb-2">Readiness</h3>
            <div className="flex items-center gap-4">
              <div className="w-24 h-24">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart><Pie data={readinessData} cx="50%" cy="50%" innerRadius={24} outerRadius={42} paddingAngle={3} dataKey="value" stroke="none">
                    {readinessData.map((d) => <Cell key={d.name} fill={READY_COLORS[d.name] || "var(--th-dim)"} />)}
                  </Pie></PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-col gap-1">
                {readinessData.map((d) => (
                  <div key={d.name} className="flex items-center gap-2 text-xs">
                    <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: READY_COLORS[d.name] || "var(--th-dim)" }} />
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
              <p className="text-[10px] text-th-dim uppercase tracking-wider">Total Endpoints</p>
            </div>
            <div className="flex-1 bg-th-panel border border-th-line rounded-xl p-4 shadow-card flex flex-col items-center justify-center">
              <p className="text-3xl font-black text-th-ok">{totalReady}</p>
              <p className="text-[10px] text-th-dim uppercase tracking-wider">Total Ready</p>
            </div>
            <div className="flex-1 bg-th-panel border border-th-line rounded-xl p-4 shadow-card flex flex-col items-center justify-center">
              <p className="text-3xl font-black text-th-warn">{totalNotReady}</p>
              <p className="text-[10px] text-th-dim uppercase tracking-wider">Total Not Ready</p>
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
                  <SortableTh {...thProps("namespace")}>Namespace</SortableTh>
                  <SortableTh {...thProps("ready")}>Ready</SortableTh>
                  <SortableTh {...thProps("not_ready")}>Not Ready</SortableTh>
                  <th className="px-4 py-3 font-medium">Ports</th>
                  <SortableTh {...thProps("age")}>Age</SortableTh>
                </tr>
              </thead>
              <tbody>
                {pager.paged.map((e) => {
                  const key = `${e.namespace}/${e.name}`;
                  const hasAddrs = (e.ready_addrs?.length ?? 0) + (e.not_ready_addrs?.length ?? 0) > 0;
                  const isOpen = expanded[key];
                  return [
                    <tr
                      key={key}
                      className={`border-b border-th-line last:border-0 hover:bg-th-hover transition-colors ${hasAddrs ? "cursor-pointer" : ""}`}
                      onClick={() => hasAddrs && setExpanded((prev) => ({ ...prev, [key]: !prev[key] }))}
                      {...(hasAddrs ? {
                        tabIndex: 0,
                        role: "button" as const,
                        "aria-expanded": isOpen,
                        onKeyDown: (e: React.KeyboardEvent) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
                          }
                        },
                      } : {})}
                    >
                      <td className="px-4 py-3 font-medium text-th-body">
                        <span className="flex items-center gap-1.5">
                          {hasAddrs && (
                            <svg className={`w-3 h-3 text-th-ghost transition-transform ${isOpen ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                            </svg>
                          )}
                          {e.name}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-th-dim">{e.namespace}</td>
                      <td className="px-4 py-3">
                        <RatioMeter ready={e.ready} total={e.ready + e.not_ready} />
                      </td>
                      <td className="px-4 py-3">
                        {e.not_ready > 0 ? (
                          <span className="px-2 py-0.5 rounded text-xs font-medium bg-th-warn-s text-th-warn">{e.not_ready}</span>
                        ) : (
                          <span className="text-th-ghost text-xs">0</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-th-dim font-mono text-xs">
                        {(e.ports || []).map((p) => `${p.port}/${p.protocol}`).join(", ") || "-"}
                      </td>
                      <td className="px-4 py-3 text-th-ghost">{age(e.created_at)}</td>
                    </tr>,
                    isOpen && hasAddrs ? (
                      <tr key={`${key}-detail`} className="border-b border-th-line last:border-0 bg-th-subtle/50">
                        <td colSpan={6} className="px-8 py-3">
                          <div className="grid grid-cols-3 gap-2 text-[10px] uppercase tracking-wider text-th-ghost border-b border-th-line pb-1 mb-1">
                            <span>Address</span><span>Backing Pod</span><span>Node</span>
                          </div>
                          {(e.ready_addrs || []).map((a, i) => (
                            <div key={`r${i}`} className="grid grid-cols-3 gap-2 text-xs py-0.5">
                              <span className="font-mono text-th-ok">{a.ip}</span>
                              <span className="text-th-dim">{a.target_ref || "-"}</span>
                              <span className="text-th-dim">{a.node_name || "-"}</span>
                            </div>
                          ))}
                          {(e.not_ready_addrs || []).map((a, i) => (
                            <div key={`n${i}`} className="grid grid-cols-3 gap-2 text-xs py-0.5">
                              <span className="font-mono text-th-warn">{a.ip} <span className="text-[10px]">(not ready)</span></span>
                              <span className="text-th-dim">{a.target_ref || "-"}</span>
                              <span className="text-th-dim">{a.node_name || "-"}</span>
                            </div>
                          ))}
                        </td>
                      </tr>
                    ) : null,
                  ];
                })}
                {filtered.length === 0 && (
                  <EmptyRow colSpan={6} title="No endpoints found" />
                )}
              </tbody>
            </table>
          </div>
          <TablePagination {...pager} label="endpoints" />
        </div>
      )}
    </div>
  );
}
