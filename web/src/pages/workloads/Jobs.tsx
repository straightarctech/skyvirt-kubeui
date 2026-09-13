import { useState, useMemo } from "react";
import { useUrlSearch } from "@/hooks/useUrlState";
import { EmptyRow } from "@/components/EmptyState";
import { TableSkeleton } from "@/components/Skeleton";
import { useOutletContext, Link } from "react-router-dom";
import { listJobs, deleteJob } from "@/api/client";
import type { JobSummary } from "@/api/client";
import { useLiveResource } from "@/hooks/useLiveResource";
import LiveIndicator from "@/components/LiveIndicator";
import { RatioMeter } from "@/components/viz";
import { useSortableTable, SortableTh } from "@/hooks/useSortableTable";
import { usePagination, TablePagination } from "@/hooks/usePagination";
import { useRowSelection } from "@/hooks/useRowSelection";
import BulkActionBar, { SelectCheckbox } from "@/components/BulkActionBar";
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import CreateWorkloadModal from "@/components/CreateWorkloadModal";
import EditYAMLModal from "@/components/EditYAMLModal";
import EditJobModal from "@/components/EditJobModal";
import DeleteConfirmModal from "@/components/DeleteConfirmModal";

function age(created: string): string {
  const diff = Date.now() - new Date(created).getTime();
  const days = Math.floor(diff / 86400000);
  if (days > 0) return `${days}d`;
  const hours = Math.floor(diff / 3600000);
  if (hours > 0) return `${hours}h`;
  const mins = Math.floor(diff / 60000);
  return `${mins}m`;
}

function statusColor(job: JobSummary): string {
  if (job.succeeded > 0 && job.failed === 0) return "bg-th-ok-s text-th-ok";
  if (job.failed > 0) return "bg-th-danger-s text-th-danger";
  if (job.active > 0) return "bg-th-info-s text-th-info";
  return "bg-th-muted text-th-dim";
}

function statusLabel(job: JobSummary): string {
  if (job.succeeded > 0 && job.failed === 0) return "Complete";
  if (job.failed > 0) return "Failed";
  if (job.active > 0) return "Running";
  return "Pending";
}

const STATUS_COLORS: Record<string, string> = {
  Complete: "var(--th-ok)",
  Failed: "var(--th-danger)",
  Running: "#3b82f6",
  Pending: "var(--th-warn)",
};

export default function Jobs() {
  const { namespace } = useOutletContext<{ namespace: string }>();
  const { data: items, loading, error, refresh, watchStatus, live, setLive } = useLiveResource<JobSummary[]>(
    () => listJobs(namespace),
    "Job",
    namespace,
    [namespace],
  );
  const [search, setSearch] = useUrlSearch();
  const [showCreate, setShowCreate] = useState(false);
  const [editYaml, setEditYaml] = useState<{ kind: string; ns: string; name: string } | null>(null);
  const [editJob, setEditJob] = useState<{ ns: string; name: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ ns: string; name: string } | null>(null);

  const filtered = (items ?? []).filter(
    (j) =>
      j.name.toLowerCase().includes(search.toLowerCase()) ||
      j.namespace.toLowerCase().includes(search.toLowerCase()),
  );

  const { sorted, thProps } = useSortableTable(filtered, {
    name: (j) => j.name,
    namespace: (j) => j.namespace,
    status: (j) => (j.succeeded > 0 && j.failed === 0 ? "Complete" : j.failed > 0 ? "Failed" : j.active > 0 ? "Running" : "Pending"),
    completions: (j) => j.completions,
    succeeded: (j) => j.succeeded,
    failed: (j) => j.failed,
    active: (j) => j.active,
    duration: (j) => j.duration,
    age: (j) => Date.now() - new Date(j.created_at).getTime(),
  }, { key: "name", urlKey: "" });

  const pager = usePagination(sorted, { pageSize: 25, urlKey: "" });
  const sel = useRowSelection<JobSummary>((j) => `${j.namespace}/${j.name}`);

  const { statusData, succeededCount, failedCount } = useMemo(() => {
    const counts: Record<string, number> = {};
    let succeeded = 0;
    let failed = 0;
    filtered.forEach((j) => {
      const label = statusLabel(j);
      counts[label] = (counts[label] || 0) + 1;
      if (label === "Complete") succeeded++;
      if (label === "Failed") failed++;
    });
    const data = Object.entries(counts).map(([name, value]) => ({ name, value }));
    return { statusData: data, succeededCount: succeeded, failedCount: failed };
  }, [filtered]);

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-th-heading">Jobs</h1>
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
        placeholder="Search jobs..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full max-w-sm px-3 py-2 bg-th-subtle border border-th-line rounded-lg text-sm text-th-body placeholder:text-th-ghost focus:outline-none focus:ring-1 focus:ring-th-accent"
      />

      {loading && <TableSkeleton />}
      {error && <div className="p-3 bg-th-danger-s text-th-danger rounded-lg text-sm">{error}</div>}

      {/* Visual summary */}
      {!loading && filtered.length > 0 && (
        <div className="grid grid-cols-12 gap-4">
          {/* Status donut */}
          <div className="col-span-12 md:col-span-5 bg-th-panel border border-th-line rounded-xl p-4 shadow-card">
            <h3 className="text-xs font-bold text-th-dim uppercase tracking-wider mb-2">Job Status</h3>
            <div className="flex items-center gap-4">
              <div className="w-24 h-24">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={statusData} cx="50%" cy="50%" innerRadius={24} outerRadius={42} paddingAngle={2} dataKey="value" stroke="none">
                      {statusData.map((d) => <Cell key={d.name} fill={STATUS_COLORS[d.name] || "var(--th-dim)"} />)}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-col gap-1">
                {statusData.map((d) => (
                  <div key={d.name} className="flex items-center gap-2 text-xs">
                    <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: STATUS_COLORS[d.name] || "var(--th-dim)" }} />
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
              <p className="text-[10px] text-th-dim uppercase tracking-wider">Total Jobs</p>
            </div>
            <div className="bg-th-panel border border-th-line rounded-xl p-4 shadow-card flex flex-col items-center justify-center">
              <p className="text-3xl font-black text-th-ok">{succeededCount}</p>
              <p className="text-[10px] text-th-dim uppercase tracking-wider">Succeeded</p>
            </div>
            <div className="bg-th-panel border border-th-line rounded-xl p-4 shadow-card flex flex-col items-center justify-center">
              <p className="text-3xl font-black text-th-danger">{failedCount}</p>
              <p className="text-[10px] text-th-dim uppercase tracking-wider">Failed</p>
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
                  <th className="pl-4 pr-1 py-3 w-8"><SelectCheckbox ariaLabel="Select all jobs on this page" checked={sel.allSelected(pager.paged)} indeterminate={sel.someSelected(pager.paged)} onChange={() => sel.toggleAll(pager.paged)} /></th>
                  <SortableTh {...thProps("name")}>Name</SortableTh>
                  <SortableTh {...thProps("namespace")}>Namespace</SortableTh>
                  <SortableTh {...thProps("status")}>Status</SortableTh>
                  <SortableTh {...thProps("completions")}>Completions</SortableTh>
                  <SortableTh {...thProps("succeeded")}>Succeeded</SortableTh>
                  <SortableTh {...thProps("failed")}>Failed</SortableTh>
                  <SortableTh {...thProps("active")}>Active</SortableTh>
                  <SortableTh {...thProps("duration")}>Duration</SortableTh>
                  <SortableTh {...thProps("age")}>Age</SortableTh>
                  <th className="px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pager.paged.map((j) => {
                  const key = `${j.namespace}/${j.name}`;
                  return (
                    <tr key={key} className={`border-b border-th-line last:border-0 hover:bg-th-hover transition-colors ${sel.isSelected(key) ? "bg-th-accent/5" : ""}`}>
                      <td className="pl-4 pr-1 py-3"><SelectCheckbox ariaLabel={`Select ${j.name}`} checked={sel.isSelected(key)} onChange={() => sel.toggle(key)} /></td>
                      <td className="px-4 py-3 font-medium"><Link to={`/workloads/jobs/${j.namespace}/${j.name}`} className="text-th-accent hover:underline">{j.name}</Link></td>
                      <td className="px-4 py-3 text-th-dim">{j.namespace}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusColor(j)}`}>
                          {statusLabel(j)}
                        </span>
                      </td>
                      <td className="px-4 py-3"><RatioMeter ready={j.succeeded} total={j.completions} /></td>
                      <td className="px-4 py-3 text-th-ok">{j.succeeded}</td>
                      <td className="px-4 py-3 text-th-danger">{j.failed}</td>
                      <td className="px-4 py-3 text-th-dim">{j.active}</td>
                      <td className="px-4 py-3 text-th-ghost">{j.duration || "-"}</td>
                      <td className="px-4 py-3 text-th-ghost">{age(j.created_at)}</td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          <button
                            onClick={() => setDeleteTarget({ ns: j.namespace, name: j.name })}
                            className="px-2 py-1 text-xs bg-th-danger-s text-th-danger rounded hover:opacity-80"
                          >
                            Delete
                          </button>
                          <button
                            onClick={() => setEditJob({ ns: j.namespace, name: j.name })}
                            className="px-2 py-1 text-xs bg-th-accent-s text-th-accent rounded hover:opacity-80"
                            title="Edit parallelism, deadline, suspend"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => setEditYaml({ kind: "Job", ns: j.namespace, name: j.name })}
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
                  <EmptyRow colSpan={11} title="No jobs found" />
                )}
              </tbody>
            </table>
          </div>
          <TablePagination {...pager} label="jobs" />
          <BulkActionBar
            selected={sel.selectedRows(items ?? [])}
            noun="jobs"
            onClear={sel.clear}
            onComplete={refresh}
            actions={[
              { label: "Delete", danger: true, gerund: "Deleting", run: (j) => deleteJob(j.namespace, j.name) },
            ]}
          />
        </div>
      )}

      {showCreate && (
        <CreateWorkloadModal
          defaultKind="Job"
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
      {editJob && (
        <EditJobModal
          namespace={editJob.ns}
          name={editJob.name}
          onClose={() => setEditJob(null)}
          onSaved={() => { setEditJob(null); refresh(); }}
        />
      )}
      <DeleteConfirmModal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onDeleted={refresh}
        resourceType="Job"
        resourceName={deleteTarget?.name ?? ""}
        namespace={deleteTarget?.ns}
        kind="Job"
        deleteFn={() => deleteJob(deleteTarget!.ns, deleteTarget!.name)}
      />
    </div>
  );
}
