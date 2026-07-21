import { useMemo } from "react";
import { STATUS, classifyStatus } from "@/lib/status";
import { TableSkeleton } from "@/components/Skeleton";
import { useOutletContext } from "react-router-dom";
import { listNodes, listPods, topNodes, listEvents } from "@/api/client";
import type { NodeSummary, PodSummary, NodeMetrics, EventSummary } from "@/api/client";
import { useResource } from "@/hooks/useResource";
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";

interface DiagCheck {
  name: string;
  status: "ok" | "warn" | "error";
  message: string;
  detail?: string;
}

/* SVG ring gauge for overall health score */
function HealthRing({ score, label }: { score: number; label: string }) {
  const r = 52, stroke = 10, c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score));
  const color = pct >= 80 ? "var(--th-ok)" : pct >= 50 ? "var(--th-warn)" : "var(--th-danger)";
  return (
    <div className="flex flex-col items-center">
      <svg width={130} height={130} viewBox="0 0 130 130">
        <circle cx={65} cy={65} r={r} fill="none" stroke="var(--th-line)" strokeWidth={stroke} />
        <circle cx={65} cy={65} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)}
          strokeLinecap="round" transform="rotate(-90 65 65)"
          style={{ filter: `drop-shadow(0 0 6px ${color}40)`, transition: "stroke-dashoffset 0.6s ease" }}
        />
        <text x={65} y={58} textAnchor="middle" className="fill-th-heading" fontSize={28} fontWeight="800">{pct}</text>
        <text x={65} y={78} textAnchor="middle" className="fill-th-dim" fontSize={10} fontWeight="500">{label}</text>
      </svg>
    </div>
  );
}

const STATUS_COLORS = { ok: "var(--th-ok)", warn: "var(--th-warn)", error: "var(--th-danger)" };

export default function Diagnostics() {
  useOutletContext<{ namespace: string }>();
  const { data: nodes, loading: l1, refresh: r1 } = useResource<NodeSummary[]>(() => listNodes(), []);
  const { data: pods, loading: l2 } = useResource<PodSummary[]>(() => listPods(), []);
  const { data: metrics, loading: l3 } = useResource<NodeMetrics[]>(() => topNodes(), []);
  const { data: events, loading: l4 } = useResource<EventSummary[]>(() => listEvents(), []);
  const loading = l1 || l2 || l3 || l4;

  const { checks, healthScore, podStatusData, statusSummary } = useMemo(() => {
    const checks: DiagCheck[] = [];
    let score = 100;

    // Node health
    if (nodes) {
      const notReady = nodes.filter((n) => n.status !== "Ready");
      checks.push({
        name: "Node Health",
        status: notReady.length === 0 ? "ok" : "error",
        message: notReady.length === 0 ? `All ${nodes.length} nodes Ready` : `${notReady.length}/${nodes.length} nodes NotReady`,
        detail: notReady.length > 0 ? `Affected: ${notReady.map((n) => n.name).join(", ")}` : undefined,
      });
      if (notReady.length > 0) score -= 30;
    }

    // Pod health
    const allPods = pods ?? [];
    const failing = allPods.filter((p) => ["CrashLoopBackOff", "Error", "ImagePullBackOff", "OOMKilled", "ErrImagePull"].includes(p.status));
    const pending = allPods.filter((p) => p.status === "Pending");
    const running = allPods.filter((p) => p.status === "Running");
    if (pods) {
      checks.push({
        name: "Pod Health",
        status: failing.length > 0 ? "error" : pending.length > 5 ? "warn" : "ok",
        message: failing.length > 0
          ? `${failing.length} pods in error state`
          : `${allPods.length} pods, ${running.length} running, ${pending.length} pending`,
        detail: failing.length > 0 ? failing.slice(0, 4).map((p) => `${p.namespace}/${p.name}: ${p.status}`).join(", ") + (failing.length > 4 ? "..." : "") : undefined,
      });
      if (failing.length > 10) score -= 20;
      else if (failing.length > 0) score -= 10;
      if (pending.length > 10) score -= 5;
    }

    // CPU
    if (metrics) {
      const highCPU = metrics.filter((m) => m.cpu_percent > 80);
      checks.push({
        name: "CPU Usage",
        status: highCPU.length > 0 ? "warn" : "ok",
        message: highCPU.length > 0
          ? `${highCPU.length} nodes above 80% CPU`
          : "All nodes below 80% CPU",
        detail: highCPU.length > 0 ? highCPU.map((n) => `${n.name}: ${n.cpu_percent.toFixed(0)}%`).join(", ") : undefined,
      });
      if (highCPU.length > 0) score -= 10;
    }

    // Memory
    if (metrics) {
      const highMem = metrics.filter((m) => m.memory_percent > 80);
      checks.push({
        name: "Memory Usage",
        status: highMem.length > 0 ? "warn" : "ok",
        message: highMem.length > 0
          ? `${highMem.length} nodes above 80% memory`
          : "All nodes below 80% memory",
        detail: highMem.length > 0 ? highMem.map((n) => `${n.name}: ${n.memory_percent.toFixed(0)}%`).join(", ") : undefined,
      });
      if (highMem.length > 0) score -= 10;
    }

    // Events
    if (events) {
      const warnings = events.filter((e) => e.type === "Warning");
      const recent = warnings.filter((e) => Date.now() - new Date(e.last_seen).getTime() < 3600000);
      checks.push({
        name: "Recent Warnings",
        status: recent.length > 10 ? "warn" : "ok",
        message: recent.length > 0 ? `${recent.length} warning events in the last hour` : "No warning events in the last hour",
      });
      if (recent.length > 20) score -= 10;
    }

    score = Math.max(0, score);

    // Pod status breakdown for pie chart
    const podStatusMap: Record<string, number> = {};
    allPods.forEach((p) => { podStatusMap[p.status] = (podStatusMap[p.status] || 0) + 1; });
    const podStatusData = Object.entries(podStatusMap)
      .sort((a, b) => b[1] - a[1])
      .map(([name, value]) => ({ name, value }));

    const statusSummary = {
      ok: checks.filter((c) => c.status === "ok").length,
      warn: checks.filter((c) => c.status === "warn").length,
      error: checks.filter((c) => c.status === "error").length,
    };

    return { checks, healthScore: score, podStatusData, statusSummary };
  }, [nodes, pods, metrics, events]);

  // Hex from the shared status palette (recharts <Cell fill> is an SVG attribute
  // that can't resolve CSS var()); classified so every reason maps consistently.
  const podStatusColor = (name: string) => STATUS[classifyStatus(name)].fill;

  const refresh = () => { r1(); };

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-th-heading">Cluster Diagnostics</h1>
        <button onClick={refresh} className="px-3 py-1.5 text-sm bg-th-accent text-white rounded-lg hover:opacity-90 transition-opacity">
          Run Diagnostics
        </button>
      </div>

      {loading && <TableSkeleton />}

      {!loading && (
        <>
          {/* Top dashboard */}
          <div className="grid grid-cols-12 gap-4">
            {/* Health score */}
            <div className="col-span-12 md:col-span-3 bg-th-panel border border-th-line rounded-xl p-4 shadow-card flex flex-col items-center justify-center">
              <HealthRing score={healthScore} label="Health Score" />
            </div>

            {/* Check summary */}
            <div className="col-span-12 md:col-span-3 bg-th-panel border border-th-line rounded-xl p-4 shadow-card flex flex-col justify-center gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-green-500/15 flex items-center justify-center">
                  <span className="text-lg font-black text-th-ok">{statusSummary.ok}</span>
                </div>
                <div>
                  <p className="text-sm font-medium text-th-body">Passed</p>
                  <p className="text-[10px] text-th-dim">All checks healthy</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-amber-500/15 flex items-center justify-center">
                  <span className="text-lg font-black text-th-warn">{statusSummary.warn}</span>
                </div>
                <div>
                  <p className="text-sm font-medium text-th-body">Warnings</p>
                  <p className="text-[10px] text-th-dim">Needs attention</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-red-500/15 flex items-center justify-center">
                  <span className="text-lg font-black text-th-danger">{statusSummary.error}</span>
                </div>
                <div>
                  <p className="text-sm font-medium text-th-body">Errors</p>
                  <p className="text-[10px] text-th-dim">Requires action</p>
                </div>
              </div>
            </div>

            {/* Pod status pie */}
            <div className="col-span-12 md:col-span-6 bg-th-panel border border-th-line rounded-xl p-4 shadow-card">
              <h3 className="text-xs font-bold text-th-dim uppercase tracking-wider mb-2">Pod Status Distribution</h3>
              {podStatusData.length > 0 ? (
                <div className="flex items-center gap-4">
                  <div className="w-28 h-28">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={podStatusData} cx="50%" cy="50%" innerRadius={26} outerRadius={50} paddingAngle={2} dataKey="value" stroke="none">
                          {podStatusData.map((d) => <Cell key={d.name} fill={podStatusColor(d.name)} />)}
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex flex-col gap-1 flex-1">
                    {podStatusData.map((d) => (
                      <div key={d.name} className="flex items-center gap-2 text-xs">
                        <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: podStatusColor(d.name) }} />
                        <span className="text-th-dim">{d.name}</span>
                        <span className="font-semibold text-th-body ml-auto">{d.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-xs text-th-ghost text-center mt-8">No pods</p>
              )}
            </div>
          </div>

          {/* Check details */}
          <div className="space-y-3">
            {checks.map((c) => (
              <div
                key={c.name}
                className={`bg-th-panel border rounded-xl p-4 shadow-card flex items-start gap-3 ${
                  c.status === "error" ? "border-red-500/30" : c.status === "warn" ? "border-amber-500/30" : "border-th-line"
                }`}
              >
                <div className="mt-0.5 shrink-0">
                  {c.status === "ok" && (
                    <svg className="w-5 h-5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  )}
                  {c.status === "warn" && (
                    <svg className="w-5 h-5 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                  )}
                  {c.status === "error" && (
                    <svg className="w-5 h-5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium text-th-body">{c.name}</h3>
                    <span
                      className="px-1.5 py-0.5 rounded text-[10px] font-medium uppercase"
                      style={{
                        backgroundColor: STATUS_COLORS[c.status] + "18",
                        color: STATUS_COLORS[c.status],
                      }}
                    >
                      {c.status}
                    </span>
                  </div>
                  <p className="text-sm text-th-dim mt-0.5">{c.message}</p>
                  {c.detail && <p className="text-xs text-th-ghost mt-1 break-words">{c.detail}</p>}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
