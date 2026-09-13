import { getRightsize, type WorkloadUsage } from "@/api/client";
import { useResource } from "@/hooks/useResource";
import { TableSkeleton } from "@/components/Skeleton";
import { EmptyState } from "@/components/EmptyState";
import { StatStrip } from "@/components/ResourceSummary";

const sevChip: Record<string, string> = {
  high: "bg-th-danger-s text-th-danger",
  medium: "bg-th-warn-s text-th-warn",
  low: "bg-th-subtle text-th-dim",
};

// pctCell colours a usage/request ratio: over 100% is a risk, under 20% is waste.
function pctCell(pct: number) {
  if (pct < 0) return <span className="text-th-ghost">—</span>;
  const cls = pct > 100 ? "text-th-danger" : pct < 20 ? "text-th-warn" : "text-th-body";
  return <span className={cls}>{pct}%</span>;
}

export default function Rightsizing() {
  const rs = useResource(() => getRightsize(), []);
  const data = rs.data;
  const rows = data?.workloads ?? [];

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-th-heading">Rightsizing</h1>
          <p className="mt-0.5 text-sm text-th-dim">Live usage vs requested resources, per workload. Over-provisioned wastes capacity; usage over the request risks throttling or OOM; no request means no scheduling guarantee. Usage is a point-in-time sample — a pointer, not a precise recommendation.</p>
        </div>
        <button onClick={rs.refresh} className="rounded-lg border border-th-line bg-th-subtle px-3 py-1.5 text-sm text-th-body hover:bg-th-hover">Refresh</button>
      </div>

      {rs.loading ? (
        <TableSkeleton rows={6} />
      ) : rs.error ? (
        <div className="rounded-xl border border-th-line bg-th-panel p-1 shadow-card">
          <EmptyState title="Metrics are not available" hint="Rightsizing needs metrics-server to read live usage. Install it (App Catalog → Essentials) and this fills in within a minute." />
        </div>
      ) : (
        <>
          <StatStrip
            stats={[
              { label: "Analyzed", value: data?.analyzed ?? 0, tone: "accent" },
              { label: "No requests", value: data?.no_requests ?? 0, tone: (data?.no_requests ?? 0) > 0 ? "warn" : "ok" },
              { label: "Over request (risk)", value: data?.under_provisioned ?? 0, tone: (data?.under_provisioned ?? 0) > 0 ? "error" : "ok" },
              { label: "Over-provisioned", value: data?.over_provisioned ?? 0, tone: (data?.over_provisioned ?? 0) > 0 ? "warn" : "ok" },
            ]}
          />

          {rows.length === 0 ? (
            <div className="rounded-lg bg-th-ok-s px-3 py-2 text-sm text-th-ok">✓ No rightsizing concerns — requests track usage.</div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-th-line bg-th-panel shadow-card">
              <table className="w-full text-sm">
                <thead className="bg-th-subtle text-left text-xs text-th-ghost">
                  <tr>
                    <th className="px-4 py-2">Severity</th>
                    <th className="px-4 py-2">Workload</th>
                    <th className="px-4 py-2">CPU (used / req)</th>
                    <th className="px-4 py-2 text-center">%</th>
                    <th className="px-4 py-2">Memory (used / req)</th>
                    <th className="px-4 py-2 text-center">%</th>
                    <th className="px-4 py-2">Findings</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-th-line">
                  {rows.map((w: WorkloadUsage, i: number) => (
                    <tr key={i} className="hover:bg-th-hover">
                      <td className="px-4 py-2"><span className={`rounded px-1.5 py-0.5 text-xs font-semibold uppercase ${sevChip[w.severity]}`}>{w.severity}</span></td>
                      <td className="px-4 py-2"><span className="font-medium text-th-body">{w.name}</span> <span className="text-[11px] text-th-ghost">{w.kind} · {w.namespace}</span></td>
                      <td className="px-4 py-2 font-mono text-xs text-th-dim">{w.cpu_usage} / {w.cpu_request}</td>
                      <td className="px-4 py-2 text-center font-mono text-xs">{pctCell(w.cpu_pct)}</td>
                      <td className="px-4 py-2 font-mono text-xs text-th-dim">{w.mem_usage} / {w.mem_request}</td>
                      <td className="px-4 py-2 text-center font-mono text-xs">{pctCell(w.mem_pct)}</td>
                      <td className="px-4 py-2 text-xs text-th-dim">{w.flags.join("; ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
