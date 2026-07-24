import { useMemo } from "react";
import { Link } from "react-router-dom";
import { vulnStatus, listVulnReports, listWorkloadAudit, listImageAudit, type VulnReport, type WorkloadRisk, type ImageAuditReport } from "@/api/client";
import { useResource } from "@/hooks/useResource";
import { TableSkeleton } from "@/components/Skeleton";
import { EmptyState } from "@/components/EmptyState";
import { StatStrip } from "@/components/ResourceSummary";

function Count({ n, cls }: { n: number; cls: string }) {
  return <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${n > 0 ? cls : "bg-th-subtle text-th-ghost"}`}>{n}</span>;
}

const sevChip: Record<string, string> = {
  critical: "bg-th-danger-s text-th-danger",
  high: "bg-th-warn-s text-th-warn",
  medium: "bg-th-info-s text-th-info",
  low: "bg-th-subtle text-th-dim",
};

// WorkloadHardening lists insecure workload settings — no scanner needed, so it
// always renders (unlike the Trivy image-CVE section).
function WorkloadHardening() {
  const audit = useResource<WorkloadRisk[]>(() => listWorkloadAudit(), []);
  const rows = audit.data ?? [];
  return (
    <div className="space-y-2">
      <div>
        <h2 className="text-sm font-semibold text-th-heading">Workload hardening</h2>
        <p className="mt-0.5 text-xs text-th-dim">Insecure pod settings — privileged, host namespaces, hostPath mounts, root execution, added capabilities. Worst first. No scanner required.</p>
      </div>
      {audit.loading ? (
        <TableSkeleton rows={4} />
      ) : rows.length === 0 ? (
        <div className="rounded-lg bg-th-ok-s px-3 py-2 text-sm text-th-ok">✓ No workloads with insecure settings.</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-th-line bg-th-panel shadow-card">
          <table className="w-full text-sm">
            <thead className="bg-th-subtle text-left text-xs text-th-ghost">
              <tr><th className="px-4 py-2">Severity</th><th className="px-4 py-2">Workload</th><th className="px-4 py-2">Namespace</th><th className="px-4 py-2">Findings</th></tr>
            </thead>
            <tbody className="divide-y divide-th-line">
              {rows.map((w, i) => (
                <tr key={i} className="hover:bg-th-hover align-top">
                  <td className="px-4 py-2"><span className={`rounded px-1.5 py-0.5 text-xs font-semibold uppercase ${sevChip[w.severity]}`}>{w.severity}</span></td>
                  <td className="px-4 py-2"><div className="font-medium text-th-body">{w.name}</div><div className="text-[11px] text-th-ghost">{w.kind}</div></td>
                  <td className="px-4 py-2 text-th-dim">{w.namespace}</td>
                  <td className="px-4 py-2">
                    {Array.from(new Set(w.findings.map((f) => f.check))).map((c, j) => {
                      const sev = w.findings.find((f) => f.check === c)!.severity;
                      return <span key={j} className={`mr-1 mb-1 inline-block rounded px-1.5 py-0.5 text-xs ${sevChip[sev]}`} title={w.findings.filter((f) => f.check === c).map((f) => f.detail).join("\n")}>{c}</span>;
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ImageProvenance summarises registries in use and flags mutable (:latest /
// untagged) image references — a supply-chain / reproducibility concern. No
// scanner needed.
function ImageProvenance() {
  const audit = useResource<ImageAuditReport>(() => listImageAudit(), []);
  const data = audit.data;
  const mutable = (data?.images ?? []).filter((i) => i.mutable);
  const registries = Object.entries(data?.registries ?? {}).sort((a, b) => b[1] - a[1]);
  return (
    <div className="space-y-2">
      <div>
        <h2 className="text-sm font-semibold text-th-heading">Image provenance</h2>
        <p className="mt-0.5 text-xs text-th-dim">Registries in use, and images pinned to a mutable <span className="font-mono">:latest</span> (or untagged) reference — those can't be reproduced or rolled back reliably. No scanner required.</p>
      </div>
      {audit.loading ? (
        <TableSkeleton rows={3} />
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <span className="rounded-lg border border-th-line bg-th-subtle px-2 py-1 text-xs text-th-body">{data?.total ?? 0} images</span>
            <span className={`rounded-lg border border-th-line px-2 py-1 text-xs ${(data?.mutable ?? 0) > 0 ? "bg-th-warn-s text-th-warn" : "bg-th-ok-s text-th-ok"}`}>{data?.mutable ?? 0} mutable</span>
            {registries.map(([reg, n]) => (
              <span key={reg} className="rounded-lg border border-th-line bg-th-subtle px-2 py-1 text-xs text-th-dim"><span className="font-mono text-th-body">{reg}</span> · {n}</span>
            ))}
          </div>
          {mutable.length === 0 ? (
            <div className="rounded-lg bg-th-ok-s px-3 py-2 text-sm text-th-ok">✓ No mutable image references.</div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-th-line bg-th-panel shadow-card">
              <table className="w-full text-sm">
                <thead className="bg-th-subtle text-left text-xs text-th-ghost">
                  <tr><th className="px-4 py-2">Image</th><th className="px-4 py-2">Registry</th><th className="px-4 py-2">Tag</th><th className="px-4 py-2">Used by</th></tr>
                </thead>
                <tbody className="divide-y divide-th-line">
                  {mutable.map((i, idx) => (
                    <tr key={idx} className="hover:bg-th-hover">
                      <td className="px-4 py-2 font-mono text-xs text-th-body">{i.repository}<span className="text-th-warn">:{i.tag || "latest"}</span></td>
                      <td className="px-4 py-2 font-mono text-xs text-th-dim">{i.registry}</td>
                      <td className="px-4 py-2"><span className="rounded bg-th-warn-s px-1.5 py-0.5 text-xs text-th-warn">mutable</span></td>
                      <td className="px-4 py-2 text-xs text-th-dim" title={i.workloads.join("\n")}>{i.workloads.length} workload{i.workloads.length === 1 ? "" : "s"}</td>
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

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-th-heading">Workload Security</h1>
        <p className="mt-0.5 text-sm text-th-dim">Hardening posture and image CVEs across your workloads — worst first.</p>
      </div>

      <WorkloadHardening />

      <ImageProvenance />

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-th-heading">Image vulnerabilities</h2>
          {status.data?.installed && <button onClick={reports.refresh} className="rounded-lg border border-th-line bg-th-subtle px-3 py-1.5 text-sm text-th-body hover:bg-th-hover">Refresh</button>}
        </div>

        {status.loading ? (
          <TableSkeleton rows={4} />
        ) : !status.data?.installed ? (
          <div className="rounded-xl border border-th-line bg-th-panel p-1 shadow-card">
            <EmptyState
              title="Image scanning (Trivy Operator) is not installed"
              hint="Install Trivy Operator to continuously scan your workload images for CVEs — with an offline vuln DB for air-gapped clusters. It installs in one step from the App Catalog."
              action={<Link to="/operations/catalog" className="rounded-lg bg-th-accent px-3 py-1.5 text-sm text-white hover:opacity-90">Install from App Catalog</Link>}
            />
          </div>
        ) : (
        <>
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
        </>
        )}
      </div>
    </div>
  );
}
