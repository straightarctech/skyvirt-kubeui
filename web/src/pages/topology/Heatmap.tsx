import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { TableSkeleton } from "@/components/Skeleton";
import { listNodes, topNodes, listPods, topPods } from "@/api/client";
import type { NodeSummary, NodeMetrics, PodSummary, PodMetrics } from "@/api/client";
import { useResource } from "@/hooks/useResource";

/* ---- unit parsing ---------------------------------------------------- */
// CPU → millicores. k8s metrics emit nanocores ("1234567n"), millicores
// ("120m"), or plain cores ("1.5").
function cpuMillicores(s: string): number {
  if (!s) return 0;
  const v = parseFloat(s);
  if (s.endsWith("n")) return v / 1e6;
  if (s.endsWith("u")) return v / 1e3;
  if (s.endsWith("m")) return v;
  return v * 1000;
}
// Memory → bytes.
function memBytes(s: string): number {
  if (!s) return 0;
  const v = parseFloat(s);
  const u: Record<string, number> = { Ki: 1024, Mi: 1024 ** 2, Gi: 1024 ** 3, Ti: 1024 ** 4, K: 1e3, M: 1e6, G: 1e9, T: 1e12 };
  for (const [suf, mul] of Object.entries(u)) if (s.endsWith(suf)) return v * mul;
  return v;
}
function fmtCpu(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(2)} cores` : `${Math.round(m)}m`;
}
function fmtMem(b: number): string {
  if (b >= 1024 ** 3) return `${(b / 1024 ** 3).toFixed(1)} Gi`;
  if (b >= 1024 ** 2) return `${(b / 1024 ** 2).toFixed(0)} Mi`;
  return `${(b / 1024).toFixed(0)} Ki`;
}

/* ---- heat color: intensity 0..1 → green→yellow→orange→red ------------ */
function heat(t: number): string {
  const c = Math.max(0, Math.min(1, t));
  const hue = 140 * (1 - c); // 140=green .. 0=red
  return `hsl(${hue}, 72%, ${46 - c * 6}%)`;
}

const CELL_CAP = 4000;

interface Cell {
  key: string;
  label: string;
  sub: string;
  value: number;
  intensity: number; // 0..1
  valueLabel: string;
  nav: string;
  group: string;
}

export default function Heatmap() {
  const nav = useNavigate();
  const { data: nodes, loading: l1, refresh } = useResource<NodeSummary[]>(() => listNodes(), []);
  const { data: nodeMetrics, loading: l2 } = useResource<NodeMetrics[]>(() => topNodes(), []);
  const { data: pods, loading: l3 } = useResource<PodSummary[]>(() => listPods(), []);
  const { data: podMetrics, loading: l4 } = useResource<PodMetrics[]>(() => topPods(), []);
  const loading = l1 || l2 || l3 || l4;

  const [entity, setEntity] = useState<"pods" | "nodes">("pods");
  const [metric, setMetric] = useState<"cpu" | "mem">("cpu");
  const [groupBy, setGroupBy] = useState<"node" | "namespace">("namespace");
  const [query, setQuery] = useState("");

  const podNodeMap = useMemo(() => new Map((pods ?? []).map((p) => [`${p.namespace}/${p.name}`, p.node || "unscheduled"])), [pods]);

  const { groups, total, capped, hottest, bands } = useMemo(() => {
    let cells: Cell[] = [];

    if (entity === "nodes") {
      const mm = new Map((nodeMetrics ?? []).map((m) => [m.name, m]));
      cells = (nodes ?? []).map((n) => {
        const m = mm.get(n.name);
        const pct = (metric === "cpu" ? m?.cpu_percent : m?.memory_percent) ?? 0;
        return {
          key: n.name, label: n.name, sub: n.status,
          value: pct, intensity: pct / 100,
          valueLabel: `${pct.toFixed(0)}%`,
          nav: `/nodes/${n.name}`, group: "Cluster nodes",
        };
      });
    } else {
      const raw = (podMetrics ?? []).map((pm) => {
        const val = (pm.containers || []).reduce(
          (s, c) => s + (metric === "cpu" ? cpuMillicores(c.cpu_usage) : memBytes(c.memory_usage)), 0);
        const node = podNodeMap.get(`${pm.namespace}/${pm.name}`) || "unscheduled";
        return { pm, val, node };
      });
      const max = Math.max(1, ...raw.map((r) => r.val));
      cells = raw.map((r) => ({
        key: `${r.pm.namespace}/${r.pm.name}`,
        label: r.pm.name, sub: r.pm.namespace,
        value: r.val, intensity: r.val / max,
        valueLabel: metric === "cpu" ? fmtCpu(r.val) : fmtMem(r.val),
        nav: `/workloads/pods/${r.pm.namespace}/${r.pm.name}`,
        group: groupBy === "node" ? r.node : r.pm.namespace,
      }));
    }

    const total = cells.length;
    const capped = total > CELL_CAP;
    if (capped) cells = [...cells].sort((a, b) => b.value - a.value).slice(0, CELL_CAP);

    // Heat bands for the summary.
    const bands = { hot: 0, warm: 0, cool: 0 };
    cells.forEach((c) => { if (c.intensity >= 0.75) bands.hot++; else if (c.intensity >= 0.4) bands.warm++; else bands.cool++; });
    const hottest = cells.reduce<Cell | null>((h, c) => (!h || c.value > h.value ? c : h), null);

    // Group + sort hottest-first within each group.
    const gm = new Map<string, Cell[]>();
    cells.forEach((c) => (gm.get(c.group) ?? gm.set(c.group, []).get(c.group)!).push(c));
    const groups = [...gm.entries()]
      .map(([name, cs]) => ({ name, cells: cs.sort((a, b) => b.value - a.value), peak: Math.max(...cs.map((c) => c.value)) }))
      .sort((a, b) => b.peak - a.peak);

    // Search filtering is visual (dim/highlight), applied in render.
    return { groups, total, capped, hottest, bands };
  }, [entity, metric, groupBy, nodes, nodeMetrics, podMetrics, podNodeMap]);

  const q = query.trim().toLowerCase();
  const cellSize = entity === "nodes" ? 26 : 15;

  const Toggle = ({ options, value, onChange }: { options: [string, string][]; value: string; onChange: (v: string) => void }) => (
    <div className="inline-flex rounded-lg border border-th-line overflow-hidden text-sm">
      {options.map(([v, label]) => (
        <button key={v} onClick={() => onChange(v)}
          className={`px-3 py-1.5 transition-colors ${value === v ? "bg-th-accent text-white" : "bg-th-subtle text-th-dim hover:text-th-body"}`}>
          {label}
        </button>
      ))}
    </div>
  );

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-th-heading">Resource Heatmap</h1>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <svg className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-th-ghost" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Highlight…"
              className="w-40 pl-8 pr-3 py-1.5 text-sm bg-th-subtle border border-th-line rounded-lg text-th-body placeholder:text-th-ghost focus:outline-none focus:ring-1 focus:ring-th-accent" />
          </div>
          <button onClick={refresh} className="px-3 py-1.5 text-sm bg-th-accent text-white rounded-lg hover:opacity-90 transition-opacity">Refresh</button>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3 flex-wrap">
        <Toggle options={[["pods", "Pods"], ["nodes", "Nodes"]]} value={entity} onChange={(v) => setEntity(v as "pods" | "nodes")} />
        <Toggle options={[["cpu", "CPU"], ["mem", "Memory"]]} value={metric} onChange={(v) => setMetric(v as "cpu" | "mem")} />
        {entity === "pods" && (
          <Toggle options={[["namespace", "By namespace"], ["node", "By node"]]} value={groupBy} onChange={(v) => setGroupBy(v as "node" | "namespace")} />
        )}
        {/* Legend */}
        <div className="flex items-center gap-2 text-xs text-th-dim ml-auto">
          <span>{entity === "nodes" ? "0%" : "low"}</span>
          <div className="h-3 w-32 rounded" style={{ background: `linear-gradient(to right, ${heat(0)}, ${heat(0.5)}, ${heat(1)})` }} />
          <span>{entity === "nodes" ? "100%" : "high"}</span>
        </div>
      </div>

      {/* Summary */}
      {!loading && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-th-dim">
          <span><b className="text-th-body">{total}</b> {entity}</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded" style={{ background: heat(0.9) }} /> {bands.hot} hot</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded" style={{ background: heat(0.55) }} /> {bands.warm} warm</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded" style={{ background: heat(0.15) }} /> {bands.cool} cool</span>
          {hottest && <span className="text-th-ghost">hottest: <b className="text-th-body">{hottest.label}</b> ({hottest.valueLabel})</span>}
          {capped && <span className="text-th-warn">showing hottest {CELL_CAP} of {total}</span>}
        </div>
      )}

      {loading && <TableSkeleton />}

      {!loading && total === 0 && (
        <div className="bg-th-panel border border-th-line rounded-xl shadow-card px-4 py-10 text-center text-th-ghost">
          No {metric === "cpu" ? "CPU" : "memory"} metrics available — the metrics-server may still be warming up.
        </div>
      )}

      {!loading && groups.map((g) => (
        <div key={g.name} className="bg-th-panel border border-th-line rounded-xl shadow-card p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-th-heading">{g.name}</h3>
            <span className="text-xs text-th-ghost">{g.cells.length} {entity}</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {g.cells.map((c) => {
              const dim = q !== "" && !c.label.toLowerCase().includes(q) && !c.sub.toLowerCase().includes(q);
              const isHit = q !== "" && (c.label.toLowerCase().includes(q) || c.sub.toLowerCase().includes(q));
              return (
                <button
                  key={c.key}
                  onClick={() => nav(c.nav)}
                  title={`${c.label}\n${c.sub}\n${metric === "cpu" ? "CPU" : "Memory"}: ${c.valueLabel}`}
                  className="rounded-sm transition-all hover:scale-125 hover:z-10 hover:ring-2 hover:ring-th-accent focus:outline-none"
                  style={{
                    width: cellSize, height: cellSize,
                    backgroundColor: heat(c.intensity),
                    opacity: dim ? 0.15 : 1,
                    boxShadow: isHit ? "0 0 0 2px var(--th-accent)" : undefined,
                  }}
                />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
