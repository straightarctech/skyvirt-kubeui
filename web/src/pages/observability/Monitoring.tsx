import { useOutletContext } from "react-router-dom";
import { TableSkeleton } from "@/components/Skeleton";
import { topNodes, listNodes, listPods } from "@/api/client";
import type { NodeMetrics, NodeSummary, PodSummary } from "@/api/client";
import { useResource } from "@/hooks/useResource";
import { useSortableTable, SortableTh } from "@/hooks/useSortableTable";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  PieChart, Pie, Cell,
} from "recharts";

/* ---------- helpers ---------- */

function usageColor(pct: number): string {
  if (pct >= 90) return "var(--th-danger)";
  if (pct >= 70) return "var(--th-warn)";
  return "var(--th-ok)";
}

function GaugeRing({ value, label, size = 100, color }: { value: number; label: string; size?: number; color?: string }) {
  const sw = 8;
  const r = (size - sw) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (Math.min(value, 100) / 100) * c;
  const fill = color || usageColor(value);
  return (
    <div className="flex flex-col items-center">
      <div className="relative">
        <svg width={size} height={size} className="-rotate-90" style={{ filter: `drop-shadow(0 0 6px ${fill})` }}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--th-muted)" strokeWidth={sw} opacity={0.25} />
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={fill} strokeWidth={sw}
            strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round"
            className="transition-all duration-700" />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xl font-black text-th-heading">{value.toFixed(0)}%</span>
        </div>
      </div>
      <span className="mt-1 text-[10px] text-th-dim uppercase tracking-wider font-semibold">{label}</span>
    </div>
  );
}

/* ---------- main ---------- */

export default function Monitoring() {
  useOutletContext<{ namespace: string }>();
  const { data: metrics, loading: l1, error, refresh } = useResource<NodeMetrics[]>(topNodes);
  const { data: nodes, loading: l2 } = useResource<NodeSummary[]>(() => listNodes(), []);
  const { data: pods, loading: l3 } = useResource<PodSummary[]>(() => listPods(), []);

  const loading = l1 || l2 || l3;
  const allMetrics = metrics ?? [];
  const allPods = pods ?? [];

  const avgCpu = allMetrics.length > 0 ? allMetrics.reduce((s, m) => s + m.cpu_percent, 0) / allMetrics.length : 0;
  const avgMem = allMetrics.length > 0 ? allMetrics.reduce((s, m) => s + m.memory_percent, 0) / allMetrics.length : 0;
  const maxCpu = allMetrics.length > 0 ? Math.max(...allMetrics.map((m) => m.cpu_percent)) : 0;
  const maxMem = allMetrics.length > 0 ? Math.max(...allMetrics.map((m) => m.memory_percent)) : 0;

  // Pod counts per node
  const podCountMap = new Map<string, number>();
  allPods.forEach((p) => { if (p.node) podCountMap.set(p.node, (podCountMap.get(p.node) || 0) + 1); });

  // Sortable detail table — default to hottest CPU first.
  const { sorted: sortedMetrics, thProps } = useSortableTable(
    allMetrics,
    {
      name: (m) => m.name,
      cpu: (m) => m.cpu_percent,
      mem: (m) => m.memory_percent,
      pods: (m) => podCountMap.get(m.name) || 0,
    },
    { key: "cpu", dir: "desc", urlKey: "mon" },
  );

  // Grouped bar data
  const barData = allMetrics.map((m) => ({
    name: m.name.length > 12 ? m.name.slice(0, 12) + "..." : m.name,
    CPU: Math.round(m.cpu_percent * 10) / 10,
    Memory: Math.round(m.memory_percent * 10) / 10,
    Pods: podCountMap.get(m.name) || 0,
  }));

  // Pod distribution pie
  const podsByNode = allMetrics.map((m) => ({
    name: m.name,
    value: podCountMap.get(m.name) || 0,
  }));
  const pieColors = ["var(--th-accent)", "var(--th-info)", "var(--th-warn)", "var(--th-ok)", "var(--th-danger)"];

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-th-heading">Monitoring</h1>
        <button onClick={refresh} className="px-3 py-1.5 text-sm bg-th-accent text-white rounded-lg hover:opacity-90 transition-opacity">
          Refresh
        </button>
      </div>

      {loading && <TableSkeleton />}
      {error && <div className="p-3 bg-th-danger-s text-th-danger rounded-lg text-sm">{error}</div>}

      {!loading && allMetrics.length > 0 && (
        <>
          {/* ROW 1: Cluster-level gauges */}
          <div className="grid grid-cols-12 gap-4">
            <div className="col-span-12 lg:col-span-8 bg-th-panel border border-th-line rounded-xl p-5 shadow-card">
              <h2 className="text-xs font-bold text-th-dim uppercase tracking-wider mb-4">Cluster Averages</h2>
              <div className="flex items-center justify-around">
                <GaugeRing value={avgCpu} label="Avg CPU" size={110} />
                <GaugeRing value={avgMem} label="Avg Memory" size={110} />
                <GaugeRing value={maxCpu} label="Peak CPU" size={90} color="var(--th-danger)" />
                <GaugeRing value={maxMem} label="Peak Memory" size={90} color="var(--th-warn)" />
              </div>
            </div>
            <div className="col-span-12 lg:col-span-4 grid grid-cols-2 gap-3 content-start">
              <div className="bg-th-panel border border-th-line rounded-xl p-4 shadow-card text-center">
                <p className="text-3xl font-black text-th-accent">{(nodes ?? []).length}</p>
                <p className="text-[10px] text-th-dim uppercase">Nodes</p>
              </div>
              <div className="bg-th-panel border border-th-line rounded-xl p-4 shadow-card text-center">
                <p className="text-3xl font-black text-th-info">{allPods.length}</p>
                <p className="text-[10px] text-th-dim uppercase">Pods</p>
              </div>
              <div className="bg-th-panel border border-th-line rounded-xl p-4 shadow-card text-center">
                <p className={`text-3xl font-black ${avgCpu >= 70 ? "text-th-danger" : "text-th-ok"}`}>{avgCpu.toFixed(1)}%</p>
                <p className="text-[10px] text-th-dim uppercase">CPU</p>
              </div>
              <div className="bg-th-panel border border-th-line rounded-xl p-4 shadow-card text-center">
                <p className={`text-3xl font-black ${avgMem >= 70 ? "text-th-warn" : "text-th-ok"}`}>{avgMem.toFixed(1)}%</p>
                <p className="text-[10px] text-th-dim uppercase">Memory</p>
              </div>
            </div>
          </div>

          {/* ROW 2: Per-node gauges */}
          <div className="bg-th-panel border border-th-line rounded-xl p-5 shadow-card">
            <h2 className="text-xs font-bold text-th-dim uppercase tracking-wider mb-4">Per-Node Resource Usage</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {allMetrics.map((m) => (
                <div key={m.name} className="flex items-center gap-5 bg-th-subtle rounded-xl p-4 border border-th-line">
                  <div className="flex flex-col items-center gap-2">
                    <GaugeRing value={m.cpu_percent} label="CPU" size={72} />
                  </div>
                  <div className="flex flex-col items-center gap-2">
                    <GaugeRing value={m.memory_percent} label="MEM" size={72} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-th-heading truncate">{m.name}</p>
                    <p className="text-xs text-th-dim mt-1">CPU: {m.cpu_usage}</p>
                    <p className="text-xs text-th-dim">Mem: {m.memory_usage}</p>
                    <p className="text-xs text-th-ghost mt-1">{podCountMap.get(m.name) || 0} pods</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ROW 3: Grouped bar chart + Pod distribution pie */}
          <div className="grid grid-cols-12 gap-4">
            <div className="col-span-12 lg:col-span-8 bg-th-panel border border-th-line rounded-xl p-5 shadow-card">
              <h2 className="text-xs font-bold text-th-dim uppercase tracking-wider mb-4">CPU & Memory by Node</h2>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={barData} barCategoryGap="20%">
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--th-line)" opacity={0.5} />
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: "var(--th-dim)" }} axisLine={false} tickLine={false} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: "var(--th-dim)" }} axisLine={false} tickLine={false} width={35}
                      tickFormatter={(v) => `${v}%`} />
                    <Tooltip
                      contentStyle={{ backgroundColor: "var(--th-panel)", border: "1px solid var(--th-line)", borderRadius: "8px", fontSize: "12px" }}
                      labelStyle={{ color: "var(--th-heading)", fontWeight: 600 }}
                      formatter={(v: number | undefined) => `${(v ?? 0).toFixed(1)}%`}
                    />
                    <Bar dataKey="CPU" fill="var(--th-accent)" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="Memory" fill="var(--th-info)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-2 flex items-center justify-center gap-6 text-xs">
                <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-th-accent" /> CPU</div>
                <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-th-info" /> Memory</div>
              </div>
            </div>

            <div className="col-span-12 lg:col-span-4 bg-th-panel border border-th-line rounded-xl p-5 shadow-card">
              <h2 className="text-xs font-bold text-th-dim uppercase tracking-wider mb-4">Pod Distribution</h2>
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={podsByNode} cx="50%" cy="50%" innerRadius={40} outerRadius={70} paddingAngle={3} dataKey="value" stroke="none"
                      label={({ name, value }) => `${name}: ${value}`} labelLine={false}>
                      {podsByNode.map((_, i) => <Cell key={i} fill={pieColors[i % pieColors.length]} />)}
                    </Pie>
                    <Tooltip
                      contentStyle={{ backgroundColor: "var(--th-panel)", border: "1px solid var(--th-line)", borderRadius: "8px", fontSize: "12px" }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-wrap gap-2 justify-center mt-2">
                {podsByNode.map((p, i) => (
                  <div key={p.name} className="flex items-center gap-1 text-xs">
                    <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: pieColors[i % pieColors.length] }} />
                    <span className="text-th-dim">{p.name}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ROW 4: Details table */}
          <div className="bg-th-panel border border-th-line rounded-xl overflow-hidden shadow-card">
            <div className="px-5 py-3 border-b border-th-line">
              <h2 className="text-lg font-semibold text-th-heading">Node Metrics Detail</h2>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-th-dim bg-th-subtle border-b border-th-line">
                  <SortableTh {...thProps("name")}>Node</SortableTh>
                  <th className="px-4 py-3 font-medium">CPU Usage</th>
                  <SortableTh {...thProps("cpu")}>CPU %</SortableTh>
                  <th className="px-4 py-3 font-medium">Memory Usage</th>
                  <SortableTh {...thProps("mem")}>Memory %</SortableTh>
                  <SortableTh {...thProps("pods")}>Pods</SortableTh>
                </tr>
              </thead>
              <tbody>
                {sortedMetrics.map((m) => (
                  <tr key={m.name} className="border-b border-th-line last:border-0 hover:bg-th-hover transition-colors">
                    <td className="px-4 py-3 font-medium text-th-body">{m.name}</td>
                    <td className="px-4 py-3 text-th-dim font-mono text-xs">{m.cpu_usage}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-28 h-3 bg-th-muted rounded-full overflow-hidden">
                          <div className="h-full rounded-full transition-all duration-500" style={{
                            width: `${Math.min(m.cpu_percent, 100)}%`,
                            backgroundColor: usageColor(m.cpu_percent),
                          }} />
                        </div>
                        <span className="text-xs font-semibold" style={{ color: usageColor(m.cpu_percent) }}>
                          {m.cpu_percent.toFixed(1)}%
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-th-dim font-mono text-xs">{m.memory_usage}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-28 h-3 bg-th-muted rounded-full overflow-hidden">
                          <div className="h-full rounded-full transition-all duration-500" style={{
                            width: `${Math.min(m.memory_percent, 100)}%`,
                            backgroundColor: usageColor(m.memory_percent),
                          }} />
                        </div>
                        <span className="text-xs font-semibold" style={{ color: usageColor(m.memory_percent) }}>
                          {m.memory_percent.toFixed(1)}%
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-th-body">{podCountMap.get(m.name) || 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {!loading && allMetrics.length === 0 && !error && (
        <div className="flex flex-col items-center justify-center py-20">
          <div className="bg-th-panel border border-th-line rounded-xl p-10 shadow-card text-center max-w-md">
            <svg className="w-16 h-16 mx-auto text-th-dim mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
            </svg>
            <p className="text-sm text-th-ghost">Metrics server not available. Install metrics-server to see node resource usage.</p>
          </div>
        </div>
      )}
    </div>
  );
}
