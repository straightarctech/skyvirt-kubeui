import { useState, useEffect, useCallback } from "react";
import {
  listNodes, listPods, listDeployments, listStatefulSets, listDaemonSets,
  listServices, listNamespaces, listEvents, topNodes, topPods, listJobs, listCronJobs,
  listPVCs, listHelmReleases, listConfigMaps, listSecrets,
} from "@/api/client";
import type {
  NodeSummary, PodSummary, DeploymentSummary, StatefulSetSummary,
  DaemonSetSummary, ServiceSummary, NamespaceSummary, EventSummary,
  NodeMetrics, PodMetrics, JobSummary, CronJobSummary, PVCSummary, HelmRelease,
  ConfigMapSummary, SecretSummary,
} from "@/api/client";
import { Link } from "react-router-dom";
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip } from "recharts";
import { Sparkline, useMetricHistory, LiveTrend } from "@/components/viz";
import { StatusDot } from "@/components/StatusBadge";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function age(created: string): string {
  const diff = Date.now() - new Date(created).getTime();
  const days = Math.floor(diff / 86400000);
  if (days > 0) return `${days}d`;
  const hours = Math.floor(diff / 3600000);
  if (hours > 0) return `${hours}h`;
  const mins = Math.floor(diff / 60000);
  return `${mins}m`;
}

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

function pct(v: number, max: number): number {
  return max > 0 ? Math.min(Math.round((v / max) * 100), 100) : 0;
}

function usageColor(percent: number): string {
  if (percent >= 90) return "text-th-danger";
  if (percent >= 70) return "text-th-warn";
  return "text-th-ok";
}

function usageStroke(percent: number): string {
  if (percent >= 90) return "var(--th-danger)";
  if (percent >= 70) return "var(--th-warn)";
  return "var(--th-ok)";
}

// A stat value with a live trend sparkline that accumulates while the page is
// open (one sample per refresh — no Prometheus needed).
function TrendStat({ value, display, label }: { value: number; display: string; label: string }) {
  const hist = useMetricHistory(Math.round(value * 10) / 10, 40, 3000);
  return (
    <div className="flex flex-col items-center">
      <p className={`text-lg font-bold ${usageColor(value)}`}>{display}</p>
      <div className="h-6 my-0.5 flex items-center justify-center">
        <Sparkline data={hist} width={66} height={22} color={usageStroke(value)} />
      </div>
      <p className="text-[10px] text-th-dim uppercase tracking-wide">{label}</p>
    </div>
  );
}


// ---------------------------------------------------------------------------
// Circular Gauge (SVG)
// ---------------------------------------------------------------------------

function CircularGauge({ value, label, size = 80, strokeWidth = 6, color }: {
  value: number; label: string; size?: number; strokeWidth?: number; color?: string;
}) {
  const r = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * r;
  const offset = circumference - (Math.min(value, 100) / 100) * circumference;
  const c = color || (value >= 90 ? "var(--th-danger)" : value >= 70 ? "var(--th-warn)" : "var(--th-ok)");
  const glowId = `glow-${label.replace(/\s/g, "")}`;

  return (
    <div className="flex flex-col items-center gap-1">
      <svg width={size} height={size} className="-rotate-90">
        <defs>
          <filter id={glowId}>
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--th-muted)" strokeWidth={strokeWidth} opacity={0.3} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={c} strokeWidth={strokeWidth}
          strokeDasharray={circumference} strokeDashoffset={offset}
          strokeLinecap="round"
          className="transition-all duration-700"
          filter={`url(#${glowId})`}
        />
      </svg>
      <div className="absolute flex flex-col items-center justify-center" style={{ width: size, height: size }}>
        <span className="text-lg font-bold text-th-heading">{value.toFixed(0)}%</span>
      </div>
      <span className="text-[10px] text-th-dim uppercase tracking-wider font-medium">{label}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mini Stat
// ---------------------------------------------------------------------------

function MiniStat({ icon, value, label, color = "text-th-accent", to }: {
  icon: React.ReactNode; value: number; label: string; color?: string; to?: string;
}) {
  const inner = (
    <div className="flex items-center gap-3 glass-card glass-card-hover rounded-xl px-4 py-3 transition-all duration-200 group">
      <div className={`${color} opacity-70 group-hover:opacity-100 transition-opacity`}>{icon}</div>
      <div>
        <p className={`text-2xl font-bold ${color}`}>{value}</p>
        <p className="text-[10px] text-th-dim uppercase tracking-wider font-medium">{label}</p>
      </div>
    </div>
  );
  if (to) return <Link to={to} className="block">{inner}</Link>;
  return inner;
}

// ---------------------------------------------------------------------------
// Health Score Ring
// ---------------------------------------------------------------------------

function HealthRing({ score, label }: { score: number; label: string }) {
  const size = 140;
  const sw = 10;
  const r = (size - sw) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (Math.min(score, 100) / 100) * c;
  const color = score >= 80 ? "var(--th-ok)" : score >= 50 ? "var(--th-warn)" : "var(--th-danger)";

  return (
    <div className="flex flex-col items-center">
      <div className="relative">
        <svg width={size} height={size} className="-rotate-90">
          <defs>
            <filter id="health-glow">
              <feGaussianBlur stdDeviation="1.5" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
            <linearGradient id="health-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={color} />
              <stop offset="100%" stopColor={color} stopOpacity="0.6" />
            </linearGradient>
          </defs>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--th-muted)" strokeWidth={sw} opacity={0.15} />
          <circle
            cx={size / 2} cy={size / 2} r={r} fill="none"
            stroke="url(#health-gradient)" strokeWidth={sw}
            strokeDasharray={c} strokeDashoffset={offset}
            strokeLinecap="round"
            className="transition-all duration-1000"
            filter="url(#health-glow)"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-black text-th-heading">{score}</span>
          <span className="text-[10px] text-th-ghost uppercase tracking-widest font-medium">/ 100</span>
        </div>
      </div>
      <p className="mt-2 text-[10px] font-bold text-th-dim uppercase tracking-widest">{label}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Node Card
// ---------------------------------------------------------------------------

function NodeCard({ node, metrics }: { node: NodeSummary; metrics?: NodeMetrics }) {
  const ready = node.status === "Ready";
  const cpu = metrics?.cpu_percent ?? 0;
  const mem = metrics?.memory_percent ?? 0;

  return (
    <Link to={`/nodes/${node.name}`} className="block group">
      <div className={`glass-card glass-card-hover rounded-xl p-3 transition-all duration-200 ${!ready ? "border-th-danger/50" : ""}`}>
        <div className="flex items-center gap-2 mb-3">
          <StatusDot kind={ready ? "ok" : "error"} status={node.status} className={ready ? "animate-pulse-soft" : "animate-pulse"} />
          <span className="text-sm font-semibold text-th-heading truncate group-hover:text-th-accent transition-colors">{node.name}</span>
        </div>
        <div className="flex items-center gap-4 justify-center">
          <div className="relative">
            <CircularGauge value={cpu} label="CPU" size={64} strokeWidth={5} />
          </div>
          <div className="relative">
            <CircularGauge value={mem} label="MEM" size={64} strokeWidth={5} />
          </div>
        </div>
        <div className="mt-1.5 flex items-center justify-center gap-4">
          <LiveTrend value={cpu} width={64} height={18} color={usageStroke(cpu)} />
          <LiveTrend value={mem} width={64} height={18} color={usageStroke(mem)} />
        </div>
        <div className="mt-2 flex items-center justify-between text-[10px] text-th-ghost">
          <span className="font-mono">{node.internal_ip}</span>
          <span>{node.roles.join(", ")}</span>
        </div>
      </div>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Pod Phase Donut
// ---------------------------------------------------------------------------

const POD_COLORS: Record<string, string> = {
  Running: "var(--th-ok)",
  Succeeded: "var(--th-info)",
  Pending: "var(--th-warn)",
  Failed: "var(--th-danger)",
  Unknown: "var(--th-dim)",
};

function PodDonut({ pods }: { pods: PodSummary[] }) {
  const counts: Record<string, number> = {};
  pods.forEach((p) => {
    const phase = ["Running", "Succeeded", "Pending", "Failed"].includes(p.status) ? p.status : "Unknown";
    counts[phase] = (counts[phase] || 0) + 1;
  });
  const data = Object.entries(counts).map(([name, value]) => ({ name, value }));

  if (data.length === 0) return <p className="text-th-ghost text-xs text-center py-4">No pods</p>;

  return (
    <div className="flex items-center gap-4">
      <div className="w-28 h-28">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} cx="50%" cy="50%" innerRadius={28} outerRadius={48} paddingAngle={2} dataKey="value" stroke="none">
              {data.map((d) => <Cell key={d.name} fill={POD_COLORS[d.name] || "var(--th-dim)"} />)}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-col gap-1">
        {data.map((d) => (
          <div key={d.name} className="flex items-center gap-2 text-xs">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: POD_COLORS[d.name] || "var(--th-dim)" }} />
            <span className="text-th-dim w-16">{d.name}</span>
            <span className="font-semibold text-th-body">{d.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Workload Status Bar
// ---------------------------------------------------------------------------

function WorkloadBar({ label, ready, total, to }: { label: string; ready: number; total: number; to: string }) {
  const p = pct(ready, total);
  const healthy = ready === total && total > 0;

  return (
    <Link to={to} className="block group">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-th-body group-hover:text-th-accent transition-colors">{label}</span>
        <span className={`text-xs font-bold ${healthy ? "text-th-ok" : "text-th-warn"}`}>{ready}/{total}</span>
      </div>
      <div className="w-full h-2 bg-th-muted rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ${healthy ? "bg-th-ok" : "bg-th-warn"}`}
          style={{ width: `${p}%` }}
        />
      </div>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Events Feed
// ---------------------------------------------------------------------------

function EventsFeed({ events }: { events: EventSummary[] }) {
  return (
    <div className="space-y-1 max-h-[320px] overflow-y-auto pr-1 scrollbar-thin">
      {events.map((e, i) => (
        <div key={i} className={`flex items-start gap-2 px-2 py-1.5 rounded text-xs ${e.type === "Warning" ? "bg-th-warn-s/40" : "hover:bg-th-hover"} transition-colors`}>
          <span className={`mt-0.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${e.type === "Warning" ? "bg-th-warn" : "bg-th-ok"}`} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-medium text-th-body truncate">{e.reason}</span>
              <span className="text-th-ghost flex-shrink-0">{timeAgo(e.last_seen)}</span>
            </div>
            <p className="text-th-dim truncate">{e.regarding_kind}/{e.regarding_name}: {e.message}</p>
          </div>
        </div>
      ))}
      {events.length === 0 && <p className="text-center text-th-ghost py-4 text-xs">No events</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Service Type Breakdown
// ---------------------------------------------------------------------------

function ServiceBreakdown({ services }: { services: ServiceSummary[] }) {
  const types: Record<string, number> = {};
  services.forEach((s) => { types[s.type] = (types[s.type] || 0) + 1; });
  const colors: Record<string, string> = { ClusterIP: "bg-th-accent", NodePort: "bg-th-info", LoadBalancer: "bg-th-warn", ExternalName: "bg-th-ok" };

  return (
    <div className="flex flex-wrap gap-3">
      {Object.entries(types).map(([type, count]) => (
        <div key={type} className="flex items-center gap-2">
          <span className={`w-2.5 h-2.5 rounded-sm ${colors[type] || "bg-th-dim"}`} />
          <span className="text-xs text-th-dim">{type}</span>
          <span className="text-xs font-bold text-th-body">{count}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section Header
// ---------------------------------------------------------------------------

function SectionHeader({ title, to }: { title: string; to?: string }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h3 className="text-xs font-bold text-th-dim uppercase tracking-wider">{title}</h3>
      {to && <Link to={to} className="text-[10px] text-th-accent hover:underline uppercase tracking-wider">View All</Link>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Dashboard
// ---------------------------------------------------------------------------

interface DashboardData {
  nodes: NodeSummary[];
  pods: PodSummary[];
  deployments: DeploymentSummary[];
  statefulSets: StatefulSetSummary[];
  daemonSets: DaemonSetSummary[];
  services: ServiceSummary[];
  namespaces: NamespaceSummary[];
  events: EventSummary[];
  metrics: NodeMetrics[];
  jobs: JobSummary[];
  cronJobs: CronJobSummary[];
  pvcs: PVCSummary[];
  helmReleases: HelmRelease[];
  configMaps: ConfigMapSummary[];
  secrets: SecretSummary[];
  podMetrics: PodMetrics[];
}

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [failedSources, setFailedSources] = useState(0);

  const fetchAll = useCallback(async () => {
    const results = await Promise.allSettled([
      listNodes(),
      listPods(),
      listDeployments(),
      listStatefulSets(),
      listDaemonSets(),
      listServices(),
      listNamespaces(),
      listEvents(),
      topNodes(),
      listJobs(),
      listCronJobs(),
      listPVCs(),
      listHelmReleases(),
      listConfigMaps(),
      listSecrets(),
      topPods(),
    ]);

    // Track failures so we don't render empty-as-healthy: a failed metrics or
    // resource call must be surfaced, not silently shown as 0.
    setFailedSources(results.filter((r) => r.status === "rejected").length);

    const get = <T,>(i: number, fallback: T): T =>
      results[i].status === "fulfilled" ? (results[i] as PromiseFulfilledResult<T>).value : fallback;

    setData({
      nodes: get(0, []),
      pods: get(1, []),
      deployments: get(2, []),
      statefulSets: get(3, []),
      daemonSets: get(4, []),
      services: get(5, []),
      namespaces: get(6, []),
      events: get(7, []).slice(0, 30),
      metrics: get(8, []),
      jobs: get(9, []),
      cronJobs: get(10, []),
      pvcs: get(11, []),
      helmReleases: get(12, []),
      configMaps: get(13, []),
      secrets: get(14, []),
      podMetrics: get(15, []),
    });
    setLastRefresh(new Date());
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(fetchAll, 30000);
    return () => clearInterval(id);
  }, [autoRefresh, fetchAll]);

  if (loading || !data) {
    return (
      <div className="flex flex-col items-center justify-center h-[70vh] gap-4">
        <div className="w-12 h-12 border-2 border-th-accent/30 border-t-th-accent rounded-full animate-spin" />
        <p className="text-sm text-th-dim animate-pulse-soft">Loading Command Center...</p>
      </div>
    );
  }

  // Compute health score
  const readyNodes = data.nodes.filter((n) => n.status === "Ready").length;
  const runningPods = data.pods.filter((p) => p.status === "Running" || p.status === "Succeeded").length;
  const healthyDeploys = data.deployments.filter((d) => d.ready_replicas === d.replicas).length;
  const healthySts = data.statefulSets.filter((s) => s.ready_replicas === s.replicas).length;
  const healthyDs = data.daemonSets.filter((d) => d.ready === d.desired).length;
  const warningEvents = data.events.filter((e) => e.type === "Warning").length;

  const totalWorkloads = data.deployments.length + data.statefulSets.length + data.daemonSets.length;
  const healthyWorkloads = healthyDeploys + healthySts + healthyDs;

  const nodeScore = data.nodes.length > 0 ? pct(readyNodes, data.nodes.length) : 100;
  const podScore = data.pods.length > 0 ? pct(runningPods, data.pods.length) : 100;
  const workloadScore = totalWorkloads > 0 ? pct(healthyWorkloads, totalWorkloads) : 100;
  const eventPenalty = Math.min(warningEvents * 3, 30);
  const healthScore = Math.max(0, Math.round((nodeScore * 0.35 + podScore * 0.30 + workloadScore * 0.35) - eventPenalty));

  // Avg resource usage
  const avgCpu = data.metrics.length > 0 ? data.metrics.reduce((s, m) => s + m.cpu_percent, 0) / data.metrics.length : 0;
  const avgMem = data.metrics.length > 0 ? data.metrics.reduce((s, m) => s + m.memory_percent, 0) / data.metrics.length : 0;

  // PVC status
  const boundPVCs = data.pvcs.filter((p) => p.status === "Bound").length;
  const pendingPVCs = data.pvcs.filter((p) => p.status === "Pending").length;

  // Jobs status
  const activeJobs = data.jobs.filter((j) => j.active > 0).length;
  const failedJobs = data.jobs.filter((j) => j.failed > 0).length;

  // Helm status
  const deployedHelm = data.helmReleases.filter((h) => h.status === "deployed").length;

  // Restarts
  const totalRestarts = data.pods.reduce((s, p) => s + (p.containers || []).reduce((cs, c) => cs + (c.restarts || 0), 0), 0);

  // Namespace resource chart
  const nsData = data.namespaces
    .filter((n) => !["kube-system", "kube-public", "kube-node-lease", "default"].includes(n.name))
    .slice(0, 8)
    .map((n) => ({
      name: n.name.length > 12 ? n.name.slice(0, 12) + "..." : n.name,
      pods: data.pods.filter((p) => p.namespace === n.name).length,
    }))
    .filter((n) => n.pods > 0);

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Header bar */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-th-heading tracking-tight">Command Center</h1>
          <p className="text-xs text-th-ghost mt-0.5">
            Last updated {lastRefresh.toLocaleTimeString()}
            {autoRefresh && <span className="ml-2 text-th-ok">Auto-refresh: 30s</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`px-3 py-1.5 text-xs rounded-lg border transition-all duration-200 ${
              autoRefresh
                ? "bg-th-ok/10 border-th-ok/30 text-th-ok shadow-neon-ok"
                : "bg-th-subtle border-th-line text-th-dim"
            }`}
          >
            <span className="flex items-center gap-1.5">
              {autoRefresh && <span className="w-1.5 h-1.5 rounded-full bg-th-ok animate-pulse-soft" />}
              {autoRefresh ? "Live" : "Paused"}
            </span>
          </button>
          <button
            onClick={() => fetchAll()}
            className="btn-accent px-3 py-1.5 text-xs rounded-lg font-medium"
          >
            Refresh
          </button>
        </div>
      </div>

      {failedSources > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-th-warn/40 bg-th-warn-s px-3 py-2 text-sm text-th-warn">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          {failedSources} of 16 data sources failed to load — some figures below may be incomplete or stale.
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* ROW 1: Health Score + Stats + Node Cards                            */}
      {/* ------------------------------------------------------------------ */}
      <div className="grid grid-cols-12 gap-4">
        {/* Health Score */}
        <div className="col-span-12 lg:col-span-3 glass-card rounded-xl p-5 flex flex-col items-center justify-center">
          <HealthRing score={healthScore} label="Cluster Health" />
          <div className="mt-4 grid grid-cols-3 gap-3 w-full">
            <TrendStat value={avgCpu} display={`${avgCpu.toFixed(0)}%`} label="CPU" />
            <TrendStat value={avgMem} display={`${avgMem.toFixed(0)}%`} label="Memory" />
            <div className="flex flex-col items-center">
              <p className={`text-lg font-bold ${totalRestarts > 50 ? "text-th-danger" : totalRestarts > 10 ? "text-th-warn" : "text-th-ok"}`}>{totalRestarts}</p>
              <div className="h-6 my-0.5" />
              <p className="text-[10px] text-th-dim uppercase tracking-wide">Restarts</p>
            </div>
          </div>
        </div>

        {/* Quick stats grid */}
        <div className="col-span-12 lg:col-span-3 grid grid-cols-2 gap-3 content-start">
          <MiniStat
            icon={<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><rect x="2" y="3" width="20" height="18" rx="2" /><path d="M6 8h.01M10 8h.01M6 12h.01M10 12h.01M6 16h.01M10 16h.01" /></svg>}
            value={data.nodes.length} label="Nodes"
            color={readyNodes === data.nodes.length ? "text-th-ok" : "text-th-warn"}
            to="/nodes"
          />
          <MiniStat
            icon={<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" /></svg>}
            value={data.pods.length} label="Pods"
            color="text-th-accent"
            to="/workloads/pods"
          />
          <MiniStat
            icon={<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M4 4h16v16H4z" /><path d="M4 10h16M10 4v16" /></svg>}
            value={data.deployments.length} label="Deploys"
            color="text-th-info"
            to="/workloads/deployments"
          />
          <MiniStat
            icon={<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" /></svg>}
            value={data.namespaces.length} label="Namespaces"
            color="text-th-warn"
            to="/config/namespaces"
          />
        </div>

        {/* Node cards */}
        <div className="col-span-12 lg:col-span-6">
          <SectionHeader title="Nodes" to="/nodes" />
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {data.nodes.map((n) => (
              <NodeCard key={n.name} node={n} metrics={data.metrics.find((m) => m.name === n.name)} />
            ))}
          </div>
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* ROW 2: Workloads + Pods + Services + Storage                       */}
      {/* ------------------------------------------------------------------ */}
      <div className="grid grid-cols-12 gap-4">
        {/* Workload Health */}
        <div className="col-span-12 md:col-span-6 lg:col-span-3 glass-card rounded-xl p-4">
          <SectionHeader title="Workload Health" to="/workloads/deployments" />
          <div className="space-y-3">
            <WorkloadBar label="Deployments" ready={healthyDeploys} total={data.deployments.length} to="/workloads/deployments" />
            <WorkloadBar label="StatefulSets" ready={healthySts} total={data.statefulSets.length} to="/workloads/statefulsets" />
            <WorkloadBar label="DaemonSets" ready={healthyDs} total={data.daemonSets.length} to="/workloads/daemonsets" />
            <div className="pt-2 border-t border-th-line flex items-center justify-between">
              <span className="text-xs text-th-dim">Jobs</span>
              <div className="flex gap-3 text-xs">
                <span className="text-th-info">{activeJobs} active</span>
                {failedJobs > 0 && <span className="text-th-danger">{failedJobs} failed</span>}
                <span className="text-th-dim">{data.jobs.length} total</span>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-th-dim">CronJobs</span>
              <span className="text-xs text-th-body">{data.cronJobs.length}</span>
            </div>
          </div>
        </div>

        {/* Pod Status */}
        <div className="col-span-12 md:col-span-6 lg:col-span-3 glass-card rounded-xl p-4">
          <SectionHeader title="Pod Status" to="/workloads/pods" />
          <PodDonut pods={data.pods} />
          <div className="mt-3 pt-3 border-t border-th-line grid grid-cols-2 gap-2">
            <div className="text-center">
              <p className="text-lg font-bold text-th-heading">{data.pods.length}</p>
              <p className="text-[10px] text-th-dim uppercase">Total Pods</p>
            </div>
            <div className="text-center">
              <p className={`text-lg font-bold ${totalRestarts > 50 ? "text-th-danger" : totalRestarts > 0 ? "text-th-warn" : "text-th-ok"}`}>{totalRestarts}</p>
              <p className="text-[10px] text-th-dim uppercase">Restarts</p>
            </div>
          </div>
        </div>

        {/* Services & Networking */}
        <div className="col-span-12 md:col-span-6 lg:col-span-3 glass-card rounded-xl p-4">
          <SectionHeader title="Networking" to="/networking/services" />
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-th-dim">Services</span>
              <span className="text-lg font-bold text-th-accent">{data.services.length}</span>
            </div>
            <ServiceBreakdown services={data.services} />
            <div className="pt-3 border-t border-th-line space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-th-dim">Helm Releases</span>
                <span className="text-xs font-bold text-th-body">{data.helmReleases.length}</span>
              </div>
              {data.helmReleases.length > 0 && (
                <div className="flex gap-2 text-xs">
                  <span className="text-th-ok">{deployedHelm} deployed</span>
                  {data.helmReleases.length - deployedHelm > 0 && (
                    <span className="text-th-warn">{data.helmReleases.length - deployedHelm} other</span>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Storage & Config */}
        <div className="col-span-12 md:col-span-6 lg:col-span-3 glass-card rounded-xl p-4">
          <SectionHeader title="Storage & Config" to="/storage" />
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-th-dim">PVCs</span>
              <div className="flex items-center gap-2">
                <span className="text-lg font-bold text-th-accent">{data.pvcs.length}</span>
              </div>
            </div>
            {data.pvcs.length > 0 && (
              <div className="flex gap-3 text-xs">
                <span className="text-th-ok">{boundPVCs} bound</span>
                {pendingPVCs > 0 && <span className="text-th-warn">{pendingPVCs} pending</span>}
              </div>
            )}
            <div className="pt-3 border-t border-th-line space-y-2">
              <div className="flex items-center justify-between">
                <Link to="/config/configmaps" className="text-xs text-th-dim hover:text-th-accent">ConfigMaps</Link>
                <span className="text-xs font-bold text-th-body">{data.configMaps.length}</span>
              </div>
              <div className="flex items-center justify-between">
                <Link to="/config/secrets" className="text-xs text-th-dim hover:text-th-accent">Secrets</Link>
                <span className="text-xs font-bold text-th-body">{data.secrets.length}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* ROW 3: Resource Usage Chart + Events Feed                          */}
      {/* ------------------------------------------------------------------ */}
      <div className="grid grid-cols-12 gap-4">
        {/* Resource Usage Bars */}
        <div className="col-span-12 lg:col-span-5 glass-card rounded-xl p-4">
          <SectionHeader title="Node Resource Usage" to="/observability/monitoring" />
          {data.metrics.length > 0 ? (
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.metrics.map((m) => ({
                  name: m.name.length > 10 ? m.name.slice(0, 10) + "..." : m.name,
                  CPU: Math.round(m.cpu_percent * 10) / 10,
                  Memory: Math.round(m.memory_percent * 10) / 10,
                }))}>
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: "var(--th-dim)" }} axisLine={{ stroke: "var(--th-line)" }} tickLine={false} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: "var(--th-dim)" }} axisLine={false} tickLine={false} width={30} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "var(--th-panel)", border: "1px solid var(--th-line)", borderRadius: "8px", fontSize: "11px" }}
                    labelStyle={{ color: "var(--th-heading)" }}
                    formatter={(v: number | undefined) => `${(v ?? 0).toFixed(1)}%`}
                  />
                  <Bar dataKey="CPU" fill="var(--th-accent)" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="Memory" fill="var(--th-info)" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-xs text-th-ghost py-8 text-center">Metrics server not available</p>
          )}
          {/* Resource legend */}
          {data.metrics.length > 0 && (
            <div className="mt-2 flex items-center justify-center gap-4 text-[10px]">
              <div className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-th-accent" />CPU</div>
              <div className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-th-info" />Memory</div>
            </div>
          )}
        </div>

        {/* Namespace breakdown */}
        <div className="col-span-12 lg:col-span-3 glass-card rounded-xl p-4">
          <SectionHeader title="Pods by Namespace" to="/config/namespaces" />
          {nsData.length > 0 ? (
            <div className="space-y-2">
              {nsData.map((n) => (
                <div key={n.name}>
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-xs text-th-dim truncate max-w-[120px]">{n.name}</span>
                    <span className="text-xs font-semibold text-th-body">{n.pods}</span>
                  </div>
                  <div className="w-full h-1.5 bg-th-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-th-accent rounded-full transition-all duration-500"
                      style={{ width: `${pct(n.pods, Math.max(...nsData.map((x) => x.pods), 1))}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-th-ghost py-4 text-center">No user namespaces</p>
          )}
        </div>

        {/* Events feed */}
        <div className="col-span-12 lg:col-span-4 glass-card rounded-xl p-4">
          <SectionHeader title={`Events ${warningEvents > 0 ? `(${warningEvents} warnings)` : ""}`} />
          <EventsFeed events={data.events} />
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* ROW 4: Unhealthy Resources (only if problems exist)                */}
      {/* ------------------------------------------------------------------ */}
      {(() => {
        const unhealthyDeploys = data.deployments.filter((d) => d.ready_replicas !== d.replicas);
        const failedPods = data.pods.filter((p) => p.status === "Failed" || p.status === "CrashLoopBackOff" || p.status === "Error");
        const pendingPods = data.pods.filter((p) => p.status === "Pending");
        const highRestartPods = data.pods.filter((p) => (p.containers || []).some((c) => c.restarts > 5));

        const problems = [...unhealthyDeploys.map((d) => ({
          kind: "Deployment", name: d.name, ns: d.namespace,
          detail: `${d.ready_replicas ?? 0}/${d.replicas} ready`,
          severity: "warn" as const,
          link: `/workloads/deployments/${d.namespace}/${d.name}`,
        })), ...failedPods.map((p) => ({
          kind: "Pod", name: p.name, ns: p.namespace,
          detail: p.status,
          severity: "danger" as const,
          link: `/workloads/pods/${p.namespace}/${p.name}`,
        })), ...pendingPods.map((p) => ({
          kind: "Pod", name: p.name, ns: p.namespace,
          detail: `Pending (${age(p.created_at)})`,
          severity: "warn" as const,
          link: `/workloads/pods/${p.namespace}/${p.name}`,
        })), ...highRestartPods.filter((p) => !failedPods.includes(p) && !pendingPods.includes(p)).map((p) => ({
          kind: "Pod", name: p.name, ns: p.namespace,
          detail: `${(p.containers || []).reduce((s, c) => s + c.restarts, 0)} restarts`,
          severity: "warn" as const,
          link: `/workloads/pods/${p.namespace}/${p.name}`,
        }))];

        if (problems.length === 0) return null;

        return (
          <div className="glass-card rounded-xl p-4 border-th-warn/20">
            <SectionHeader title={`Attention Required (${problems.length})`} />
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
              {problems.slice(0, 12).map((p, i) => (
                <Link key={i} to={p.link} className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-th-hover transition-colors group">
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${p.severity === "danger" ? "bg-th-danger animate-pulse" : "bg-th-warn"}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] text-th-ghost uppercase">{p.kind}</span>
                      <span className="text-xs font-medium text-th-body group-hover:text-th-accent truncate">{p.name}</span>
                    </div>
                    <p className={`text-[10px] ${p.severity === "danger" ? "text-th-danger" : "text-th-warn"}`}>{p.detail}</p>
                  </div>
                  <span className="text-[10px] text-th-ghost">{p.ns}</span>
                </Link>
              ))}
            </div>
            {problems.length > 12 && (
              <p className="text-xs text-th-dim text-center mt-2">+{problems.length - 12} more issues</p>
            )}
          </div>
        );
      })()}

      {/* Top Resource Consumers */}
      {data.podMetrics.length > 0 && (() => {
        const parseCPU = (s: string): number => {
          if (!s) return 0;
          if (s.endsWith("n")) return parseInt(s) / 1e6;
          if (s.endsWith("u")) return parseInt(s) / 1000;
          if (s.endsWith("m")) return parseInt(s);
          return parseFloat(s) * 1000;
        };
        const parseMem = (s: string): number => {
          if (!s) return 0;
          if (s.endsWith("Ki")) return parseInt(s) / 1024;
          if (s.endsWith("Mi")) return parseInt(s);
          if (s.endsWith("Gi")) return parseInt(s) * 1024;
          return parseFloat(s) / (1024 * 1024);
        };

        const podCPU = data.podMetrics.map((pm) => ({
          name: pm.name,
          namespace: pm.namespace,
          cpu: pm.containers.reduce((s, c) => s + parseCPU(c.cpu_usage), 0),
          mem: pm.containers.reduce((s, c) => s + parseMem(c.memory_usage), 0),
        }));

        const topCPU = [...podCPU].sort((a, b) => b.cpu - a.cpu).slice(0, 5);
        const topMem = [...podCPU].sort((a, b) => b.mem - a.mem).slice(0, 5);

        return (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="glass-card rounded-xl p-4">
              <h3 className="text-xs font-bold text-th-dim uppercase tracking-wider mb-3">Top CPU Consumers</h3>
              <div className="space-y-2">
                {topCPU.map((p, i) => (
                  <Link key={i} to={`/workloads/pods/${p.namespace}/${p.name}`} className="flex items-center gap-3 px-2 py-1.5 rounded-lg hover:bg-th-hover transition-colors">
                    <span className="text-xs font-bold text-th-accent w-4">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-th-body truncate">{p.name}</p>
                      <p className="text-[10px] text-th-ghost">{p.namespace}</p>
                    </div>
                    <span className="text-xs font-mono text-th-warn">{p.cpu.toFixed(0)}m</span>
                  </Link>
                ))}
                {topCPU.length === 0 && <p className="text-xs text-th-ghost text-center py-4">No metrics available</p>}
              </div>
            </div>
            <div className="glass-card rounded-xl p-4">
              <h3 className="text-xs font-bold text-th-dim uppercase tracking-wider mb-3">Top Memory Consumers</h3>
              <div className="space-y-2">
                {topMem.map((p, i) => (
                  <Link key={i} to={`/workloads/pods/${p.namespace}/${p.name}`} className="flex items-center gap-3 px-2 py-1.5 rounded-lg hover:bg-th-hover transition-colors">
                    <span className="text-xs font-bold text-th-accent w-4">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-th-body truncate">{p.name}</p>
                      <p className="text-[10px] text-th-ghost">{p.namespace}</p>
                    </div>
                    <span className="text-xs font-mono text-th-info">{p.mem.toFixed(0)} Mi</span>
                  </Link>
                ))}
                {topMem.length === 0 && <p className="text-xs text-th-ghost text-center py-4">No metrics available</p>}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
