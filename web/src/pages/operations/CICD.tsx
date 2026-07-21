import { useState } from "react";
import { EmptyRow } from "@/components/EmptyState";
import { StatStrip } from "@/components/ResourceSummary";
import { useOutletContext } from "react-router-dom";
import { listJobs, listCronJobs, deleteJob, deleteCronJob } from "@/api/client";
import type { JobSummary, CronJobSummary } from "@/api/client";
import { useResource } from "@/hooks/useResource";
import { useLiveResources } from "@/hooks/useLiveResource";
import LiveIndicator from "@/components/LiveIndicator";
import { useSortableTable, SortableTh } from "@/hooks/useSortableTable";
import { usePagination, TablePagination } from "@/hooks/usePagination";
import { useConfirmAction } from "@/hooks/useConfirmAction";

function age(created: string): string {
  const diff = Date.now() - new Date(created).getTime();
  const days = Math.floor(diff / 86400000);
  if (days > 0) return `${days}d`;
  const hours = Math.floor(diff / 3600000);
  if (hours > 0) return `${hours}h`;
  return `${Math.floor(diff / 60000)}m`;
}

export default function CICD() {
  const { namespace } = useOutletContext<{ namespace: string }>();
  const { data: jobs, loading: l1, error: e1, refresh: r1 } = useResource<JobSummary[]>(
    () => listJobs(namespace), [namespace],
  );
  const { data: cronJobs, loading: l2, error: e2, refresh: r2 } = useResource<CronJobSummary[]>(
    () => listCronJobs(namespace), [namespace],
  );
  const [tab, setTab] = useState<"jobs" | "scheduled">("jobs");
  const [search, setSearch] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const loading = l1 || l2;
  const error = e1 || e2;
  const refresh = () => { r1(); r2(); };
  const { watchStatus, live, setLive } = useLiveResources(
    [{ kind: "Job", namespace }, { kind: "CronJob", namespace }],
    refresh,
  );
  const confirmAction = useConfirmAction();

  const filteredJobs = (jobs ?? []).filter((j) =>
    j.name.toLowerCase().includes(search.toLowerCase()) ||
    j.namespace.toLowerCase().includes(search.toLowerCase()),
  );
  const filteredCronJobs = (cronJobs ?? []).filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.namespace.toLowerCase().includes(search.toLowerCase()),
  );

  const { sorted: sortedJobs, thProps: jobThProps } = useSortableTable(filteredJobs, {
    name: (j) => j.name,
    namespace: (j) => j.namespace,
    status: (j) => (j.succeeded >= j.completions ? "Complete" : j.failed > 0 ? "Failed" : "Running"),
    completions: (j) => j.succeeded,
    age: (j) => Date.now() - new Date(j.created_at).getTime(),
  }, { key: "name" });

  const { sorted: sortedCron, thProps: cronThProps } = useSortableTable(filteredCronJobs, {
    name: (c) => c.name,
    namespace: (c) => c.namespace,
    schedule: (c) => c.schedule,
    suspended: (c) => (c.suspend ? 1 : 0),
    active: (c) => c.active_count,
    last: (c) => (c.last_schedule ? Date.now() - new Date(c.last_schedule).getTime() : null),
  }, { key: "name" });

  const jobsPager = usePagination(sortedJobs, { pageSize: 25 });
  const cronPager = usePagination(sortedCron, { pageSize: 25 });

  const handleDeleteJob = (ns: string, name: string) => {
    confirmAction.request({
      key: `${ns}/${name}`,
      title: "Delete Job",
      message: <span>Delete job <span className="font-semibold text-th-heading">{ns}/{name}</span>?</span>,
      confirmLabel: "Delete",
      danger: true,
      fn: async () => {
        setActionLoading(`${ns}/${name}`);
        try { await deleteJob(ns, name); refresh(); }
        finally { setActionLoading(null); }
      },
      successMsg: `Deleted job ${name}`,
    });
  };

  const handleDeleteCronJob = (ns: string, name: string) => {
    confirmAction.request({
      key: `${ns}/${name}`,
      title: "Delete CronJob",
      message: <span>Delete cronjob <span className="font-semibold text-th-heading">{ns}/{name}</span>?</span>,
      confirmLabel: "Delete",
      danger: true,
      fn: async () => {
        setActionLoading(`${ns}/${name}`);
        try { await deleteCronJob(ns, name); refresh(); }
        finally { setActionLoading(null); }
      },
      successMsg: `Deleted cronjob ${name}`,
    });
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-th-heading">CI/CD Pipelines</h1>
        <div className="flex items-center gap-2">
          <LiveIndicator live={live} status={watchStatus} onToggle={setLive} />
          <button onClick={refresh} className="px-3 py-1.5 text-sm bg-th-accent text-white rounded-lg hover:opacity-90 transition-opacity">Refresh</button>
        </div>
      </div>

      {!loading && (
        <StatStrip stats={[
          { label: "Jobs", value: (jobs ?? []).length, tone: "accent" },
          { label: "Running", value: (jobs ?? []).reduce((n, j) => n + (j.active || 0), 0), tone: "info" },
          { label: "Completed", value: (jobs ?? []).filter((j) => j.succeeded > 0 && j.active === 0 && j.failed === 0).length, tone: "ok" },
          { label: "Failed", value: (jobs ?? []).filter((j) => j.failed > 0).length, tone: "error" },
          { label: "CronJobs", value: (cronJobs ?? []).length, tone: "neutral" },
          { label: "Suspended", value: (cronJobs ?? []).filter((c) => c.suspend).length, tone: "warn" },
        ]} />
      )}

      <div className="flex gap-2">
        <button onClick={() => setTab("jobs")} className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${tab === "jobs" ? "bg-th-accent text-white" : "bg-th-subtle text-th-dim hover:text-th-body"}`}>
          Jobs ({(jobs ?? []).length})
        </button>
        <button onClick={() => setTab("scheduled")} className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${tab === "scheduled" ? "bg-th-accent text-white" : "bg-th-subtle text-th-dim hover:text-th-body"}`}>
          Scheduled ({(cronJobs ?? []).length})
        </button>
      </div>

      <input type="text" placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)}
        className="w-full max-w-sm px-3 py-2 bg-th-subtle border border-th-line rounded-lg text-sm text-th-body placeholder:text-th-ghost focus:outline-none focus:ring-1 focus:ring-th-accent" />

      {loading && <div className="flex items-center justify-center h-32"><div className="w-6 h-6 border-2 border-th-accent border-t-transparent rounded-full animate-spin" /></div>}
      {error && <div className="p-3 bg-th-danger-s text-th-danger rounded-lg text-sm">{error}</div>}

      {!loading && tab === "jobs" && (
        <div className="bg-th-panel border border-th-line rounded-xl overflow-hidden shadow-card">
          <div className="overflow-x-auto pin-actions">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-th-dim bg-th-subtle border-b border-th-line">
                  <SortableTh {...jobThProps("name")}>Name</SortableTh>
                  <SortableTh {...jobThProps("namespace")}>Namespace</SortableTh>
                  <SortableTh {...jobThProps("status")}>Status</SortableTh>
                  <SortableTh {...jobThProps("completions")}>Completions</SortableTh>
                  <th className="px-4 py-3 font-medium">Duration</th>
                  <SortableTh {...jobThProps("age")}>Age</SortableTh>
                  <th className="px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {jobsPager.paged.map((j) => {
                  const key = `${j.namespace}/${j.name}`;
                  const done = j.succeeded >= j.completions;
                  return (
                    <tr key={key} className="border-b border-th-line last:border-0 hover:bg-th-hover transition-colors">
                      <td className="px-4 py-3 font-medium text-th-body">{j.name}</td>
                      <td className="px-4 py-3 text-th-dim">{j.namespace}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${done ? "bg-th-ok-s text-th-ok" : j.failed > 0 ? "bg-th-danger-s text-th-danger" : "bg-th-info-s text-th-info"}`}>
                          {done ? "Complete" : j.failed > 0 ? "Failed" : "Running"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-th-dim">{j.succeeded}/{j.completions}</td>
                      <td className="px-4 py-3 text-th-dim">{j.duration || "-"}</td>
                      <td className="px-4 py-3 text-th-ghost">{age(j.created_at)}</td>
                      <td className="px-4 py-3">
                        <button onClick={() => handleDeleteJob(j.namespace, j.name)} disabled={actionLoading === key}
                          className="px-2 py-1 text-xs bg-th-danger-s text-th-danger rounded hover:opacity-80">Delete</button>
                      </td>
                    </tr>
                  );
                })}
                {filteredJobs.length === 0 && <EmptyRow colSpan={7} title="No jobs found" />}
              </tbody>
            </table>
          </div>
          <TablePagination {...jobsPager} label="jobs" />
        </div>
      )}

      {!loading && tab === "scheduled" && (
        <div className="bg-th-panel border border-th-line rounded-xl overflow-hidden shadow-card">
          <div className="overflow-x-auto pin-actions">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-th-dim bg-th-subtle border-b border-th-line">
                  <SortableTh {...cronThProps("name")}>Name</SortableTh>
                  <SortableTh {...cronThProps("namespace")}>Namespace</SortableTh>
                  <SortableTh {...cronThProps("schedule")}>Schedule</SortableTh>
                  <SortableTh {...cronThProps("suspended")}>Suspended</SortableTh>
                  <SortableTh {...cronThProps("active")}>Active</SortableTh>
                  <SortableTh {...cronThProps("last")}>Last Run</SortableTh>
                  <th className="px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {cronPager.paged.map((c) => {
                  const key = `${c.namespace}/${c.name}`;
                  return (
                    <tr key={key} className="border-b border-th-line last:border-0 hover:bg-th-hover transition-colors">
                      <td className="px-4 py-3 font-medium text-th-body">{c.name}</td>
                      <td className="px-4 py-3 text-th-dim">{c.namespace}</td>
                      <td className="px-4 py-3 font-mono text-xs text-th-dim">{c.schedule}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${c.suspend ? "bg-th-warn-s text-th-warn" : "bg-th-ok-s text-th-ok"}`}>
                          {c.suspend ? "Yes" : "No"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-th-dim">{c.active_count}</td>
                      <td className="px-4 py-3 text-th-ghost">{c.last_schedule ? age(c.last_schedule) : "-"}</td>
                      <td className="px-4 py-3">
                        <button onClick={() => handleDeleteCronJob(c.namespace, c.name)} disabled={actionLoading === key}
                          className="px-2 py-1 text-xs bg-th-danger-s text-th-danger rounded hover:opacity-80">Delete</button>
                      </td>
                    </tr>
                  );
                })}
                {filteredCronJobs.length === 0 && <EmptyRow colSpan={7} title="No cron jobs found" />}
              </tbody>
            </table>
          </div>
          <TablePagination {...cronPager} label="cron jobs" />
        </div>
      )}
      {confirmAction.modal}
    </div>
  );
}
