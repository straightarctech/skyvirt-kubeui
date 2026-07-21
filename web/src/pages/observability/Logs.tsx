import { useState, useEffect, useCallback } from "react";
import { useOutletContext } from "react-router-dom";
import { listPods, getPodLogs } from "@/api/client";
import type { PodSummary } from "@/api/client";
import { useResource } from "@/hooks/useResource";

export default function Logs() {
  const { namespace } = useOutletContext<{ namespace: string }>();
  const { data: pods, loading: podsLoading } = useResource<PodSummary[]>(
    () => listPods(namespace),
    [namespace],
  );
  const [selectedPod, setSelectedPod] = useState("");
  const [selectedContainer, setSelectedContainer] = useState("");
  const [tailLines, setTailLines] = useState(100);
  const [logs, setLogs] = useState("");
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);

  const selectedPodObj = (pods ?? []).find((p) => `${p.namespace}/${p.name}` === selectedPod);
  const containers = selectedPodObj?.containers?.map((c) => c.name) ?? [];

  useEffect(() => {
    setSelectedContainer("");
    setLogs("");
  }, [selectedPod]);

  const fetchLogs = useCallback(async () => {
    if (!selectedPodObj) return;
    const { namespace: ns, name: podName } = selectedPodObj;
    setLogsLoading(true);
    setLogsError(null);
    try {
      const text = await getPodLogs(ns, podName, selectedContainer || undefined, tailLines);
      setLogs(text);
    } catch (e) {
      setLogsError(e instanceof Error ? e.message : String(e));
    } finally {
      setLogsLoading(false);
    }
  }, [selectedPodObj, selectedContainer, tailLines]);

  useEffect(() => {
    if (!autoRefresh || !selectedPodObj) return;
    const interval = setInterval(fetchLogs, 5000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchLogs, selectedPodObj]);

  return (
    <div className="space-y-4 animate-fade-in">
      <h1 className="text-2xl font-bold text-th-heading">Pod Logs</h1>

      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs text-th-dim mb-1">Pod</label>
          <select
            value={selectedPod}
            onChange={(e) => setSelectedPod(e.target.value)}
            className="px-3 py-2 bg-th-subtle border border-th-line rounded-lg text-sm text-th-body focus:outline-none focus:ring-1 focus:ring-th-accent min-w-[200px]"
          >
            <option value="">Select a pod...</option>
            {(pods ?? []).map((p) => (
              <option key={`${p.namespace}/${p.name}`} value={`${p.namespace}/${p.name}`}>
                {p.namespace}/{p.name}
              </option>
            ))}
          </select>
        </div>

        {containers.length > 1 && (
          <div>
            <label className="block text-xs text-th-dim mb-1">Container</label>
            <select
              value={selectedContainer}
              onChange={(e) => setSelectedContainer(e.target.value)}
              className="px-3 py-2 bg-th-subtle border border-th-line rounded-lg text-sm text-th-body focus:outline-none focus:ring-1 focus:ring-th-accent"
            >
              <option value="">All</option>
              {containers.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        )}

        <div>
          <label className="block text-xs text-th-dim mb-1">Tail Lines</label>
          <select
            value={tailLines}
            onChange={(e) => setTailLines(Number(e.target.value))}
            className="px-3 py-2 bg-th-subtle border border-th-line rounded-lg text-sm text-th-body focus:outline-none focus:ring-1 focus:ring-th-accent"
          >
            <option value={50}>50</option>
            <option value={100}>100</option>
            <option value={500}>500</option>
            <option value={1000}>1000</option>
          </select>
        </div>

        <button
          onClick={fetchLogs}
          disabled={!selectedPod || logsLoading}
          className="px-4 py-2 text-sm bg-th-accent text-white rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {logsLoading ? "Loading..." : "Fetch Logs"}
        </button>

        <label className="flex items-center gap-2 text-sm text-th-dim">
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(e) => setAutoRefresh(e.target.checked)}
            className="rounded"
          />
          Auto-refresh (5s)
        </label>
      </div>

      {podsLoading && (
        <div className="flex items-center justify-center h-32">
          <div className="w-6 h-6 border-2 border-th-accent border-t-transparent rounded-full animate-spin" />
        </div>
      )}
      {logsError && <div className="p-3 bg-th-danger-s text-th-danger rounded-lg text-sm">{logsError}</div>}

      {logs && (
        <div className="bg-th-panel border border-th-line rounded-xl shadow-card overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2 bg-th-subtle border-b border-th-line">
            <span className="text-xs text-th-dim">
              {selectedPodObj?.namespace}/{selectedPodObj?.name}
              {selectedContainer ? ` / ${selectedContainer}` : ""}
            </span>
            <span className="text-xs text-th-ghost">{logs.split("\n").length} lines</span>
          </div>
          <pre className="p-4 text-xs font-mono text-th-body overflow-auto max-h-[600px] whitespace-pre-wrap break-all">
            {logs}
          </pre>
        </div>
      )}

      {!logs && !logsLoading && selectedPod && (
        <div className="bg-th-panel border border-th-line rounded-xl p-8 text-center text-th-ghost shadow-card">
          Click "Fetch Logs" to view pod logs
        </div>
      )}
    </div>
  );
}
