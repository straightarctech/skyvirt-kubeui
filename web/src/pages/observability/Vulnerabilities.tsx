import { useMemo } from "react";
import { Link } from "react-router-dom";
import { vulnStatus, listVulnReports, type VulnReport } from "@/api/client";
import { useResource } from "@/hooks/useResource";
import { TableSkeleton } from "@/components/Skeleton";
import { EmptyState } from "@/components/EmptyState";
import { StatStrip } from "@/components/ResourceSummary";

function Count({ n, cls }: { n: number; cls: string }) {
  return <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${n > 0 ? cls : "bg-th-subtle text-th-ghost"}`}>{n}</span>;
}

export default function Vulnerabilities() {
  const status = useResource(() => vulnStatus(), []);
  const reports = useResource<VulnReport[]>(() => listVulnReports(), []);

  const sorted = useMemo(
    () => [...(reports.data ?? [])].sort((a, b) => b.critical - a.critical || b.high - a.high || b.medium - a.medium),
    [reports.data],
  );
  const totals = useMemo(() => {
    return (reports.data ?? []).reduce(
      (acc, r) => ({ critical: acc.critical + r.critical, high: acc.high + r.high, medium: acc.medium + r.medium, low: acc.low + r.low }),
      { critical: 0, high: 0, medium: 0, low: 0 },
    );
  }, [reports.data]);

  if (status.loading) return <div className="p-2"><TableSkeleton rows={5} /></div>;

  if (!status.data?.installed) {
    return (
      <div className="space-y-4 animate-fade-in">
        <h1 className="text-2xl font-bold text-th-heading">Image Vulnerabilities</h1>
        <div className="rounded-xl border border-th-line bg-th-panel p-1 shadow-card">
          <EmptyState
            title="Image scanning (Trivy Operator) is not installed"
            hint="Install Trivy Operator to continuously scan your workload images for CVEs — with an offline vuln DB for air-gapped clusters. It installs in one step from the App Catalog."
            action={<Link to="/operations/catalog" className="rounded-lg bg-th-accent px-3 py-1.5 text-sm text-white hover:opacity-90">Install from App Catalog</Link>}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-th-heading">Image Vulnerabilities</h1>
          <p className="mt-0.5 text-sm text-th-dim">CVEs across your workload images, from continuous Trivy scanning — worst first.</p>
        </div>
        <button onClick={reports.refresh} className="rounded-lg border border-th-line bg-th-subtle px-3 py-1.5 text-sm text-th-body hover:bg-th-hover">Refresh</button>
      </div>

      {!reports.loading && (reports.data?.length ?? 0) > 0 && (
        <StatStrip
          stats={[
            { label: "Critical", value: totals.critical, tone: totals.critical > 0 ? "error" : "ok" },
            { label: "High", value: totals.high, tone: totals.high > 0 ? "warn" : "ok" },
            { label: "Medium", value: totals.medium, tone: "neutral" },
            { label: "Images", value: reports.data?.length ?? 0, tone: "accent" },
          ]}
        />
      )}

      {reports.loading ? (
        <TableSkeleton rows={6} />
      ) : sorted.length === 0 ? (
        <EmptyState title="No vulnerability reports yet" hint="Trivy Operator is installed but hasn't produced reports yet — give it a minute after workloads start." />
      ) : (
        <div className="overflow-hidden rounded-xl border border-th-line bg-th-panel shadow-card">
          <table className="w-full text-sm">
            <thead className="bg-th-subtle text-left text-xs text-th-ghost">
              <tr>
                <th className="px-4 py-2">Image</th>
                <th className="px-4 py-2">Workload</th>
                <th className="px-4 py-2">Namespace</th>
                <th className="px-4 py-2 text-center">Crit</th>
                <th className="px-4 py-2 text-center">High</th>
                <th className="px-4 py-2 text-center">Med</th>
                <th className="px-4 py-2 text-center">Low</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-th-line">
              {sorted.map((r, i) => (
                <tr key={i} className="hover:bg-th-hover">
                  <td className="px-4 py-2 font-mono text-xs text-th-body">{r.image}</td>
                  <td className="px-4 py-2 text-xs text-th-dim">{r.workload}</td>
                  <td className="px-4 py-2 text-th-dim">{r.namespace}</td>
                  <td className="px-4 py-2 text-center"><Count n={r.critical} cls="bg-th-danger-s text-th-danger" /></td>
                  <td className="px-4 py-2 text-center"><Count n={r.high} cls="bg-th-warn-s text-th-warn" /></td>
                  <td className="px-4 py-2 text-center"><Count n={r.medium} cls="bg-th-info-s text-th-info" /></td>
                  <td className="px-4 py-2 text-center"><Count n={r.low} cls="bg-th-subtle text-th-dim" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
