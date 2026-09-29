import { useState, useMemo } from "react";
import { useUrlSearch } from "@/hooks/useUrlState";
import { EmptyRow } from "@/components/EmptyState";
import { TableSkeleton } from "@/components/Skeleton";
import { useOutletContext } from "react-router-dom";
import { listSecrets, deleteSecret } from "@/api/client";
import type { SecretSummary } from "@/api/client";
import { useLiveResource } from "@/hooks/useLiveResource";
import LiveIndicator from "@/components/LiveIndicator";
import { useSortableTable, SortableTh } from "@/hooks/useSortableTable";
import { usePagination, TablePagination } from "@/hooks/usePagination";
import { useRowSelection } from "@/hooks/useRowSelection";
import BulkActionBar, { SelectCheckbox } from "@/components/BulkActionBar";
import { useLabelSelector, LabelSelectorInput } from "@/hooks/useLabelSelector";
import CreateSecretModal from "@/components/CreateSecretModal";
import EditSecretModal from "@/components/EditSecretModal";
import EditYAMLModal from "@/components/EditYAMLModal";
import DeleteConfirmModal from "@/components/DeleteConfirmModal";
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

function typeColor(type: string): string {
  if (type.includes("tls")) return "bg-th-ok-s text-th-ok";
  if (type.includes("docker")) return "bg-th-info-s text-th-info";
  if (type === "Opaque") return "bg-th-muted text-th-dim";
  return "bg-th-warn-s text-th-warn";
}

export default function Secrets() {
  const { namespace } = useOutletContext<{ namespace: string }>();
  const { data: items, loading, error, refresh, watchStatus, live, setLive } = useLiveResource<SecretSummary[]>(
    () => listSecrets(namespace),
    "Secret",
    namespace,
    [namespace],
  );
  const [search, setSearch] = useUrlSearch();
  const [showCreate, setShowCreate] = useState(false);
  const [editYaml, setEditYaml] = useState<{ kind: string; ns: string; name: string } | null>(null);
  const [editSecret, setEditSecret] = useState<{ ns: string; name: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ ns: string; name: string } | null>(null);
  const [protectedResources, setProtectedResources] = useState<Set<string>>(new Set());

  const labelSel = useLabelSelector({ urlKey: "" });
  const textFiltered = (items ?? []).filter(
    (s) =>
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.namespace.toLowerCase().includes(search.toLowerCase()) ||
      s.type.toLowerCase().includes(search.toLowerCase()),
  );
  const filtered = textFiltered.filter((s) => labelSel.match(s.labels));

  const { sorted, thProps } = useSortableTable(filtered, {
    name: (s) => s.name,
    namespace: (s) => s.namespace,
    type: (s) => s.type,
    keys: (s) => (s.data_keys || []).length,
    age: (s) => Date.now() - new Date(s.created_at).getTime(),
  }, { key: "name", urlKey: "" });

  const pager = usePagination(sorted, { pageSize: 25, urlKey: "" });
  const sel = useRowSelection<SecretSummary>((s) => `${s.namespace}/${s.name}`);

  const nsData = useMemo(() => {
    const counts: Record<string, number> = {};
    filtered.forEach((s) => { counts[s.namespace] = (counts[s.namespace] || 0) + 1; });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, value]) => ({ name, value }));
  }, [filtered]);

  const totalDataKeys = useMemo(() => filtered.reduce((s, c) => s + (c.data_keys || []).length, 0), [filtered]);

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-th-heading">Secrets</h1>
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

      <div className="p-3 bg-th-warn-s text-th-warn rounded-lg text-xs">
        Secret values are never displayed for security. Only metadata and key names are shown.
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <input
          type="text"
          placeholder="Search secrets..."
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
              <p className="text-[10px] text-th-dim uppercase tracking-wider">Total Secrets</p>
            </div>
            <div className="flex-1 bg-th-panel border border-th-line rounded-xl p-4 shadow-card flex flex-col items-center justify-center">
              <p className="text-3xl font-black text-th-info">{totalDataKeys}</p>
              <p className="text-[10px] text-th-dim uppercase tracking-wider">Total Data Keys</p>
            </div>
            <div className="flex-1 bg-th-panel border border-th-line rounded-xl p-4 shadow-card flex flex-col items-center justify-center">
              <p className="text-3xl font-black text-th-ok">{new Set(filtered.map((s) => s.namespace)).size}</p>
              <p className="text-[10px] text-th-dim uppercase tracking-wider">Namespaces</p>
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
                  <th className="pl-4 pr-1 py-3 w-8"><SelectCheckbox ariaLabel="Select all secrets on this page" checked={sel.allSelected(pager.paged)} indeterminate={sel.someSelected(pager.paged)} onChange={() => sel.toggleAll(pager.paged)} /></th>
                  <SortableTh {...thProps("name")}>Name</SortableTh>
                  <SortableTh {...thProps("namespace")}>Namespace</SortableTh>
                  <SortableTh {...thProps("type")}>Type</SortableTh>
                  <SortableTh {...thProps("keys")}>Keys</SortableTh>
                  <SortableTh {...thProps("age")}>Age</SortableTh>
                  <th className="w-10 px-2 py-3 font-medium" title="Protection"></th>
                  <th className="px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pager.paged.map((s) => {
                  const key = `${s.namespace}/${s.name}`;
                  return (
                    <tr key={key} className={`border-b border-th-line last:border-0 hover:bg-th-hover transition-colors ${sel.isSelected(key) ? "bg-th-accent/5" : ""}`}>
                      <td className="pl-4 pr-1 py-3"><SelectCheckbox ariaLabel={`Select ${s.name}`} checked={sel.isSelected(key)} onChange={() => sel.toggle(key)} /></td>
                      <td className="px-4 py-3 font-medium text-th-body">{s.name}</td>
                      <td className="px-4 py-3 text-th-dim">{s.namespace}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${typeColor(s.type)}`}>
                          {s.type}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-th-dim text-xs">
                        {(s.data_keys || []).length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {s.data_keys.map((k) => (
                              <span key={k} className="px-1.5 py-0.5 bg-th-subtle border border-th-line rounded text-xs text-th-body">
                                {k}
                              </span>
                            ))}
                          </div>
                        ) : (
                          "-"
                        )}
                      </td>
                      <td className="px-4 py-3 text-th-ghost">{age(s.created_at)}</td>
                      <td className="px-2 py-3">
                        <ProtectToggle
                          kind="Secret"
                          namespace={s.namespace}
                          name={s.name}
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
                          <button
                            onClick={() => setEditSecret({ ns: s.namespace, name: s.name })}
                            className="px-2 py-1 text-xs bg-th-accent-s text-th-accent rounded hover:opacity-80"
                            title="Edit secret data"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => setEditYaml({ kind: "Secret", ns: s.namespace, name: s.name })}
                            className="px-2 py-1 text-xs bg-th-subtle border border-th-line rounded text-th-body hover:opacity-80"
                          >
                            YAML
                          </button>
                          <button
                            onClick={() => setDeleteTarget({ ns: s.namespace, name: s.name })}
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
                  <EmptyRow colSpan={8} title="No secrets found" />
                )}
              </tbody>
            </table>
          </div>
          <TablePagination {...pager} label="secrets" />
        </div>
      )}
      <BulkActionBar
        selected={sel.selectedRows(items ?? [])}
        noun="secrets"
        onClear={sel.clear}
        onComplete={refresh}
        actions={[{ label: "Delete", danger: true, gerund: "Deleting", run: (s) => deleteSecret(s.namespace, s.name) }]}
      />

      {showCreate && (
        <CreateSecretModal
          defaultNamespace={namespace !== "all" ? namespace : undefined}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); refresh(); }}
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
      {editSecret && (
        <EditSecretModal
          namespace={editSecret.ns}
          name={editSecret.name}
          onClose={() => setEditSecret(null)}
          onSaved={() => { setEditSecret(null); refresh(); }}
        />
      )}

      <DeleteConfirmModal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onDeleted={refresh}
        resourceType="Secret"
        resourceName={deleteTarget?.name ?? ""}
        namespace={deleteTarget?.ns}
        kind="Secret"
        deleteFn={() => deleteSecret(deleteTarget!.ns, deleteTarget!.name)}
      />
    </div>
  );
}
