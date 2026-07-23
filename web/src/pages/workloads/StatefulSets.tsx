import { useState } from "react";
import { useUrlSearch } from "@/hooks/useUrlState";
import { EmptyRow } from "@/components/EmptyState";
import { TableSkeleton } from "@/components/Skeleton";
import { useOutletContext, Link } from "react-router-dom";
import { listStatefulSets, scaleStatefulSet, restartStatefulSet, deleteStatefulSet } from "@/api/client";
import type { StatefulSetSummary } from "@/api/client";
import { useLiveResource } from "@/hooks/useLiveResource";
import LiveIndicator from "@/components/LiveIndicator";
import { useConfirmAction } from "@/hooks/useConfirmAction";
import { useSortableTable, SortableTh } from "@/hooks/useSortableTable";
import { usePagination, TablePagination } from "@/hooks/usePagination";
import { useRowSelection } from "@/hooks/useRowSelection";
import BulkActionBar, { SelectCheckbox } from "@/components/BulkActionBar";
import { useLabelSelector, LabelSelectorInput } from "@/hooks/useLabelSelector";
import { RatioMeter } from "@/components/viz";
import { useToast } from "@/components/Toast";
import CreateWorkloadModal from "@/components/CreateWorkloadModal";
import EditYAMLModal from "@/components/EditYAMLModal";
import EditWorkloadModal from "@/components/EditWorkloadModal";
import DeleteConfirmModal from "@/components/DeleteConfirmModal";
import DiagnoseModal from "@/components/DiagnoseModal";
import ProtectToggle from "@/components/ProtectToggle";
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";

function age(created: string): string {
  const diff = Date.now() - new Date(created).getTime();
  const days = Math.floor(diff / 86400000);
  if (days > 0) return `${days}d`;
  const hours = Math.floor(diff / 3600000);
  if (hours > 0) return `${hours}h`;
  const mins = Math.floor(diff / 60000);
  return `${mins}m`;
}

export default function StatefulSets() {
  const { namespace } = useOutletContext<{ namespace: string }>();
  const { data: items, loading, error, refresh, watchStatus, live, setLive } = useLiveResource<StatefulSetSummary[]>(
    () => listStatefulSets(namespace),
    "StatefulSet",
    namespace,
    [namespace],
  );
  const toast = useToast();
  const confirmAction = useConfirmAction();
  const [search, setSearch] = useUrlSearch();
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [scaleTarget, setScaleTarget] = useState<{ ns: string; name: string } | null>(null);
  const [scaleValue, setScaleValue] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const [editYaml, setEditYaml] = useState<{ kind: string; ns: string; name: string } | null>(null);
  const [editWl, setEditWl] = useState<{ ns: string; name: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ ns: string; name: string } | null>(null);
  const [diagnose, setDiagnose] = useState<{ ns: string; name: string } | null>(null);
  const [protectedResources, setProtectedResources] = useState<Set<string>>(new Set());

  const labelSel = useLabelSelector({ urlKey: "" });
  const textFiltered = (items ?? []).filter(
    (s) =>
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.namespace.toLowerCase().includes(search.toLowerCase()),
  );
  const filtered = textFiltered.filter((s) => labelSel.match(s.labels));

  const { sorted, thProps } = useSortableTable(filtered, {
    name: (s) => s.name,
    namespace: (s) => s.namespace,
    replicas: (s) => s.replicas,
    ready: (s) => s.ready_replicas ?? 0,
    service: (s) => s.service_name,
    age: (s) => Date.now() - new Date(s.created_at).getTime(),
  }, { key: "name", urlKey: "" });

  const pager = usePagination(sorted, { pageSize: 25, urlKey: "" });
  const sel = useRowSelection<StatefulSetSummary>((s) => `${s.namespace}/${s.name}`);

  const handleAction = (ns: string, name: string, action: () => Promise<void>, label: string) => {
    confirmAction.request({
      key: `${ns}/${name}`,
      title: `${label} StatefulSet`,
      message: <span>{label} statefulset <span className="font-semibold text-th-heading">{ns}/{name}</span>?</span>,
      confirmLabel: label,
      fn: async () => {
        setActionLoading(`${ns}/${name}`);
        try {
          await action();
          refresh();
        } finally {
          setActionLoading(null);
        }
      },
      successMsg: `${label} ${name} succeeded`,
    });
  };

  const handleScale = async () => {
    if (!scaleTarget) return;
    setActionLoading(`${scaleTarget.ns}/${scaleTarget.name}`);
    try {
      await scaleStatefulSet(scaleTarget.ns, scaleTarget.name, scaleValue);
      setScaleTarget(null);
      toast.success(`Scaled ${scaleTarget.name} to ${scaleValue} replicas`);
      refresh();
    } catch (e) {
      toast.error("Scale failed", e instanceof Error ? e.message : String(e));
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-th-heading">StatefulSets</h1>
        <div className="flex items-center gap-2">
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
          placeholder="Search statefulsets..."
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

      {!loading && filtered.length > 0 && (() => {
        const healthy = filtered.filter(s => (s.ready_replicas ?? 0) === s.replicas).length;
        const degraded = filtered.length - healthy;
        const healthData = [{ name: "Healthy", value: healthy }, { name: "Degraded", value: degraded }].filter(d => d.value > 0);
        const healthColors: Record<string, string> = { Healthy: "var(--th-ok)", Degraded: "var(--th-warn)" };
        const totalReplicas = filtered.reduce((s, d) => s + d.replicas, 0);
        const totalReady = filtered.reduce((s, d) => s + (d.ready_replicas ?? 0), 0);
        return (
          <div className="grid grid-cols-12 gap-4">
            <div className="col-span-12 md:col-span-4 bg-th-panel border border-th-line rounded-xl p-4 shadow-card">
              <h3 className="text-xs font-bold text-th-dim uppercase tracking-wider mb-2">Health Status</h3>
              <div className="flex items-center gap-4">
                <div className="w-24 h-24">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart><Pie data={healthData} cx="50%" cy="50%" innerRadius={24} outerRadius={42} paddingAngle={3} dataKey="value" stroke="none">
                      {healthData.map(d => <Cell key={d.name} fill={healthColors[d.name] || "var(--th-dim)"} />)}
                    </Pie></PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex flex-col gap-1">
                  {healthData.map(d => (
                    <div key={d.name} className="flex items-center gap-2 text-xs">
                      <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: healthColors[d.name] }} />
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
                <p className="text-[10px] text-th-dim uppercase tracking-wider">StatefulSets</p>
              </div>
              <div className="flex-1 bg-th-panel border border-th-line rounded-xl p-4 shadow-card flex flex-col items-center justify-center">
                <p className="text-3xl font-black text-th-info">{totalReplicas}</p>
                <p className="text-[10px] text-th-dim uppercase tracking-wider">Total Replicas</p>
              </div>
              <div className="flex-1 bg-th-panel border border-th-line rounded-xl p-4 shadow-card flex flex-col items-center justify-center">
                <p className="text-3xl font-black text-th-ok">{totalReady}</p>
                <p className="text-[10px] text-th-dim uppercase tracking-wider">Ready</p>
              </div>
            </div>
          </div>
        );
      })()}

      {scaleTarget && (
        <div className="p-4 bg-th-panel border border-th-line rounded-xl shadow-card">
          <h3 className="text-sm font-medium text-th-body mb-2">
            Scale {scaleTarget.ns}/{scaleTarget.name}
          </h3>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              value={scaleValue}
              onChange={(e) => setScaleValue(parseInt(e.target.value) || 0)}
              className="w-20 px-2 py-1 bg-th-subtle border border-th-line rounded text-sm text-th-body focus:outline-none focus:ring-1 focus:ring-th-accent"
            />
            <button onClick={handleScale} disabled={actionLoading !== null} className="px-3 py-1 text-xs bg-th-accent text-white rounded hover:opacity-90 disabled:opacity-50">
              Apply
            </button>
            <button onClick={() => setScaleTarget(null)} className="px-3 py-1 text-xs text-th-dim hover:text-th-body">
              Cancel
            </button>
          </div>
        </div>
      )}

      {!loading && (
        <div className="bg-th-panel border border-th-line rounded-xl overflow-hidden shadow-card">
          <div className="overflow-x-auto pin-actions">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-th-dim bg-th-subtle border-b border-th-line">
                  <th className="pl-4 pr-1 py-3 w-8"><SelectCheckbox ariaLabel="Select all statefulsets on this page" checked={sel.allSelected(pager.paged)} indeterminate={sel.someSelected(pager.paged)} onChange={() => sel.toggleAll(pager.paged)} /></th>
                  <SortableTh {...thProps("name")}>Name</SortableTh>
                  <SortableTh {...thProps("namespace")}>Namespace</SortableTh>
                  <SortableTh {...thProps("replicas")}>Replicas</SortableTh>
                  <SortableTh {...thProps("ready")}>Ready</SortableTh>
                  <SortableTh {...thProps("service")}>Service</SortableTh>
                  <th className="px-4 py-3 font-medium">Images</th>
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
                      <td className="px-4 py-3 font-medium"><Link to={`/workloads/statefulsets/${s.namespace}/${s.name}`} className="text-th-accent hover:underline">{s.name}</Link></td>
                      <td className="px-4 py-3 text-th-dim">{s.namespace}</td>
                      <td className="px-4 py-3 text-th-dim">{s.replicas}</td>
                      <td className="px-4 py-3">
                        <RatioMeter ready={s.ready_replicas ?? 0} total={s.replicas} />
                      </td>
                      <td className="px-4 py-3 text-th-dim">{s.service_name || "-"}</td>
                      <td className="px-4 py-3 text-th-dim text-xs max-w-xs truncate" title={(s.images || []).join(", ")}>
                        {(s.images || []).map((img) => img.split("/").pop()).join(", ")}
                      </td>
                      <td className="px-4 py-3 text-th-ghost">{age(s.created_at)}</td>
                      <td className="px-2 py-3">
                        <ProtectToggle
                          kind="StatefulSet"
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
                            onClick={() => setDiagnose({ ns: s.namespace, name: s.name })}
                            className="px-2 py-1 text-xs bg-th-accent/10 text-th-accent rounded hover:opacity-80"
                            title="Diagnose the pods behind this statefulset"
                          >
                            Diagnose
                          </button>
                          <button
                            onClick={() => { setScaleTarget({ ns: s.namespace, name: s.name }); setScaleValue(s.replicas); }}
                            disabled={actionLoading === key}
                            className="px-2 py-1 text-xs bg-th-info-s text-th-info rounded hover:opacity-80"
                          >
                            Scale
                          </button>
                          <button
                            onClick={() => handleAction(s.namespace, s.name, () => restartStatefulSet(s.namespace, s.name), "Restart")}
                            disabled={actionLoading === key}
                            className="px-2 py-1 text-xs bg-th-warn-s text-th-warn rounded hover:opacity-80"
                          >
                            Restart
                          </button>
                          <button
                            onClick={() => setDeleteTarget({ ns: s.namespace, name: s.name })}
                            disabled={actionLoading === key}
                            className="px-2 py-1 text-xs bg-th-danger-s text-th-danger rounded hover:opacity-80"
                          >
                            Delete
                          </button>
                          <button
                            onClick={() => setEditWl({ ns: s.namespace, name: s.name })}
                            className="px-2 py-1 text-xs bg-th-accent-s text-th-accent rounded hover:opacity-80"
                            title="Edit replicas, image, and env"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => setEditYaml({ kind: "StatefulSet", ns: s.namespace, name: s.name })}
                            className="px-2 py-1 text-xs bg-th-subtle text-th-body border border-th-line rounded hover:opacity-80"
                          >
                            YAML
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <EmptyRow colSpan={10} title="No statefulsets found" />
                )}
              </tbody>
            </table>
          </div>
          <TablePagination {...pager} label="statefulsets" />
          <BulkActionBar
            selected={sel.selectedRows(items ?? [])}
            noun="statefulsets"
            onClear={sel.clear}
            onComplete={refresh}
            actions={[
              { label: "Restart", gerund: "Restarting", run: (s) => restartStatefulSet(s.namespace, s.name) },
              { label: "Scale to 0", gerund: "Scaling", run: (s) => scaleStatefulSet(s.namespace, s.name, 0) },
              { label: "Delete", danger: true, gerund: "Deleting", run: (s) => deleteStatefulSet(s.namespace, s.name) },
            ]}
          />
        </div>
      )}

      {showCreate && (
        <CreateWorkloadModal
          defaultKind="StatefulSet"
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
      {editWl && (
        <EditWorkloadModal
          kind="StatefulSet"
          namespace={editWl.ns}
          name={editWl.name}
          onClose={() => setEditWl(null)}
          onSaved={() => { setEditWl(null); refresh(); }}
        />
      )}
      <DeleteConfirmModal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onDeleted={refresh}
        resourceType="StatefulSet"
        resourceName={deleteTarget?.name ?? ""}
        namespace={deleteTarget?.ns}
        kind="StatefulSet"
        deleteFn={() => deleteStatefulSet(deleteTarget!.ns, deleteTarget!.name)}
      />
      {diagnose && (
        <DiagnoseModal kind="StatefulSet" namespace={diagnose.ns} name={diagnose.name} onClose={() => setDiagnose(null)} />
      )}
      {confirmAction.modal}
    </div>
  );
}
