import { useState, useMemo } from "react";
import { useUrlSearch } from "@/hooks/useUrlState";
import { EmptyRow } from "@/components/EmptyState";
import { TableSkeleton } from "@/components/Skeleton";
import { useOutletContext, Link } from "react-router-dom";
import { listCronJobs, deleteCronJob, suspendCronJob } from "@/api/client";
import type { CronJobSummary } from "@/api/client";
import { useLiveResource } from "@/hooks/useLiveResource";
import LiveIndicator from "@/components/LiveIndicator";
import { useSortableTable, SortableTh } from "@/hooks/useSortableTable";
import { usePagination, TablePagination } from "@/hooks/usePagination";
import { useRowSelection } from "@/hooks/useRowSelection";
import BulkActionBar, { SelectCheckbox } from "@/components/BulkActionBar";
import { useToast } from "@/components/Toast";
import CreateWorkloadModal from "@/components/CreateWorkloadModal";
import EditYAMLModal from "@/components/EditYAMLModal";
import EditCronJobModal from "@/components/EditCronJobModal";
import DeleteConfirmModal from "@/components/DeleteConfirmModal";
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";

const SUSPEND_COLORS: Record<string, string> = { Active: "var(--th-ok)", Suspended: "var(--th-warn)" };

function age(created: string): string {
  const diff = Date.now() - new Date(created).getTime();
  const days = Math.floor(diff / 86400000);
  if (days > 0) return `${days}d`;
  const hours = Math.floor(diff / 3600000);
  if (hours > 0) return `${hours}h`;
  const mins = Math.floor(diff / 60000);
  return `${mins}m`;
}

export default function CronJobs() {
  const { namespace } = useOutletContext<{ namespace: string }>();
  const { data: items, loading, error, refresh, watchStatus, live, setLive } = useLiveResource<CronJobSummary[]>(
    () => listCronJobs(namespace),
    "CronJob",
    namespace,
    [namespace],
  );
  const toast = useToast();
  const [search, setSearch] = useUrlSearch();
  const [showCreate, setShowCreate] = useState(false);
  const [editYaml, setEditYaml] = useState<{ kind: string; ns: string; name: string } | null>(null);
  const [editCron, setEditCron] = useState<{ ns: string; name: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ ns: string; name: string } | null>(null);
  const [suspendLoading, setSuspendLoading] = useState<string | null>(null);

  const handleSuspendToggle = async (ns: string, name: string, currentlySuspended: boolean) => {
    setSuspendLoading(`${ns}/${name}`);
    try {
      await suspendCronJob(ns, name, !currentlySuspended);
      toast.success(`${currentlySuspended ? "Resumed" : "Suspended"} ${name}`);
      refresh();
    } catch (e) {
      toast.error(`Failed to ${currentlySuspended ? "resume" : "suspend"} ${name}`, e instanceof Error ? e.message : String(e));
    } finally {
      setSuspendLoading(null);
    }
  };

  const filtered = (items ?? []).filter(
    (c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.namespace.toLowerCase().includes(search.toLowerCase()),
  );

  const { sorted, thProps } = useSortableTable(filtered, {
    name: (c) => c.name,
    namespace: (c) => c.namespace,
    schedule: (c) => c.schedule,
    suspend: (c) => (c.suspend ? 1 : 0),
    active: (c) => c.active_count,
    last_schedule: (c) => (c.last_schedule ? new Date(c.last_schedule).getTime() : null),
    age: (c) => Date.now() - new Date(c.created_at).getTime(),
  }, { key: "name", urlKey: "" });

  const pager = usePagination(sorted, { pageSize: 25, urlKey: "" });
  const sel = useRowSelection<CronJobSummary>((c) => `${c.namespace}/${c.name}`);

  const suspendData = useMemo(() => {
    const active = filtered.filter((c) => !c.suspend).length;
    const suspended = filtered.length - active;
    return [{ name: "Active", value: active }, { name: "Suspended", value: suspended }].filter((d) => d.value > 0);
  }, [filtered]);

  const totalActive = useMemo(() => filtered.reduce((s, c) => s + (c.active_count || 0), 0), [filtered]);

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-th-heading">CronJobs</h1>
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

      <input
        type="text"
        placeholder="Search cronjobs..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full max-w-sm px-3 py-2 bg-th-subtle border border-th-line rounded-lg text-sm text-th-body placeholder:text-th-ghost focus:outline-none focus:ring-1 focus:ring-th-accent"
      />

      {loading && <TableSkeleton />}
      {error && <div className="p-3 bg-th-danger-s text-th-danger rounded-lg text-sm">{error}</div>}

      {!loading && filtered.length > 0 && (
        <div className="grid grid-cols-12 gap-4">
          <div className="col-span-12 md:col-span-4 bg-th-panel border border-th-line rounded-xl p-4 shadow-card">
            <h3 className="text-xs font-bold text-th-dim uppercase tracking-wider mb-2">Schedule Status</h3>
            <div className="flex items-center gap-4">
              <div className="w-24 h-24">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart><Pie data={suspendData} cx="50%" cy="50%" innerRadius={24} outerRadius={42} paddingAngle={3} dataKey="value" stroke="none">
                    {suspendData.map((d) => <Cell key={d.name} fill={SUSPEND_COLORS[d.name] || "var(--th-dim)"} />)}
                  </Pie></PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-col gap-1">
                {suspendData.map((d) => (
                  <div key={d.name} className="flex items-center gap-2 text-xs">
                    <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: SUSPEND_COLORS[d.name] }} />
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
              <p className="text-[10px] text-th-dim uppercase tracking-wider">CronJobs</p>
            </div>
            <div className="flex-1 bg-th-panel border border-th-line rounded-xl p-4 shadow-card flex flex-col items-center justify-center">
              <p className="text-3xl font-black text-th-ok">{filtered.filter((c) => !c.suspend).length}</p>
              <p className="text-[10px] text-th-dim uppercase tracking-wider">Active</p>
            </div>
            <div className="flex-1 bg-th-panel border border-th-line rounded-xl p-4 shadow-card flex flex-col items-center justify-center">
              <p className="text-3xl font-black text-th-info">{totalActive}</p>
              <p className="text-[10px] text-th-dim uppercase tracking-wider">Running Jobs</p>
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
                  <th className="pl-4 pr-1 py-3 w-8"><SelectCheckbox ariaLabel="Select all cronjobs on this page" checked={sel.allSelected(pager.paged)} indeterminate={sel.someSelected(pager.paged)} onChange={() => sel.toggleAll(pager.paged)} /></th>
                  <SortableTh {...thProps("name")}>Name</SortableTh>
                  <SortableTh {...thProps("namespace")}>Namespace</SortableTh>
                  <SortableTh {...thProps("schedule")}>Schedule</SortableTh>
                  <SortableTh {...thProps("suspend")}>Suspend</SortableTh>
                  <SortableTh {...thProps("active")}>Active</SortableTh>
                  <SortableTh {...thProps("last_schedule")}>Last Schedule</SortableTh>
                  <SortableTh {...thProps("age")}>Age</SortableTh>
                  <th className="px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pager.paged.map((c) => {
                  const key = `${c.namespace}/${c.name}`;
                  return (
                    <tr key={key} className={`border-b border-th-line last:border-0 hover:bg-th-hover transition-colors ${sel.isSelected(key) ? "bg-th-accent/5" : ""}`}>
                      <td className="pl-4 pr-1 py-3"><SelectCheckbox ariaLabel={`Select ${c.name}`} checked={sel.isSelected(key)} onChange={() => sel.toggle(key)} /></td>
                      <td className="px-4 py-3 font-medium"><Link to={`/workloads/cronjobs/${c.namespace}/${c.name}`} className="text-th-accent hover:underline">{c.name}</Link></td>
                      <td className="px-4 py-3 text-th-dim">{c.namespace}</td>
                      <td className="px-4 py-3 text-th-body font-mono text-xs">{c.schedule}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${c.suspend ? "bg-th-warn-s text-th-warn" : "bg-th-ok-s text-th-ok"}`}>
                          {c.suspend ? "Yes" : "No"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-th-dim">{c.active_count}</td>
                      <td className="px-4 py-3 text-th-ghost text-xs">
                        {c.last_schedule ? new Date(c.last_schedule).toLocaleString() : "-"}
                      </td>
                      <td className="px-4 py-3 text-th-ghost">{age(c.created_at)}</td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          <button
                            onClick={() => handleSuspendToggle(c.namespace, c.name, c.suspend)}
                            disabled={suspendLoading === `${c.namespace}/${c.name}`}
                            className={`px-2 py-1 text-xs rounded hover:opacity-80 ${c.suspend ? "bg-th-ok-s text-th-ok" : "bg-th-warn-s text-th-warn"}`}
                          >
                            {suspendLoading === `${c.namespace}/${c.name}` ? "..." : c.suspend ? "Resume" : "Suspend"}
                          </button>
                          <button
                            onClick={() => setDeleteTarget({ ns: c.namespace, name: c.name })}
                            className="px-2 py-1 text-xs bg-th-danger-s text-th-danger rounded hover:opacity-80"
                          >
                            Delete
                          </button>
                          <button
                            onClick={() => setEditCron({ ns: c.namespace, name: c.name })}
                            className="px-2 py-1 text-xs bg-th-accent-s text-th-accent rounded hover:opacity-80"
                            title="Edit schedule, suspend, image, and env"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => setEditYaml({ kind: "CronJob", ns: c.namespace, name: c.name })}
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
                  <EmptyRow colSpan={9} title="No cronjobs found" />
                )}
              </tbody>
            </table>
          </div>
          <TablePagination {...pager} label="cronjobs" />
          <BulkActionBar
            selected={sel.selectedRows(items ?? [])}
            noun="cronjobs"
            onClear={sel.clear}
            onComplete={refresh}
            actions={[
              { label: "Delete", danger: true, gerund: "Deleting", run: (c) => deleteCronJob(c.namespace, c.name) },
            ]}
          />
        </div>
      )}

      {showCreate && (
        <CreateWorkloadModal
          defaultKind="CronJob"
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
      {editCron && (
        <EditCronJobModal
          namespace={editCron.ns}
          name={editCron.name}
          onClose={() => setEditCron(null)}
          onSaved={() => { setEditCron(null); refresh(); }}
        />
      )}
      <DeleteConfirmModal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onDeleted={refresh}
        resourceType="CronJob"
        resourceName={deleteTarget?.name ?? ""}
        namespace={deleteTarget?.ns}
        kind="CronJob"
        deleteFn={() => deleteCronJob(deleteTarget!.ns, deleteTarget!.name)}
      />
    </div>
  );
}
