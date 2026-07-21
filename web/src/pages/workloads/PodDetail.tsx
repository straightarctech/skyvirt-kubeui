import { useState, useEffect, useRef, useCallback } from "react";
import { EmptyRow } from "@/components/EmptyState";
import { TableSkeleton } from "@/components/Skeleton";
import { useParams, Link } from "react-router-dom";
import DetailTabs from "@/components/DetailTabs";
import YAMLEditor from "@/components/YAMLEditor";
import { getPod, getPodLogs, listEvents, getResourceYAML, topPods } from "@/api/client";
import type { PodSummary, EventSummary, PodMetrics } from "@/api/client";
import { LiveTrend } from "@/components/viz";

/* metrics-server unit parsing (nanocores/millicores/cores, Ki/Mi/Gi) */
function cpuMilli(s: string): number {
  if (!s) return 0;
  const v = parseFloat(s);
  if (s.endsWith("n")) return v / 1e6;
  if (s.endsWith("u")) return v / 1e3;
  if (s.endsWith("m")) return v;
  return v * 1000;
}
function memMi(s: string): number {
  if (!s) return 0;
  const v = parseFloat(s);
  if (s.endsWith("Gi")) return v * 1024;
  if (s.endsWith("Mi")) return v;
  if (s.endsWith("Ki")) return v / 1024;
  return v / (1024 * 1024);
}
function fmtCpu(m: number): string { return m >= 1000 ? `${(m / 1000).toFixed(2)} cores` : `${Math.round(m)}m`; }
function fmtMi(mi: number): string { return mi >= 1024 ? `${(mi / 1024).toFixed(2)} Gi` : `${Math.round(mi)} Mi`; }
import { getAuthToken } from "@/hooks/useAuth";
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
  { key: "metrics", label: "Metrics" },
  { key: "logs", label: "Logs" },
  { key: "exec", label: "Terminal" },
  { key: "events", label: "Events" },
  { key: "yaml", label: "YAML" },
];

export default function PodDetail() {
  const { namespace, name } = useParams<{ namespace: string; name: string }>();
  const [tab, setTab] = useState("overview");

  // ---- Overview data ----
  const { data: pod, loading, error, refresh } = useResource<PodSummary>(
    () => getPod(namespace!, name!),
    [namespace, name],
  );

  // ---- Metrics ----
  const { data: podMetricsAll } = useResource<PodMetrics[]>(
    () => topPods(namespace),
    [namespace],
  );
  const podMetrics = (podMetricsAll ?? []).find((m) => m.name === name && m.namespace === namespace);
  const totalCpu = (podMetrics?.containers || []).reduce((s, c) => s + cpuMilli(c.cpu_usage), 0);
  const totalMem = (podMetrics?.containers || []).reduce((s, c) => s + memMi(c.memory_usage), 0);

  // ---- Logs state ----
  const [selectedContainer, setSelectedContainer] = useState("");
  const [tailLines, setTailLines] = useState(200);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [logs, setLogs] = useState("");
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchLogs = useCallback(async () => {
    if (!namespace || !name) return;
    setLogsLoading(true);
    setLogsError(null);
    try {
      const container = selectedContainer || undefined;
      const text = await getPodLogs(namespace, name, container, tailLines);
      setLogs(text);
    } catch (e) {
      setLogsError(e instanceof Error ? e.message : String(e));
    } finally {
      setLogsLoading(false);
    }
  }, [namespace, name, selectedContainer, tailLines]);

  // Fetch logs when switching to Logs tab or when params change
  useEffect(() => {
    if (tab === "logs") {
      fetchLogs();
    }
  }, [tab, fetchLogs]);

  // Auto-refresh logs
  useEffect(() => {
    if (autoRefresh && tab === "logs") {
      intervalRef.current = setInterval(fetchLogs, 5000);
    }
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [autoRefresh, tab, fetchLogs]);

  // Set default container once pod loads
  useEffect(() => {
    if (pod && pod.containers?.length > 0 && !selectedContainer) {
      setSelectedContainer(pod.containers[0].name);
    }
  }, [pod, selectedContainer]);

  const handleDownloadLogs = () => {
    const blob = new Blob([logs], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${namespace}-${name}-logs.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ---- Events data ----
  const { data: allEvents, loading: eventsLoading, error: eventsError } = useResource<EventSummary[]>(
    () => listEvents(namespace),
    [namespace],
  );
  const podEvents = (allEvents ?? []).filter(
    (e) => e.regarding_name === name && e.namespace === namespace,
  );

  // ---- YAML data ----
  const [yaml, setYaml] = useState("");
  const [yamlLoading, setYamlLoading] = useState(false);
  const [yamlError, setYamlError] = useState<string | null>(null);

  useEffect(() => {
    if (tab === "yaml" && namespace && name) {
      setYamlLoading(true);
      setYamlError(null);
      getResourceYAML("Pod", namespace, name)
        .then((data) => {
          setYaml(jsYaml.dump(data, { indent: 2, lineWidth: -1, noRefs: true }));
        })
        .catch((e) => {
          setYamlError(e instanceof Error ? e.message : String(e));
        })
        .finally(() => setYamlLoading(false));
    }
  }, [tab, namespace, name]);

  // ---- Exec terminal state ----
  const [execContainer, setExecContainer] = useState("");
  const [execConnected, setExecConnected] = useState(false);
  const [execOutput, setExecOutput] = useState<string[]>([]);
  const [execInput, setExecInput] = useState("");
  const execWsRef = useRef<WebSocket | null>(null);
  const execOutputRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (execOutputRef.current) {
      execOutputRef.current.scrollTop = execOutputRef.current.scrollHeight;
    }
  }, [execOutput]);

  // Cleanup exec WebSocket on unmount
  useEffect(() => {
    return () => {
      if (execWsRef.current) {
        execWsRef.current.close();
        execWsRef.current = null;
      }
    };
  }, []);

  const execConnect = () => {
    if (!namespace || !name) return;
    const container = execContainer || pod?.containers?.[0]?.name || "";
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const token = getAuthToken();
    const url = `${proto}//${window.location.host}/api/v1/namespaces/${namespace}/pods/${name}/exec?container=${encodeURIComponent(container)}${token ? `&token=${encodeURIComponent(token)}` : ""}`;
    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    execWsRef.current = ws;
    ws.onopen = () => {
      setExecConnected(true);
      setExecOutput((prev) => [...prev, `--- Connected to ${namespace}/${name}/${container} ---`]);
    };
    const decoder = new TextDecoder();
    ws.onmessage = (event) => {
      const text = typeof event.data === "string" ? event.data : decoder.decode(event.data);
      setExecOutput((prev) => [...prev, text]);
    };
    ws.onclose = () => {
      setExecConnected(false);
      setExecOutput((prev) => [...prev, "--- Disconnected ---"]);
    };
    ws.onerror = () => {
      setExecOutput((prev) => [...prev, "--- Connection error ---"]);
    };
  };

  const execDisconnect = () => {
    if (execWsRef.current) {
      execWsRef.current.close();
      execWsRef.current = null;
    }
    setExecConnected(false);
  };

  const execSend = () => {
    if (!execWsRef.current || !execInput.trim()) return;
    execWsRef.current.send(execInput + "\n");
    setExecOutput((prev) => [...prev, `$ ${execInput}`]);
    setExecInput("");
  };

  if (!namespace || !name) return null;

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-th-dim">
        <Link to="/workloads/pods" className="hover:text-th-accent">Pods</Link>
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

      {!loading && pod && (
        <DetailTabs tabs={TABS} activeTab={tab} onTabChange={setTab}>
          {/* ---- OVERVIEW TAB ---- */}
          {tab === "overview" && (
            <div className="space-y-6">
              {/* Pod Info Card */}
              <div className="bg-th-panel border border-th-line rounded-xl p-6 shadow-card">
                <h2 className="text-lg font-semibold text-th-heading mb-4">Pod Info</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  <div>
                    <span className="text-xs text-th-dim">Status</span>
                    <div className="mt-1">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${podStatusColor(pod.status)}`}>
                        {pod.status}
                      </span>
                    </div>
                  </div>
                  <div>
                    <span className="text-xs text-th-dim">Namespace</span>
                    <p className="text-sm text-th-body mt-1">{pod.namespace}</p>
                  </div>
                  <div>
                    <span className="text-xs text-th-dim">Node</span>
                    <p className="text-sm text-th-body mt-1">
                      {pod.node ? (
                        <Link to={`/nodes/${pod.node}`} className="text-th-accent hover:underline">{pod.node}</Link>
                      ) : "-"}
                    </p>
                  </div>
                  <div>
                    <span className="text-xs text-th-dim">IP</span>
                    <p className="text-sm text-th-body font-mono mt-1">{pod.ip || "-"}</p>
                  </div>
                  <div>
                    <span className="text-xs text-th-dim">Created</span>
                    <p className="text-sm text-th-body mt-1">{age(pod.created_at)} ago</p>
                  </div>
                  {pod.owner_kind && (
                    <div>
                      <span className="text-xs text-th-dim">Owner</span>
                      <p className="text-sm text-th-body mt-1">{pod.owner_kind}/{pod.owner_name}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Containers */}
              <div className="bg-th-panel border border-th-line rounded-xl p-6 shadow-card">
                <h2 className="text-lg font-semibold text-th-heading mb-4">Containers</h2>
                {(!pod.containers || pod.containers.length === 0) ? (
                  <p className="text-sm text-th-ghost">No containers</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-th-dim bg-th-subtle border-b border-th-line">
                          <th className="px-4 py-2 font-medium">Name</th>
                          <th className="px-4 py-2 font-medium">Image</th>
                          <th className="px-4 py-2 font-medium">Ready</th>
                          <th className="px-4 py-2 font-medium">Restarts</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pod.containers.map((c) => (
                          <tr key={c.name} className="border-b border-th-line last:border-0">
                            <td className="px-4 py-2 text-th-body font-medium">{c.name}</td>
                            <td className="px-4 py-2 text-th-dim text-xs font-mono max-w-xs truncate" title={c.image}>{c.image}</td>
                            <td className="px-4 py-2">
                              <span className={`px-2 py-0.5 rounded text-xs font-medium ${c.ready ? "bg-th-ok-s text-th-ok" : "bg-th-danger-s text-th-danger"}`}>
                                {c.ready ? "Yes" : "No"}
                              </span>
                            </td>
                            <td className="px-4 py-2">
                              <span className={c.restarts > 0 ? "text-th-warn" : "text-th-dim"}>{c.restarts}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Labels */}
              {pod.labels && Object.keys(pod.labels).length > 0 && (
                <div className="bg-th-panel border border-th-line rounded-xl p-6 shadow-card">
                  <h2 className="text-lg font-semibold text-th-heading mb-4">Labels</h2>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(pod.labels).map(([k, v]) => (
                      <span key={k} className="px-2 py-1 bg-th-subtle border border-th-line rounded text-xs text-th-body">
                        {k}={v}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ---- METRICS TAB ---- */}
          {tab === "metrics" && (
            <div className="space-y-4">
              {!podMetrics ? (
                <div className="bg-th-panel border border-th-line rounded-xl shadow-card px-4 py-10 text-center text-th-ghost">
                  No metrics for this pod — the metrics-server may still be warming up, or the pod isn't running.
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="bg-th-panel border border-th-line rounded-xl p-6 shadow-card">
                      <div className="flex items-baseline justify-between mb-3">
                        <h2 className="text-lg font-semibold text-th-heading">CPU</h2>
                        <span className="text-xl font-bold text-th-heading tabular-nums">{fmtCpu(totalCpu)}</span>
                      </div>
                      <p className="text-[10px] text-th-ghost uppercase tracking-wider mb-1">Live trend</p>
                      <LiveTrend value={Math.round(totalCpu)} width={300} height={44} color="var(--th-accent)" />
                    </div>
                    <div className="bg-th-panel border border-th-line rounded-xl p-6 shadow-card">
                      <div className="flex items-baseline justify-between mb-3">
                        <h2 className="text-lg font-semibold text-th-heading">Memory</h2>
                        <span className="text-xl font-bold text-th-heading tabular-nums">{fmtMi(totalMem)}</span>
                      </div>
                      <p className="text-[10px] text-th-ghost uppercase tracking-wider mb-1">Live trend</p>
                      <LiveTrend value={Math.round(totalMem)} width={300} height={44} color="var(--th-info)" />
                    </div>
                  </div>

                  <div className="bg-th-panel border border-th-line rounded-xl overflow-hidden shadow-card">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-th-dim bg-th-subtle border-b border-th-line">
                          <th className="px-4 py-3 font-medium">Container</th>
                          <th className="px-4 py-3 font-medium">CPU</th>
                          <th className="px-4 py-3 font-medium">Memory</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(podMetrics.containers || []).map((c) => (
                          <tr key={c.name} className="border-b border-th-line last:border-0">
                            <td className="px-4 py-3 font-medium text-th-body">{c.name}</td>
                            <td className="px-4 py-3 text-th-dim tabular-nums">{fmtCpu(cpuMilli(c.cpu_usage))}</td>
                            <td className="px-4 py-3 text-th-dim tabular-nums">{fmtMi(memMi(c.memory_usage))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ---- LOGS TAB ---- */}
          {tab === "logs" && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                {/* Container selector */}
                {pod.containers && pod.containers.length > 1 && (
                  <select
                    value={selectedContainer}
                    onChange={(e) => setSelectedContainer(e.target.value)}
                    className="px-3 py-1.5 bg-th-subtle border border-th-line rounded-lg text-sm text-th-body focus:outline-none focus:ring-1 focus:ring-th-accent"
                  >
                    {pod.containers.map((c) => (
                      <option key={c.name} value={c.name}>{c.name}</option>
                    ))}
                  </select>
                )}

                {/* Tail lines */}
                <select
                  value={tailLines}
                  onChange={(e) => setTailLines(Number(e.target.value))}
                  className="px-3 py-1.5 bg-th-subtle border border-th-line rounded-lg text-sm text-th-body focus:outline-none focus:ring-1 focus:ring-th-accent"
                >
                  <option value={100}>100 lines</option>
                  <option value={200}>200 lines</option>
                  <option value={500}>500 lines</option>
                  <option value={1000}>1000 lines</option>
                </select>

                {/* Auto-refresh toggle */}
                <label className="flex items-center gap-2 text-sm text-th-body cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoRefresh}
                    onChange={(e) => setAutoRefresh(e.target.checked)}
                    className="rounded border-th-line"
                  />
                  Auto-refresh (5s)
                </label>

                {/* Refresh button */}
                <button
                  onClick={fetchLogs}
                  className="px-3 py-1.5 text-sm bg-th-accent text-white rounded-lg hover:opacity-90 transition-opacity"
                >
                  Refresh
                </button>

                {/* Download button */}
                <button
                  onClick={handleDownloadLogs}
                  disabled={!logs}
                  className="px-3 py-1.5 text-sm border border-th-line text-th-body rounded-lg hover:bg-th-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Download
                </button>
              </div>

              {logsLoading && (
                <div className="flex items-center justify-center h-32">
                  <div className="w-6 h-6 border-2 border-th-accent border-t-transparent rounded-full animate-spin" />
                </div>
              )}
              {logsError && <div className="p-3 bg-th-danger-s text-th-danger rounded-lg text-sm">{logsError}</div>}

              {!logsLoading && !logsError && (
                <div className="bg-th-panel border border-th-line rounded-xl shadow-card overflow-hidden">
                  <pre className="text-xs text-th-body font-mono whitespace-pre-wrap break-all bg-[#1a1a2e] text-gray-200 p-4 max-h-[600px] overflow-auto">
                    {logs || "No logs available"}
                  </pre>
                </div>
              )}
            </div>
          )}

          {/* ---- EXEC TAB ---- */}
          {tab === "exec" && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                {pod.containers && pod.containers.length > 1 && (
                  <select
                    value={execContainer}
                    onChange={(e) => setExecContainer(e.target.value)}
                    disabled={execConnected}
                    className="px-3 py-1.5 bg-th-subtle border border-th-line rounded-lg text-sm text-th-body focus:outline-none focus:ring-1 focus:ring-th-accent"
                  >
                    {pod.containers.map((c) => (
                      <option key={c.name} value={c.name}>{c.name}</option>
                    ))}
                  </select>
                )}
                {!execConnected ? (
                  <button
                    onClick={execConnect}
                    className="px-4 py-1.5 text-sm bg-th-ok text-white rounded-lg hover:opacity-90 transition-opacity"
                  >
                    Connect
                  </button>
                ) : (
                  <button
                    onClick={execDisconnect}
                    className="px-4 py-1.5 text-sm bg-th-danger text-white rounded-lg hover:opacity-90 transition-opacity"
                  >
                    Disconnect
                  </button>
                )}
              </div>
              <div className="bg-gray-900 rounded-xl overflow-hidden shadow-card border border-th-line">
                <div className="flex items-center justify-between px-4 py-2 bg-gray-800 border-b border-gray-700">
                  <span className="text-xs text-gray-400">
                    {execConnected ? `Connected: ${namespace}/${name}` : "Not connected"}
                  </span>
                  <div className={`w-2 h-2 rounded-full ${execConnected ? "bg-green-400" : "bg-gray-600"}`} />
                </div>
                <div ref={execOutputRef} className="p-4 h-[400px] overflow-auto font-mono text-xs text-green-400">
                  {execOutput.map((line, i) => (
                    <div key={i} className="whitespace-pre-wrap break-all">{line}</div>
                  ))}
                  {execOutput.length === 0 && (
                    <span className="text-gray-600">Click Connect to start a shell session</span>
                  )}
                </div>
                {execConnected && (
                  <div className="flex border-t border-gray-700">
                    <span className="px-3 py-2 text-green-400 font-mono text-sm">$</span>
                    <input
                      type="text"
                      value={execInput}
                      onChange={(e) => setExecInput(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && execSend()}
                      className="flex-1 bg-transparent text-green-400 font-mono text-sm py-2 pr-4 focus:outline-none"
                      placeholder="Type a command..."
                      autoFocus
                    />
                  </div>
                )}
              </div>
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
                        {podEvents.map((ev, i) => (
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
                        {podEvents.length === 0 && (
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
