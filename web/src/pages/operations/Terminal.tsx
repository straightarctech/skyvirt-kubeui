import { useState, useRef, useEffect } from "react";
import { useOutletContext } from "react-router-dom";
import { listPods } from "@/api/client";
import type { PodSummary } from "@/api/client";
import { useResource } from "@/hooks/useResource";
import { getAuthToken } from "@/hooks/useAuth";

export default function Terminal() {
  const { namespace } = useOutletContext<{ namespace: string }>();
  const { data: pods, loading: podsLoading } = useResource<PodSummary[]>(
    () => listPods(namespace),
    [namespace],
  );
  const [selectedPod, setSelectedPod] = useState("");
  const [selectedContainer, setSelectedContainer] = useState("");
  const [connected, setConnected] = useState(false);
  const [output, setOutput] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const wsRef = useRef<WebSocket | null>(null);
  const outputRef = useRef<HTMLDivElement>(null);

  const selectedPodObj = (pods ?? []).find((p) => `${p.namespace}/${p.name}` === selectedPod);
  const containers = selectedPodObj?.containers?.map((c) => c.name) ?? [];

  useEffect(() => {
    setSelectedContainer("");
    disconnect();
  }, [selectedPod]);

  // Cleanup WebSocket on unmount to prevent leak.
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output]);

  const connect = () => {
    if (!selectedPodObj) return;
    const ns = selectedPodObj.namespace;
    const name = selectedPodObj.name;
    const container = selectedContainer || containers[0] || "";
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const token = getAuthToken();
    const url = `${proto}//${window.location.host}/api/v1/namespaces/${ns}/pods/${name}/exec?container=${encodeURIComponent(container)}${token ? `&token=${encodeURIComponent(token)}` : ""}`;

    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      setOutput((prev) => [...prev, `--- Connected to ${ns}/${name}/${container} ---`]);
    };

    const decoder = new TextDecoder();
    ws.onmessage = (event) => {
      const text = typeof event.data === "string" ? event.data : decoder.decode(event.data);
      setOutput((prev) => [...prev, text]);
    };

    ws.onclose = () => {
      setConnected(false);
      setOutput((prev) => [...prev, "--- Disconnected ---"]);
    };

    ws.onerror = () => {
      setOutput((prev) => [...prev, "--- Connection error ---"]);
    };
  };

  const disconnect = () => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setConnected(false);
  };

  const sendCommand = () => {
    if (!wsRef.current || !input.trim()) return;
    wsRef.current.send(input + "\n");
    setOutput((prev) => [...prev, `$ ${input}`]);
    setInput("");
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <h1 className="text-2xl font-bold text-th-heading">Terminal</h1>

      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs text-th-dim mb-1">Pod</label>
          <select
            value={selectedPod}
            onChange={(e) => setSelectedPod(e.target.value)}
            disabled={connected}
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
              disabled={connected}
              className="px-3 py-2 bg-th-subtle border border-th-line rounded-lg text-sm text-th-body focus:outline-none focus:ring-1 focus:ring-th-accent"
            >
              {containers.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        )}

        {!connected ? (
          <button
            onClick={connect}
            disabled={!selectedPod}
            className="px-4 py-2 text-sm bg-th-ok text-white rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity"
          >Connect</button>
        ) : (
          <button
            onClick={disconnect}
            className="px-4 py-2 text-sm bg-th-danger text-white rounded-lg hover:opacity-90 transition-opacity"
          >Disconnect</button>
        )}
      </div>

      {podsLoading && (
        <div className="flex items-center justify-center h-32">
          <div className="w-6 h-6 border-2 border-th-accent border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      <div className="bg-gray-900 rounded-xl overflow-hidden shadow-card border border-th-line">
        <div className="flex items-center justify-between px-4 py-2 bg-gray-800 border-b border-gray-700">
          <span className="text-xs text-gray-400">
            {connected ? `Connected: ${selectedPodObj?.namespace}/${selectedPodObj?.name}` : "Not connected"}
          </span>
          <div className={`w-2 h-2 rounded-full ${connected ? "bg-green-400" : "bg-gray-600"}`} />
        </div>
        <div ref={outputRef} className="p-4 h-[400px] overflow-auto font-mono text-xs text-green-400">
          {output.map((line, i) => (
            <div key={i} className="whitespace-pre-wrap break-all">{line}</div>
          ))}
          {output.length === 0 && (
            <span className="text-gray-600">Select a pod and click Connect to start a terminal session</span>
          )}
        </div>
        {connected && (
          <div className="flex border-t border-gray-700">
            <span className="px-3 py-2 text-green-400 font-mono text-sm">$</span>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendCommand()}
              className="flex-1 bg-transparent text-green-400 font-mono text-sm py-2 pr-4 focus:outline-none"
              placeholder="Type a command..."
              autoFocus
            />
          </div>
        )}
      </div>
    </div>
  );
}
