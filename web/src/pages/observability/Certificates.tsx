import { useMemo } from "react";
import { scanCertExpiry, type CertInfo } from "@/api/client";
import { useResource } from "@/hooks/useResource";
import { TableSkeleton } from "@/components/Skeleton";
import { EmptyState } from "@/components/EmptyState";
import { StatStrip } from "@/components/ResourceSummary";

function urgency(c: CertInfo): { cls: string; label: string } {
  if (c.no_expiry) return { cls: "bg-th-info-s text-th-info", label: "long-lived" };
  if (c.expired) return { cls: "bg-th-danger-s text-th-danger", label: "expired" };
  if (c.days_left <= 14) return { cls: "bg-th-danger-s text-th-danger", label: `${c.days_left}d` };
  if (c.days_left <= 30) return { cls: "bg-th-warn-s text-th-warn", label: `${c.days_left}d` };
  return { cls: "bg-th-ok-s text-th-ok", label: `${c.days_left}d` };
}

const KIND: Record<CertInfo["kind"], { label: string; cls: string }> = {
  tls: { label: "TLS", cls: "bg-th-accent/10 text-th-accent" },
  kubeconfig: { label: "kubeconfig", cls: "bg-th-warn-s text-th-warn" },
  "sa-token": { label: "SA token", cls: "bg-th-subtle text-th-dim" },
};

export default function Certificates() {
  const { data, loading, error, refresh } = useResource<CertInfo[]>(() => scanCertExpiry(), []);

  // Soonest-expiring first; long-lived (no-expiry) entries sink to the bottom.
  const sorted = useMemo(
    () => [...(data ?? [])].sort((a, b) => (a.no_expiry !== b.no_expiry ? (a.no_expiry ? 1 : -1) : a.days_left - b.days_left)),
    [data],
  );
  const stats = useMemo(() => {
    const list = data ?? [];
    return {
      total: list.length,
      soon: list.filter((c) => !c.expired && !c.no_expiry && c.days_left <= 30).length,
      expired: list.filter((c) => c.expired).length,
      longLived: list.filter((c) => c.no_expiry).length,
    };
  }, [data]);

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-th-heading">Certificate & credential expiry</h1>
          <p className="mt-0.5 text-sm text-th-dim">
            TLS certificates, kubeconfig client certs, and ServiceAccount tokens across your Secrets — when they expire, so you catch a silent expiry (or a long-lived credential) before it bites.
          </p>
        </div>
        <button onClick={refresh} className="rounded-lg border border-th-line bg-th-subtle px-3 py-1.5 text-sm text-th-body hover:bg-th-hover">
          Refresh
        </button>
      </div>

      {!loading && (data?.length ?? 0) > 0 && (
        <StatStrip
          stats={[
            { label: "Credentials", value: stats.total, tone: "accent" },
            { label: "Expiring ≤30d", value: stats.soon, tone: stats.soon > 0 ? "warn" : "ok" },
            { label: "Expired", value: stats.expired, tone: stats.expired > 0 ? "error" : "ok" },
            { label: "Long-lived", value: stats.longLived, tone: stats.longLived > 0 ? "warn" : "neutral" },
          ]}
        />
      )}

      {error && <div className="rounded-lg bg-th-danger-s p-3 text-sm text-th-danger">{error}</div>}

      {loading ? (
        <TableSkeleton rows={6} />
      ) : sorted.length === 0 ? (
        <EmptyState title="No certificates or tokens found" hint="No Secrets carrying a TLS cert, kubeconfig, or ServiceAccount token were found in the cluster." />
      ) : (
        <div className="overflow-hidden rounded-xl border border-th-line bg-th-panel shadow-card">
          <table className="w-full text-sm">
            <thead className="bg-th-subtle text-left text-xs text-th-ghost">
              <tr>
                <th className="px-4 py-2">Type</th>
                <th className="px-4 py-2">Secret</th>
                <th className="px-4 py-2">Namespace</th>
                <th className="px-4 py-2">Common name / subject</th>
                <th className="px-4 py-2">Issuer</th>
                <th className="px-4 py-2">Expires</th>
                <th className="px-4 py-2 text-right">Remaining</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-th-line">
              {sorted.map((c, i) => {
                const u = urgency(c);
                const k = KIND[c.kind] ?? KIND.tls;
                return (
                  <tr key={i} className="hover:bg-th-hover">
                    <td className="px-4 py-2">
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${k.cls}`}>{k.label}</span>
                    </td>
                    <td className="px-4 py-2 font-medium text-th-body">{c.secret}</td>
                    <td className="px-4 py-2 text-th-dim">{c.namespace}</td>
                    <td className="px-4 py-2 text-th-dim">
                      <div className="text-th-body">{c.common_name || "—"}</div>
                      {c.dns_names?.length > 0 && (
                        <div className="truncate text-xs text-th-ghost" title={c.dns_names.join(", ")}>{c.dns_names.join(", ")}</div>
                      )}
                    </td>
                    <td className="px-4 py-2 text-xs text-th-dim">{c.issuer || "—"}</td>
                    <td className="px-4 py-2 text-xs text-th-dim">{c.no_expiry ? "never" : new Date(c.not_after).toLocaleDateString()}</td>
                    <td className="px-4 py-2 text-right">
                      <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${u.cls}`}>{u.label}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
