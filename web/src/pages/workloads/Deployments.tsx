import { useState, useMemo } from "react";
import { useUrlSearch } from "@/hooks/useUrlState";
import { TableSkeleton } from "@/components/Skeleton";
import { useOutletContext, Link } from "react-router-dom";
import {
  listDeployments,
  scaleDeployment,
  restartDeployment,
  rollbackDeployment,
  deleteDeployment,
} from "@/api/client";
import type { DeploymentSummary } from "@/api/client";
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
import { EmptyRow } from "@/components/EmptyState";
import ProtectToggle from "@/components/ProtectToggle";
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip } from "recharts";

function age(created: string): string {
  const diff = Date.now() - new Date(created).getTime();
  const days = Math.floor(diff / 86400000);
  if (days > 0) return `${days}d`;
  const hours = Math.floor(diff / 3600000);
  if (hours > 0) return `${hours}h`;
  const mins = Math.floor(diff / 60000);
  return `${mins}m`;
}

export default function Deployments() {
  const { namespace } = useOutletContext<{ namespace: string }>();
  const { data: deployments, loading, error, refresh, watchStatus, live, setLive } = useLiveResource<DeploymentSummary[]>(
    () => listDeployments(namespace),
    "Deployment",
    namespace,
    [namespace],
    { keyOf: (d) => `${(d as DeploymentSummary).namespace}/${(d as DeploymentSummary).name}` },
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
  const textFiltered = (deployments ?? []).filter(
    (d) =>
      d.name.toLowerCase().includes(search.toLowerCase()) ||
      d.namespace.toLowerCase().includes(search.toLowerCase()),
  );
  const filtered = textFiltered.filter((d) => labelSel.match(d.labels));

  const { sorted, thProps } = useSortableTable(filtered, {
    name: (d) => d.name,
    namespace: (d) => d.namespace,
    replicas: (d) => d.replicas,
    ready: (d) => d.ready_replicas ?? 0,
    age: (d) => Date.now() - new Date(d.created_at).getTime(),
  }, { key: "name", urlKey: "" });

  const pager = usePagination(sorted, { pageSize: 25, urlKey: "" });
  const sel = useRowSelection<DeploymentSummary>((d) => `${d.namespace}/${d.name}`);

  const healthData = useMemo(() => {
    const healthy = filtered.filter((d) => d.ready_replicas === d.replicas).length;
    const degraded = filtered.length - healthy;
    return [{ name: "Healthy", value: healthy }, { name: "Degraded", value: degraded }].filter((d) => d.value > 0);
  }, [filtered]);
  const HEALTH_COLORS: Record<string, string> = { Healthy: "var(--th-ok)", Degraded: "var(--th-warn)" };

  const quickStats = useMemo(() => ({
    totalDeploys: filtered.length,
    totalReplicas: filtered.reduce((s, d) => s + d.replicas, 0),
    totalReady: filtered.reduce((s, d) => s + (d.ready_replicas ?? 0), 0),
  }), [filtered]);

  const nsBarData = useMemo(() => {
    const counts: Record<string, number> = {};
    filtered.forEach((d) => { counts[d.namespace] = (counts[d.namespace] || 0) + 1; });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 6)
      .map(([ns, count]) => ({ name: ns.length > 14 ? ns.slice(0, 14) + "..." : ns, deployments: count }));
  }, [filtered]);

  const handleAction = (ns: string, name: string, action: () => Promise<void>, label: string) => {
    confirmAction.request({
      key: `${ns}/${name}`,
      title: `${label} Deployment`,
      message: <span>{label} deployment <span className="font-semibold text-th-heading">{ns}/{name}</span>?</span>,
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
      await scaleDeployment(scaleTarget.ns, scaleTarget.name, scaleValue);
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
        <h1 className="text-2xl font-bold text-th-heading">Deployments</h1>
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
          placeholder="Search deployments..."
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
            <h3 className="text-xs font-bold text-th-dim uppercase tracking-wider mb-2">Health Status</h3>
            <div className="flex items-center gap-4">
              <div className="w-24 h-24">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart><Pie data={healthData} cx="50%" cy="50%" innerRadius={24} outerRadius={42} paddingAngle={3} dataKey="value" stroke="none">
                    {healthData.map((d) => <Cell key={d.name} fill={HEALTH_COLORS[d.name] || "var(--th-dim)"} />)}
                  </Pie></PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-col gap-1">
                {healthData.map((d) => (
                  <div key={d.name} className="flex items-center gap-2 text-xs">
                    <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: HEALTH_COLORS[d.name] }} />
                    <span className="text-th-dim">{d.name}</span>
                    <span className="font-semibold text-th-body">{d.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="col-span-12 md:col-span-3 flex flex-col gap-3">
            <div className="flex-1 bg-th-panel border border-th-line rounded-xl p-4 shadow-card flex flex-col items-center justify-center">
              <p className="text-3xl font-black text-th-accent">{quickStats.totalDeploys}</p>
              <p className="text-[10px] text-th-dim uppercase tracking-wider">Deployments</p>
            </div>
            <div className="flex-1 bg-th-panel border border-th-line rounded-xl p-4 shadow-card flex flex-col items-center justify-center">
              <p className="text-3xl font-black text-th-info">{quickStats.totalReplicas}</p>
              <p className="text-[10px] text-th-dim uppercase tracking-wider">Total Replicas</p>
            </div>
            <div className="flex-1 bg-th-panel border border-th-line rounded-xl p-4 shadow-card flex flex-col items-center justify-center">
              <p className="text-3xl font-black text-th-ok">{quickStats.totalReady}</p>
              <p className="text-[10px] text-th-dim uppercase tracking-wider">Ready</p>
            </div>
          </div>
          <div className="col-span-12 md:col-span-5 bg-th-panel border border-th-line rounded-xl p-4 shadow-card">
            <h3 className="text-xs font-bold text-th-dim uppercase tracking-wider mb-2">By Namespace</h3>
            {nsBarData.length > 0 ? (
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={nsBarData} layout="vertical">
                    <XAxis type="number" tick={{ fontSize: 10, fill: "var(--th-dim)" }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: "var(--th-dim)" }} axisLine={false} tickLine={false} width={100} />
                    <Tooltip contentStyle={{ backgroundColor: "var(--th-panel)", border: "1px solid var(--th-line)", borderRadius: "8px", fontSize: "11px" }} labelStyle={{ color: "var(--th-heading)" }} />
                    <Bar dataKey="deployments" fill="var(--th-accent)" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="text-xs text-th-ghost py-8 text-center">No namespace data</p>
            )}
          </div>
        </div>
      )}

      {/* Scale modal */}
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
            <button
              onClick={handleScale}
              disabled={actionLoading !== null}
              className="px-3 py-1 text-xs bg-th-accent text-white rounded hover:opacity-90 disabled:opacity-50"
            >
              Apply
            </button>
            <button
              onClick={() => setScaleTarget(null)}
              className="px-3 py-1 text-xs text-th-dim hover:text-th-body"
            >
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
                  <th className="pl-4 pr-1 py-3 w-8">
                    <SelectCheckbox
                      ariaLabel="Select all deployments on this page"
                      checked={sel.allSelected(pager.paged)}
                      indeterminate={sel.someSelected(pager.paged)}
                      onChange={() => sel.toggleAll(pager.paged)}
                    />
                  </th>
                  <SortableTh {...thProps("name")}>Name</SortableTh>
                  <SortableTh {...thProps("namespace")}>Namespace</SortableTh>
                  <SortableTh {...thProps("replicas")}>Replicas</SortableTh>
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
                      <td className="pl-4 pr-1 py-3">
                        <SelectCheckbox ariaLabel={`Select ${d.name}`} checked={sel.isSelected(key)} onChange={() => sel.toggle(key)} />
                      </td>
                      <td className="px-4 py-3 font-medium"><Link to={`/workloads/deployments/${d.namespace}/${d.name}`} className="text-th-accent hover:underline">{d.name}</Link></td>
                      <td className="px-4 py-3 text-th-dim">{d.namespace}</td>
                      <td className="px-4 py-3 text-th-dim">{d.replicas}</td>
                      <td className="px-4 py-3">
                        <RatioMeter ready={d.ready_replicas ?? 0} total={d.replicas} />
                      </td>
                      <td className="px-4 py-3 text-th-dim text-xs max-w-xs truncate" title={(d.images || []).join(", ")}>
                        {(d.images || []).map((img) => img.split("/").pop()).join(", ")}
                      </td>
                      <td className="px-4 py-3 text-th-ghost">{age(d.created_at)}</td>
                      <td className="px-2 py-3">
                        <ProtectToggle
                          kind="Deployment"
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
                            title="Diagnose the pods behind this deployment"
                          >
                            Diagnose
                          </button>
                          <button
                            onClick={() => {
                              setScaleTarget({ ns: d.namespace, name: d.name });
                              setScaleValue(d.replicas);
                            }}
                            disabled={actionLoading === key}
                            className="px-2 py-1 text-xs bg-th-info-s text-th-info rounded hover:opacity-80"
                          >
                            Scale
                          </button>
                          <button
                            onClick={() =>
                              handleAction(d.namespace, d.name, () => restartDeployment(d.namespace, d.name), "Restart")
                            }
                            disabled={actionLoading === key}
                            className="px-2 py-1 text-xs bg-th-warn-s text-th-warn rounded hover:opacity-80"
                          >
                            Restart
                          </button>
                          <button
                            onClick={() =>
                              handleAction(d.namespace, d.name, () => rollbackDeployment(d.namespace, d.name), "Rollback")
                            }
                            disabled={actionLoading === key}
                            className="px-2 py-1 text-xs bg-th-accent/20 text-th-accent rounded hover:opacity-80"
                          >
                            Rollback
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
                            title="Edit replicas, image, and env"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => setEditYaml({ kind: "Deployment", ns: d.namespace, name: d.name })}
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
                  <EmptyRow
                    colSpan={9}
                    title={search ? "No matching deployments" : "No deployments"}
                    hint={search ? "Try a different search or label filter." : "Create a deployment to run a scalable, self-healing set of pods."}
                  />
                )}
              </tbody>
            </table>
          </div>
          <TablePagination {...pager} label="deployments" />
          <BulkActionBar
            selected={sel.selectedRows(deployments ?? [])}
            noun="deployments"
            onClear={sel.clear}
            onComplete={refresh}
            actions={[
              { label: "Restart", gerund: "Restarting", run: (d) => restartDeployment(d.namespace, d.name) },
              { label: "Scale to 0", gerund: "Scaling", run: (d) => scaleDeployment(d.namespace, d.name, 0) },
              { label: "Delete", danger: true, gerund: "Deleting", run: (d) => deleteDeployment(d.namespace, d.name) },
            ]}
          />
        </div>
      )}

      {showCreate && (
        <CreateWorkloadModal
          defaultKind="Deployment"
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
          kind="Deployment"
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
        resourceType="Deployment"
        resourceName={deleteTarget?.name ?? ""}
        namespace={deleteTarget?.ns}
        kind="Deployment"
        deleteFn={() => deleteDeployment(deleteTarget!.ns, deleteTarget!.name)}
      />
      {diagnose && (
        <DiagnoseModal kind="Deployment" namespace={diagnose.ns} name={diagnose.name} onClose={() => setDiagnose(null)} />
      )}
      {confirmAction.modal}
    </div>
  );
}
