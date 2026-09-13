import { useState, useEffect } from "react";
import { EmptyRow } from "@/components/EmptyState";
import { TableSkeleton } from "@/components/Skeleton";
import { useParams, Link } from "react-router-dom";
import DetailTabs from "@/components/DetailTabs";
import YAMLEditor from "@/components/YAMLEditor";
import {
  getDeployment,
  scaleDeployment,
  restartDeployment,
  rollbackDeployment,
  listPods,
  listEvents,
  listDeploymentReplicaSets,
  getResourceYAML,
  applyManifest,
} from "@/api/client";
import type { DeploymentSummary, PodSummary, EventSummary, ReplicaSetSummary } from "@/api/client";
import { useResource } from "@/hooks/useResource";
import { useConfirmAction } from "@/hooks/useConfirmAction";
import jsYaml from "js-yaml";

function age(created: string): string {
  const diff = Date.now() - new Date(created).getTime();
  const days = Math.floor(diff / 86400000);
  if (days > 0) return `${days}d`;
  const hours = Math.floor(diff / 3600000);
  if (hours > 0) return `${hours}h`;
  const mins = Math.floor(diff / 60000);
  return `${mins}m`;
}

function podStatusColor(status: string): string {
  switch (status) {
    case "Running":
      return "bg-th-ok-s text-th-ok";
    case "Succeeded":
      return "bg-th-info-s text-th-info";
    case "Pending":
      return "bg-th-warn-s text-th-warn";
    case "Failed":
    case "CrashLoopBackOff":
    case "Error":
      return "bg-th-danger-s text-th-danger";
    default:
      return "bg-th-subtle text-th-dim";
  }
}

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "pods", label: "Pods" },
  { key: "revisions", label: "Revisions" },
  { key: "events", label: "Events" },
  { key: "yaml", label: "YAML" },
];

export default function DeploymentDetail() {
  const { namespace, name } = useParams<{ namespace: string; name: string }>();
  const [tab, setTab] = useState("overview");

  // ---- Overview data ----
  const { data: deploy, loading, error, refresh } = useResource<DeploymentSummary>(
    () => getDeployment(namespace!, name!),
    [namespace, name],
  );

  // ---- Pods data ----
  const { data: allPods, loading: podsLoading, error: podsError } = useResource<PodSummary[]>(
    () => listPods(namespace),
    [namespace],
  );
  // Filter pods by label matching deployment name
  const deployPods = (allPods ?? []).filter((p) => {
    if (!p.labels) return false;
    return p.labels["app"] === name || p.owner_name?.includes(name!);
  });

  // ---- Revisions data ----
  const { data: replicaSets, loading: rsLoading, error: rsError } = useResource<ReplicaSetSummary[]>(
    () => listDeploymentReplicaSets(namespace!, name!),
    [namespace, name],
  );

  // ---- Events data ----
  const { data: allEvents, loading: eventsLoading, error: eventsError } = useResource<EventSummary[]>(
    () => listEvents(namespace),
    [namespace],
  );
  const deployEvents = (allEvents ?? []).filter(
    (e) => e.regarding_name === name && e.namespace === namespace,
  );

  // ---- YAML state ----
  const [yaml, setYaml] = useState("");
  const [yamlLoading, setYamlLoading] = useState(false);
  const [yamlError, setYamlError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (tab === "yaml" && namespace && name) {
      setYamlLoading(true);
      setYamlError(null);
      getResourceYAML("Deployment", namespace, name)
        .then((data) => {
          setYaml(jsYaml.dump(data, { indent: 2, lineWidth: -1, noRefs: true }));
        })
        .catch((e) => {
          setYamlError(e instanceof Error ? e.message : String(e));
        })
        .finally(() => setYamlLoading(false));
    }
  }, [tab, namespace, name]);

  // ---- Scale / Rollback / Restart state ----
  const [showScale, setShowScale] = useState(false);
  const [scaleCount, setScaleCount] = useState(1);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const confirmAction = useConfirmAction();

  const handleScale = async () => {
    setActionLoading("scale");
    setActionError(null);
    try {
      await scaleDeployment(namespace!, name!, scaleCount);
      setShowScale(false);
      refresh();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setActionLoading(null);
    }
  };

  const handleRestart = () => {
    confirmAction.request({
      key: "restart",
      title: "Restart Deployment",
      message: <span>Restart deployment <span className="font-semibold text-th-heading">{name}</span>? This will trigger a rolling restart of all pods.</span>,
      confirmLabel: "Restart",
      fn: async () => {
        setActionLoading("restart");
        setActionError(null);
        try {
          await restartDeployment(namespace!, name!);
          refresh();
        } finally {
          setActionLoading(null);
        }
      },
      successMsg: `Rolling restart of ${name} started`,
    });
  };

  const handleRollback = (revision?: string) => {
    confirmAction.request({
      key: "rollback",
      title: "Rollback Deployment",
      message: (
        <span>
          Rollback <span className="font-semibold text-th-heading">{name}</span> to{" "}
          {revision ? `revision ${revision}` : "the previous revision"}?
        </span>
      ),
      confirmLabel: "Rollback",
      danger: true,
      fn: async () => {
        setActionLoading("rollback");
        setActionError(null);
        try {
          await rollbackDeployment(namespace!, name!);
          refresh();
        } finally {
          setActionLoading(null);
        }
      },
      successMsg: `Rollback of ${name} started`,
    });
  };

  const handleSaveYaml = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await applyManifest(yaml);
      refresh();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  if (!namespace || !name) return null;

  const totalRestarts = (p: PodSummary) =>
    (p.containers || []).reduce((sum, c) => sum + (c.restarts || 0), 0);

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-th-dim">
        <Link to="/workloads/deployments" className="hover:text-th-accent">Deployments</Link>
        <span>/</span>
        <span className="text-th-body">{namespace}/{name}</span>
      </div>

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-th-heading">{name}</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setScaleCount(deploy?.replicas ?? 1); setShowScale(true); }}
            disabled={!!actionLoading}
            className="px-3 py-1.5 text-sm bg-th-info text-white rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            Scale
          </button>
          <button
            onClick={handleRestart}
            disabled={!!actionLoading}
            className="px-3 py-1.5 text-sm bg-th-warn text-white rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {actionLoading === "restart" ? "Restarting..." : "Restart"}
          </button>
          <button
            onClick={() => handleRollback()}
            disabled={!!actionLoading}
            className="px-3 py-1.5 text-sm border border-th-line text-th-body rounded-lg hover:bg-th-hover transition-colors disabled:opacity-50"
          >
            {actionLoading === "rollback" ? "Rolling back..." : "Rollback"}
          </button>
          <button onClick={refresh} className="px-3 py-1.5 text-sm bg-th-accent text-white rounded-lg hover:opacity-90 transition-opacity">
            Refresh
          </button>
        </div>
      </div>
      {actionError && <div className="p-3 bg-th-danger-s text-th-danger rounded-lg text-sm">{actionError}</div>}

      {loading && <TableSkeleton />}
      {error && <div className="p-3 bg-th-danger-s text-th-danger rounded-lg text-sm">{error}</div>}

      {!loading && deploy && (
        <DetailTabs tabs={TABS} activeTab={tab} onTabChange={setTab}>
          {/* ---- OVERVIEW TAB ---- */}
          {tab === "overview" && (
            <div className="space-y-6">
              {/* Deployment Info Card */}
              <div className="bg-th-panel border border-th-line rounded-xl p-6 shadow-card">
                <h2 className="text-lg font-semibold text-th-heading mb-4">Deployment Info</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  <div>
                    <span className="text-xs text-th-dim">Name</span>
                    <p className="text-sm text-th-body mt-1">{deploy.name}</p>
                  </div>
                  <div>
                    <span className="text-xs text-th-dim">Namespace</span>
                    <p className="text-sm text-th-body mt-1">{deploy.namespace}</p>
                  </div>
                  <div>
                    <span className="text-xs text-th-dim">Strategy</span>
                    <p className="text-sm text-th-body mt-1">{deploy.strategy || "-"}</p>
                  </div>
                  <div>
                    <span className="text-xs text-th-dim">Replicas</span>
                    <div className="mt-1">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                        deploy.ready_replicas === deploy.replicas
                          ? "bg-th-ok-s text-th-ok"
                          : "bg-th-warn-s text-th-warn"
                      }`}>
                        {deploy.ready_replicas ?? 0}/{deploy.replicas}
                      </span>
                    </div>
                  </div>
                  <div>
                    <span className="text-xs text-th-dim">Images</span>
                    <div className="mt-1 space-y-1">
                      {(deploy.images || []).map((img, i) => (
                        <p key={i} className="text-xs text-th-body font-mono truncate" title={img}>{img}</p>
                      ))}
                    </div>
                  </div>
                  <div>
                    <span className="text-xs text-th-dim">Created</span>
                    <p className="text-sm text-th-body mt-1">{age(deploy.created_at)} ago</p>
                  </div>
                </div>
              </div>

              {/* Conditions */}
              {deploy.conditions && deploy.conditions.length > 0 && (
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
                        {deploy.conditions.map((c, i) => (
                          <tr key={i} className="border-b border-th-line last:border-0">
                            <td className="px-4 py-2 text-th-body font-medium">{c.type}</td>
                            <td className="px-4 py-2">
                              <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                                c.status === "True" ? "bg-th-ok-s text-th-ok" : "bg-th-danger-s text-th-danger"
                              }`}>
                                {c.status}
                              </span>
                            </td>
                            <td className="px-4 py-2 text-th-dim">{c.reason}</td>
                            <td className="px-4 py-2 text-th-dim max-w-md truncate" title={c.message}>{c.message}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Labels */}
              {deploy.labels && Object.keys(deploy.labels).length > 0 && (
                <div className="bg-th-panel border border-th-line rounded-xl p-6 shadow-card">
                  <h2 className="text-lg font-semibold text-th-heading mb-4">Labels</h2>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(deploy.labels).map(([k, v]) => (
                      <span key={k} className="px-2 py-1 bg-th-subtle border border-th-line rounded text-xs text-th-body">
                        {k}={v}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ---- PODS TAB ---- */}
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
                        {deployPods.map((p) => {
                          const restarts = totalRestarts(p);
                          return (
                            <tr key={`${p.namespace}/${p.name}`} className="border-b border-th-line last:border-0 hover:bg-th-hover transition-colors">
                              <td className="px-4 py-3 font-medium max-w-xs truncate" title={p.name}>
                                <Link to={`/workloads/pods/${p.namespace}/${p.name}`} className="text-th-accent hover:underline">{p.name}</Link>
                              </td>
                              <td className="px-4 py-3">
                                <span className={`px-2 py-0.5 rounded text-xs font-medium ${podStatusColor(p.status)}`}>
                                  {p.status}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-th-dim text-xs">{p.node || "-"}</td>
                              <td className="px-4 py-3 text-th-dim font-mono text-xs">{p.ip || "-"}</td>
                              <td className="px-4 py-3">
                                <span className={restarts > 0 ? "text-th-warn" : "text-th-dim"}>{restarts}</span>
                              </td>
                              <td className="px-4 py-3 text-th-ghost">{age(p.created_at)}</td>
                            </tr>
                          );
                        })}
                        {deployPods.length === 0 && (
                          <EmptyRow colSpan={6} title="No pods found for this deployment" />
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ---- REVISIONS TAB ---- */}
          {tab === "revisions" && (
            <div>
              {rsLoading && (
                <div className="flex items-center justify-center h-32">
                  <div className="w-6 h-6 border-2 border-th-accent border-t-transparent rounded-full animate-spin" />
                </div>
              )}
              {rsError && <div className="p-3 bg-th-danger-s text-th-danger rounded-lg text-sm">{rsError}</div>}

              {!rsLoading && (
                <div className="bg-th-panel border border-th-line rounded-xl overflow-hidden shadow-card">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-th-dim bg-th-subtle border-b border-th-line">
                          <th className="px-4 py-3 font-medium">Revision</th>
                          <th className="px-4 py-3 font-medium">Name</th>
                          <th className="px-4 py-3 font-medium">Replicas</th>
                          <th className="px-4 py-3 font-medium">Ready</th>
                          <th className="px-4 py-3 font-medium">Images</th>
                          <th className="px-4 py-3 font-medium">Age</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(replicaSets ?? [])
                          .slice()
                          .sort((a, b) => {
                            const revA = parseInt(a.revision) || 0;
                            const revB = parseInt(b.revision) || 0;
                            return revB - revA;
                          })
                          .map((rs, i) => {
                            const isLatest = i === 0;
                            return (
                              <tr
                                key={rs.name}
                                className={`border-b border-th-line last:border-0 hover:bg-th-hover transition-colors ${isLatest ? "bg-th-ok-s/30" : ""}`}
                              >
                                <td className="px-4 py-3 text-th-body font-medium">
                                  {rs.revision}
                                  {isLatest && (
                                    <span className="ml-2 px-1.5 py-0.5 rounded text-xs bg-th-ok-s text-th-ok">current</span>
                                  )}
                                </td>
                                <td className="px-4 py-3 text-th-dim text-xs">{rs.name}</td>
                                <td className="px-4 py-3 text-th-dim">{rs.replicas}</td>
                                <td className="px-4 py-3 text-th-dim">{rs.ready_replicas ?? 0}</td>
                                <td className="px-4 py-3 text-th-dim text-xs max-w-xs truncate" title={(rs.images || []).join(", ")}>
                                  {(rs.images || []).map((img) => img.split("/").pop()).join(", ")}
                                </td>
                                <td className="px-4 py-3 text-th-ghost">{age(rs.created_at)}</td>
                              </tr>
                            );
                          })}
                        {(!replicaSets || replicaSets.length === 0) && (
                          <EmptyRow colSpan={6} title="No revisions found" />
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ---- EVENTS TAB ---- */}
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
                          <th className="px-4 py-3 font-medium">Message</th>
                          <th className="px-4 py-3 font-medium">Count</th>
                          <th className="px-4 py-3 font-medium">Last Seen</th>
                        </tr>
                      </thead>
                      <tbody>
                        {deployEvents.map((ev, i) => (
                          <tr key={`${ev.name}-${i}`} className="border-b border-th-line last:border-0 hover:bg-th-hover transition-colors">
                            <td className="px-4 py-3">
                              <span className={ev.type === "Warning" ? "text-th-warn" : "text-th-dim"}>
                                {ev.type}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-th-body font-medium">{ev.reason}</td>
                            <td className="px-4 py-3 text-th-dim max-w-md truncate" title={ev.message}>{ev.message}</td>
                            <td className="px-4 py-3 text-th-dim">{ev.count}</td>
                            <td className="px-4 py-3 text-th-ghost">{age(ev.last_seen)}</td>
                          </tr>
                        ))}
                        {deployEvents.length === 0 && (
                          <EmptyRow colSpan={5} title="No events found" />
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ---- YAML TAB ---- */}
          {tab === "yaml" && (
            <div className="space-y-4">
              {yamlLoading && (
                <div className="flex items-center justify-center h-32">
                  <div className="w-6 h-6 border-2 border-th-accent border-t-transparent rounded-full animate-spin" />
                </div>
              )}
              {yamlError && <div className="p-3 bg-th-danger-s text-th-danger rounded-lg text-sm">{yamlError}</div>}
              {!yamlLoading && !yamlError && (
                <>
                  <YAMLEditor value={yaml} onChange={setYaml} height="500px" />
                  {saveError && <div className="p-3 bg-th-danger-s text-th-danger rounded-lg text-sm">{saveError}</div>}
                  <div className="flex justify-end">
                    <button
                      onClick={handleSaveYaml}
                      disabled={saving}
                      className="px-4 py-2 text-sm bg-th-accent text-white rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {saving ? "Saving..." : "Save"}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </DetailTabs>
      )}

      {/* Scale Modal */}
      {showScale && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowScale(false)} />
          <div className="relative bg-th-panel rounded-xl shadow-card w-full max-w-sm mx-4 p-6">
            <h3 className="text-lg font-semibold text-th-heading mb-4">Scale Deployment</h3>
            <p className="text-sm text-th-dim mb-3">Current replicas: <span className="font-semibold text-th-body">{deploy?.replicas ?? 0}</span></p>
            <div>
              <label className="block text-xs text-th-dim mb-1">New Replica Count</label>
              <input
                type="number"
                min={0}
                max={100}
                value={scaleCount}
                onChange={(e) => setScaleCount(parseInt(e.target.value) || 0)}
                className="w-full px-3 py-2 bg-th-subtle border border-th-line rounded-lg text-sm text-th-body focus:outline-none focus:ring-1 focus:ring-th-accent"
                autoFocus
              />
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setShowScale(false)} className="px-4 py-2 text-sm border border-th-line text-th-body rounded-lg hover:bg-th-hover">Cancel</button>
              <button
                onClick={handleScale}
                disabled={actionLoading === "scale"}
                className="px-4 py-2 text-sm bg-th-accent text-white rounded-lg hover:opacity-90 disabled:opacity-50"
              >
                {actionLoading === "scale" ? "Scaling..." : "Scale"}
              </button>
            </div>
          </div>
        </div>
      )}
      {confirmAction.modal}
    </div>
  );
}
