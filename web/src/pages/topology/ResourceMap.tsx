import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { TableSkeleton } from "@/components/Skeleton";
import { listPods, topPods } from "@/api/client";
import type { PodSummary, PodMetrics } from "@/api/client";
import { useResource } from "@/hooks/useResource";
import { hierarchy, pack, type HierarchyCircularNode } from "d3-hierarchy";
import { STATUS, classifyStatus, type StatusKind } from "@/lib/status";

/* ---- unit parsing (metrics-server strings) --------------------------- */
function cpuMillicores(s: string): number {
  if (!s) return 0;
  const v = parseFloat(s);
  if (s.endsWith("n")) return v / 1e6;
  if (s.endsWith("u")) return v / 1e3;
  if (s.endsWith("m")) return v;
  return v * 1000;
}
function memBytes(s: string): number {
  if (!s) return 0;
  const v = parseFloat(s);
  const u: Record<string, number> = { Ki: 1024, Mi: 1024 ** 2, Gi: 1024 ** 3, Ti: 1024 ** 4 };
  for (const [suf, mul] of Object.entries(u)) if (s.endsWith(suf)) return v * mul;
  return v;
}
function fmtCpu(m: number) { return m >= 1000 ? `${(m / 1000).toFixed(2)} cores` : `${Math.round(m)}m`; }
function fmtMem(b: number) { return b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)}Gi` : `${(b / 1024 ** 2).toFixed(0)}Mi`; }

/* ---- pod status color (single source of truth: lib/status.ts) --------- */
function podKind(status: string): StatusKind {
  return classifyStatus(status);
}

/* ---- non-color status cues (WCAG 1.4.1 Use of Color) ------------------
   Hue alone can't convey health to colorblind users, so failed pods get a
   bold ring + "!" glyph and pending pods a dashed ring — distinguishable even
   in grayscale. Fill/ring hex come from the shared STATUS palette. */
function podStatusMark(kind: StatusKind): { stroke: string; sw: number; dash?: string; glyph?: string } {
  const ring = STATUS[kind].ring;
  if (kind === "warn") return { stroke: ring, sw: 1.5, dash: "2.5 2" };
  if (kind === "error") return { stroke: ring, sw: 2.5, glyph: "!" };
  return { stroke: ring, sw: 1 };
}

/* ---- workload grouping from pod owner -------------------------------- */
function workloadOf(p: PodSummary): { name: string; kind: string } {
  if (p.owner_kind === "ReplicaSet" && p.owner_name) return { name: p.owner_name.replace(/-[a-z0-9]{5,}$/, ""), kind: "Deployment" };
  if (p.owner_name) return { name: p.owner_name, kind: p.owner_kind || "Workload" };
  return { name: p.name, kind: "Pod" };
}

const SIZE = 1000;

interface HData {
  id: string;
  name: string;
  kind: "cluster" | "namespace" | "workload" | "pod";
  status?: string;
  cpu?: number;
  mem?: number;
  node?: string;
  ns?: string;
  children?: HData[];
  value?: number;
}

export default function ResourceMap() {
  const nav = useNavigate();
  const { data: pods, loading: l1, refresh } = useResource<PodSummary[]>(() => listPods(), []);
  const { data: podMetrics, loading: l2 } = useResource<PodMetrics[]>(() => topPods(), []);
  const loading = l1 || l2;

  const [metric, setMetric] = useState<"cpu" | "mem" | "count">("cpu");
  const [focusId, setFocusId] = useState<string>("cluster");
  const [query, setQuery] = useState("");

  // Build hierarchy: cluster → namespace → workload → pod.
  const root = useMemo(() => {
    const mmCpu = new Map<string, number>();
    const mmMem = new Map<string, number>();
    (podMetrics ?? []).forEach((pm) => {
      const key = `${pm.namespace}/${pm.name}`;
      mmCpu.set(key, (pm.containers || []).reduce((s, c) => s + cpuMillicores(c.cpu_usage), 0));
      mmMem.set(key, (pm.containers || []).reduce((s, c) => s + memBytes(c.memory_usage), 0));
    });

    const nsMap = new Map<string, Map<string, HData[]>>();
    (pods ?? []).forEach((p) => {
      const wl = workloadOf(p);
      if (!nsMap.has(p.namespace)) nsMap.set(p.namespace, new Map());
      const wlMap = nsMap.get(p.namespace)!;
      if (!wlMap.has(wl.name)) wlMap.set(wl.name, []);
      const key = `${p.namespace}/${p.name}`;
      wlMap.get(wl.name)!.push({
        id: `cluster/${p.namespace}/${wl.name}/${p.name}`,
        name: p.name, kind: "pod", status: p.status, ns: p.namespace, node: p.node,
        cpu: mmCpu.get(key) ?? 0, mem: mmMem.get(key) ?? 0,
      });
    });

    const children: HData[] = [...nsMap.entries()].map(([ns, wlMap]) => ({
      id: `cluster/${ns}`, name: ns, kind: "namespace" as const,
      children: [...wlMap.entries()].map(([wl, ps]) => ({
        id: `cluster/${ns}/${wl}`, name: wl, kind: "workload" as const, ns, children: ps,
      })),
    }));
    return { id: "cluster", name: "cluster", kind: "cluster" as const, children } as HData;
  }, [pods, podMetrics]);

  // Pack layout.
  const packed = useMemo(() => {
    const h = hierarchy<HData>(root)
      .sum((d) => (d.kind === "pod" ? (metric === "cpu" ? Math.max(1, d.cpu ?? 0) : metric === "mem" ? Math.max(1, (d.mem ?? 0) / 1e6) : 1) : 0))
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
    return pack<HData>().size([SIZE, SIZE]).padding((d) => (d.depth === 0 ? 16 : d.depth === 1 ? 6 : 2))(h);
  }, [root, metric]);

  const nodesById = useMemo(() => {
    const m = new Map<string, HierarchyCircularNode<HData>>();
    packed.each((n) => m.set(n.data.id, n));
    return m;
  }, [packed]);

  const focus = nodesById.get(focusId) ?? packed;
  const q = query.trim().toLowerCase();

  // Which nodes contain / are a search match (post-order).
  const litIds = useMemo(() => {
    if (!q) return null;
    const lit = new Set<string>();
    packed.eachAfter((n) => {
      const self = n.data.name.toLowerCase().includes(q);
      const kid = (n.children || []).some((c) => lit.has(c.data.id));
      if (self || kid) lit.add(n.data.id);
    });
    return lit;
  }, [packed, q]);

  // View transform from focus circle.
  const k = SIZE / (focus.r * 2);
  const toScreen = (n: HierarchyCircularNode<HData>) => ({
    x: (n.x - focus.x) * k + SIZE / 2,
    y: (n.y - focus.y) * k + SIZE / 2,
    r: n.r * k,
  });

  // Cull tiny circles; collect visible.
  const visible = useMemo(() => {
    const out: { n: HierarchyCircularNode<HData>; s: { x: number; y: number; r: number } }[] = [];
    packed.each((n) => {
      const s = toScreen(n);
      if (s.r < 1.2) return;
      if (s.x + s.r < -50 || s.x - s.r > SIZE + 50 || s.y + s.r < -50 || s.y - s.r > SIZE + 50) return;
      out.push({ n, s });
    });
    return out;
  }, [packed, focusId]); // eslint-disable-line react-hooks/exhaustive-deps

  const stats = useMemo(() => {
    let running = 0, warn = 0, fail = 0, total = 0;
    packed.leaves().forEach((l) => {
      total++;
      const k = podKind(l.data.status || "");
      if (k === "ok") running++; else if (k === "warn") warn++; else if (k === "error") fail++;
    });
    return { total, running, warn, fail, namespaces: root.children?.length ?? 0 };
  }, [packed, root]);

  const onClickNode = (n: HierarchyCircularNode<HData>) => {
    if (n.data.kind === "pod") { nav(`/workloads/pods/${n.data.ns}/${n.data.name}`); return; }
    setFocusId(n.data.id);
  };

  // Breadcrumb from focus ancestors.
  const crumbs = focus.ancestors().reverse();

  const Toggle = ({ options, value, onChange }: { options: [string, string][]; value: string; onChange: (v: string) => void }) => (
    <div className="inline-flex rounded-lg border border-th-line overflow-hidden text-sm">
      {options.map(([v, label]) => (
        <button key={v} onClick={() => onChange(v)} className={`px-3 py-1.5 transition-colors ${value === v ? "bg-th-accent text-white" : "bg-th-subtle text-th-dim hover:text-th-body"}`}>{label}</button>
      ))}
    </div>
  );

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-th-heading">Cluster Map</h1>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <svg className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-th-ghost" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" /></svg>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Highlight…" className="w-40 pl-8 pr-3 py-1.5 text-sm bg-th-subtle border border-th-line rounded-lg text-th-body placeholder:text-th-ghost focus:outline-none focus:ring-1 focus:ring-th-accent" />
          </div>
          <Toggle options={[["cpu", "CPU"], ["mem", "Memory"], ["count", "Count"]]} value={metric} onChange={(v) => setMetric(v as "cpu" | "mem" | "count")} />
          <button onClick={refresh} className="px-3 py-1.5 text-sm bg-th-accent text-white rounded-lg hover:opacity-90 transition-opacity">Refresh</button>
        </div>
      </div>

      {/* Breadcrumb + legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <div className="flex items-center gap-1 text-th-dim">
          {crumbs.map((c, i) => (
            <span key={c.data.id} className="flex items-center gap-1">
              {i > 0 && <span className="text-th-ghost">/</span>}
              <button onClick={() => setFocusId(c.data.id)} className={`hover:text-th-accent ${c.data.id === focusId ? "text-th-body font-medium" : ""}`}>
                {c.data.kind === "cluster" ? "Cluster" : c.data.name}
              </button>
            </span>
          ))}
        </div>
        <div className="flex items-center gap-3 text-th-dim ml-auto">
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full" style={{ background: STATUS.ok.fill, border: `1px solid ${STATUS.ok.ring}` }} /> {stats.running} running</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full" style={{ background: STATUS.warn.fill, border: `1.5px dashed ${STATUS.warn.ring}` }} /> {stats.warn} pending</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full grid place-items-center text-[8px] font-extrabold text-white leading-none" style={{ background: STATUS.error.fill, border: `1.5px solid ${STATUS.error.ring}` }}>!</span> {stats.fail} failed</span>
          <span className="text-th-ghost">{stats.namespaces} namespaces · {stats.total} pods · sized by {metric}</span>
        </div>
      </div>

      {loading && <TableSkeleton />}
      {!loading && stats.total === 0 && (
        <div className="bg-th-panel border border-th-line rounded-xl shadow-card px-4 py-10 text-center text-th-ghost">No pods running.</div>
      )}

      {!loading && stats.total > 0 && (
        <div className="bg-th-panel border border-th-line rounded-xl shadow-card overflow-hidden" style={{ height: "calc(100vh - 200px)" }}>
          <svg viewBox={`0 0 ${SIZE} ${SIZE}`} width="100%" height="100%" preserveAspectRatio="xMidYMid meet" style={{ cursor: focusId === "cluster" ? "default" : "zoom-out", display: "block" }}
            onClick={() => { if (focus.parent) setFocusId(focus.parent.data.id); }}>
            {visible.map(({ n, s }) => {
              const d = n.data;
              const isPod = d.kind === "pod";
              const lit = !litIds || litIds.has(d.id);
              const isHit = q !== "" && d.name.toLowerCase().includes(q);
              let fill = "transparent", stroke = "transparent", sw = 1, dash: string | undefined;
              let glyph: string | undefined;
              if (isPod) {
                const kind = podKind(d.status || "");
                fill = STATUS[kind].fill;
                const mark = podStatusMark(kind);
                stroke = mark.stroke; sw = mark.sw; dash = mark.dash;
                // Only draw the glyph when the circle is large enough to read it.
                if (mark.glyph && s.r >= 5) glyph = mark.glyph;
              }
              else if (d.kind === "namespace") { fill = "rgba(99,102,241,0.05)"; stroke = "#6366f1"; sw = 1.2; }
              else if (d.kind === "workload") { fill = "rgba(59,130,246,0.05)"; stroke = "#3b82f6"; sw = 1; }
              const tip = isPod
                ? `${d.name}\n${d.ns} · ${d.status}\nCPU ${fmtCpu(d.cpu ?? 0)} · Mem ${fmtMem(d.mem ?? 0)}${d.node ? "\n@ " + d.node : ""}`
                : `${d.name} (${d.kind})\n${n.leaves().length} pods`;
              return (
                <g key={d.id}>
                  <circle cx={s.x} cy={s.y} r={s.r}
                    fill={fill} stroke={stroke} strokeWidth={sw} strokeDasharray={dash}
                    fillOpacity={isPod ? (lit ? 0.9 : 0.12) : lit ? 1 : 0.3}
                    strokeOpacity={lit ? (isPod ? 0.9 : 0.55) : 0.15}
                    style={{
                      transition: "cx 0.5s ease, cy 0.5s ease, r 0.5s ease",
                      cursor: isPod ? "pointer" : "zoom-in",
                      // CSS vars resolve in `style`, not in SVG attributes.
                      ...(isHit ? { stroke: "var(--th-accent)", strokeWidth: 3, strokeOpacity: 1 } : {}),
                    }}
                    onClick={(e) => { e.stopPropagation(); onClickNode(n); }}>
                    <title>{tip}</title>
                  </circle>
                  {glyph && lit && (
                    <text x={s.x} y={s.y} textAnchor="middle" dominantBaseline="central"
                      fontSize={Math.min(s.r * 1.5, 13)} fontWeight={800} fill="#ffffff"
                      style={{ pointerEvents: "none", transition: "x 0.5s ease, y 0.5s ease" }}>
                      {glyph}
                    </text>
                  )}
                </g>
              );
            })}
            {/* Labels for namespace/workload circles large enough to read.
                A panel-colored halo (paint-order: stroke) keeps them legible
                over the pods packed beneath them — fixes overlap illegibility. */}
            {visible.filter(({ n, s }) => n.data.kind !== "pod" && s.r > 34 && n.data.id !== focus.data.id).map(({ n, s }) => (
              <text key={"t" + n.data.id} x={s.x} y={s.y - s.r + 14} textAnchor="middle"
                style={{
                  transition: "x 0.5s ease, y 0.5s ease", pointerEvents: "none", fontWeight: 700,
                  fill: n.data.kind === "namespace" ? "#6366f1" : "var(--th-dim)",
                  paintOrder: "stroke", stroke: "var(--th-panel)", strokeWidth: 3.5, strokeLinejoin: "round",
                }}
                fontSize={n.data.kind === "namespace" ? 13 : 11}>
                {n.data.name.length > 22 ? n.data.name.slice(0, 22) + "…" : n.data.name}
              </text>
            ))}
          </svg>
        </div>
      )}
    </div>
  );
}
