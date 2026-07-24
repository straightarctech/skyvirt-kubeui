import { getClusterHealth, getOrphans, type HealthIssue, type OrphanReport } from "@/api/client";
import { useResource } from "@/hooks/useResource";
import { TableSkeleton } from "@/components/Skeleton";
import { StatStrip } from "@/components/ResourceSummary";

const sevChip: Record<string, string> = {
  critical: "bg-th-danger-s text-th-danger",
  high: "bg-th-warn-s text-th-warn",
  medium: "bg-th-info-s text-th-info",
  low: "bg-th-subtle text-th-dim",
};

// Orphans lists broken/unused resources — dead services and unused PVCs — a
// review list to clean up, distinct from the "broken right now" triage above.
function Orphans() {
  const orph = useResource<OrphanReport>(() => getOrphans(), []);
  const data = orph.data;
  const items = data?.items ?? [];
  return (
    <div className="space-y-2">
      <div>
        <h2 className="text-sm font-semibold text-th-heading">Orphaned &amp; unused</h2>
        <p className="mt-0.5 text-xs text-th-dim">Services whose selector matches no running pods (traffic blackholes) and bound PVCs no pod mounts (wasted storage). A review list, not auto-deleted.</p>
      </div>
      {orph.loading ? (
        <TableSkeleton rows={3} />
      ) : (
        <>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className={`rounded-lg border border-th-line px-2 py-1 ${(data?.dead_services ?? 0) > 0 ? "bg-th-warn-s text-th-warn" : "bg-th-ok-s text-th-ok"}`}>{data?.dead_services ?? 0} dead services</span>
            <span className={`rounded-lg border border-th-line px-2 py-1 ${(data?.unused_pvcs ?? 0) > 0 ? "bg-th-warn-s text-th-warn" : "bg-th-ok-s text-th-ok"}`}>{data?.unused_pvcs ?? 0} unused PVCs{data?.unused_storage ? ` · ${data.unused_storage}` : ""}</span>
          </div>
          {items.length === 0 ? (
            <div className="rounded-lg bg-th-ok-s px-3 py-2 text-sm text-th-ok">✓ No orphaned or unused resources.</div>
          ) : (
            <div className="max-h-72 overflow-y-auto rounded-xl border border-th-line bg-th-panel shadow-card">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-th-subtle text-left text-xs text-th-ghost">
                  <tr><th className="px-4 py-2">Category</th><th className="px-4 py-2">Resource</th><th className="px-4 py-2">Detail</th></tr>
                </thead>
                <tbody className="divide-y divide-th-line">
                  {items.map((i, idx) => (
                    <tr key={idx} className="hover:bg-th-hover">
                      <td className="px-4 py-2"><span className={`rounded px-1.5 py-0.5 text-xs ${sevChip[i.severity]}`}>{i.category}</span></td>
                      <td className="px-4 py-2"><span className="font-mono text-xs text-th-body">{i.namespace}/{i.name}</span></td>
                      <td className="px-4 py-2 text-xs text-th-dim">{i.detail}</td>
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

// resourceLabel renders "namespace/name" for namespaced issues, "name" otherwise.
function resourceLabel(i: HealthIssue): string {
  return i.namespace ? `${i.namespace}/${i.name}` : i.name;
}

export default function ClusterHealth() {
  const health = useResource(() => getClusterHealth(), []);
  const data = health.data;
  const issues = data?.issues ?? [];

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-th-heading">Cluster Health</h1>
          <p className="mt-0.5 text-sm text-th-dim">Everything broken or stuck right now — crash-looping and unschedulable workloads, unhealthy nodes, pending volumes, failed jobs. Worst first.</p>
        </div>
        <button onClick={health.refresh} className="rounded-lg border border-th-line bg-th-subtle px-3 py-1.5 text-sm text-th-body hover:bg-th-hover">Refresh</button>
      </div>

      {health.loading ? (
        <TableSkeleton rows={6} />
      ) : health.error ? (
        <div className="rounded-lg bg-th-danger-s p-3 text-sm text-th-danger">{health.error}</div>
      ) : (
        <>
          <StatStrip
            stats={[
              { label: "Critical", value: data?.counts?.critical ?? 0, tone: (data?.counts?.critical ?? 0) > 0 ? "error" : "ok" },
              { label: "High", value: data?.counts?.high ?? 0, tone: (data?.counts?.high ?? 0) > 0 ? "warn" : "ok" },
              { label: "Medium", value: data?.counts?.medium ?? 0, tone: "neutral" },
              { label: "Pods scanned", value: data?.scanned?.pods ?? 0, tone: "accent" },
            ]}
          />

          {issues.length === 0 ? (
            <div className="rounded-lg bg-th-ok-s px-3 py-2 text-sm text-th-ok">✓ Everything is healthy — no broken or stuck resources.</div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-th-line bg-th-panel shadow-card">
              <table className="w-full text-sm">
                <thead className="bg-th-subtle text-left text-xs text-th-ghost">
                  <tr>
                    <th className="px-4 py-2">Severity</th>
                    <th className="px-4 py-2">Reason</th>
                    <th className="px-4 py-2">Category</th>
                    <th className="px-4 py-2">Resource</th>
                    <th className="px-4 py-2">Detail</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-th-line">
                  {issues.map((i, idx) => (
                    <tr key={idx} className="hover:bg-th-hover">
                      <td className="px-4 py-2"><span className={`rounded px-1.5 py-0.5 text-xs font-semibold uppercase ${sevChip[i.severity]}`}>{i.severity}</span></td>
                      <td className="px-4 py-2 font-medium text-th-body">{i.reason}</td>
                      <td className="px-4 py-2 text-th-dim">{i.category}</td>
                      <td className="px-4 py-2"><span className="font-mono text-xs text-th-body">{resourceLabel(i)}</span> <span className="text-[11px] text-th-ghost">{i.kind}</span></td>
                      <td className="px-4 py-2 text-xs text-th-dim">{i.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <Orphans />
        </>
      )}
    </div>
  );
}
