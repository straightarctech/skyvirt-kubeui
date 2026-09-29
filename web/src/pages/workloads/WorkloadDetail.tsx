import { useState, useEffect } from "react";
import { EmptyRow } from "@/components/EmptyState";
import { TableSkeleton } from "@/components/Skeleton";
import { useParams, Link } from "react-router-dom";
import DetailTabs from "@/components/DetailTabs";
import YAMLEditor from "@/components/YAMLEditor";
import {
  listPods,
  listEvents,
  listJobs,
  getResourceYAML,
  applyManifest,
  scaleStatefulSet,
  restartStatefulSet,
  restartDaemonSet,
  suspendCronJob,
} from "@/api/client";
import type { PodSummary, EventSummary, JobSummary } from "@/api/client";
import { useResource } from "@/hooks/useResource";
import { useConfirmAction } from "@/hooks/useConfirmAction";
import { useToast } from "@/components/Toast";
import jsYaml from "js-yaml";

type WorkloadKind = "StatefulSet" | "DaemonSet" | "Job" | "CronJob";

const KIND_META: Record<WorkloadKind, { listPath: string; plural: string }> = {
  StatefulSet: { listPath: "/workloads/statefulsets", plural: "StatefulSets" },
  DaemonSet: { listPath: "/workloads/daemonsets", plural: "DaemonSets" },
  Job: { listPath: "/workloads/jobs", plural: "Jobs" },
  CronJob: { listPath: "/workloads/cronjobs", plural: "CronJobs" },
};

function age(created: string): string {
  if (!created) return "-";
  const diff = Date.now() - new Date(created).getTime();
  const days = Math.floor(diff / 86400000);
  if (days > 0) return `${days}d`;
  const hours = Math.floor(diff / 3600000);
  if (hours > 0) return `${hours}h`;
  return `${Math.floor(diff / 60000)}m`;
}

function podStatusColor(status: string): string {
  switch (status) {
    case "Running": return "bg-th-ok-s text-th-ok";
    case "Succeeded": return "bg-th-info-s text-th-info";
    case "Pending": return "bg-th-warn-s text-th-warn";
    case "Failed":
    case "CrashLoopBackOff":
    case "Error": return "bg-th-danger-s text-th-danger";
    default: return "bg-th-subtle text-th-dim";
  }
}

function totalRestarts(p: PodSummary): number {
  return (p.containers || []).reduce((s, c) => s + (c.restarts || 0), 0);
}

/** Pull a nested field out of the raw resource object. */
function dig(obj: unknown, path: string[]): unknown {
  let cur: unknown = obj;
  for (const key of path) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

function extractImages(kind: WorkloadKind, obj: Record<string, unknown>): string[] {
  const containerPath = kind === "CronJob"
    ? ["spec", "jobTemplate", "spec", "template", "spec", "containers"]
    : ["spec", "template", "spec", "containers"];
  const containers = dig(obj, containerPath);
  if (!Array.isArray(containers)) return [];
  return containers.map((c) => String((c as Record<string, unknown>).image ?? "")).filter(Boolean);
}

/** Status facts shown in the info card, per kind. */
function statusFacts(kind: WorkloadKind, obj: Record<string, unknown>): { label: string; value: string; tone?: "ok" | "warn" }[] {
  const s = (p: string[]) => dig(obj, p);
  switch (kind) {
    case "StatefulSet": {
      const replicas = Number(s(["spec", "replicas"]) ?? 0);
      const ready = Number(s(["status", "readyReplicas"]) ?? 0);
      return [
        { label: "Replicas", value: `${ready}/${replicas}`, tone: ready === replicas ? "ok" : "warn" },
        { label: "Service", value: String(s(["spec", "serviceName"]) ?? "-") },
        { label: "Update Strategy", value: String(s(["spec", "updateStrategy", "type"]) ?? "-") },
      ];
    }
    case "DaemonSet": {
      const desired = Number(s(["status", "desiredNumberScheduled"]) ?? 0);
      const ready = Number(s(["status", "numberReady"]) ?? 0);
      return [
        { label: "Scheduled", value: `${ready}/${desired}`, tone: ready === desired ? "ok" : "warn" },
        { label: "Up-to-date", value: String(s(["status", "updatedNumberScheduled"]) ?? 0) },
        { label: "Update Strategy", value: String(s(["spec", "updateStrategy", "type"]) ?? "-") },
      ];
    }
    case "Job": {
      const completions = Number(s(["spec", "completions"]) ?? 1);
      const succeeded = Number(s(["status", "succeeded"]) ?? 0);
      const failed = Number(s(["status", "failed"]) ?? 0);
      return [
        { label: "Completions", value: `${succeeded}/${completions}`, tone: succeeded >= completions ? "ok" : "warn" },
        { label: "Failed", value: String(failed), tone: failed > 0 ? "warn" : "ok" },
        { label: "Parallelism", value: String(s(["spec", "parallelism"]) ?? 1) },
      ];
    }
    case "CronJob": {
      const suspend = Boolean(s(["spec", "suspend"]));
      return [
        { label: "Schedule", value: String(s(["spec", "schedule"]) ?? "-") },
        { label: "State", value: suspend ? "Suspended" : "Active", tone: suspend ? "warn" : "ok" },
        { label: "Last Schedule", value: String(s(["status", "lastScheduleTime"]) ?? "-") },
        { label: "Concurrency", value: String(s(["spec", "concurrencyPolicy"]) ?? "Allow") },
      ];
    }
  }
}

export default function WorkloadDetail({ kind }: { kind: WorkloadKind }) {
  const { namespace, name } = useParams<{ namespace: string; name: string }>();
  const meta = KIND_META[kind];
  const toast = useToast();
  const confirmAction = useConfirmAction();
  const [tab, setTab] = useState("overview");

  const tabs = [
    { key: "overview", label: "Overview" },
    { key: "pods", label: "Pods" },
    ...(kind === "CronJob" ? [{ key: "jobs", label: "Jobs" }] : []),
    { key: "events", label: "Events" },
    { key: "yaml", label: "YAML" },
  ];

  // ---- Object ----
  const { data: obj, loading, error, refresh } = useResource<Record<string, unknown>>(
    () => getResourceYAML(kind, namespace!, name!),
    [kind, namespace, name],
  );

  // ---- Pods (owner-filtered) ----
  const { data: allPods, loading: podsLoading, error: podsError, refresh: refreshPods } = useResource<PodSummary[]>(
    () => listPods(namespace),
    [namespace],
  );
  const ownedPods = (allPods ?? []).filter((p) => {
    if (kind === "CronJob") return p.owner_kind === "Job" && p.owner_name?.startsWith(`${name}-`);
    return p.owner_kind === kind && p.owner_name === name;
  });

  // ---- CronJob child jobs ----
  const { data: allJobs, loading: jobsLoading } = useResource<JobSummary[]>(
    () => (kind === "CronJob" ? listJobs(namespace) : Promise.resolve([])),
    [kind, namespace],
  );
  const childJobs = (allJobs ?? []).filter((j) => j.name.startsWith(`${name}-`));

  // ---- Events ----
  const { data: allEvents, loading: eventsLoading, error: eventsError } = useResource<EventSummary[]>(
    () => listEvents(namespace),
    [namespace],
  );
  const objEvents = (allEvents ?? []).filter(
    (e) => e.namespace === namespace &&
      (e.regarding_name === name || (kind === "CronJob" && e.regarding_name?.startsWith(`${name}-`))),
  );

  // ---- YAML tab ----
  const [yaml, setYaml] = useState("");
  const [yamlLoading, setYamlLoading] = useState(false);
  const [yamlError, setYamlError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (tab === "yaml" && namespace && name) {
      setYamlLoading(true);
      setYamlError(null);
      getResourceYAML(kind, namespace, name)
        .then((data) => setYaml(jsYaml.dump(data, { indent: 2, lineWidth: -1, noRefs: true })))
        .catch((e) => setYamlError(e instanceof Error ? e.message : String(e)))
        .finally(() => setYamlLoading(false));
    }
  }, [tab, kind, namespace, name]);

  const handleSaveYaml = async () => {
    setSaving(true);
    setYamlError(null);
    try {
      await applyManifest(yaml);
      toast.success(`${kind} ${name} updated`);
      refresh();
    } catch (e) {
      setYamlError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  // ---- Actions ----
  const [actionBusy, setActionBusy] = useState(false);
  const [showScale, setShowScale] = useState(false);
  const [scaleCount, setScaleCount] = useState(1);
  const suspended = Boolean(dig(obj ?? {}, ["spec", "suspend"]));

  const runAction = (label: string, fn: () => Promise<void>, danger = false) => {
    confirmAction.request({
      key: label,
      title: `${label} ${kind}`,
      message: <span>{label} {kind.toLowerCase()} <span className="font-semibold text-th-heading">{name}</span>?</span>,
      confirmLabel: label,
      danger,
      fn: async () => {
        setActionBusy(true);
        try {
          await fn();
          refresh();
          refreshPods();
        } finally {
          setActionBusy(false);
        }
      },
      successMsg: `${label} ${name} succeeded`,
    });
  };

  const handleScale = async () => {
    setActionBusy(true);
    try {
      await scaleStatefulSet(namespace!, name!, scaleCount);
      setShowScale(false);
      toast.success(`Scaled ${name} to ${scaleCount} replicas`);
      refresh();
    } catch (e) {
      toast.error("Scale failed", e instanceof Error ? e.message : String(e));
    } finally {
      setActionBusy(false);
    }
  };

  const labels = (dig(obj ?? {}, ["metadata", "labels"]) as Record<string, string>) || {};
  const createdAt = String(dig(obj ?? {}, ["metadata", "creationTimestamp"]) ?? "");
  const images = obj ? extractImages(kind, obj) : [];
  const facts = obj ? statusFacts(kind, obj) : [];
  const conditions = (dig(obj ?? {}, ["status", "conditions"]) as { type: string; status: string; reason?: string; message?: string }[]) || [];

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-th-dim">
        <Link to={meta.listPath} className="hover:text-th-accent">{meta.plural}</Link>
        <span>/</span>
        <span className="text-th-body">{namespace}/{name}</span>
      </div>

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-th-heading">{name}</h1>
        <div className="flex items-center gap-2">
          {kind === "StatefulSet" && (
            <>
              <button
                onClick={() => { setScaleCount(Number(dig(obj ?? {}, ["spec", "replicas"]) ?? 1)); setShowScale(true); }}
                disabled={actionBusy}
                className="px-3 py-1.5 text-sm bg-th-info text-white rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
              >Scale</button>
              <button
                onClick={() => runAction("Restart", () => restartStatefulSet(namespace!, name!))}
                disabled={actionBusy}
                className="px-3 py-1.5 text-sm bg-th-warn text-white rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
              >Restart</button>
            </>
          )}
          {kind === "DaemonSet" && (
            <button
              onClick={() => runAction("Restart", () => restartDaemonSet(namespace!, name!))}
              disabled={actionBusy}
              className="px-3 py-1.5 text-sm bg-th-warn text-white rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
            >Restart</button>
          )}
          {kind === "CronJob" && (
            <button
              onClick={() => runAction(suspended ? "Resume" : "Suspend", () => suspendCronJob(namespace!, name!, !suspended))}
              disabled={actionBusy}
              className={`px-3 py-1.5 text-sm text-white rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 ${suspended ? "bg-th-ok" : "bg-th-warn"}`}
            >{suspended ? "Resume" : "Suspend"}</button>
          )}
          <button onClick={() => { refresh(); refreshPods(); }} className="px-3 py-1.5 text-sm bg-th-accent text-white rounded-lg hover:opacity-90 transition-opacity">
            Refresh
          </button>
        </div>
      </div>

      {loading && <TableSkeleton />}
      {error && <div className="p-3 bg-th-danger-s text-th-danger rounded-lg text-sm">{error}</div>}

      {!loading && obj && (
        <DetailTabs tabs={tabs} activeTab={tab} onTabChange={setTab}>
          {tab === "overview" && (
            <div className="space-y-6">
              <div className="bg-th-panel border border-th-line rounded-xl p-6 shadow-card">
                <h2 className="text-lg font-semibold text-th-heading mb-4">{kind} Info</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  <div>
                    <span className="text-xs text-th-dim">Name</span>
                    <p className="text-sm text-th-body mt-1">{name}</p>
                  </div>
                  <div>
                    <span className="text-xs text-th-dim">Namespace</span>
                    <p className="text-sm text-th-body mt-1">{namespace}</p>
                  </div>
                  {facts.map((f) => (
                    <div key={f.label}>
                      <span className="text-xs text-th-dim">{f.label}</span>
                      <div className="mt-1">
                        {f.tone ? (
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${f.tone === "ok" ? "bg-th-ok-s text-th-ok" : "bg-th-warn-s text-th-warn"}`}>
                            {f.value}
                          </span>
                        ) : (
                          <p className="text-sm text-th-body">{f.value}</p>
                        )}
                      </div>
                    </div>
                  ))}
                  <div>
                    <span className="text-xs text-th-dim">Images</span>
                    <div className="mt-1 space-y-1">
                      {images.map((img, i) => (
                        <p key={i} className="text-xs text-th-body font-mono truncate" title={img}>{img}</p>
                      ))}
                      {images.length === 0 && <p className="text-xs text-th-ghost">-</p>}
                    </div>
                  </div>
                  <div>
                    <span className="text-xs text-th-dim">Created</span>
                    <p className="text-sm text-th-body mt-1">{createdAt ? `${age(createdAt)} ago` : "-"}</p>
                  </div>
                </div>
              </div>

              {conditions.length > 0 && (
                <div className="bg-th-panel border border-th-line rounded-xl p-6 shadow-card">
                  <h2 className="text-lg font-semibold text-th-heading mb-4">Conditions</h2>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-th-dim bg-th-subtle border-b border-th-line">
                          <th className="px-4 py-2 font-medium">Type</th>
                          <th className="px-4 py-2 font-medium">Status</th>
                          <th className="px-4 py-2 font-medium">Reason</th>
                          <th className="px-4 py-2 font-medium">Message</th>
                        </tr>
                      </thead>
                      <tbody>
                        {conditions.map((c, i) => (
                          <tr key={i} className="border-b border-th-line last:border-0">
                            <td className="px-4 py-2 text-th-body font-medium">{c.type}</td>
                            <td className="px-4 py-2">
                              <span className={`px-2 py-0.5 rounded text-xs font-medium ${c.status === "True" ? "bg-th-ok-s text-th-ok" : "bg-th-danger-s text-th-danger"}`}>
                                {c.status}
                              </span>
                            </td>
                            <td className="px-4 py-2 text-th-dim">{c.reason || "-"}</td>
                            <td className="px-4 py-2 text-th-dim max-w-md truncate" title={c.message}>{c.message || "-"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {Object.keys(labels).length > 0 && (
                <div className="bg-th-panel border border-th-line rounded-xl p-6 shadow-card">
                  <h2 className="text-lg font-semibold text-th-heading mb-4">Labels</h2>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(labels).map(([k, v]) => (
                      <span key={k} className="px-2 py-1 bg-th-subtle border border-th-line rounded text-xs text-th-body">
                        {k}={v}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === "pods" && (
            <div>
              {podsLoading && (
                <div className="flex items-center justify-center h-32">
                  <div className="w-6 h-6 border-2 border-th-accent border-t-transparent rounded-full animate-spin" />
                </div>
              )}
              {podsError && <div className="p-3 bg-th-danger-s text-th-danger rounded-lg text-sm">{podsError}</div>}
              {!podsLoading && (
                <div className="bg-th-panel border border-th-line rounded-xl overflow-hidden shadow-card">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-th-dim bg-th-subtle border-b border-th-line">
                          <th className="px-4 py-3 font-medium">Name</th>
                          <th className="px-4 py-3 font-medium">Status</th>
                          <th className="px-4 py-3 font-medium">Node</th>
                          <th className="px-4 py-3 font-medium">IP</th>
                          <th className="px-4 py-3 font-medium">Restarts</th>
                          <th className="px-4 py-3 font-medium">Age</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ownedPods.map((p) => (
                          <tr key={`${p.namespace}/${p.name}`} className="border-b border-th-line last:border-0 hover:bg-th-hover transition-colors">
                            <td className="px-4 py-3 font-medium max-w-xs truncate" title={p.name}>
                              <Link to={`/workloads/pods/${p.namespace}/${p.name}`} className="text-th-accent hover:underline">{p.name}</Link>
                            </td>
                            <td className="px-4 py-3">
                              <span className={`px-2 py-0.5 rounded text-xs font-medium ${podStatusColor(p.status)}`}>{p.status}</span>
                            </td>
                            <td className="px-4 py-3 text-th-dim">{p.node || "-"}</td>
                            <td className="px-4 py-3 text-th-dim font-mono text-xs">{p.ip || "-"}</td>
                            <td className="px-4 py-3 text-th-dim">{totalRestarts(p)}</td>
                            <td className="px-4 py-3 text-th-ghost">{age(p.created_at)}</td>
                          </tr>
                        ))}
                        {ownedPods.length === 0 && (
                          <EmptyRow colSpan={6} title={`No pods owned by this ${kind.toLowerCase()}`} />
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === "jobs" && kind === "CronJob" && (
            <div>
              {jobsLoading && (
                <div className="flex items-center justify-center h-32">
                  <div className="w-6 h-6 border-2 border-th-accent border-t-transparent rounded-full animate-spin" />
                </div>
              )}
              {!jobsLoading && (
                <div className="bg-th-panel border border-th-line rounded-xl overflow-hidden shadow-card">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-th-dim bg-th-subtle border-b border-th-line">
                          <th className="px-4 py-3 font-medium">Name</th>
                          <th className="px-4 py-3 font-medium">Completions</th>
                          <th className="px-4 py-3 font-medium">Active</th>
                          <th className="px-4 py-3 font-medium">Failed</th>
                          <th className="px-4 py-3 font-medium">Duration</th>
                          <th className="px-4 py-3 font-medium">Age</th>
                        </tr>
                      </thead>
                      <tbody>
                        {childJobs.map((j) => (
                          <tr key={`${j.namespace}/${j.name}`} className="border-b border-th-line last:border-0 hover:bg-th-hover transition-colors">
                            <td className="px-4 py-3 font-medium max-w-xs truncate" title={j.name}>
                              <Link to={`/workloads/jobs/${j.namespace}/${j.name}`} className="text-th-accent hover:underline">{j.name}</Link>
                            </td>
                            <td className="px-4 py-3">
                              <span className={`px-2 py-0.5 rounded text-xs font-medium ${j.succeeded >= j.completions ? "bg-th-ok-s text-th-ok" : "bg-th-warn-s text-th-warn"}`}>
                                {j.succeeded}/{j.completions}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-th-dim">{j.active}</td>
                            <td className="px-4 py-3">
                              {j.failed > 0
                                ? <span className="px-2 py-0.5 rounded text-xs font-medium bg-th-danger-s text-th-danger">{j.failed}</span>
                                : <span className="text-th-ghost text-xs">0</span>}
                            </td>
                            <td className="px-4 py-3 text-th-dim">{j.duration || "-"}</td>
                            <td className="px-4 py-3 text-th-ghost">{age(j.created_at)}</td>
                          </tr>
                        ))}
                        {childJobs.length === 0 && (
                          <EmptyRow colSpan={6} title="No jobs spawned by this cronjob yet" />
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === "events" && (
            <div>
              {eventsLoading && (
                <div className="flex items-center justify-center h-32">
                  <div className="w-6 h-6 border-2 border-th-accent border-t-transparent rounded-full animate-spin" />
                </div>
              )}
              {eventsError && <div className="p-3 bg-th-danger-s text-th-danger rounded-lg text-sm">{eventsError}</div>}
              {!eventsLoading && (
                <div className="bg-th-panel border border-th-line rounded-xl overflow-hidden shadow-card">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-th-dim bg-th-subtle border-b border-th-line">
                          <th className="px-4 py-3 font-medium">Type</th>
                          <th className="px-4 py-3 font-medium">Reason</th>
                          <th className="px-4 py-3 font-medium">Object</th>
                          <th className="px-4 py-3 font-medium">Message</th>
                          <th className="px-4 py-3 font-medium">Count</th>
                          <th className="px-4 py-3 font-medium">Last Seen</th>
                        </tr>
                      </thead>
                      <tbody>
                        {objEvents.map((e, i) => (
                          <tr key={i} className="border-b border-th-line last:border-0 hover:bg-th-hover transition-colors">
                            <td className="px-4 py-3">
                              <span className={`px-2 py-0.5 rounded text-xs font-medium ${e.type === "Warning" ? "bg-th-warn-s text-th-warn" : "bg-th-info-s text-th-info"}`}>
                                {e.type}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-th-body font-medium">{e.reason}</td>
                            <td className="px-4 py-3 text-th-dim text-xs">{e.regarding_kind}/{e.regarding_name}</td>
                            <td className="px-4 py-3 text-th-dim max-w-md truncate" title={e.message}>{e.message}</td>
                            <td className="px-4 py-3 text-th-dim">{e.count}</td>
                            <td className="px-4 py-3 text-th-ghost">{age(e.last_seen)}</td>
                          </tr>
                        ))}
                        {objEvents.length === 0 && (
                          <EmptyRow colSpan={6} title="No recent events" />
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === "yaml" && (
            <div className="space-y-3">
              {yamlLoading && (
                <div className="flex items-center justify-center h-32">
                  <div className="w-6 h-6 border-2 border-th-accent border-t-transparent rounded-full animate-spin" />
                </div>
              )}
              {yamlError && <div className="p-3 bg-th-danger-s text-th-danger rounded-lg text-sm">{yamlError}</div>}
              {!yamlLoading && (
                <>
                  <YAMLEditor value={yaml} onChange={setYaml} height="500px" />
                  <div className="flex justify-end">
                    <button
                      onClick={handleSaveYaml}
                      disabled={saving}
                      className="px-4 py-2 text-sm bg-th-accent text-white rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
                    >
                      {saving ? "Saving..." : "Save Changes"}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </DetailTabs>
      )}

      {/* Scale modal (StatefulSet) */}
      {showScale && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowScale(false)}>
          <div className="bg-th-panel border border-th-line rounded-xl shadow-2xl w-full max-w-sm p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-th-heading">Scale {name}</h2>
            <div>
              <label className="block text-xs font-medium text-th-label mb-1">Replicas</label>
              <input
                type="number"
                min={0}
                value={scaleCount}
                onChange={(e) => setScaleCount(Math.max(0, parseInt(e.target.value) || 0))}
                className="w-full px-3 py-2 bg-th-subtle border border-th-line rounded-lg text-sm text-th-body focus:outline-none focus:ring-1 focus:ring-th-accent"
                autoFocus
              />
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowScale(false)} className="px-4 py-2 text-sm bg-th-subtle border border-th-line rounded-lg hover:bg-th-hover">Cancel</button>
              <button
                onClick={handleScale}
                disabled={actionBusy}
                className="px-4 py-2 text-sm bg-th-accent text-white rounded-lg hover:opacity-90 disabled:opacity-50"
              >
                {actionBusy ? "Scaling..." : "Scale"}
              </button>
            </div>
          </div>
        </div>
      )}
      {confirmAction.modal}
    </div>
  );
}
