import { useState, useMemo } from "react";
import { TableSkeleton } from "@/components/Skeleton";
import { useOutletContext } from "react-router-dom";
import { listNodes, topNodes, listPods } from "@/api/client";
import type { NodeSummary, NodeMetrics, PodSummary } from "@/api/client";
import { useResource } from "@/hooks/useResource";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { useSortableTable, SortableTh } from "@/hooks/useSortableTable";
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip } from "recharts";

function parseCPU(s: string): number {
  if (!s) return 0;
  if (s.endsWith("m")) return parseInt(s) / 1000;
  if (s.endsWith("u")) return parseInt(s) / 1e6;
  if (s.endsWith("n")) return parseInt(s) / 1e9;
  return parseFloat(s);
}

function parseMem(s: string): number {
  if (!s) return 0;
  if (s.endsWith("Ki")) return parseInt(s) / (1024 * 1024);
  if (s.endsWith("Mi")) return parseInt(s) / 1024;
  if (s.endsWith("Gi")) return parseInt(s);
  return parseFloat(s) / (1024 * 1024 * 1024);
}

const NS_COLORS = ["#6366f1", "#a855f7", "#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#ec4899", "#14b8a6", "#8b5cf6", "#f97316"];

/* SVG efficiency gauge */
function EfficiencyGauge({ pct }: { pct: number }) {
  const r = 48, stroke = 10, c = 2 * Math.PI * r;
  const color = pct >= 60 ? "var(--th-ok)" : pct >= 30 ? "var(--th-warn)" : "var(--th-danger)";
  return (
    <svg width={120} height={120} viewBox="0 0 120 120">
      <circle cx={60} cy={60} r={r} fill="none" stroke="var(--th-line)" strokeWidth={stroke} />
      <circle cx={60} cy={60} r={r} fill="none" stroke={color} strokeWidth={stroke}
        strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)}
        strokeLinecap="round" transform="rotate(-90 60 60)"
        style={{ filter: `drop-shadow(0 0 6px ${color}40)`, transition: "stroke-dashoffset 0.6s ease" }}
      />
      <text x={60} y={55} textAnchor="middle" className="fill-th-heading" fontSize={24} fontWeight="800">{pct}%</text>
      <text x={60} y={72} textAnchor="middle" className="fill-th-dim" fontSize={9} fontWeight="500">Efficiency</text>
    </svg>
  );
}

export default function Cost() {
  useOutletContext<{ namespace: string }>();
  const { data: nodes, loading: l1, refresh } = useResource<NodeSummary[]>(() => listNodes(), []);
  const { data: metrics, loading: l2 } = useResource<NodeMetrics[]>(() => topNodes(), []);
  const { data: pods, loading: l3 } = useResource<PodSummary[]>(() => listPods(), []);
  // Rates persist so a customized pricing model survives reloads/navigation.
  const [cpuRate, setCpuRate] = useLocalStorage("kubeui.cost.cpuRate", 0.048);
  const [memRate, setMemRate] = useLocalStorage("kubeui.cost.memRate", 0.006);
  const [showRates, setShowRates] = useState(false);

  const loading = l1 || l2 || l3;

  const {
    totalCPU, totalMem, usedCPU, usedMem,
    monthlyCost, usedCost, idleCost, efficiency,
    nsBreakdown, costSplitData, nsBarData, nsRows,
  } = useMemo(() => {
    const totalCPU = (nodes ?? []).reduce((sum, n) => sum + parseCPU(n.cpu_capacity), 0);
    const totalMem = (nodes ?? []).reduce((sum, n) => sum + parseMem(n.memory_capacity), 0);
    const usedCPU = (metrics ?? []).reduce((sum, m) => sum + parseCPU(m.cpu_usage), 0);
    const usedMem = (metrics ?? []).reduce((sum, m) => sum + parseMem(m.memory_usage), 0);
    const monthlyCost = (totalCPU * cpuRate + totalMem * memRate) * 730;
    const usedCost = (usedCPU * cpuRate + usedMem * memRate) * 730;
    const idleCost = Math.max(0, monthlyCost - usedCost);
    const efficiency = monthlyCost > 0 ? Math.round((usedCost / monthlyCost) * 100) : 0;

    // Namespace breakdown
    const nsByPods = new Map<string, number>();
    (pods ?? []).forEach((p) => { nsByPods.set(p.namespace, (nsByPods.get(p.namespace) || 0) + 1); });
    const nsBreakdown = Array.from(nsByPods.entries()).sort((a, b) => b[1] - a[1]);

    // Cost split pie data
    const cpuCost = totalCPU * cpuRate * 730;
    const memCost = totalMem * memRate * 730;
    const costSplitData = [
      { name: "CPU", value: Math.round(cpuCost) },
      { name: "Memory", value: Math.round(memCost) },
    ];

    // Top 8 namespaces for bar chart
    const podTotal = (pods ?? []).length;
    const nsBarData = nsBreakdown.slice(0, 8).map(([ns, count]) => ({
      name: ns.length > 16 ? ns.slice(0, 16) + "..." : ns,
      pods: count,
      estCost: Math.round(monthlyCost * (count / podTotal)),
    }));

    // Rows for the detail table. Color is bound to the namespace's rank (matches
    // the pie/legend) and stays put when the table is re-sorted.
    const nsRows = nsBreakdown.map(([ns, count], i) => ({
      ns, count,
      pct: podTotal > 0 ? (count / podTotal) * 100 : 0,
      estCost: Math.round(monthlyCost * (count / Math.max(1, podTotal))),
      color: NS_COLORS[i % NS_COLORS.length],
    }));

    return { totalCPU, totalMem, usedCPU, usedMem, monthlyCost, usedCost, idleCost, efficiency, nsBreakdown, costSplitData, nsBarData, nsRows };
  }, [nodes, metrics, pods, cpuRate, memRate]);

  const { sorted: sortedRows, thProps } = useSortableTable(
    nsRows,
    {
      ns: (r) => r.ns,
      count: (r) => r.count,
      pct: (r) => r.pct,
      estCost: (r) => r.estCost,
    },
    { key: "count", dir: "desc", urlKey: "cost" },
  );

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-th-heading">Cost Estimation</h1>
        <button onClick={refresh} className="px-3 py-1.5 text-sm bg-th-accent text-white rounded-lg hover:opacity-90 transition-opacity">Refresh</button>
      </div>

      <div className="bg-th-panel border border-th-line rounded-xl p-3 shadow-card">
        <div className="flex items-center justify-between">
          <p className="text-xs text-th-dim">
            Estimated costs. Rates: ${cpuRate}/vCPU/hr, ${memRate}/GiB/hr.
          </p>
          <button onClick={() => setShowRates(!showRates)} className="text-xs text-th-accent hover:underline">
            {showRates ? "Hide" : "Edit Rates"}
          </button>
        </div>
        {showRates && (
          <div className="flex gap-4 mt-2 pt-2 border-t border-th-line">
            <div>
              <label className="block text-[10px] text-th-dim mb-0.5">CPU $/vCPU/hr</label>
              <input type="number" step="0.001" min="0" value={cpuRate}
                onChange={(e) => setCpuRate(parseFloat(e.target.value) || 0)}
                className="w-28 px-2 py-1 bg-th-subtle border border-th-line rounded text-xs text-th-body focus:outline-none focus:ring-1 focus:ring-th-accent"
              />
            </div>
            <div>
              <label className="block text-[10px] text-th-dim mb-0.5">Memory $/GiB/hr</label>
              <input type="number" step="0.001" min="0" value={memRate}
                onChange={(e) => setMemRate(parseFloat(e.target.value) || 0)}
                className="w-28 px-2 py-1 bg-th-subtle border border-th-line rounded text-xs text-th-body focus:outline-none focus:ring-1 focus:ring-th-accent"
              />
            </div>
          </div>
        )}
      </div>

      {loading && <TableSkeleton />}

      {!loading && (
        <>
          {/* Top cards */}
          <div className="grid grid-cols-12 gap-4">
            <div className="col-span-12 md:col-span-3 bg-th-panel border border-th-line rounded-xl p-4 shadow-card">
              <p className="text-[10px] text-th-dim uppercase tracking-wider mb-1">Total Capacity Cost</p>
              <p className="text-3xl font-black text-th-heading">${monthlyCost.toFixed(0)}<span className="text-sm text-th-ghost font-normal">/mo</span></p>
              <p className="text-xs text-th-ghost mt-1">{totalCPU.toFixed(0)} vCPU, {totalMem.toFixed(1)} GiB RAM</p>
            </div>
            <div className="col-span-12 md:col-span-3 bg-th-panel border border-th-line rounded-xl p-4 shadow-card">
              <p className="text-[10px] text-th-dim uppercase tracking-wider mb-1">Used Resources Cost</p>
              <p className="text-3xl font-black text-th-accent">${usedCost.toFixed(0)}<span className="text-sm text-th-ghost font-normal">/mo</span></p>
              <p className="text-xs text-th-ghost mt-1">{usedCPU.toFixed(1)} vCPU, {usedMem.toFixed(1)} GiB RAM</p>
            </div>

            {/* Efficiency gauge + reclaimable idle spend */}
            <div className="col-span-12 md:col-span-3 bg-th-panel border border-th-line rounded-xl p-4 shadow-card flex items-center justify-center gap-3">
              <EfficiencyGauge pct={efficiency} />
              <div className="min-w-0">
                <p className="text-[10px] text-th-dim uppercase tracking-wider">Idle / Reclaimable</p>
                <p className={`text-2xl font-black ${idleCost > usedCost ? "text-th-warn" : "text-th-heading"}`}>
                  ${idleCost.toFixed(0)}<span className="text-xs text-th-ghost font-normal">/mo</span>
                </p>
                <p className="text-xs text-th-ghost mt-0.5">unused capacity at current rates</p>
              </div>
            </div>

            {/* Cost split pie */}
            <div className="col-span-12 md:col-span-3 bg-th-panel border border-th-line rounded-xl p-4 shadow-card">
              <p className="text-[10px] text-th-dim uppercase tracking-wider mb-2">Cost Split</p>
              <div className="flex items-center gap-3">
                <div className="w-20 h-20">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={costSplitData} cx="50%" cy="50%" innerRadius={18} outerRadius={36} paddingAngle={3} dataKey="value" stroke="none">
                        <Cell fill="#6366f1" />
                        <Cell fill="#a855f7" />
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: "#6366f1" }} />
                    <span className="text-th-dim">CPU</span>
                    <span className="font-semibold text-th-body">${costSplitData[0]?.value || 0}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: "#a855f7" }} />
                    <span className="text-th-dim">Memory</span>
                    <span className="font-semibold text-th-body">${costSplitData[1]?.value || 0}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Namespace cost bar chart */}
          {nsBarData.length > 0 && (
            <div className="grid grid-cols-12 gap-4">
              <div className="col-span-12 md:col-span-7 bg-th-panel border border-th-line rounded-xl p-4 shadow-card">
                <h3 className="text-xs font-bold text-th-dim uppercase tracking-wider mb-2">Estimated Cost by Namespace</h3>
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={nsBarData}>
                      <XAxis dataKey="name" tick={{ fontSize: 9, fill: "var(--th-dim)" }} axisLine={false} tickLine={false} angle={-25} textAnchor="end" height={50} />
                      <YAxis tick={{ fontSize: 9, fill: "var(--th-dim)" }} axisLine={false} tickLine={false} width={40} tickFormatter={(v: number) => `$${v}`} />
                      <Tooltip
                        contentStyle={{ backgroundColor: "var(--th-panel)", border: "1px solid var(--th-line)", borderRadius: "8px", fontSize: "11px" }}
                        labelStyle={{ color: "var(--th-heading)" }}
                        formatter={(v: number | undefined) => [`$${v ?? 0}/mo`, "Est. Cost"]}
                      />
                      <Bar dataKey="estCost" fill="var(--th-accent)" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Namespace pod distribution pie */}
              <div className="col-span-12 md:col-span-5 bg-th-panel border border-th-line rounded-xl p-4 shadow-card">
                <h3 className="text-xs font-bold text-th-dim uppercase tracking-wider mb-2">Pod Distribution</h3>
                <div className="flex items-center gap-3">
                  <div className="w-28 h-28">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={nsBreakdown.slice(0, 8).map(([name, value]) => ({ name: name.length > 14 ? name.slice(0, 14) + "..." : name, value }))}
                          cx="50%" cy="50%" innerRadius={24} outerRadius={50} paddingAngle={2} dataKey="value" stroke="none"
                        >
                          {nsBreakdown.slice(0, 8).map((_, i) => <Cell key={i} fill={NS_COLORS[i % NS_COLORS.length]} />)}
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex flex-col gap-1 min-w-0 flex-1">
                    {nsBreakdown.slice(0, 6).map(([ns, count], i) => (
                      <div key={ns} className="flex items-center gap-2 text-xs">
                        <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: NS_COLORS[i % NS_COLORS.length] }} />
                        <span className="text-th-dim truncate">{ns}</span>
                        <span className="font-semibold text-th-body ml-auto">{count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Namespace detail table */}
          <div className="bg-th-panel border border-th-line rounded-xl overflow-hidden shadow-card">
            <h3 className="px-4 py-3 font-medium text-th-body bg-th-subtle border-b border-th-line">Namespace Resource Distribution</h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-th-dim bg-th-subtle border-b border-th-line">
                  <SortableTh {...thProps("ns")}>Namespace</SortableTh>
                  <SortableTh {...thProps("count")}>Pods</SortableTh>
                  <SortableTh {...thProps("pct")}>% of Total</SortableTh>
                  <SortableTh {...thProps("estCost")}>Est. Cost</SortableTh>
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((r) => (
                  <tr key={r.ns} className="border-b border-th-line last:border-0 hover:bg-th-hover transition-colors">
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: r.color }} />
                        <span className="font-medium text-th-body">{r.ns}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2 text-th-dim">{r.count}</td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <div className="w-20 h-2 bg-th-subtle rounded-full overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${r.pct}%`, backgroundColor: r.color }} />
                        </div>
                        <span className="text-xs text-th-dim">{r.pct.toFixed(1)}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-2 text-th-dim font-medium">${r.estCost}/mo</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
