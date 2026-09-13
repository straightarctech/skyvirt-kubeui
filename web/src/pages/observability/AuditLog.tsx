import { useMemo } from "react";
import { TableSkeleton } from "@/components/Skeleton";
import { listAuditLog } from "@/api/client";
import type { AuditEntry } from "@/api/client";
import { useResource } from "@/hooks/useResource";
import { useUrlSearch } from "@/hooks/useUrlState";
import { useSortableTable, SortableTh } from "@/hooks/useSortableTable";
import { usePagination, TablePagination } from "@/hooks/usePagination";
import { EmptyRow } from "@/components/EmptyState";
import { StatStrip } from "@/components/ResourceSummary";
import { STATUS, type StatusKind } from "@/lib/status";

function when(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function resultKind(status: number): StatusKind {
  if (status >= 200 && status < 300) return "ok";
  if (status === 401 || status === 403) return "warn";
  return "error";
}
function resultLabel(status: number): string {
  if (status >= 200 && status < 300) return "OK";
  if (status === 401 || status === 403) return "Denied";
  if (status === 0) return "—";
  return "Failed";
}

export default function AuditLog() {
  const { data, loading, error, refresh } = useResource<{ entries: AuditEntry[]; total: number }>(
    () => listAuditLog(1000),
    [],
  );
  const [search, setSearch] = useUrlSearch();

  const entries = data?.entries ?? [];
  const filtered = entries.filter((e) => {
    const q = search.toLowerCase();
    return (
      (e.email || e.user).toLowerCase().includes(q) ||
      e.action.toLowerCase().includes(q) ||
      e.resource.toLowerCase().includes(q) ||
      (e.kind || "").toLowerCase().includes(q)
    );
  });

  const { sorted, thProps } = useSortableTable(filtered, {
    time: (e) => new Date(e.timestamp).getTime(),
    user: (e) => e.email || e.user,
    action: (e) => e.action,
    resource: (e) => e.resource,
    result: (e) => e.status,
  }, { key: "time", dir: "desc", urlKey: "" });

  const pager = usePagination(sorted, { pageSize: 25, urlKey: "" });

  const stats = useMemo(() => {
    let ok = 0, denied = 0, failed = 0;
    const users = new Set<string>();
    filtered.forEach((e) => {
      users.add(e.email || e.user);
      const k = resultKind(e.status);
      if (k === "ok") ok++; else if (k === "warn") denied++; else failed++;
    });
    return { total: filtered.length, ok, denied, failed, users: users.size };
  }, [filtered]);

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-th-heading">Audit Log</h1>
        <button onClick={refresh} className="px-3 py-1.5 text-sm bg-th-accent text-white rounded-lg hover:opacity-90 transition-opacity">Refresh</button>
      </div>

      <p className="text-xs text-th-dim">
        Mutating actions performed through this console — including denied and failed attempts.
        Kept in memory (recent {data?.total ?? 0} shown); set a database for durable retention.
      </p>

      <input
        type="text"
        placeholder="Search by user, action, or resource…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full max-w-sm px-3 py-2 bg-th-subtle border border-th-line rounded-lg text-sm text-th-body placeholder:text-th-ghost focus:outline-none focus:ring-1 focus:ring-th-accent"
      />

      {loading && <TableSkeleton />}
      {error && <div className="p-3 bg-th-danger-s text-th-danger rounded-lg text-sm">{error}</div>}

      {!loading && (
        <>
          <StatStrip stats={[
            { label: "Actions", value: stats.total, tone: "accent" },
            { label: "Succeeded", value: stats.ok, tone: "ok" },
            { label: "Denied", value: stats.denied, tone: stats.denied ? "warn" : "neutral" },
            { label: "Failed", value: stats.failed, tone: stats.failed ? "error" : "neutral" },
            { label: "Users", value: stats.users, tone: "info" },
          ]} />

          <div className="bg-th-panel border border-th-line rounded-xl overflow-hidden shadow-card">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-th-dim bg-th-subtle border-b border-th-line">
                    <SortableTh {...thProps("time")}>Time</SortableTh>
                    <SortableTh {...thProps("user")}>User</SortableTh>
                    <SortableTh {...thProps("action")}>Action</SortableTh>
                    <SortableTh {...thProps("resource")}>Resource</SortableTh>
                    <SortableTh {...thProps("result")}>Result</SortableTh>
                    <th className="px-4 py-3 font-medium">Method</th>
                  </tr>
                </thead>
                <tbody>
                  {pager.paged.map((e) => (
                    <tr key={e.id} className="border-b border-th-line last:border-0 hover:bg-th-hover transition-colors">
                      <td className="px-4 py-3 text-th-dim whitespace-nowrap" title={new Date(e.timestamp).toLocaleString()}>{when(e.timestamp)}</td>
                      <td className="px-4 py-3">
                        <span className="text-th-body">{e.email || e.user}</span>
                        {e.role && <span className="ml-1.5 text-[10px] uppercase tracking-wider text-th-ghost">{e.role}</span>}
                      </td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-0.5 rounded text-xs font-medium bg-th-accent-s text-th-accent">{e.action}</span>
                      </td>
                      <td className="px-4 py-3 text-th-body font-mono text-xs">{e.resource}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS[resultKind(e.status)].badge}`} title={`HTTP ${e.status}`}>
                          {resultLabel(e.status)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-th-dim font-mono text-xs">{e.method}</td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <EmptyRow colSpan={6} title="No audited actions yet" hint="Create, edit, delete, scale, or restart something — it'll show up here." />
                  )}
                </tbody>
              </table>
            </div>
            <TablePagination {...pager} label="actions" />
          </div>
        </>
      )}
    </div>
  );
}
