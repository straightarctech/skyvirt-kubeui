import { TableSkeleton } from "@/components/Skeleton";
import { getSecurityPosture } from "@/api/client";
import type { SecurityPosture as Posture, SecurityFinding } from "@/api/client";
import { useResource } from "@/hooks/useResource";
import { useUrlSearch } from "@/hooks/useUrlState";
import { useSortableTable, SortableTh } from "@/hooks/useSortableTable";
import { usePagination, TablePagination } from "@/hooks/usePagination";
import { EmptyRow } from "@/components/EmptyState";
import { StatStrip } from "@/components/ResourceSummary";
import { STATUS, type StatusKind } from "@/lib/status";

const SEV_KIND: Record<string, StatusKind> = { high: "error", medium: "warn", low: "info" };
const SEV_RANK: Record<string, number> = { high: 3, medium: 2, low: 1 };

function scoreColor(score: number): string {
  if (score >= 80) return "text-th-ok";
  if (score >= 50) return "text-th-warn";
  return "text-th-danger";
}

function resource(f: SecurityFinding): string {
  if (f.namespace) return `${f.kind} ${f.namespace}/${f.name}`;
  return `${f.kind} ${f.name}`;
}

export default function SecurityPosture() {
  const { data, loading, error, refresh } = useResource<Posture>(() => getSecurityPosture(), []);
  const [search, setSearch] = useUrlSearch();

  const findings = data?.findings ?? [];
  const filtered = findings.filter((f) => {
    const q = search.toLowerCase();
    return (
      f.title.toLowerCase().includes(q) ||
      f.category.toLowerCase().includes(q) ||
      resource(f).toLowerCase().includes(q)
    );
  });

  const { sorted, thProps } = useSortableTable(filtered, {
    severity: (f) => SEV_RANK[f.severity] ?? 0,
    category: (f) => f.category,
    title: (f) => f.title,
    resource: (f) => resource(f),
  }, { key: "severity", dir: "desc", urlKey: "" });

  const pager = usePagination(sorted, { pageSize: 25, urlKey: "" });

  const c = data?.counts ?? {};

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-th-heading">Security Posture</h1>
        <button onClick={refresh} className="px-3 py-1.5 text-sm bg-th-accent text-white rounded-lg hover:opacity-90 transition-opacity">Rescan</button>
      </div>

      <p className="text-xs text-th-dim">
        A read-only scan of workloads, namespaces, and RBAC for common misconfigurations.
        {data && ` Scanned ${data.scanned.pods ?? 0} pods across ${data.scanned.namespaces ?? 0} namespaces.`}
      </p>

      {loading && <TableSkeleton />}
      {error && <div className="p-3 bg-th-danger-s text-th-danger rounded-lg text-sm">{error}</div>}

      {!loading && data && (
        <>
          <div className="grid grid-cols-12 gap-4">
            <div className="col-span-12 md:col-span-3 bg-th-panel border border-th-line rounded-xl p-4 shadow-card flex flex-col items-center justify-center">
              <div className={`text-5xl font-black tabular-nums ${scoreColor(data.score)}`}>{data.score}</div>
              <div className="mt-1 text-[10px] uppercase tracking-wider text-th-dim">Security Score</div>
            </div>
            <div className="col-span-12 md:col-span-9">
              <StatStrip stats={[
                { label: "High", value: c.high ?? 0, tone: (c.high ?? 0) ? "error" : "neutral" },
                { label: "Medium", value: c.medium ?? 0, tone: (c.medium ?? 0) ? "warn" : "neutral" },
                { label: "Low", value: c.low ?? 0, tone: (c.low ?? 0) ? "info" : "neutral" },
                { label: "Findings", value: findings.length, tone: "accent" },
              ]} />
            </div>
          </div>

          <input
            type="text"
            placeholder="Search findings by issue, category, or resource…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full max-w-sm px-3 py-2 bg-th-subtle border border-th-line rounded-lg text-sm text-th-body placeholder:text-th-ghost focus:outline-none focus:ring-1 focus:ring-th-accent"
          />

          <div className="bg-th-panel border border-th-line rounded-xl overflow-hidden shadow-card">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-th-dim bg-th-subtle border-b border-th-line">
                    <SortableTh {...thProps("severity")}>Severity</SortableTh>
                    <SortableTh {...thProps("category")}>Category</SortableTh>
                    <SortableTh {...thProps("title")}>Issue</SortableTh>
                    <SortableTh {...thProps("resource")}>Resource</SortableTh>
                    <th className="px-4 py-3 font-medium">Fix</th>
                  </tr>
                </thead>
                <tbody>
                  {pager.paged.map((f, i) => (
                    <tr key={i} className="border-b border-th-line last:border-0 hover:bg-th-hover transition-colors align-top">
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium capitalize ${STATUS[SEV_KIND[f.severity] ?? "unknown"].badge}`}>{f.severity}</span>
                      </td>
                      <td className="px-4 py-3 text-th-dim">{f.category}</td>
                      <td className="px-4 py-3">
                        <span className="text-th-body">{f.title}</span>
                        {f.detail && <span className="block text-[11px] text-th-dim">{f.detail}</span>}
                      </td>
                      <td className="px-4 py-3 text-th-body font-mono text-xs">{resource(f)}</td>
                      <td className="px-4 py-3 text-xs text-th-dim max-w-sm">{f.remediation}</td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <EmptyRow colSpan={5} title={findings.length ? "No findings match your search" : "No security findings"} hint={findings.length ? undefined : "Nice — no common misconfigurations detected in the scanned scope."} />
                  )}
                </tbody>
              </table>
            </div>
            <TablePagination {...pager} label="findings" />
          </div>
        </>
      )}
    </div>
  );
}
