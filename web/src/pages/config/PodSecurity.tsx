import { useMemo } from "react";
import { useUrlSearch } from "@/hooks/useUrlState";
import { EmptyRow } from "@/components/EmptyState";
import { STATUS } from "@/lib/status";
import { TableSkeleton } from "@/components/Skeleton";
import { useOutletContext } from "react-router-dom";
import { listNamespaces } from "@/api/client";
import type { NamespaceSummary } from "@/api/client";
import { useLiveResource } from "@/hooks/useLiveResource";
import LiveIndicator from "@/components/LiveIndicator";
import { useSortableTable, SortableTh } from "@/hooks/useSortableTable";
import { usePagination, TablePagination } from "@/hooks/usePagination";
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";

const LEVEL_COLORS: Record<string, string> = {
  restricted: STATUS.ok.fill,
  baseline: STATUS.warn.fill,
  privileged: STATUS.error.fill,
  none: "#6366f1",
};

function levelColor(level: string): string {
  switch (level) {
    case "restricted": return "bg-th-ok-s text-th-ok";
    case "baseline": return "bg-th-warn-s text-th-warn";
    case "privileged": return "bg-th-danger-s text-th-danger";
    default: return "bg-th-muted text-th-dim";
  }
}

interface PodSecurityInfo {
  namespace: string;
  enforce: string;
  warn: string;
  audit: string;
}

export default function PodSecurity() {
  useOutletContext<{ namespace: string }>();
  const { data: namespaces, loading, error, refresh, watchStatus, live, setLive } = useLiveResource<NamespaceSummary[]>(
    () => listNamespaces(),
    "Namespace",
    undefined,
    [],
  );
  const [search, setSearch] = useUrlSearch();

  const items: PodSecurityInfo[] = (namespaces ?? []).map((ns) => ({
    namespace: ns.name,
    enforce: (ns.labels || {})["pod-security.kubernetes.io/enforce"] || "",
    warn: (ns.labels || {})["pod-security.kubernetes.io/warn"] || "",
    audit: (ns.labels || {})["pod-security.kubernetes.io/audit"] || "",
  })).filter((i) => i.enforce || i.warn || i.audit || search === "");

  const filtered = items.filter((i) => i.namespace.toLowerCase().includes(search.toLowerCase()));

  const { sorted, thProps } = useSortableTable(filtered, {
    namespace: (i) => i.namespace,
    enforce: (i) => i.enforce || "",
    warn: (i) => i.warn || "",
    audit: (i) => i.audit || "",
  }, { key: "namespace", urlKey: "" });

  const pager = usePagination(sorted, { pageSize: 25, urlKey: "" });

  const enforceData = useMemo(() => {
    const counts: Record<string, number> = {};
    filtered.forEach((i) => {
      const level = i.enforce || "none";
      counts[level] = (counts[level] || 0) + 1;
    });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [filtered]);

  const withPolicyCount = useMemo(() => filtered.filter((i) => i.enforce || i.warn || i.audit).length, [filtered]);
  const restrictedCount = useMemo(() => filtered.filter((i) => i.enforce === "restricted").length, [filtered]);

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-th-heading">Pod Security Standards</h1>
        <div className="flex items-center gap-2">
          <LiveIndicator live={live} status={watchStatus} onToggle={setLive} />
          <button onClick={refresh} className="px-3 py-1.5 text-sm bg-th-accent text-white rounded-lg hover:opacity-90 transition-opacity">Refresh</button>
        </div>
      </div>

      <div className="bg-th-panel border border-th-line rounded-xl p-4 shadow-card">
        <p className="text-sm text-th-dim">
          Pod Security Standards are enforced via namespace labels. Each namespace can set
          <code className="mx-1 px-1 bg-th-subtle rounded text-xs">enforce</code>,
          <code className="mx-1 px-1 bg-th-subtle rounded text-xs">warn</code>, and
          <code className="mx-1 px-1 bg-th-subtle rounded text-xs">audit</code>
          levels: <span className="text-th-ok font-medium">restricted</span>,
          <span className="text-th-warn font-medium"> baseline</span>, or
          <span className="text-th-danger font-medium"> privileged</span>.
        </p>
      </div>

      <input
        type="text"
        placeholder="Search namespaces..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full max-w-sm px-3 py-2 bg-th-subtle border border-th-line rounded-lg text-sm text-th-body placeholder:text-th-ghost focus:outline-none focus:ring-1 focus:ring-th-accent"
      />

      {loading && <TableSkeleton />}
      {error && <div className="p-3 bg-th-danger-s text-th-danger rounded-lg text-sm">{error}</div>}

      {!loading && filtered.length > 0 && (
        <div className="grid grid-cols-12 gap-4">
          <div className="col-span-12 md:col-span-4 bg-th-panel border border-th-line rounded-xl p-4 shadow-card">
            <h3 className="text-xs font-bold text-th-dim uppercase tracking-wider mb-2">Enforce Levels</h3>
            <div className="flex items-center gap-4">
              <div className="w-24 h-24">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart><Pie data={enforceData} cx="50%" cy="50%" innerRadius={24} outerRadius={42} paddingAngle={3} dataKey="value" stroke="none">
                    {enforceData.map((d) => <Cell key={d.name} fill={LEVEL_COLORS[d.name] || "#6366f1"} />)}
                  </Pie></PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-col gap-1">
                {enforceData.map((d) => (
                  <div key={d.name} className="flex items-center gap-2 text-xs">
                    <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: LEVEL_COLORS[d.name] || "#6366f1" }} />
                    <span className="text-th-dim">{d.name}</span>
                    <span className="font-semibold text-th-body">{d.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="col-span-12 md:col-span-8 flex gap-4">
            <div className="flex-1 bg-th-panel border border-th-line rounded-xl p-4 shadow-card flex flex-col items-center justify-center">
              <p className="text-3xl font-black text-th-accent">{filtered.length}</p>
              <p className="text-[10px] text-th-dim uppercase tracking-wider">Total Namespaces</p>
            </div>
            <div className="flex-1 bg-th-panel border border-th-line rounded-xl p-4 shadow-card flex flex-col items-center justify-center">
              <p className="text-3xl font-black text-th-info">{withPolicyCount}</p>
              <p className="text-[10px] text-th-dim uppercase tracking-wider">With Policy</p>
            </div>
            <div className="flex-1 bg-th-panel border border-th-line rounded-xl p-4 shadow-card flex flex-col items-center justify-center">
              <p className="text-3xl font-black text-th-ok">{restrictedCount}</p>
              <p className="text-[10px] text-th-dim uppercase tracking-wider">Restricted</p>
            </div>
          </div>
        </div>
      )}

      {!loading && (
        <div className="bg-th-panel border border-th-line rounded-xl overflow-hidden shadow-card">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-th-dim bg-th-subtle border-b border-th-line">
                  <SortableTh {...thProps("namespace")}>Namespace</SortableTh>
                  <SortableTh {...thProps("enforce")}>Enforce</SortableTh>
                  <SortableTh {...thProps("warn")}>Warn</SortableTh>
                  <SortableTh {...thProps("audit")}>Audit</SortableTh>
                </tr>
              </thead>
              <tbody>
                {pager.paged.map((i) => (
                  <tr key={i.namespace} className="border-b border-th-line last:border-0 hover:bg-th-hover transition-colors">
                    <td className="px-4 py-3 font-medium text-th-body">{i.namespace}</td>
                    <td className="px-4 py-3">
                      {i.enforce ? <span className={`px-2 py-0.5 rounded text-xs font-medium ${levelColor(i.enforce)}`}>{i.enforce}</span> : <span className="text-th-ghost text-xs">-</span>}
                    </td>
                    <td className="px-4 py-3">
                      {i.warn ? <span className={`px-2 py-0.5 rounded text-xs font-medium ${levelColor(i.warn)}`}>{i.warn}</span> : <span className="text-th-ghost text-xs">-</span>}
                    </td>
                    <td className="px-4 py-3">
                      {i.audit ? <span className={`px-2 py-0.5 rounded text-xs font-medium ${levelColor(i.audit)}`}>{i.audit}</span> : <span className="text-th-ghost text-xs">-</span>}
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <EmptyRow colSpan={4} title="No namespaces with pod security labels found" />
                )}
              </tbody>
            </table>
          </div>
          <TablePagination {...pager} label="namespaces" />
        </div>
      )}
    </div>
  );
}
