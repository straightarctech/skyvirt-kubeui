import React, { useState, useMemo } from "react";
import { useUrlSearch } from "@/hooks/useUrlState";
import { EmptyRow } from "@/components/EmptyState";
import { TableSkeleton } from "@/components/Skeleton";
import { useOutletContext } from "react-router-dom";
import { listConfigMaps, getConfigMap, deleteConfigMap, listNamespaces } from "@/api/client";
import type { ConfigMapSummary, ConfigMapDetail, NamespaceSummary } from "@/api/client";
import { useResource } from "@/hooks/useResource";
import { useLiveResource } from "@/hooks/useLiveResource";
import LiveIndicator from "@/components/LiveIndicator";
import { useSortableTable, SortableTh } from "@/hooks/useSortableTable";
import { usePagination, TablePagination } from "@/hooks/usePagination";
import { useRowSelection } from "@/hooks/useRowSelection";
import BulkActionBar, { SelectCheckbox } from "@/components/BulkActionBar";
import { useLabelSelector, LabelSelectorInput } from "@/hooks/useLabelSelector";
import { useToast } from "@/components/Toast";
import DeleteConfirmModal from "@/components/DeleteConfirmModal";
import EditYAMLModal from "@/components/EditYAMLModal";
import ConfigMapModal from "@/components/ConfigMapModal";
import ProtectToggle from "@/components/ProtectToggle";
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";

const NS_COLORS = ["#6366f1", "#a855f7", "#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#ec4899", "#14b8a6"];

function age(created: string): string {
  const diff = Date.now() - new Date(created).getTime();
  const days = Math.floor(diff / 86400000);
  if (days > 0) return `${days}d`;
  const hours = Math.floor(diff / 3600000);
  if (hours > 0) return `${hours}h`;
  const mins = Math.floor(diff / 60000);
  return `${mins}m`;
}

export default function ConfigMaps() {
  const { namespace } = useOutletContext<{ namespace: string }>();
  const { data: items, loading, error, refresh, watchStatus, live, setLive } = useLiveResource<ConfigMapSummary[]>(
    () => listConfigMaps(namespace),
    "ConfigMap",
    namespace,
    [namespace],
  );
  const toast = useToast();
  const [search, setSearch] = useUrlSearch();
  const [expanded, setExpanded] = useState<Record<string, ConfigMapDetail | null>>({});
  const [expandLoading, setExpandLoading] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ ns: string; name: string } | null>(null);
  const [editYaml, setEditYaml] = useState<{ ns: string; name: string } | null>(null);
  const [protectedResources, setProtectedResources] = useState<Set<string>>(new Set());

  // Create / edit modal state
  const [showCreate, setShowCreate] = useState(false);
  const [editCM, setEditCM] = useState<{ ns: string; name: string } | null>(null);
  const { data: allNamespaces } = useResource<NamespaceSummary[]>(() => listNamespaces(), []);

  const labelSel = useLabelSelector({ urlKey: "" });
  const textFiltered = (items ?? []).filter(
    (c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.namespace.toLowerCase().includes(search.toLowerCase()),
  );
  const filtered = textFiltered.filter((c) => labelSel.match(c.labels));

  const { sorted, thProps } = useSortableTable(filtered, {
    name: (c) => c.name,
    namespace: (c) => c.namespace,
    data: (c) => c.data_count || 0,
    age: (c) => Date.now() - new Date(c.created_at).getTime(),
  }, { key: "name", urlKey: "" });

  const pager = usePagination(sorted, { pageSize: 25, urlKey: "" });
  const sel = useRowSelection<ConfigMapSummary>((c) => `${c.namespace}/${c.name}`);

  const nsData = useMemo(() => {
    const counts: Record<string, number> = {};
    filtered.forEach((c) => { counts[c.namespace] = (counts[c.namespace] || 0) + 1; });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, value]) => ({ name, value }));
  }, [filtered]);

  const totalKeys = useMemo(() => filtered.reduce((s, c) => s + (c.data_count || 0), 0), [filtered]);

  const toggleExpand = async (ns: string, name: string) => {
    const key = `${ns}/${name}`;
    if (expanded[key] !== undefined) {
      setExpanded((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      return;
    }
    setExpandLoading(key);
    try {
      const detail = await getConfigMap(ns, name);
      setExpanded((prev) => ({ ...prev, [key]: detail }));
    } catch (e) {
      toast.error("Failed to load ConfigMap", e instanceof Error ? e.message : String(e));
    } finally {
      setExpandLoading(null);
    }
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-th-heading">ConfigMaps</h1>
        <div className="flex items-center gap-2">
          <LiveIndicator live={live} status={watchStatus} onToggle={setLive} />
          <button onClick={() => setShowCreate(true)} className="px-3 py-1.5 text-sm bg-th-ok text-white rounded-lg hover:opacity-90 transition-opacity">Create</button>
          <button onClick={refresh} className="px-3 py-1.5 text-sm bg-th-accent text-white rounded-lg hover:opacity-90 transition-opacity">Refresh</button>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <input
          type="text"
          placeholder="Search configmaps..."
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
            <h3 className="text-xs font-bold text-th-dim uppercase tracking-wider mb-2">By Namespace</h3>
            <div className="flex items-center gap-4">
              <div className="w-24 h-24">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart><Pie data={nsData} cx="50%" cy="50%" innerRadius={24} outerRadius={42} paddingAngle={2} dataKey="value" stroke="none">
                    {nsData.map((_, i) => <Cell key={i} fill={NS_COLORS[i % NS_COLORS.length]} />)}
                  </Pie></PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-col gap-1">
                {nsData.slice(0, 5).map((d, i) => (
                  <div key={d.name} className="flex items-center gap-2 text-xs">
                    <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: NS_COLORS[i % NS_COLORS.length] }} />
                    <span className="text-th-dim truncate">{d.name}</span>
                    <span className="font-semibold text-th-body">{d.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="col-span-12 md:col-span-8 flex gap-4">
            <div className="flex-1 bg-th-panel border border-th-line rounded-xl p-4 shadow-card flex flex-col items-center justify-center">
              <p className="text-3xl font-black text-th-accent">{filtered.length}</p>
              <p className="text-[10px] text-th-dim uppercase tracking-wider">ConfigMaps</p>
            </div>
            <div className="flex-1 bg-th-panel border border-th-line rounded-xl p-4 shadow-card flex flex-col items-center justify-center">
              <p className="text-3xl font-black text-th-info">{totalKeys}</p>
              <p className="text-[10px] text-th-dim uppercase tracking-wider">Total Keys</p>
            </div>
            <div className="flex-1 bg-th-panel border border-th-line rounded-xl p-4 shadow-card flex flex-col items-center justify-center">
              <p className="text-3xl font-black text-th-ok">{new Set(filtered.map((c) => c.namespace)).size}</p>
              <p className="text-[10px] text-th-dim uppercase tracking-wider">Namespaces</p>
            </div>
          </div>
        </div>
      )}

      {!loading && (
        <div className="bg-th-panel border border-th-line rounded-xl overflow-hidden shadow-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-th-dim bg-th-subtle border-b border-th-line">
                <th className="pl-4 pr-1 py-3 w-8"><SelectCheckbox ariaLabel="Select all configmaps on this page" checked={sel.allSelected(pager.paged)} indeterminate={sel.someSelected(pager.paged)} onChange={() => sel.toggleAll(pager.paged)} /></th>
                <th className="px-4 py-3 font-medium w-8"></th>
                <SortableTh {...thProps("name")}>Name</SortableTh>
                <SortableTh {...thProps("namespace")}>Namespace</SortableTh>
                <SortableTh {...thProps("data")}>Data</SortableTh>
                <SortableTh {...thProps("age")}>Age</SortableTh>
                <th className="w-10 px-2 py-3 font-medium" title="Protection"></th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pager.paged.map((c) => {
                const key = `${c.namespace}/${c.name}`;
                const detail = expanded[key];
                const isExpanded = detail !== undefined;
                return (
                  <React.Fragment key={key}>
                    <tr className={`border-b border-th-line last:border-0 hover:bg-th-hover transition-colors ${sel.isSelected(key) ? "bg-th-accent/5" : ""}`}>
                      <td className="pl-4 pr-1 py-3"><SelectCheckbox ariaLabel={`Select ${c.name}`} checked={sel.isSelected(key)} onChange={() => sel.toggle(key)} /></td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => toggleExpand(c.namespace, c.name)}
                          className="text-th-dim hover:text-th-body"
                        >
                          {expandLoading === key ? (
                            <div className="w-4 h-4 border border-th-accent border-t-transparent rounded-full animate-spin" />
                          ) : (
                            <svg
                              className={`w-4 h-4 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                              strokeWidth={2}
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                            </svg>
                          )}
                        </button>
                      </td>
                      <td className="px-4 py-3 font-medium text-th-body">{c.name}</td>
                      <td className="px-4 py-3 text-th-dim">{c.namespace}</td>
                      <td className="px-4 py-3 text-th-dim">{c.data_count} keys</td>
                      <td className="px-4 py-3 text-th-ghost">{age(c.created_at)}</td>
                      <td className="px-2 py-3">
                        <ProtectToggle
                          kind="ConfigMap"
                          namespace={c.namespace}
                          name={c.name}
                          isProtected={protectedResources.has(key)}
                          onToggled={(v) => setProtectedResources((prev) => {
                            const next = new Set(prev);
                            v ? next.add(key) : next.delete(key);
                            return next;
                          })}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          <button onClick={() => setEditCM({ ns: c.namespace, name: c.name })}
                            className="px-2 py-1 text-xs bg-th-accent-s text-th-accent rounded hover:opacity-80" title="Edit data entries">Edit</button>
                          <button onClick={() => setEditYaml({ ns: c.namespace, name: c.name })}
                            className="px-2 py-1 text-xs bg-th-subtle text-th-body border border-th-line rounded hover:opacity-80">YAML</button>
                          <button onClick={() => setDeleteTarget({ ns: c.namespace, name: c.name })}
                            className="px-2 py-1 text-xs bg-th-danger-s text-th-danger rounded hover:opacity-80">Delete</button>
                        </div>
                      </td>
                    </tr>
                    {isExpanded && detail && (
                      <tr className="border-b border-th-line">
                        <td colSpan={8} className="px-8 py-3 bg-th-subtle">
                          <div className="space-y-2">
                            {Object.entries(detail.data || {}).map(([dk, dv]) => (
                              <div key={dk}>
                                <p className="text-xs font-medium text-th-body mb-1">{dk}</p>
                                <pre className="text-xs text-th-dim bg-th-panel border border-th-line rounded p-2 overflow-x-auto max-h-40 whitespace-pre-wrap break-all">
                                  {dv}
                                </pre>
                              </div>
                            ))}
                            {Object.keys(detail.data || {}).length === 0 && (
                              <p className="text-xs text-th-ghost">No data</p>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
              {filtered.length === 0 && (
                <EmptyRow colSpan={8} title="No configmaps found" />
              )}
            </tbody>
          </table>
          <TablePagination {...pager} label="configmaps" />
        </div>
      )}
      <BulkActionBar
        selected={sel.selectedRows(items ?? [])}
        noun="configmaps"
        onClear={sel.clear}
        onComplete={refresh}
        actions={[{ label: "Delete", danger: true, gerund: "Deleting", run: (c) => deleteConfigMap(c.namespace, c.name) }]}
      />

      {showCreate && (
        <ConfigMapModal
          namespaces={(allNamespaces ?? []).map((n) => n.name)}
          defaultNamespace={namespace !== "all" ? namespace : "default"}
          onClose={() => setShowCreate(false)}
          onSaved={() => { setShowCreate(false); refresh(); }}
        />
      )}
      {editCM && (
        <ConfigMapModal
          editTarget={{ namespace: editCM.ns, name: editCM.name }}
          namespaces={(allNamespaces ?? []).map((n) => n.name)}
          onClose={() => setEditCM(null)}
          onSaved={() => { setEditCM(null); refresh(); }}
        />
      )}

      {editYaml && (
        <EditYAMLModal kind="ConfigMap" namespace={editYaml.ns} name={editYaml.name} onClose={() => setEditYaml(null)} onUpdated={refresh} />
      )}

      <DeleteConfirmModal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onDeleted={refresh}
        resourceType="ConfigMap"
        resourceName={deleteTarget?.name ?? ""}
        namespace={deleteTarget?.ns}
        kind="ConfigMap"
        deleteFn={() => deleteConfigMap(deleteTarget!.ns, deleteTarget!.name)}
      />
    </div>
  );
}
