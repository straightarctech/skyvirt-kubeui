import { getExposure, getNetpolCoverage, type ExposureItem, type NetworkPolicyCoverageReport } from "@/api/client";
import { useResource } from "@/hooks/useResource";
import { TableSkeleton } from "@/components/Skeleton";
import { StatStrip } from "@/components/ResourceSummary";

// InternalExposure lists workloads no ingress NetworkPolicy restricts — reachable
// from any pod in the cluster (lateral-movement surface).
function InternalExposure() {
  const cov = useResource<NetworkPolicyCoverageReport>(() => getNetpolCoverage(), []);
  const data = cov.data;
  const open = data?.unrestricted ?? [];
  return (
    <div className="space-y-2">
      <div>
        <h2 className="text-sm font-semibold text-th-heading">Internal exposure — ingress NetworkPolicy coverage</h2>
        <p className="mt-0.5 text-xs text-th-dim">Workloads that no NetworkPolicy restricts accept connections from <span className="text-th-body">any pod in the cluster</span> — the lateral-movement surface. Add a default-deny policy, then allow only required flows.</p>
      </div>
      {cov.loading ? (
        <TableSkeleton rows={3} />
      ) : (
        <>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className={`rounded-lg border border-th-line px-2 py-1 ${open.length > 0 ? "bg-th-warn-s text-th-warn" : "bg-th-ok-s text-th-ok"}`}>{open.length} unrestricted</span>
            <span className="rounded-lg border border-th-line bg-th-subtle px-2 py-1 text-th-dim">{data?.covered_workloads ?? 0} covered</span>
            <span className="rounded-lg border border-th-line bg-th-subtle px-2 py-1 text-th-dim">{data?.total_workloads ?? 0} total</span>
          </div>
          {open.length === 0 ? (
            <div className="rounded-lg bg-th-ok-s px-3 py-2 text-sm text-th-ok">✓ Every workload is covered by an ingress NetworkPolicy.</div>
          ) : (
            <div className="max-h-72 overflow-y-auto rounded-xl border border-th-line bg-th-panel shadow-card">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-th-subtle text-left text-xs text-th-ghost">
                  <tr><th className="px-4 py-2">Workload</th><th className="px-4 py-2">Kind</th><th className="px-4 py-2">Namespace</th></tr>
                </thead>
                <tbody className="divide-y divide-th-line">
                  {open.map((u, i) => (
                    <tr key={i} className="hover:bg-th-hover">
                      <td className="px-4 py-2 font-medium text-th-body">{u.name}</td>
                      <td className="px-4 py-2 text-th-dim">{u.kind}</td>
                      <td className="px-4 py-2 text-th-dim">{u.namespace}</td>
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

const sevChip: Record<string, string> = {
  high: "bg-th-danger-s text-th-danger",
  medium: "bg-th-warn-s text-th-warn",
  low: "bg-th-subtle text-th-dim",
};

const typeChip: Record<string, string> = {
  LoadBalancer: "bg-th-danger-s text-th-danger",
  NodePort: "bg-th-warn-s text-th-warn",
  Ingress: "bg-th-info-s text-th-info",
};

export default function Exposure() {
  const exp = useResource(() => getExposure(), []);
  const data = exp.data;
  const items = data?.items ?? [];

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-th-heading">External Exposure</h1>
          <p className="mt-0.5 text-sm text-th-dim">Everything reachable from outside the cluster — LoadBalancer and NodePort services, and Ingress routes. Plaintext ingresses are flagged. Your attack surface, one view.</p>
        </div>
        <button onClick={exp.refresh} className="rounded-lg border border-th-line bg-th-subtle px-3 py-1.5 text-sm text-th-body hover:bg-th-hover">Refresh</button>
      </div>

      {exp.loading ? (
        <TableSkeleton rows={6} />
      ) : exp.error ? (
        <div className="rounded-lg bg-th-danger-s p-3 text-sm text-th-danger">{exp.error}</div>
      ) : (
        <>
          <StatStrip
            stats={[
              { label: "Load Balancers", value: data?.load_balancers ?? 0, tone: (data?.load_balancers ?? 0) > 0 ? "warn" : "ok" },
              { label: "NodePorts", value: data?.node_ports ?? 0, tone: (data?.node_ports ?? 0) > 0 ? "warn" : "ok" },
              { label: "Ingresses", value: data?.ingresses ?? 0, tone: "accent" },
              { label: "Plaintext Ingresses", value: data?.plaintext_ingresses ?? 0, tone: (data?.plaintext_ingresses ?? 0) > 0 ? "error" : "ok" },
            ]}
          />

          {items.length === 0 ? (
            <div className="rounded-lg bg-th-ok-s px-3 py-2 text-sm text-th-ok">✓ Nothing is exposed outside the cluster.</div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-th-line bg-th-panel shadow-card">
              <table className="w-full text-sm">
                <thead className="bg-th-subtle text-left text-xs text-th-ghost">
                  <tr>
                    <th className="px-4 py-2">Severity</th>
                    <th className="px-4 py-2">Type</th>
                    <th className="px-4 py-2">Resource</th>
                    <th className="px-4 py-2">Address</th>
                    <th className="px-4 py-2">Ports</th>
                    <th className="px-4 py-2">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-th-line">
                  {items.map((i: ExposureItem, idx: number) => (
                    <tr key={idx} className="hover:bg-th-hover">
                      <td className="px-4 py-2"><span className={`rounded px-1.5 py-0.5 text-xs font-semibold uppercase ${sevChip[i.severity]}`}>{i.severity}</span></td>
                      <td className="px-4 py-2"><span className={`rounded px-1.5 py-0.5 text-xs ${typeChip[i.type] ?? "bg-th-subtle text-th-dim"}`}>{i.type}</span></td>
                      <td className="px-4 py-2"><span className="font-mono text-xs text-th-body">{i.namespace}/{i.name}</span></td>
                      <td className="px-4 py-2 font-mono text-xs text-th-dim">{i.address || "—"}</td>
                      <td className="px-4 py-2 font-mono text-xs text-th-dim">{i.ports || "—"}</td>
                      <td className="px-4 py-2 text-xs text-th-dim">
                        {i.type === "Ingress" && (i.tls ? <span className="mr-1 text-th-ok">TLS</span> : <span className="mr-1 text-th-danger">no&nbsp;TLS</span>)}
                        {i.detail}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <InternalExposure />
        </>
      )}
    </div>
  );
}
