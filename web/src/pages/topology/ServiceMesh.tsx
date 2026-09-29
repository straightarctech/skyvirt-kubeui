import { useMemo, useState } from "react";
import { TableSkeleton } from "@/components/Skeleton";
import { useOutletContext, useNavigate } from "react-router-dom";
import { STATUS, statusSoft, type StatusKind } from "@/lib/status";
import { StatStrip } from "@/components/ResourceSummary";
import { listServices, listEndpoints, listIngresses } from "@/api/client";
import type { ServiceSummary, EndpointSummary, IngressSummary } from "@/api/client";
import { useResource } from "@/hooks/useResource";

// Layout geometry for the deterministic three-lane request-path graph.
const ROW = 48;
const TOP = 24;
const ING_X = 24, ING_W = 190;
const SVC_X = 300, SVC_W = 250;
const BE_X = 620, BE_W = 150;
const WIDTH = BE_X + BE_W + 24;

interface SvcNode {
  key: string;
  ns: string;
  name: string;
  type: string;
  kind: StatusKind;
  ready: number;
  total: number;
  ports: string;
  y: number;
  exposed: boolean;
}

function backendHealth(svc: ServiceSummary, ep?: EndpointSummary): { kind: StatusKind; ready: number; total: number } {
  const ready = ep?.ready ?? 0;
  const notReady = ep?.not_ready ?? 0;
  const total = ready + notReady;
  const hasSelector = Object.keys(svc.selector || {}).length > 0;
  if (!hasSelector) return { kind: "unknown", ready, total };
  if (ready === 0) return { kind: "error", ready, total };
  if (notReady > 0) return { kind: "warn", ready, total };
  return { kind: "ok", ready, total };
}

// Smooth left→right connector.
function link(x1: number, y1: number, x2: number, y2: number): string {
  const mx = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
}

export default function ServiceMesh() {
  const { namespace } = useOutletContext<{ namespace: string }>();
  const nav = useNavigate();
  const { data: svcs, loading: l1, refresh } = useResource<ServiceSummary[]>(() => listServices(namespace), [namespace]);
  const { data: endpoints, loading: l2 } = useResource<EndpointSummary[]>(() => listEndpoints(namespace), [namespace]);
  const { data: ingresses, loading: l3 } = useResource<IngressSummary[]>(() => listIngresses(namespace), [namespace]);
  const loading = l1 || l2 || l3;
  const [query, setQuery] = useState("");

  const model = useMemo(() => {
    const epMap = new Map((endpoints ?? []).map((e) => [`${e.namespace}/${e.name}`, e]));
    // service key -> ingress hosts routing to it
    const routes = new Map<string, Set<string>>();
    (ingresses ?? []).forEach((ing) => {
      ing.rules?.forEach((r) => {
        const host = r.host || "*";
        r.paths?.forEach((p) => {
          if (!p.service_name) return;
          const k = `${ing.namespace}/${p.service_name}`;
          (routes.get(k) ?? routes.set(k, new Set()).get(k)!).add(host);
        });
      });
    });

    const q = query.trim().toLowerCase();
    const all = (svcs ?? []).filter((s) => s.type !== "ExternalName");
    // Exposed services (the actual traffic entry points) lead, so the ingress
    // lane is visible up top; then worst-health first, then namespace/name.
    const rank: Record<StatusKind, number> = { error: 0, warn: 1, unknown: 2, ok: 3, info: 4 };
    const nodes: SvcNode[] = all
      .map((s) => {
        const h = backendHealth(s, epMap.get(`${s.namespace}/${s.name}`));
        return {
          key: `${s.namespace}/${s.name}`, ns: s.namespace, name: s.name, type: s.type,
          kind: h.kind, ready: h.ready, total: h.total,
          ports: (s.ports || []).map((p) => `${p.port}/${p.protocol}`).join(", "),
          y: 0,
          exposed: routes.has(`${s.namespace}/${s.name}`) || s.type === "LoadBalancer" || s.type === "NodePort",
        };
      })
      .sort((a, b) =>
        (Number(b.exposed) - Number(a.exposed)) ||
        (rank[a.kind] - rank[b.kind]) ||
        a.ns.localeCompare(b.ns) || a.name.localeCompare(b.name));

    nodes.forEach((n, i) => { n.y = TOP + i * ROW + ROW / 2; });
    const byKey = new Map(nodes.map((n) => [n.key, n]));

    // Ingress host lane: each host positioned at the mean y of its target services.
    const hostTargets = new Map<string, SvcNode[]>();
    routes.forEach((hosts, svcKey) => {
      const n = byKey.get(svcKey);
      if (!n) return;
      hosts.forEach((h) => (hostTargets.get(h) ?? hostTargets.set(h, []).get(h)!).push(n));
    });
    const hosts = [...hostTargets.entries()].map(([host, targets]) => ({
      host, targets, y: targets.reduce((a, t) => a + t.y, 0) / targets.length,
    }));

    const degraded = nodes.filter((n) => n.kind === "error" || n.kind === "warn").length;
    const exposed = nodes.filter((n) => n.exposed).length;
    const healthy = nodes.filter((n) => n.kind === "ok").length;
    const height = TOP * 2 + nodes.length * ROW;

    return { nodes, hosts, height, stats: { services: nodes.length, exposed, healthy, degraded }, q };
  }, [svcs, endpoints, ingresses, query]);

  const { nodes, hosts, height, stats, q } = model;
  const hasIngress = hosts.length > 0;
  const svcX = hasIngress ? SVC_X : ING_X;
  const svcMatch = (n: SvcNode) => q === "" || n.name.toLowerCase().includes(q) || n.ns.toLowerCase().includes(q);

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-th-heading">Service Traffic Map</h1>
        <div className="flex items-center gap-2">
          <input
            type="text" value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Highlight service or namespace…"
            className="px-3 py-1.5 text-sm bg-th-subtle border border-th-line rounded-lg text-th-body placeholder:text-th-ghost focus:outline-none focus:ring-1 focus:ring-th-accent"
          />
          <button onClick={refresh} className="px-3 py-1.5 text-sm bg-th-accent text-white rounded-lg hover:opacity-90 transition-opacity">Refresh</button>
        </div>
      </div>

      <p className="text-xs text-th-dim">
        The request path from ingress to services to their backing endpoints, colored by backend health.
        {" "}<span className="text-th-ok">healthy</span> · <span className="text-th-warn">degraded</span> · <span className="text-th-danger">no endpoints</span> · <span className="text-th-dim">no selector</span>.
      </p>

      {loading && <TableSkeleton />}

      {!loading && (
        <>
          <StatStrip stats={[
            { label: "Services", value: stats.services, tone: "accent" },
            { label: "Exposed", value: stats.exposed, tone: "info" },
            { label: "Healthy", value: stats.healthy, tone: "ok" },
            { label: "Degraded", value: stats.degraded, tone: stats.degraded ? "error" : "neutral" },
          ]} />

          <div className="bg-th-panel border border-th-line rounded-xl shadow-card overflow-auto" style={{ maxHeight: "calc(100vh - 320px)" }}>
            {nodes.length === 0 ? (
              <p className="p-10 text-center text-sm text-th-dim">No services in scope.</p>
            ) : (
              <svg width={WIDTH} height={height} className="block min-w-full">
                {/* column captions */}
                <text x={hasIngress ? ING_X : svcX} y={16} className="fill-th-ghost" fontSize={10} fontWeight={700} style={{ textTransform: "uppercase", letterSpacing: "0.05em" }}>{hasIngress ? "Ingress" : "Service"}</text>
                {hasIngress && <text x={svcX} y={16} className="fill-th-ghost" fontSize={10} fontWeight={700}>SERVICE</text>}
                <text x={BE_X} y={16} className="fill-th-ghost" fontSize={10} fontWeight={700}>BACKENDS</text>

                {/* edges: ingress -> service */}
                {hasIngress && hosts.flatMap((h) =>
                  h.targets.map((t) => {
                    const lit = svcMatch(t) || (q !== "" && h.host.toLowerCase().includes(q));
                    return <path key={`e-${h.host}-${t.key}`} d={link(ING_X + ING_W, h.y, svcX, t.y)} fill="none"
                      stroke={STATUS[t.kind].fill} strokeWidth={1.5} opacity={q === "" ? 0.35 : lit ? 0.7 : 0.06} />;
                  }))}

                {/* edges: service -> backends */}
                {nodes.map((n) => {
                  const lit = svcMatch(n);
                  return <path key={`b-${n.key}`} d={link(svcX + SVC_W, n.y, BE_X, n.y)} fill="none"
                    stroke={STATUS[n.kind].fill} strokeWidth={n.total > 0 ? 2 : 1} strokeDasharray={n.kind === "ok" ? undefined : "5 3"}
                    opacity={q === "" ? 0.5 : lit ? 0.85 : 0.06} />;
                })}

                {/* ingress host nodes */}
                {hasIngress && hosts.map((h) => {
                  const lit = q === "" || h.host.toLowerCase().includes(q) || h.targets.some(svcMatch);
                  return (
                    <g key={`h-${h.host}`} opacity={lit ? 1 : 0.2} style={{ cursor: "pointer" }} onClick={() => nav("/networking/ingress")}>
                      <rect x={ING_X} y={h.y - 14} width={ING_W} height={28} rx={8} fill="var(--th-subtle)" stroke="var(--th-line)" />
                      <text x={ING_X + 10} y={h.y + 4} className="fill-th-body" fontSize={12} fontWeight={500}>🌐 {h.host.length > 22 ? h.host.slice(0, 22) + "…" : h.host}</text>
                    </g>
                  );
                })}

                {/* service nodes */}
                {nodes.map((n) => {
                  const lit = svcMatch(n);
                  return (
                    <g key={n.key} opacity={lit ? 1 : 0.2} style={{ cursor: "pointer" }} onClick={() => nav(`/networking/services/${n.ns}/${n.name}`)}>
                      <rect x={svcX} y={n.y - 16} width={SVC_W} height={32} rx={8}
                        fill={statusSoft(n.kind, 0.14)} stroke={STATUS[n.kind].fill} strokeWidth={1.5} />
                      <circle cx={svcX + 14} cy={n.y} r={4} fill={STATUS[n.kind].fill} />
                      <text x={svcX + 26} y={n.y - 1} className="fill-th-heading" fontSize={12} fontWeight={600}>{n.name.length > (n.exposed ? 20 : 27) ? n.name.slice(0, n.exposed ? 20 : 27) + "…" : n.name}</text>
                      <text x={svcX + 26} y={n.y + 11} fontSize={9} fill="var(--th-dim)">{n.ns} · {n.type}{n.ports ? " · " + n.ports.split(",")[0] : ""}</text>
                      {n.exposed && <text x={svcX + SVC_W - 8} y={n.y + 3} textAnchor="end" fontSize={9} fill="var(--th-info)">exposed</text>}
                      <title>{`${n.ns}/${n.name}\n${n.type} · ${n.ready}/${n.total} endpoints ready`}</title>
                    </g>
                  );
                })}

                {/* backend nodes (endpoint health) */}
                {nodes.map((n) => {
                  const lit = svcMatch(n);
                  const label = n.kind === "unknown" ? "manual" : n.kind === "error" ? "no endpoints" : `${n.ready}/${n.total} ready`;
                  return (
                    <g key={`be-${n.key}`} opacity={lit ? 1 : 0.2}>
                      <rect x={BE_X} y={n.y - 12} width={BE_W} height={24} rx={12} fill={statusSoft(n.kind, 0.16)} stroke={STATUS[n.kind].fill} strokeWidth={1.2} />
                      <text x={BE_X + BE_W / 2} y={n.y + 4} textAnchor="middle" fontSize={11} fontWeight={600} fill={STATUS[n.kind].ring}>{label}</text>
                    </g>
                  );
                })}
              </svg>
            )}
          </div>
        </>
      )}
    </div>
  );
}
