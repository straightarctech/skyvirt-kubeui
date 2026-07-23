import { useState } from "react";
import { TableSkeleton } from "@/components/Skeleton";
import { useOutletContext } from "react-router-dom";
import { listNodes, cordonNode, uncordonNode, drainNode, addNodeTaint, removeNodeTaint } from "@/api/client";
import type { NodeSummary } from "@/api/client";
import { useResource } from "@/hooks/useResource";
import ConfirmModal from "@/components/ConfirmModal";
import { useToast } from "@/components/Toast";

function StatusBadge({ status }: { status: string }) {
  const colors =
    status === "Ready"
      ? "bg-th-ok-s text-th-ok"
      : "bg-th-danger-s text-th-danger";
  return <span className={`px-2 py-0.5 rounded text-xs font-medium ${colors}`}>{status}</span>;
}

export default function NodeOperations() {
  useOutletContext<{ namespace: string }>();
  const { data: nodes, loading, error, refresh } = useResource<NodeSummary[]>(listNodes);
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [pending, setPending] = useState<{ name: string; label: string; danger?: boolean; fn: () => Promise<void> } | null>(null);
  const [taintModal, setTaintModal] = useState<string | null>(null);
  const [taintKey, setTaintKey] = useState("");
  const [taintValue, setTaintValue] = useState("");
  const [taintEffect, setTaintEffect] = useState<string>("NoSchedule");

  const filtered = (nodes ?? []).filter(
    (n) =>
      n.name.toLowerCase().includes(search.toLowerCase()) ||
      n.internal_ip.includes(search),
  );

  const handleAction = (name: string, action: () => Promise<void>, label: string) => {
    setPending({ name, label, danger: label === "Drain", fn: action });
  };

  const runPending = async () => {
    if (!pending) return;
    setActionLoading(pending.name);
    try {
      await pending.fn();
      toast.success(`${pending.label} ${pending.name} succeeded`);
      refresh();
    } finally {
      setActionLoading(null);
    }
  };

  const handleAddTaint = async (nodeName: string) => {
    if (!taintKey.trim()) return;
    setActionLoading(nodeName);
    try {
      await addNodeTaint(nodeName, { key: taintKey.trim(), value: taintValue.trim(), effect: taintEffect });
      setTaintModal(null);
      setTaintKey("");
      setTaintValue("");
      setTaintEffect("NoSchedule");
      toast.success(`Taint added to ${nodeName}`);
      refresh();
    } catch (e) {
      toast.error("Failed to add taint", e instanceof Error ? e.message : String(e));
    } finally {
      setActionLoading(null);
    }
  };

  const handleRemoveTaint = (nodeName: string, key: string) => {
    setPending({
      name: nodeName,
      label: `Remove taint "${key}" from`,
      fn: async () => {
        await removeNodeTaint(nodeName, key);
      },
    });
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-th-heading">Node Operations</h1>
        <button
          onClick={refresh}
          className="px-3 py-1.5 text-sm bg-th-accent text-white rounded-lg hover:opacity-90 transition-opacity"
        >
          Refresh
        </button>
      </div>

      <input
        type="text"
        placeholder="Search nodes..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full max-w-sm px-3 py-2 bg-th-subtle border border-th-line rounded-lg text-sm text-th-body placeholder:text-th-ghost focus:outline-none focus:ring-1 focus:ring-th-accent"
      />

      {loading && <TableSkeleton />}
      {error && <div className="p-3 bg-th-danger-s text-th-danger rounded-lg text-sm">{error}</div>}

      {!loading && (
        <div className="space-y-4">
          {filtered.map((node) => (
            <div key={node.name} className="bg-th-panel border border-th-line rounded-xl shadow-card p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <span className="font-medium text-lg text-th-body">{node.name}</span>
                  <StatusBadge status={node.status} />
                  {node.unschedulable && (
                    <span className="px-2 py-0.5 rounded text-xs font-medium bg-th-warn-s text-th-warn">
                      Cordoned
                    </span>
                  )}
                </div>
                <span className="text-xs text-th-ghost font-mono">{node.internal_ip}</span>
              </div>

              {/* Actions */}
              <div className="flex flex-wrap gap-2 mb-4">
                {node.unschedulable ? (
                  <button
                    onClick={() => handleAction(node.name, () => uncordonNode(node.name), "Uncordon")}
                    disabled={actionLoading === node.name}
                    className="px-3 py-1.5 text-xs bg-th-ok-s text-th-ok rounded-lg hover:opacity-80 disabled:opacity-50"
                  >
                    Uncordon
                  </button>
                ) : (
                  <button
                    onClick={() => handleAction(node.name, () => cordonNode(node.name), "Cordon")}
                    disabled={actionLoading === node.name}
                    className="px-3 py-1.5 text-xs bg-th-warn-s text-th-warn rounded-lg hover:opacity-80 disabled:opacity-50"
                  >
                    Cordon
                  </button>
                )}
                <button
                  onClick={() => handleAction(node.name, () => drainNode(node.name), "Drain")}
                  disabled={actionLoading === node.name}
                  className="px-3 py-1.5 text-xs bg-th-danger-s text-th-danger rounded-lg hover:opacity-80 disabled:opacity-50"
                >
                  Drain
                </button>
                <button
                  onClick={() => setTaintModal(node.name)}
                  disabled={actionLoading === node.name}
                  className="px-3 py-1.5 text-xs bg-th-info-s text-th-info rounded-lg hover:opacity-80 disabled:opacity-50"
                >
                  Add Taint
                </button>
              </div>

              {/* Taints */}
              <div>
                <h3 className="text-sm font-medium text-th-dim mb-2">Taints</h3>
                <div className="flex flex-wrap gap-2">
                  {(node.taints || []).map((t) => (
                    <div
                      key={t.key}
                      className="flex items-center gap-1 px-2 py-1 bg-th-subtle border border-th-line rounded text-xs"
                    >
                      <span className="font-medium text-th-body">{t.key}</span>
                      {t.value && (
                        <>
                          <span className="text-th-ghost">=</span>
                          <span className="text-th-dim">{t.value}</span>
                        </>
                      )}
                      <span className="text-th-ghost">:</span>
                      <span className="text-th-warn">{t.effect}</span>
                      <button
                        onClick={() => handleRemoveTaint(node.name, t.key)}
                        disabled={actionLoading === node.name}
                        className="ml-1 text-th-danger hover:opacity-80"
                        title="Remove taint"
                      >
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                  {(!node.taints || node.taints.length === 0) && (
                    <span className="text-xs text-th-ghost">No taints</span>
                  )}
                </div>
              </div>

              {/* Conditions */}
              <div className="mt-4">
                <h3 className="text-sm font-medium text-th-dim mb-2">Conditions</h3>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                  {(node.conditions || []).map((c) => (
                    <div
                      key={c.type}
                      className="flex items-center gap-2 px-2 py-1 bg-th-subtle rounded text-xs"
                    >
                      <span
                        className={`w-2 h-2 rounded-full ${
                          (c.type === "Ready" && c.status === "True") ||
                          (c.type !== "Ready" && c.status === "False")
                            ? "bg-th-ok"
                            : "bg-th-danger"
                        }`}
                      />
                      <span className="text-th-body">{c.type}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Add taint modal */}
              {taintModal === node.name && (
                <div className="mt-4 p-3 bg-th-subtle border border-th-line rounded-lg">
                  <h4 className="text-sm font-medium text-th-body mb-2">Add Taint</h4>
                  <div className="flex items-center gap-2 flex-wrap">
                    <input
                      type="text"
                      placeholder="Key"
                      value={taintKey}
                      onChange={(e) => setTaintKey(e.target.value)}
                      className="px-2 py-1 bg-th-panel border border-th-line rounded text-sm text-th-body placeholder:text-th-ghost focus:outline-none focus:ring-1 focus:ring-th-accent w-32"
                    />
                    <input
                      type="text"
                      placeholder="Value (optional)"
                      value={taintValue}
                      onChange={(e) => setTaintValue(e.target.value)}
                      className="px-2 py-1 bg-th-panel border border-th-line rounded text-sm text-th-body placeholder:text-th-ghost focus:outline-none focus:ring-1 focus:ring-th-accent w-32"
                    />
                    <select
                      value={taintEffect}
                      onChange={(e) => setTaintEffect(e.target.value)}
                      className="px-2 py-1 bg-th-panel border border-th-line rounded text-sm text-th-body focus:outline-none focus:ring-1 focus:ring-th-accent"
                    >
                      <option value="NoSchedule">NoSchedule</option>
                      <option value="PreferNoSchedule">PreferNoSchedule</option>
                      <option value="NoExecute">NoExecute</option>
                    </select>
                    <button
                      onClick={() => handleAddTaint(node.name)}
                      disabled={actionLoading === node.name || !taintKey.trim()}
                      className="px-2 py-1 text-xs bg-th-accent text-white rounded hover:opacity-90 disabled:opacity-50"
                    >
                      Apply
                    </button>
                    <button
                      onClick={() => {
                        setTaintModal(null);
                        setTaintKey("");
                        setTaintValue("");
                      }}
                      className="px-2 py-1 text-xs text-th-dim hover:text-th-body"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="text-center py-8 text-th-ghost">No nodes found</div>
          )}
        </div>
      )}
      <ConfirmModal
        open={pending !== null}
        onClose={() => setPending(null)}
        onConfirm={runPending}
        title="Node Operation"
        message={<span>{pending?.label} node <span className="font-semibold text-th-heading">{pending?.name}</span>?</span>}
        confirmLabel="Confirm"
        variant={pending?.danger ? "danger" : "warning"}
      />
    </div>
  );
}
