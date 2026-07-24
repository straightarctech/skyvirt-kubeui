import { useState, useMemo } from "react";
import { EmptyRow } from "@/components/EmptyState";
import { TableSkeleton } from "@/components/Skeleton";
import { useOutletContext } from "react-router-dom";
import { listClusterRoles, listClusterRoleBindings, listRoles, listRoleBindings } from "@/api/client";
import type { RoleSummary, RoleBindingSummary } from "@/api/client";
import { useResource } from "@/hooks/useResource";
import { useSortableTable, SortableTh } from "@/hooks/useSortableTable";
import { usePagination, TablePagination } from "@/hooks/usePagination";
import { useLiveResources } from "@/hooks/useLiveResource";
import LiveIndicator from "@/components/LiveIndicator";
import EditYAMLModal from "@/components/EditYAMLModal";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";

function age(created: string): string {
  const diff = Date.now() - new Date(created).getTime();
  const days = Math.floor(diff / 86400000);
  if (days > 0) return `${days}d`;
  const hours = Math.floor(diff / 3600000);
  if (hours > 0) return `${hours}h`;
  const mins = Math.floor(diff / 60000);
  return `${mins}m`;
}

const SUBJECT_COLORS: Record<string, string> = {
  ServiceAccount: "#6366f1",
  User: "#22c55e",
  Group: "#f59e0b",
};
const PIE_COLORS = ["#6366f1", "#a855f7", "#3b82f6", "#22c55e", "#f59e0b", "#ef4444"];

export default function RBAC() {
  const { namespace } = useOutletContext<{ namespace: string }>();
  const [tab, setTab] = useState<"roles" | "bindings">("roles");
  const [scope, setScope] = useState<"cluster" | "namespace">("cluster");
  const [search, setSearch] = useState("");
  const [editYaml, setEditYaml] = useState<{ kind: string; name: string; ns?: string } | null>(null);

  const { data: clusterRoles, loading: crLoading, error: crError, refresh: refreshCR } =
    useResource<RoleSummary[]>(listClusterRoles);
  const { data: clusterBindings, loading: cbLoading, error: cbError, refresh: refreshCB } =
    useResource<RoleBindingSummary[]>(listClusterRoleBindings);
  const { data: nsRoles, loading: nrLoading, error: nrError, refresh: refreshNR } =
    useResource<RoleSummary[]>(() => listRoles(namespace !== "all" ? namespace : ""), [namespace]);
  const { data: nsBindings, loading: nbLoading, error: nbError, refresh: refreshNB } =
    useResource<RoleBindingSummary[]>(() => listRoleBindings(namespace !== "all" ? namespace : ""), [namespace]);

  const roles = scope === "cluster" ? clusterRoles : nsRoles;
  const bindings = scope === "cluster" ? clusterBindings : nsBindings;
  const rolesLoading = scope === "cluster" ? crLoading : nrLoading;
  const bindingsLoading = scope === "cluster" ? cbLoading : nbLoading;
  const rolesError = scope === "cluster" ? crError : nrError;
  const bindingsError = scope === "cluster" ? cbError : nbError;

  const loading = tab === "roles" ? rolesLoading : bindingsLoading;
  const error = tab === "roles" ? rolesError : bindingsError;

  const filteredRoles = (roles ?? []).filter((r) =>
    r.name.toLowerCase().includes(search.toLowerCase()),
  );

  const filteredBindings = (bindings ?? []).filter((b) =>
    b.name.toLowerCase().includes(search.toLowerCase()) ||
    b.role_ref_name.toLowerCase().includes(search.toLowerCase()),
  );

  const { sorted: sortedRoles, thProps: roleTh } = useSortableTable(filteredRoles, {
    name: (r) => r.name,
    rules: (r) => r.rules_count,
    age: (r) => Date.now() - new Date(r.created_at).getTime(),
  }, { key: "name" });

  const { sorted: sortedBindings, thProps: bindTh } = useSortableTable(filteredBindings, {
    name: (b) => b.name,
    role: (b) => b.role_ref_name,
    subjects: (b) => (b.subjects || []).length,
    age: (b) => Date.now() - new Date(b.created_at).getTime(),
  }, { key: "name" });

  const rolesPager = usePagination(sortedRoles, { pageSize: 25 });
  const bindingsPager = usePagination(sortedBindings, { pageSize: 25 });

  const refresh = () => { refreshCR(); refreshCB(); refreshNR(); refreshNB(); };
  const { watchStatus, live, setLive } = useLiveResources(
    [{ kind: "ClusterRole" }, { kind: "ClusterRoleBinding" }, { kind: "Role" }, { kind: "RoleBinding" }],
    refresh,
  );

  /* ---- Visual data ---- */
  const { subjectTypeCounts, topRolesByRules, topBoundRoles } = useMemo(() => {
    // Subject type breakdown from bindings
    const subjectCounts: Record<string, number> = {};
    (bindings ?? []).forEach((b) => {
      (b.subjects || []).forEach((s) => {
        subjectCounts[s.kind] = (subjectCounts[s.kind] || 0) + 1;
      });
    });
    const subjectTypeCounts = Object.entries(subjectCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([name, value]) => ({ name, value }));

    // Top roles by rule count
    const topRolesByRules = (roles ?? [])
      .slice()
      .sort((a, b) => b.rules_count - a.rules_count)
      .slice(0, 8)
      .map((r) => ({
        name: r.name.length > 20 ? r.name.slice(0, 20) + "..." : r.name,
        rules: r.rules_count,
      }));

    // Most referenced roles in bindings
    const roleCounts: Record<string, number> = {};
    (bindings ?? []).forEach((b) => { roleCounts[b.role_ref_name] = (roleCounts[b.role_ref_name] || 0) + 1; });
    const topBoundRoles = Object.entries(roleCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([name, value]) => ({ name: name.length > 18 ? name.slice(0, 18) + "..." : name, value }));

    return { subjectTypeCounts, topRolesByRules, topBoundRoles };
  }, [roles, bindings]);

  const bothLoaded = !rolesLoading && !bindingsLoading;

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-th-heading">RBAC</h1>
        <div className="flex items-center gap-2">
          <LiveIndicator live={live} status={watchStatus} onToggle={setLive} />
          <button onClick={refresh} className="px-3 py-1.5 text-sm bg-th-accent text-white rounded-lg hover:opacity-90 transition-opacity">
            Refresh
          </button>
        </div>
      </div>

      {/* Visual Summary */}
      {bothLoaded && (
        <div className="grid grid-cols-12 gap-4">
          {/* Stats */}
          <div className="col-span-12 md:col-span-2 flex md:flex-col gap-3">
            <div className="bg-th-panel border border-th-line rounded-xl p-4 shadow-card flex-1 flex flex-col items-center justify-center">
              <p className="text-3xl font-black text-th-accent">{(roles ?? []).length}</p>
              <p className="text-[10px] text-th-dim uppercase tracking-wider">Roles</p>
            </div>
            <div className="bg-th-panel border border-th-line rounded-xl p-4 shadow-card flex-1 flex flex-col items-center justify-center">
              <p className="text-3xl font-black text-th-accent">{(bindings ?? []).length}</p>
              <p className="text-[10px] text-th-dim uppercase tracking-wider">Bindings</p>
            </div>
          </div>

          {/* Subject type pie */}
          <div className="col-span-12 md:col-span-3 bg-th-panel border border-th-line rounded-xl p-4 shadow-card">
            <h3 className="text-xs font-bold text-th-dim uppercase tracking-wider mb-2">Subject Types</h3>
            {subjectTypeCounts.length > 0 ? (
              <div className="flex items-center gap-3">
                <div className="w-20 h-20">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={subjectTypeCounts} cx="50%" cy="50%" innerRadius={18} outerRadius={36} paddingAngle={3} dataKey="value" stroke="none">
                        {subjectTypeCounts.map((d) => (
                          <Cell key={d.name} fill={SUBJECT_COLORS[d.name] || "var(--th-dim)"} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex flex-col gap-1">
                  {subjectTypeCounts.map((d) => (
                    <div key={d.name} className="flex items-center gap-2 text-xs">
                      <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: SUBJECT_COLORS[d.name] || "var(--th-dim)" }} />
                      <span className="text-th-dim">{d.name}</span>
                      <span className="font-semibold text-th-body">{d.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-xs text-th-ghost mt-4 text-center">No subjects</p>
            )}
          </div>

          {/* Top roles by rules */}
          <div className="col-span-12 md:col-span-4 bg-th-panel border border-th-line rounded-xl p-4 shadow-card">
            <h3 className="text-xs font-bold text-th-dim uppercase tracking-wider mb-2">Top Roles by Rule Count</h3>
            <div className="h-28">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topRolesByRules} layout="vertical">
                  <XAxis type="number" tick={{ fontSize: 9, fill: "var(--th-dim)" }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 9, fill: "var(--th-dim)" }} axisLine={false} tickLine={false} width={110} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "var(--th-panel)", border: "1px solid var(--th-line)", borderRadius: "8px", fontSize: "11px" }}
                    labelStyle={{ color: "var(--th-heading)" }}
                  />
                  <Bar dataKey="rules" fill="var(--th-accent)" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Most bound roles */}
          <div className="col-span-12 md:col-span-3 bg-th-panel border border-th-line rounded-xl p-4 shadow-card">
            <h3 className="text-xs font-bold text-th-dim uppercase tracking-wider mb-2">Most Bound Roles</h3>
            <div className="space-y-2 mt-2">
              {topBoundRoles.map((r, i) => (
                <div key={r.name} className="flex items-center gap-2">
                  <div className="flex-1 bg-th-subtle rounded-full h-4 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${Math.max(10, (r.value / (topBoundRoles[0]?.value || 1)) * 100)}%`,
                        backgroundColor: PIE_COLORS[i % PIE_COLORS.length],
                      }}
                    />
                  </div>
                  <span className="text-[10px] text-th-dim w-20 truncate" title={r.name}>{r.name}</span>
                  <span className="text-xs font-bold text-th-body w-6 text-right">{r.value}</span>
                </div>
              ))}
              {topBoundRoles.length === 0 && <p className="text-xs text-th-ghost text-center">No bindings</p>}
            </div>
          </div>
        </div>
      )}

      {/* Scope toggle */}
      <div className="flex items-center gap-4">
        <div className="flex gap-1 bg-th-subtle rounded-lg p-1 w-fit">
          <button onClick={() => { setScope("cluster"); setSearch(""); }}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${scope === "cluster" ? "bg-th-panel text-th-body shadow-sm" : "text-th-dim hover:text-th-body"}`}>
            Cluster-Scoped
          </button>
          <button onClick={() => { setScope("namespace"); setSearch(""); }}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${scope === "namespace" ? "bg-th-panel text-th-body shadow-sm" : "text-th-dim hover:text-th-body"}`}>
            Namespace-Scoped
          </button>
        </div>
        <div className="flex gap-1 bg-th-subtle rounded-lg p-1 w-fit">
          <button onClick={() => { setTab("roles"); setSearch(""); }}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${tab === "roles" ? "bg-th-panel text-th-body shadow-sm" : "text-th-dim hover:text-th-body"}`}>
            {scope === "cluster" ? "Cluster Roles" : "Roles"}
          </button>
          <button onClick={() => { setTab("bindings"); setSearch(""); }}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${tab === "bindings" ? "bg-th-panel text-th-body shadow-sm" : "text-th-dim hover:text-th-body"}`}>
            {scope === "cluster" ? "Cluster Role Bindings" : "Role Bindings"}
          </button>
        </div>
      </div>

      <input
        type="text"
        placeholder={tab === "roles" ? "Search roles..." : "Search bindings..."}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full max-w-sm px-3 py-2 bg-th-subtle border border-th-line rounded-lg text-sm text-th-body placeholder:text-th-ghost focus:outline-none focus:ring-1 focus:ring-th-accent"
      />

      {loading && <TableSkeleton />}
      {error && <div className="p-3 bg-th-danger-s text-th-danger rounded-lg text-sm">{error}</div>}

      {!loading && tab === "roles" && (
        <div className="bg-th-panel border border-th-line rounded-xl overflow-hidden shadow-card">
          <div className="overflow-x-auto pin-actions">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-th-dim bg-th-subtle border-b border-th-line">
                  <SortableTh {...roleTh("name")}>Name</SortableTh>
                  <SortableTh {...roleTh("rules")}>Rules</SortableTh>
                  <SortableTh {...roleTh("age")}>Age</SortableTh>
                  <th className="px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rolesPager.paged.map((r) => (
                  <tr key={r.name} className="border-b border-th-line last:border-0 hover:bg-th-hover transition-colors">
                    <td className="px-4 py-3 font-medium text-th-body">{r.name}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-16 bg-th-subtle rounded-full h-2 overflow-hidden">
                          <div
                            className="h-full bg-th-accent rounded-full"
                            style={{ width: `${Math.min(100, (r.rules_count / 20) * 100)}%` }}
                          />
                        </div>
                        <span className="text-th-dim text-xs">{r.rules_count}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-th-ghost">{age(r.created_at)}</td>
                    <td className="px-4 py-3">
                      <button onClick={() => setEditYaml({ kind: scope === "cluster" ? "ClusterRole" : "Role", name: r.name, ns: scope === "namespace" ? (r as any).namespace : undefined })}
                        className="px-2 py-1 text-xs bg-th-subtle text-th-body border border-th-line rounded hover:opacity-80">YAML</button>
                    </td>
                  </tr>
                ))}
                {filteredRoles.length === 0 && (
                  <EmptyRow colSpan={4} title="No cluster roles found" />
                )}
              </tbody>
            </table>
          </div>
          <TablePagination {...rolesPager} label="roles" />
        </div>
      )}

      {!loading && tab === "bindings" && (
        <div className="bg-th-panel border border-th-line rounded-xl overflow-hidden shadow-card">
          <div className="overflow-x-auto pin-actions">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-th-dim bg-th-subtle border-b border-th-line">
                  <SortableTh {...bindTh("name")}>Name</SortableTh>
                  <SortableTh {...bindTh("role")}>Role</SortableTh>
                  <SortableTh {...bindTh("subjects")}>Subjects</SortableTh>
                  <SortableTh {...bindTh("age")}>Age</SortableTh>
                  <th className="px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {bindingsPager.paged.map((b) => (
                  <tr key={b.name} className="border-b border-th-line last:border-0 hover:bg-th-hover transition-colors">
                    <td className="px-4 py-3 font-medium text-th-body">{b.name}</td>
                    <td className="px-4 py-3 text-th-dim">
                      <span className="text-xs">{b.role_ref_kind}/</span>{b.role_ref_name}
                    </td>
                    <td className="px-4 py-3 text-th-dim text-xs">
                      <div className="flex flex-wrap gap-1">
                        {(b.subjects || []).map((s, i) => (
                          <span
                            key={i}
                            className="px-1.5 py-0.5 rounded text-xs"
                            style={{
                              backgroundColor: (SUBJECT_COLORS[s.kind] || "var(--th-dim)") + "18",
                              color: SUBJECT_COLORS[s.kind] || "var(--th-dim)",
                              border: `1px solid ${(SUBJECT_COLORS[s.kind] || "var(--th-dim)")}40`,
                            }}
                          >
                            {s.kind}: {s.name}
                            {s.namespace ? ` (${s.namespace})` : ""}
                          </span>
                        ))}
                        {(!b.subjects || b.subjects.length === 0) && <span className="text-th-ghost">-</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-th-ghost">{age(b.created_at)}</td>
                    <td className="px-4 py-3">
                      <button onClick={() => setEditYaml({ kind: scope === "cluster" ? "ClusterRoleBinding" : "RoleBinding", name: b.name, ns: scope === "namespace" ? (b as any).namespace : undefined })}
                        className="px-2 py-1 text-xs bg-th-subtle text-th-body border border-th-line rounded hover:opacity-80">YAML</button>
                    </td>
                  </tr>
                ))}
                {filteredBindings.length === 0 && (
                  <EmptyRow colSpan={5} title="No cluster role bindings found" />
                )}
              </tbody>
            </table>
          </div>
          <TablePagination {...bindingsPager} label="bindings" />
        </div>
      )}
      {editYaml && (
        <EditYAMLModal
          kind={editYaml.kind}
          namespace={editYaml.ns}
          name={editYaml.name}
          onClose={() => setEditYaml(null)}
          onUpdated={refresh}
        />
      )}
    </div>
  );
}
