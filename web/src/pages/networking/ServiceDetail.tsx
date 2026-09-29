import { useState, useEffect } from "react";
import { EmptyRow } from "@/components/EmptyState";
import { TableSkeleton } from "@/components/Skeleton";
import { useParams, Link } from "react-router-dom";
import DetailTabs from "@/components/DetailTabs";
import { useToast } from "@/components/Toast";
import YAMLEditor from "@/components/YAMLEditor";
import {
  getService,
  listPods,
  listEndpoints,
  listEvents,
  getResourceYAML,
  applyManifest,
} from "@/api/client";
import type { ServiceSummary, PodSummary, EndpointSummary, EventSummary } from "@/api/client";
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

function typeColor(type: string): string {
  switch (type) {
    case "ClusterIP":
      return "bg-th-info-s text-th-info";
    case "NodePort":
      return "bg-th-warn-s text-th-warn";
    case "LoadBalancer":
      return "bg-th-ok-s text-th-ok";
    case "ExternalName":
      return "bg-th-accent/20 text-th-accent";
    default:
      return "bg-th-subtle text-th-dim";
  }
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
  { key: "endpoints", label: "Endpoints" },
  { key: "pods", label: "Pods" },
  { key: "events", label: "Events" },
  { key: "yaml", label: "YAML" },
];

export default function ServiceDetail() {
  const { namespace, name } = useParams<{ namespace: string; name: string }>();
  const [tab, setTab] = useState("overview");

  // ---- Overview data ----
  const { data: svc, loading, error, refresh } = useResource<ServiceSummary>(
    () => getService(namespace!, name!),
    [namespace, name],
  );

  // ---- Endpoints data ----
  const { data: allEndpoints, loading: epsLoading, error: epsError } = useResource<EndpointSummary[]>(
    () => listEndpoints(namespace),
    [namespace],
  );
  const svcEndpoints = (allEndpoints ?? []).filter(
    (ep) => ep.name === name && ep.namespace === namespace,
  );

  // ---- Pods data ----
  const { data: allPods, loading: podsLoading, error: podsError } = useResource<PodSummary[]>(
    () => listPods(namespace),
    [namespace],
  );
  // Filter pods by service's selector labels
  const svcPods = (allPods ?? []).filter((p) => {
    if (!svc?.selector || !p.labels) return false;
    return Object.entries(svc.selector).every(
      ([k, v]) => p.labels[k] === v,
    );
  });

  // ---- Events data ----
  const { data: allEvents, loading: eventsLoading, error: eventsError } = useResource<EventSummary[]>(
    () => listEvents(namespace),
    [namespace],
  );
  const svcEvents = (allEvents ?? []).filter(
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
      getResourceYAML("Service", namespace, name)
        .then((data) => {
          setYaml(jsYaml.dump(data, { indent: 2, lineWidth: -1, noRefs: true }));
        })
        .catch((e) => {
          setYamlError(e instanceof Error ? e.message : String(e));
        })
        .finally(() => setYamlLoading(false));
    }
  }, [tab, namespace, name]);

  const toast = useToast();
  const handleSaveYaml = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await applyManifest(yaml);
      toast.success("Service updated");
      refresh();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const totalRestarts = (p: PodSummary) =>
    (p.containers || []).reduce((sum, c) => sum + (c.restarts || 0), 0);

  if (!namespace || !name) return null;

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-th-dim">
        <Link to="/networking/services" className="hover:text-th-accent">Services</Link>
        <span>/</span>
        <span className="text-th-body">{namespace}/{name}</span>
      </div>

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-th-heading">{name}</h1>
        <button onClick={refresh} className="px-3 py-1.5 text-sm bg-th-accent text-white rounded-lg hover:opacity-90 transition-opacity">
          Refresh
        </button>
      </div>

      {loading && <TableSkeleton />}
      {error && <div className="p-3 bg-th-danger-s text-th-danger rounded-lg text-sm">{error}</div>}

      {!loading && svc && (
        <DetailTabs tabs={TABS} activeTab={tab} onTabChange={setTab}>
          {/* ---- OVERVIEW TAB ---- */}
          {tab === "overview" && (
            <div className="space-y-6">
              {/* Service Info Card */}
              <div className="bg-th-panel border border-th-line rounded-xl p-6 shadow-card">
                <h2 className="text-lg font-semibold text-th-heading mb-4">Service Info</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  <div>
                    <span className="text-xs text-th-dim">Name</span>
                    <p className="text-sm text-th-body mt-1">{svc.name}</p>
                  </div>
                  <div>
                    <span className="text-xs text-th-dim">Namespace</span>
                    <p className="text-sm text-th-body mt-1">{svc.namespace}</p>
                  </div>
                  <div>
                    <span className="text-xs text-th-dim">Type</span>
                    <div className="mt-1">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${typeColor(svc.type)}`}>
                        {svc.type}
                      </span>
                    </div>
                  </div>
                  <div>
                    <span className="text-xs text-th-dim">Cluster IP</span>
                    <p className="text-sm text-th-body font-mono mt-1">{svc.cluster_ip || "-"}</p>
                  </div>
                  <div>
                    <span className="text-xs text-th-dim">External IP</span>
                    <p className="text-sm text-th-body font-mono mt-1">{svc.external_ip || "-"}</p>
                  </div>
                  <div>
                    <span className="text-xs text-th-dim">Created</span>
                    <p className="text-sm text-th-body mt-1">{age(svc.created_at)} ago</p>
                  </div>
                </div>
              </div>

              {/* Ports */}
              {svc.ports && svc.ports.length > 0 && (
                <div className="bg-th-panel border border-th-line rounded-xl p-6 shadow-card">
                  <h2 className="text-lg font-semibold text-th-heading mb-4">Ports</h2>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-th-dim bg-th-subtle border-b border-th-line">
                          <th className="px-4 py-2 font-medium">Name</th>
                          <th className="px-4 py-2 font-medium">Port</th>
                          <th className="px-4 py-2 font-medium">Target Port</th>
                          <th className="px-4 py-2 font-medium">Node Port</th>
                          <th className="px-4 py-2 font-medium">Protocol</th>
                        </tr>
                      </thead>
                      <tbody>
                        {svc.ports.map((p, i) => (
                          <tr key={i} className="border-b border-th-line last:border-0">
                            <td className="px-4 py-2 text-th-body">{p.name || "-"}</td>
                            <td className="px-4 py-2 text-th-body font-mono">{p.port}</td>
                            <td className="px-4 py-2 text-th-dim font-mono">{p.target_port || "-"}</td>
                            <td className="px-4 py-2 text-th-dim font-mono">{p.node_port || "-"}</td>
                            <td className="px-4 py-2 text-th-dim">{p.protocol}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Selector */}
              {svc.selector && Object.keys(svc.selector).length > 0 && (
                <div className="bg-th-panel border border-th-line rounded-xl p-6 shadow-card">
                  <h2 className="text-lg font-semibold text-th-heading mb-4">Selector</h2>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(svc.selector).map(([k, v]) => (
                      <span key={k} className="px-2 py-1 bg-th-subtle border border-th-line rounded text-xs text-th-body">
                        {k}={v}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Labels */}
              {svc.labels && Object.keys(svc.labels).length > 0 && (
                <div className="bg-th-panel border border-th-line rounded-xl p-6 shadow-card">
                  <h2 className="text-lg font-semibold text-th-heading mb-4">Labels</h2>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(svc.labels).map(([k, v]) => (
                      <span key={k} className="px-2 py-1 bg-th-subtle border border-th-line rounded text-xs text-th-body">
                        {k}={v}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ---- ENDPOINTS TAB ---- */}
          {tab === "endpoints" && (
            <div>
              {epsLoading && (
                <div className="flex items-center justify-center h-32">
                  <div className="w-6 h-6 border-2 border-th-accent border-t-transparent rounded-full animate-spin" />
                </div>
              )}
              {epsError && <div className="p-3 bg-th-danger-s text-th-danger rounded-lg text-sm">{epsError}</div>}

              {!epsLoading && (
                <div className="space-y-4">
                  {svcEndpoints.length === 0 ? (
                    <div className="bg-th-panel border border-th-line rounded-xl p-6 shadow-card">
                      <p className="text-sm text-th-ghost text-center">No endpoints found for this service</p>
                    </div>
                  ) : (
                    svcEndpoints.map((ep) => (
                      <div key={ep.name} className="bg-th-panel border border-th-line rounded-xl p-6 shadow-card space-y-4">
                        <div className="flex items-center justify-between">
                          <h2 className="text-lg font-semibold text-th-heading">{ep.name}</h2>
                          <div className="flex gap-3">
                            <span className="px-2 py-0.5 rounded text-xs font-medium bg-th-ok-s text-th-ok">{ep.ready} ready</span>
                            {ep.not_ready > 0 && (
                              <span className="px-2 py-0.5 rounded text-xs font-medium bg-th-danger-s text-th-danger">{ep.not_ready} not ready</span>
                            )}
                          </div>
                        </div>

                        {/* Ready Endpoints Table */}
                        {(ep.ready_addrs && ep.ready_addrs.length > 0) && (
                          <div className="overflow-x-auto">
                            <h3 className="text-xs font-bold text-th-dim uppercase tracking-wider mb-2">Ready Endpoints</h3>
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="text-left text-th-dim bg-th-subtle border-b border-th-line">
                                  <th className="px-4 py-2 font-medium">IP</th>
                                  <th className="px-4 py-2 font-medium">Ports</th>
                                  <th className="px-4 py-2 font-medium">Pod</th>
                                  <th className="px-4 py-2 font-medium">Node</th>
                                </tr>
                              </thead>
                              <tbody>
                                {ep.ready_addrs.map((a, i) => (
                                  <tr key={i} className="border-b border-th-line last:border-0 hover:bg-th-hover transition-colors">
                                    <td className="px-4 py-2 text-th-body font-mono text-xs">{a.ip}</td>
                                    <td className="px-4 py-2 text-th-dim font-mono text-xs">
                                      {(ep.ports || []).map((p) => `${p.port}/${p.protocol}`).join(", ")}
                                    </td>
                                    <td className="px-4 py-2 text-th-accent text-xs">{a.target_ref || "-"}</td>
                                    <td className="px-4 py-2 text-th-dim text-xs">{a.node_name || "-"}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}

                        {/* Not Ready Endpoints Table */}
                        {(ep.not_ready_addrs && ep.not_ready_addrs.length > 0) && (
                          <div className="overflow-x-auto">
                            <h3 className="text-xs font-bold text-th-danger uppercase tracking-wider mb-2">Not Ready Endpoints</h3>
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="text-left text-th-dim bg-th-danger-s/30 border-b border-th-line">
                                  <th className="px-4 py-2 font-medium">IP</th>
                                  <th className="px-4 py-2 font-medium">Pod</th>
                                  <th className="px-4 py-2 font-medium">Node</th>
                                </tr>
                              </thead>
                              <tbody>
                                {ep.not_ready_addrs.map((a, i) => (
                                  <tr key={i} className="border-b border-th-line last:border-0">
                                    <td className="px-4 py-2 text-th-danger font-mono text-xs">{a.ip}</td>
                                    <td className="px-4 py-2 text-th-dim text-xs">{a.target_ref || "-"}</td>
                                    <td className="px-4 py-2 text-th-dim text-xs">{a.node_name || "-"}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}

                        {/* Fallback if no address details (old backend) */}
                        {(!ep.ready_addrs || ep.ready_addrs.length === 0) && (!ep.not_ready_addrs || ep.not_ready_addrs.length === 0) && ep.ports && ep.ports.length > 0 && (
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="text-left text-th-dim bg-th-subtle border-b border-th-line">
                                  <th className="px-4 py-2 font-medium">Port Name</th>
                                  <th className="px-4 py-2 font-medium">Port</th>
                                  <th className="px-4 py-2 font-medium">Protocol</th>
                                </tr>
                              </thead>
                              <tbody>
                                {ep.ports.map((p, i) => (
                                  <tr key={i} className="border-b border-th-line last:border-0">
                                    <td className="px-4 py-2 text-th-body">{p.name || "-"}</td>
                                    <td className="px-4 py-2 text-th-body font-mono">{p.port}</td>
                                    <td className="px-4 py-2 text-th-dim">{p.protocol}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    ))
                  )}
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
                          <th className="px-4 py-3 font-medium">IP</th>
                          <th className="px-4 py-3 font-medium">Restarts</th>
                          <th className="px-4 py-3 font-medium">Age</th>
                        </tr>
                      </thead>
                      <tbody>
                        {svcPods.map((p) => {
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
                              <td className="px-4 py-3 text-th-dim font-mono text-xs">{p.ip || "-"}</td>
                              <td className="px-4 py-3">
                                <span className={restarts > 0 ? "text-th-warn" : "text-th-dim"}>{restarts}</span>
                              </td>
                              <td className="px-4 py-3 text-th-ghost">{age(p.created_at)}</td>
                            </tr>
                          );
                        })}
                        {svcPods.length === 0 && (
                          <EmptyRow colSpan={5} title="No pods match this service's selector" />
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
                        {svcEvents.map((ev, i) => (
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
                        {svcEvents.length === 0 && (
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
    </div>
  );
}
