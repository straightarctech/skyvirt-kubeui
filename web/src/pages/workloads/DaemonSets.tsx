import { useState, useMemo } from "react";
import { useUrlSearch } from "@/hooks/useUrlState";
import { EmptyRow } from "@/components/EmptyState";
import { TableSkeleton } from "@/components/Skeleton";
import { useOutletContext, Link } from "react-router-dom";
import { listDaemonSets, restartDaemonSet, deleteDaemonSet } from "@/api/client";
import type { DaemonSetSummary } from "@/api/client";
import { useLiveResource } from "@/hooks/useLiveResource";
import LiveIndicator from "@/components/LiveIndicator";
import { useConfirmAction } from "@/hooks/useConfirmAction";
import { useSortableTable, SortableTh } from "@/hooks/useSortableTable";
import { usePagination, TablePagination } from "@/hooks/usePagination";
import { useRowSelection } from "@/hooks/useRowSelection";
import BulkActionBar, { SelectCheckbox } from "@/components/BulkActionBar";
import { useLabelSelector, LabelSelectorInput } from "@/hooks/useLabelSelector";
import { RatioMeter } from "@/components/viz";
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import CreateWorkloadModal from "@/components/CreateWorkloadModal";
import EditYAMLModal from "@/components/EditYAMLModal";
import EditWorkloadModal from "@/components/EditWorkloadModal";
import DeleteConfirmModal from "@/components/DeleteConfirmModal";
import DiagnoseModal from "@/components/DiagnoseModal";
import ProtectToggle from "@/components/ProtectToggle";

function age(created: string): string {
  const diff = Date.now() - new Date(created).getTime();
  const days = Math.floor(diff / 86400000);
  if (days > 0) return `${days}d`;
  const hours = Math.floor(diff / 3600000);
  if (hours > 0) return `${hours}h`;
  const mins = Math.floor(diff / 60000);
  return `${mins}m`;
}

const HEALTH_COLORS: Record<string, string> = {
  Healthy: "var(--th-ok)",
  Degraded: "var(--th-warn)",
};

export default function DaemonSets() {
  const { namespace } = useOutletContext<{ namespace: string }>();
  const { data: items, loading, error, refresh, watchStatus, live, setLive } = useLiveResource<DaemonSetSummary[]>(
    () => listDaemonSets(namespace),
    "DaemonSet",
    namespace,
    [namespace],
  );
  const confirmAction = useConfirmAction();
  const [search, setSearch] = useUrlSearch();
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editYaml, setEditYaml] = useState<{ kind: string; ns: string; name: string } | null>(null);
  const [editWl, setEditWl] = useState<{ ns: string; name: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ ns: string; name: string } | null>(null);
  const [diagnose, setDiagnose] = useState<{ ns: string; name: string } | null>(null);
  const [protectedResources, setProtectedResources] = useState<Set<string>>(new Set());

  const labelSel = useLabelSelector({ urlKey: "" });
  const textFiltered = (items ?? []).filter(
    (d) =>
      d.name.toLowerCase().includes(search.toLowerCase()) ||
      d.namespace.toLowerCase().includes(search.toLowerCase()),
  );
  const filtered = textFiltered.filter((d) => labelSel.match(d.labels));

  const { sorted, thProps } = useSortableTable(filtered, {
    name: (d) => d.name,
    namespace: (d) => d.namespace,
    desired: (d) => d.desired,
    current: (d) => d.current,
    ready: (d) => d.ready,
    age: (d) => Date.now() - new Date(d.created_at).getTime(),
  }, { key: "name", urlKey: "" });

  const pager = usePagination(sorted, { pageSize: 25, urlKey: "" });
  const sel = useRowSelection<DaemonSetSummary>((d) => `${d.namespace}/${d.name}`);

  const { healthData, totalDesired, totalReady } = useMemo(() => {
    let healthy = 0;
    let degraded = 0;
    let desired = 0;
    let ready = 0;
    filtered.forEach((d) => {
      if (d.ready === d.desired) healthy++;
      else degraded++;
      desired += d.desired;
      ready += d.ready;
    });
    const data: { name: string; value: number }[] = [];
    if (healthy > 0) data.push({ name: "Healthy", value: healthy });
    if (degraded > 0) data.push({ name: "Degraded", value: degraded });
    return { healthData: data, totalDesired: desired, totalReady: ready };
  }, [filtered]);

  const handleAction = (ns: string, name: string, action: () => Promise<void>, label: string) => {
    confirmAction.request({
      key: `${ns}/${name}`,
      title: `${label} DaemonSet`,
      message: <span>{label} daemonset <span className="font-semibold text-th-heading">{ns}/{name}</span>?</span>,
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

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-th-heading">DaemonSets</h1>
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
          placeholder="Search daemonsets..."
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

      {/* Visual summary */}
      {!loading && filtered.length > 0 && (
        <div className="grid grid-cols-12 gap-4">
          {/* Health donut */}
          <div className="col-span-12 md:col-span-5 bg-th-panel border border-th-line rounded-xl p-4 shadow-card">
            <h3 className="text-xs font-bold text-th-dim uppercase tracking-wider mb-2">DaemonSet Health</h3>
            <div className="flex items-center gap-4">
              <div className="w-24 h-24">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={healthData} cx="50%" cy="50%" innerRadius={24} outerRadius={42} paddingAngle={2} dataKey="value" stroke="none">
                      {healthData.map((d) => <Cell key={d.name} fill={HEALTH_COLORS[d.name] || "var(--th-dim)"} />)}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-col gap-1">
                {healthData.map((d) => (
                  <div key={d.name} className="flex items-center gap-2 text-xs">
                    <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: HEALTH_COLORS[d.name] || "var(--th-dim)" }} />
                    <span className="text-th-dim w-16">{d.name}</span>
                    <span className="font-semibold text-th-body">{d.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Stat cards */}
          <div className="col-span-12 md:col-span-7 grid grid-cols-3 gap-4">
            <div className="bg-th-panel border border-th-line rounded-xl p-4 shadow-card flex flex-col items-center justify-center">
              <p className="text-3xl font-black text-th-accent">{filtered.length}</p>
              <p className="text-[10px] text-th-dim uppercase tracking-wider">Total DaemonSets</p>
            </div>
            <div className="bg-th-panel border border-th-line rounded-xl p-4 shadow-card flex flex-col items-center justify-center">
              <p className="text-3xl font-black text-th-info">{totalDesired}</p>
              <p className="text-[10px] text-th-dim uppercase tracking-wider">Total Desired</p>
            </div>
            <div className="bg-th-panel border border-th-line rounded-xl p-4 shadow-card flex flex-col items-center justify-center">
              <p className="text-3xl font-black text-th-ok">{totalReady}</p>
              <p className="text-[10px] text-th-dim uppercase tracking-wider">Total Ready</p>
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
                  <th className="pl-4 pr-1 py-3 w-8"><SelectCheckbox ariaLabel="Select all daemonsets on this page" checked={sel.allSelected(pager.paged)} indeterminate={sel.someSelected(pager.paged)} onChange={() => sel.toggleAll(pager.paged)} /></th>
                  <SortableTh {...thProps("name")}>Name</SortableTh>
                  <SortableTh {...thProps("namespace")}>Namespace</SortableTh>
                  <SortableTh {...thProps("desired")}>Desired</SortableTh>
                  <SortableTh {...thProps("current")}>Current</SortableTh>
                  <SortableTh {...thProps("ready")}>Ready</SortableTh>
                  <th className="px-4 py-3 font-medium">Images</th>
                  <SortableTh {...thProps("age")}>Age</SortableTh>
                  <th className="w-10 px-2 py-3 font-medium" title="Protection"></th>
                  <th className="px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pager.paged.map((d) => {
                  const key = `${d.namespace}/${d.name}`;
                  return (
                    <tr key={key} className={`border-b border-th-line last:border-0 hover:bg-th-hover transition-colors ${sel.isSelected(key) ? "bg-th-accent/5" : ""}`}>
                      <td className="pl-4 pr-1 py-3"><SelectCheckbox ariaLabel={`Select ${d.name}`} checked={sel.isSelected(key)} onChange={() => sel.toggle(key)} /></td>
                      <td className="px-4 py-3 font-medium"><Link to={`/workloads/daemonsets/${d.namespace}/${d.name}`} className="text-th-accent hover:underline">{d.name}</Link></td>
                      <td className="px-4 py-3 text-th-dim">{d.namespace}</td>
                      <td className="px-4 py-3 text-th-dim">{d.desired}</td>
                      <td className="px-4 py-3 text-th-dim">{d.current}</td>
                      <td className="px-4 py-3">
                        <RatioMeter ready={d.ready} total={d.desired} />
                      </td>
                      <td className="px-4 py-3 text-th-dim text-xs max-w-xs truncate" title={(d.images || []).join(", ")}>
                        {(d.images || []).map((img) => img.split("/").pop()).join(", ")}
                      </td>
                      <td className="px-4 py-3 text-th-ghost">{age(d.created_at)}</td>
                      <td className="px-2 py-3">
                        <ProtectToggle
                          kind="DaemonSet"
                          namespace={d.namespace}
                          name={d.name}
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
                            onClick={() => setDiagnose({ ns: d.namespace, name: d.name })}
                            className="px-2 py-1 text-xs bg-th-accent/10 text-th-accent rounded hover:opacity-80"
                            title="Diagnose the pods behind this daemonset"
                          >
                            Diagnose
                          </button>
                          <button
                            onClick={() => handleAction(d.namespace, d.name, () => restartDaemonSet(d.namespace, d.name), "Restart")}
                            disabled={actionLoading === key}
                            className="px-2 py-1 text-xs bg-th-warn-s text-th-warn rounded hover:opacity-80"
                          >
                            Restart
                          </button>
                          <button
                            onClick={() => setDeleteTarget({ ns: d.namespace, name: d.name })}
                            disabled={actionLoading === key}
                            className="px-2 py-1 text-xs bg-th-danger-s text-th-danger rounded hover:opacity-80"
                          >
                            Delete
                          </button>
                          <button
                            onClick={() => setEditWl({ ns: d.namespace, name: d.name })}
                            className="px-2 py-1 text-xs bg-th-accent-s text-th-accent rounded hover:opacity-80"
                            title="Edit image and env"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => setEditYaml({ kind: "DaemonSet", ns: d.namespace, name: d.name })}
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
                  <EmptyRow colSpan={10} title="No daemonsets found" />
                )}
              </tbody>
            </table>
          </div>
          <TablePagination {...pager} label="daemonsets" />
          <BulkActionBar
            selected={sel.selectedRows(items ?? [])}
            noun="daemonsets"
            onClear={sel.clear}
            onComplete={refresh}
            actions={[
              { label: "Restart", gerund: "Restarting", run: (d) => restartDaemonSet(d.namespace, d.name) },
              { label: "Delete", danger: true, gerund: "Deleting", run: (d) => deleteDaemonSet(d.namespace, d.name) },
            ]}
          />
        </div>
      )}

      {showCreate && (
        <CreateWorkloadModal
          defaultKind="DaemonSet"
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
          kind="DaemonSet"
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
        resourceType="DaemonSet"
        resourceName={deleteTarget?.name ?? ""}
        namespace={deleteTarget?.ns}
        kind="DaemonSet"
        deleteFn={() => deleteDaemonSet(deleteTarget!.ns, deleteTarget!.name)}
      />
      {diagnose && (
        <DiagnoseModal kind="DaemonSet" namespace={diagnose.ns} name={diagnose.name} onClose={() => setDiagnose(null)} />
      )}
      {confirmAction.modal}
    </div>
  );
}
