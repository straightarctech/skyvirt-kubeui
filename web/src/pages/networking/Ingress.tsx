import { useState, useMemo } from "react";
import { useUrlSearch } from "@/hooks/useUrlState";
import { EmptyRow } from "@/components/EmptyState";
import { TableSkeleton } from "@/components/Skeleton";
import { useOutletContext } from "react-router-dom";
import { listIngresses, deleteIngress } from "@/api/client";
import type { IngressSummary } from "@/api/client";
import { useLiveResource } from "@/hooks/useLiveResource";
import LiveIndicator from "@/components/LiveIndicator";
import { useSortableTable, SortableTh } from "@/hooks/useSortableTable";
import { usePagination, TablePagination } from "@/hooks/usePagination";
import { useRowSelection } from "@/hooks/useRowSelection";
import BulkActionBar, { SelectCheckbox } from "@/components/BulkActionBar";
import { useLabelSelector, LabelSelectorInput } from "@/hooks/useLabelSelector";
import CreateIngressModal from "@/components/CreateIngressModal";
import EditYAMLModal from "@/components/EditYAMLModal";
import DeleteConfirmModal from "@/components/DeleteConfirmModal";
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";

const CLASS_COLORS = ["#6366f1", "#a855f7", "#3b82f6", "#22c55e", "#f59e0b", "#ef4444"];

function age(created: string): string {
  const diff = Date.now() - new Date(created).getTime();
  const days = Math.floor(diff / 86400000);
  if (days > 0) return `${days}d`;
  const hours = Math.floor(diff / 3600000);
  if (hours > 0) return `${hours}h`;
  const mins = Math.floor(diff / 60000);
  return `${mins}m`;
}

export default function Ingress() {
  const { namespace } = useOutletContext<{ namespace: string }>();
  const { data: items, loading, error, refresh, watchStatus, live, setLive } = useLiveResource<IngressSummary[]>(
    () => listIngresses(namespace),
    "Ingress",
    namespace,
    [namespace],
  );
  const [search, setSearch] = useUrlSearch();
  const [showCreate, setShowCreate] = useState(false);
  const [editIng, setEditIng] = useState<{ ns: string; name: string } | null>(null);
  const [editYaml, setEditYaml] = useState<{ kind: string; ns: string; name: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ ns: string; name: string } | null>(null);

  const labelSel = useLabelSelector({ urlKey: "" });
  const textFiltered = (items ?? []).filter(
    (i) =>
      i.name.toLowerCase().includes(search.toLowerCase()) ||
      i.namespace.toLowerCase().includes(search.toLowerCase()),
  );
  const filtered = textFiltered.filter((i) => labelSel.match(i.labels));

  const { sorted, thProps } = useSortableTable(filtered, {
    name: (i) => i.name,
    namespace: (i) => i.namespace,
    class: (i) => i.class || "",
    age: (i) => Date.now() - new Date(i.created_at).getTime(),
  }, { key: "name", urlKey: "" });

  const pager = usePagination(sorted, { pageSize: 25, urlKey: "" });
  const sel = useRowSelection<IngressSummary>((i) => `${i.namespace}/${i.name}`);

  const classData = useMemo(() => {
    const counts: Record<string, number> = {};
    filtered.forEach((i) => { counts[i.class || "none"] = (counts[i.class || "none"] || 0) + 1; });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [filtered]);

  const totalHosts = useMemo(() => {
    const hosts = new Set<string>();
    filtered.forEach((i) => (i.rules || []).forEach((r) => r.host && hosts.add(r.host)));
    return hosts.size;
  }, [filtered]);

  const getHosts = (ingress: IngressSummary): string => {
    if (!ingress.rules || ingress.rules.length === 0) return "-";
    return ingress.rules.map((r) => r.host || "*").join(", ");
  };

  const getPaths = (ingress: IngressSummary): string => {
    if (!ingress.rules || ingress.rules.length === 0) return "-";
    const paths: string[] = [];
    for (const rule of ingress.rules) {
      for (const p of rule.paths || []) {
        paths.push(`${p.path} -> ${p.service_name}:${p.service_port}`);
      }
    }
    return paths.length > 0 ? paths.join("; ") : "-";
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-th-heading">Ingresses</h1>
        <div className="flex gap-2">
          <LiveIndicator live={live} status={watchStatus} onToggle={setLive} />
          <button onClick={() => setShowCreate(true)} className="px-3 py-1.5 text-sm bg-th-ok text-white rounded-lg hover:opacity-90 transition-opacity">
            Create
          </button>
          <button onClick={refresh} className="px-3 py-1.5 text-sm bg-th-accent text-white rounded-lg hover:opacity-90 transition-opacity">
            Refresh
          </button>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <input
          type="text"
          placeholder="Search ingresses..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full sm:max-w-sm px-3 py-2 bg-th-subtle border border-th-line rounded-lg text-sm text-th-body placeholder:text-th-ghost focus:outline-none focus:ring-1 focus:ring-th-accent"
        />
        <LabelSelectorInput
          value={labelSel.query}
          onChange={labelSel.setQuery}
          matched={filtered.length}
          total={textFiltered.length}
          invalid={labelSel.invalid}
          className="w-full sm:max-w-sm"
        />
      </div>

      {loading && <TableSkeleton />}
      {error && <div className="p-3 bg-th-danger-s text-th-danger rounded-lg text-sm">{error}</div>}

      {!loading && filtered.length > 0 && (
        <div className="grid grid-cols-12 gap-4">
          <div className="col-span-12 md:col-span-4 bg-th-panel border border-th-line rounded-xl p-4 shadow-card">
            <h3 className="text-xs font-bold text-th-dim uppercase tracking-wider mb-2">Ingress Classes</h3>
            <div className="flex items-center gap-4">
              <div className="w-24 h-24">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart><Pie data={classData} cx="50%" cy="50%" innerRadius={24} outerRadius={42} paddingAngle={2} dataKey="value" stroke="none">
                    {classData.map((_, i) => <Cell key={i} fill={CLASS_COLORS[i % CLASS_COLORS.length]} />)}
                  </Pie></PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-col gap-1">
                {classData.map((d, i) => (
                  <div key={d.name} className="flex items-center gap-2 text-xs">
                    <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: CLASS_COLORS[i % CLASS_COLORS.length] }} />
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
              <p className="text-[10px] text-th-dim uppercase tracking-wider">Ingresses</p>
            </div>
            <div className="flex-1 bg-th-panel border border-th-line rounded-xl p-4 shadow-card flex flex-col items-center justify-center">
              <p className="text-3xl font-black text-th-info">{totalHosts}</p>
              <p className="text-[10px] text-th-dim uppercase tracking-wider">Unique Hosts</p>
            </div>
            <div className="flex-1 bg-th-panel border border-th-line rounded-xl p-4 shadow-card flex flex-col items-center justify-center">
              <p className="text-3xl font-black text-th-ok">{filtered.reduce((s, i) => s + (i.rules || []).reduce((rs, r) => rs + (r.paths || []).length, 0), 0)}</p>
              <p className="text-[10px] text-th-dim uppercase tracking-wider">Total Paths</p>
            </div>
          </div>
        </div>
      )}

      {!loading && (
        <div className="bg-th-panel border border-th-line rounded-xl overflow-hidden shadow-card">
          <div className="overflow-x-auto pin-actions">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-th-dim bg-th-subtle border-b border-th-line">
                  <th className="pl-4 pr-1 py-3 w-8"><SelectCheckbox ariaLabel="Select all ingresses on this page" checked={sel.allSelected(pager.paged)} indeterminate={sel.someSelected(pager.paged)} onChange={() => sel.toggleAll(pager.paged)} /></th>
                  <SortableTh {...thProps("name")}>Name</SortableTh>
                  <SortableTh {...thProps("namespace")}>Namespace</SortableTh>
                  <SortableTh {...thProps("class")}>Class</SortableTh>
                  <th className="px-4 py-3 font-medium">Hosts</th>
                  <th className="px-4 py-3 font-medium">Paths</th>
                  <SortableTh {...thProps("age")}>Age</SortableTh>
                  <th className="px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pager.paged.map((i) => {
                  const key = `${i.namespace}/${i.name}`;
                  return (
                    <tr key={key} className={`border-b border-th-line last:border-0 hover:bg-th-hover transition-colors ${sel.isSelected(key) ? "bg-th-accent/5" : ""}`}>
                      <td className="pl-4 pr-1 py-3"><SelectCheckbox ariaLabel={`Select ${i.name}`} checked={sel.isSelected(key)} onChange={() => sel.toggle(key)} /></td>
                      <td className="px-4 py-3 font-medium text-th-body">{i.name}</td>
                      <td className="px-4 py-3 text-th-dim">{i.namespace}</td>
                      <td className="px-4 py-3 text-th-dim">{i.class || "-"}</td>
                      <td className="px-4 py-3 text-th-body text-xs">{getHosts(i)}</td>
                      <td className="px-4 py-3 text-th-dim text-xs max-w-sm truncate" title={getPaths(i)}>
                        {getPaths(i)}
                      </td>
                      <td className="px-4 py-3 text-th-ghost">{age(i.created_at)}</td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          <button
                            onClick={() => setEditIng({ ns: i.namespace, name: i.name })}
                            className="px-2 py-1 text-xs bg-th-accent-s text-th-accent rounded hover:opacity-80"
                            title="Edit rules, hosts, and TLS"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => setEditYaml({ kind: "Ingress", ns: i.namespace, name: i.name })}
                            className="px-2 py-1 text-xs bg-th-subtle border border-th-line rounded text-th-body hover:opacity-80"
                          >
                            YAML
                          </button>
                          <button
                            onClick={() => setDeleteTarget({ ns: i.namespace, name: i.name })}
                            className="px-2 py-1 text-xs bg-th-danger-s text-th-danger rounded hover:opacity-80"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <EmptyRow colSpan={8} title="No ingresses found" />
                )}
              </tbody>
            </table>
          </div>
          <TablePagination {...pager} label="ingresses" />
        </div>
      )}
      <BulkActionBar
        selected={sel.selectedRows(items ?? [])}
        noun="ingresses"
        onClear={sel.clear}
        onComplete={refresh}
        actions={[{ label: "Delete", danger: true, gerund: "Deleting", run: (i) => deleteIngress(i.namespace, i.name) }]}
      />

      {showCreate && (
        <CreateIngressModal
          defaultNamespace={namespace !== "all" ? namespace : undefined}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); refresh(); }}
        />
      )}
      {editIng && (
        <CreateIngressModal
          editTarget={{ namespace: editIng.ns, name: editIng.name }}
          onClose={() => setEditIng(null)}
          onCreated={() => { setEditIng(null); refresh(); }}
        />
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
      <DeleteConfirmModal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onDeleted={refresh}
        resourceType="Ingress"
        resourceName={deleteTarget?.name ?? ""}
        namespace={deleteTarget?.ns}
        kind="Ingress"
        deleteFn={() => deleteIngress(deleteTarget!.ns, deleteTarget!.name)}
      />
    </div>
  );
}
