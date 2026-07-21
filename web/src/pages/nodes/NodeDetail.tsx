import { useState, useEffect } from "react";
import { EmptyRow } from "@/components/EmptyState";
import { TableSkeleton } from "@/components/Skeleton";
import { useParams, Link } from "react-router-dom";
import DetailTabs from "@/components/DetailTabs";
import { LiveTrend } from "@/components/viz";
import YAMLEditor from "@/components/YAMLEditor";
import { getNode, listPods, topNodes, listEvents, getClusterResourceYAML } from "@/api/client";
import type { NodeSummary, PodSummary, NodeMetrics, EventSummary } from "@/api/client";
import { useResource } from "@/hooks/useResource";
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
  { key: "metrics", label: "Metrics" },
  { key: "labels", label: "Labels" },
  { key: "events", label: "Events" },
  { key: "yaml", label: "YAML" },
];

export default function NodeDetail() {
  const { name } = useParams<{ name: string }>();
  const [tab, setTab] = useState("overview");

  // ---- Node data ----
  const { data: node, loading, error, refresh } = useResource<NodeSummary>(
    () => getNode(name!),
    [name],
  );

  // ---- Pods data ----
  const { data: allPods, loading: podsLoading, error: podsError } = useResource<PodSummary[]>(
    () => listPods(),
    [],
  );
  const nodePods = (allPods ?? []).filter((p) => p.node === name);

  // ---- Metrics data ----
  const { data: metricsAll, loading: metricsLoading, error: metricsError } = useResource<NodeMetrics[]>(
    topNodes,
    [],
  );
  const nodeMetrics = (metricsAll ?? []).find((m) => m.name === name) ?? null;

  // ---- Events data ----
  const { data: allEvents, loading: eventsLoading, error: eventsError } = useResource<EventSummary[]>(
    () => listEvents(),
    [],
  );
  const nodeEvents = (allEvents ?? []).filter(
    (e) => e.regarding_name === name,
  );

  // ---- YAML state ----
  const [yaml, setYaml] = useState("");
  const [yamlLoading, setYamlLoading] = useState(false);
  const [yamlError, setYamlError] = useState<string | null>(null);

  useEffect(() => {
    if (tab === "yaml" && name) {
      setYamlLoading(true);
      setYamlError(null);
      getClusterResourceYAML("Node", name)
        .then((data) => {
          setYaml(jsYaml.dump(data, { indent: 2, lineWidth: -1, noRefs: true }));
        })
        .catch((e) => {
          setYamlError(e instanceof Error ? e.message : String(e));
        })
        .finally(() => setYamlLoading(false));
    }
  }, [tab, name]);

  const totalRestarts = (p: PodSummary) =>
    (p.containers || []).reduce((sum, c) => sum + (c.restarts || 0), 0);

  if (!name) return null;

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-th-dim">
        <Link to="/nodes" className="hover:text-th-accent">Nodes</Link>
        <span>/</span>
        <span className="text-th-body">{name}</span>
      </div>

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-th-heading">{name}</h1>
        <button onClick={refresh} className="px-3 py-1.5 text-sm bg-th-accent text-white rounded-lg hover:opacity-90 transition-opacity">
          Refresh
        </button>
      </div>

      {loading && <TableSkeleton />}
      {error && <div className="p-3 bg-th-danger-s text-th-danger rounded-lg text-sm">{error}</div>}

      {!loading && node && (
        <DetailTabs tabs={TABS} activeTab={tab} onTabChange={setTab}>
          {/* ---- OVERVIEW TAB ---- */}
          {tab === "overview" && (
            <div className="space-y-6">
              {/* Node Info Card */}
              <div className="bg-th-panel border border-th-line rounded-xl p-6 shadow-card">
                <h2 className="text-lg font-semibold text-th-heading mb-4">Node Info</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  <div>
                    <span className="text-xs text-th-dim">Status</span>
                    <div className="mt-1">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                        node.status === "Ready" ? "bg-th-ok-s text-th-ok" : "bg-th-danger-s text-th-danger"
                      }`}>
                        {node.status}
                      </span>
                      {node.unschedulable && (
                        <span className="ml-2 px-2 py-0.5 rounded text-xs font-medium bg-th-warn-s text-th-warn">
                          SchedulingDisabled
                        </span>
                      )}
                    </div>
                  </div>
                  <div>
                    <span className="text-xs text-th-dim">Roles</span>
                    <p className="text-sm text-th-body mt-1">{node.roles.join(", ") || "-"}</p>
                  </div>
                  <div>
                    <span className="text-xs text-th-dim">Version</span>
                    <p className="text-sm text-th-body mt-1">{node.version}</p>
                  </div>
                  <div>
                    <span className="text-xs text-th-dim">Internal IP</span>
                    <p className="text-sm text-th-body font-mono mt-1">{node.internal_ip}</p>
                  </div>
                  <div>
                    <span className="text-xs text-th-dim">OS</span>
                    <p className="text-sm text-th-body mt-1">{node.os}</p>
                  </div>
                  <div>
                    <span className="text-xs text-th-dim">Architecture</span>
                    <p className="text-sm text-th-body mt-1">{node.architecture}</p>
                  </div>
                  <div>
                    <span className="text-xs text-th-dim">Container Runtime</span>
                    <p className="text-sm text-th-body mt-1">{node.container_runtime}</p>
                  </div>
                  <div>
                    <span className="text-xs text-th-dim">Kernel</span>
                    <p className="text-sm text-th-body mt-1">{node.kernel_version}</p>
                  </div>
                  <div>
                    <span className="text-xs text-th-dim">Created</span>
                    <p className="text-sm text-th-body mt-1">{age(node.created_at)} ago</p>
                  </div>
                </div>
              </div>

              {/* Capacity & Allocatable */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-th-panel border border-th-line rounded-xl p-6 shadow-card">
                  <h2 className="text-lg font-semibold text-th-heading mb-4">Capacity</h2>
                  <div className="space-y-3">
                    <div className="flex justify-between">
                      <span className="text-sm text-th-dim">CPU</span>
                      <span className="text-sm text-th-body font-mono">{node.cpu_capacity}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-th-dim">Memory</span>
                      <span className="text-sm text-th-body font-mono">{node.memory_capacity}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-th-dim">Pods</span>
                      <span className="text-sm text-th-body font-mono">{node.pod_capacity}</span>
                    </div>
                  </div>
                </div>
                <div className="bg-th-panel border border-th-line rounded-xl p-6 shadow-card">
                  <h2 className="text-lg font-semibold text-th-heading mb-4">Allocatable</h2>
                  <div className="space-y-3">
                    <div className="flex justify-between">
                      <span className="text-sm text-th-dim">CPU</span>
                      <span className="text-sm text-th-body font-mono">{node.cpu_allocatable}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-th-dim">Memory</span>
                      <span className="text-sm text-th-body font-mono">{node.memory_allocatable}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Conditions */}
              {node.conditions && node.conditions.length > 0 && (
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
                        {node.conditions.map((c, i) => (
                          <tr key={i} className="border-b border-th-line last:border-0">
                            <td className="px-4 py-2 text-th-body font-medium">{c.type}</td>
                            <td className="px-4 py-2">
                              <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                                c.status === "True"
                                  ? c.type === "Ready"
                                    ? "bg-th-ok-s text-th-ok"
                                    : "bg-th-danger-s text-th-danger"
                                  : c.type === "Ready"
                                    ? "bg-th-danger-s text-th-danger"
                                    : "bg-th-ok-s text-th-ok"
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

              {/* Taints */}
              {node.taints && node.taints.length > 0 && (
                <div className="bg-th-panel border border-th-line rounded-xl p-6 shadow-card">
                  <h2 className="text-lg font-semibold text-th-heading mb-4">Taints</h2>
                  <div className="flex flex-wrap gap-2">
                    {node.taints.map((t, i) => (
                      <span key={i} className="px-2 py-1 bg-th-warn-s text-th-warn border border-th-line rounded text-xs font-mono">
                        {t.key}{t.value ? `=${t.value}` : ""}:{t.effect}
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
                          <th className="px-4 py-3 font-medium">Namespace</th>
                          <th className="px-4 py-3 font-medium">Status</th>
                          <th className="px-4 py-3 font-medium">IP</th>
                          <th className="px-4 py-3 font-medium">Restarts</th>
                          <th className="px-4 py-3 font-medium">Age</th>
                        </tr>
                      </thead>
                      <tbody>
                        {nodePods.map((p) => {
                          const restarts = totalRestarts(p);
                          return (
                            <tr key={`${p.namespace}/${p.name}`} className="border-b border-th-line last:border-0 hover:bg-th-hover transition-colors">
                              <td className="px-4 py-3 font-medium max-w-xs truncate" title={p.name}>
                                <Link to={`/workloads/pods/${p.namespace}/${p.name}`} className="text-th-accent hover:underline">{p.name}</Link>
                              </td>
                              <td className="px-4 py-3 text-th-dim">{p.namespace}</td>
                              <td className="px-4 py-3">
                                <span className={`px-2 py-0.5 rounded text-xs font-medium ${podStatusColor(p.status)}`}>
                                  {p.status}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-th-dim font-mono text-xs">{p.ip || "-"}</td>
                              <td className="px-4 py-3">
                                <span className={restarts > 0 ? "text-th-warn" : "text-th-dim"}>{restarts}</span>
                              </td>
                              <td className="px-4 py-3 text-th-ghost">{age(p.created_at)}</td>
                            </tr>
                          );
                        })}
                        {nodePods.length === 0 && (
                          <EmptyRow colSpan={6} title="No pods running on this node" />
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ---- METRICS TAB ---- */}
          {tab === "metrics" && (
            <div>
              {metricsLoading && (
                <div className="flex items-center justify-center h-32">
                  <div className="w-6 h-6 border-2 border-th-accent border-t-transparent rounded-full animate-spin" />
                </div>
              )}
              {metricsError && <div className="p-3 bg-th-danger-s text-th-danger rounded-lg text-sm">{metricsError}</div>}

              {!metricsLoading && !metricsError && (
                <div className="space-y-4">
                  {!nodeMetrics ? (
                    <div className="bg-th-panel border border-th-line rounded-xl p-6 shadow-card">
                      <p className="text-sm text-th-ghost text-center">No metrics available for this node</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* CPU */}
                      <div className="bg-th-panel border border-th-line rounded-xl p-6 shadow-card">
                        <h2 className="text-lg font-semibold text-th-heading mb-4">CPU Usage</h2>
                        <div className="space-y-3">
                          <div className="flex justify-between text-sm">
                            <span className="text-th-dim">Usage</span>
                            <span className="text-th-body font-mono">{nodeMetrics.cpu_usage}</span>
                          </div>
                          <div className="flex justify-between text-sm mb-2">
                            <span className="text-th-dim">Utilization</span>
                            <span className="text-th-body font-medium">{nodeMetrics.cpu_percent.toFixed(1)}%</span>
                          </div>
                          <div className="w-full bg-th-subtle rounded-full h-4 overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${
                                nodeMetrics.cpu_percent > 90
                                  ? "bg-red-500"
                                  : nodeMetrics.cpu_percent > 70
                                    ? "bg-yellow-500"
                                    : "bg-green-500"
                              }`}
                              style={{ width: `${Math.min(nodeMetrics.cpu_percent, 100)}%` }}
                            />
                          </div>
                          <div className="pt-2 border-t border-th-line">
                            <p className="text-[10px] text-th-ghost uppercase tracking-wider mb-1">Live trend</p>
                            <LiveTrend value={nodeMetrics.cpu_percent} width={300} height={44}
                              color={nodeMetrics.cpu_percent > 90 ? "var(--th-danger)" : nodeMetrics.cpu_percent > 70 ? "var(--th-warn)" : "var(--th-ok)"} />
                          </div>
                        </div>
                      </div>

                      {/* Memory */}
                      <div className="bg-th-panel border border-th-line rounded-xl p-6 shadow-card">
                        <h2 className="text-lg font-semibold text-th-heading mb-4">Memory Usage</h2>
                        <div className="space-y-3">
                          <div className="flex justify-between text-sm">
                            <span className="text-th-dim">Usage</span>
                            <span className="text-th-body font-mono">{nodeMetrics.memory_usage}</span>
                          </div>
                          <div className="flex justify-between text-sm mb-2">
                            <span className="text-th-dim">Utilization</span>
                            <span className="text-th-body font-medium">{nodeMetrics.memory_percent.toFixed(1)}%</span>
                          </div>
                          <div className="w-full bg-th-subtle rounded-full h-4 overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${
                                nodeMetrics.memory_percent > 90
                                  ? "bg-red-500"
                                  : nodeMetrics.memory_percent > 70
                                    ? "bg-yellow-500"
                                    : "bg-green-500"
                              }`}
                              style={{ width: `${Math.min(nodeMetrics.memory_percent, 100)}%` }}
                            />
                          </div>
                          <div className="pt-2 border-t border-th-line">
                            <p className="text-[10px] text-th-ghost uppercase tracking-wider mb-1">Live trend</p>
                            <LiveTrend value={nodeMetrics.memory_percent} width={300} height={44}
                              color={nodeMetrics.memory_percent > 90 ? "var(--th-danger)" : nodeMetrics.memory_percent > 70 ? "var(--th-warn)" : "var(--th-ok)"} />
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ---- LABELS TAB ---- */}
          {tab === "labels" && (
            <div className="bg-th-panel border border-th-line rounded-xl p-6 shadow-card">
              <h2 className="text-lg font-semibold text-th-heading mb-4">Labels</h2>
              {(!node.labels || Object.keys(node.labels).length === 0) ? (
                <p className="text-sm text-th-ghost">No labels</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-th-dim bg-th-subtle border-b border-th-line">
                        <th className="px-4 py-2 font-medium">Key</th>
                        <th className="px-4 py-2 font-medium">Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(node.labels).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => (
                        <tr key={k} className="border-b border-th-line last:border-0">
                          <td className="px-4 py-2 text-th-body font-mono text-xs">{k}</td>
                          <td className="px-4 py-2 text-th-dim font-mono text-xs">{v}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {/* Also show as badges */}
              {node.labels && Object.keys(node.labels).length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {Object.entries(node.labels).map(([k, v]) => (
                    <span key={k} className="px-2 py-1 bg-th-subtle border border-th-line rounded text-xs text-th-body">
                      {k}={v}
                    </span>
                  ))}
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
                        {nodeEvents.map((ev, i) => (
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
                        {nodeEvents.length === 0 && (
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
            <div>
              {yamlLoading && (
                <div className="flex items-center justify-center h-32">
                  <div className="w-6 h-6 border-2 border-th-accent border-t-transparent rounded-full animate-spin" />
                </div>
              )}
              {yamlError && <div className="p-3 bg-th-danger-s text-th-danger rounded-lg text-sm">{yamlError}</div>}
              {!yamlLoading && !yamlError && (
                <YAMLEditor value={yaml} readOnly height="500px" />
              )}
            </div>
          )}
        </DetailTabs>
      )}
    </div>
  );
}
