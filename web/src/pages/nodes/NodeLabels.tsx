import { useState } from "react";
import { TableSkeleton } from "@/components/Skeleton";
import { useOutletContext } from "react-router-dom";
import { listNodes, setNodeLabels } from "@/api/client";
import type { NodeSummary } from "@/api/client";
import { useResource } from "@/hooks/useResource";
import ConfirmModal from "@/components/ConfirmModal";
import { useToast } from "@/components/Toast";

export default function NodeLabels() {
  useOutletContext<{ namespace: string }>();
  const { data: nodes, loading, error, refresh } = useResource<NodeSummary[]>(listNodes);
  const toast = useToast();
  const [pendingRemove, setPendingRemove] = useState<{ node: NodeSummary; key: string } | null>(null);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [editNode, setEditNode] = useState<string | null>(null);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [actionLoading, setActionLoading] = useState(false);

  const filtered = (nodes ?? []).filter(
    (n) =>
      n.name.toLowerCase().includes(search.toLowerCase()) ||
      Object.keys(n.labels || {}).some((k) => k.toLowerCase().includes(search.toLowerCase())) ||
      Object.values(n.labels || {}).some((v) => v.toLowerCase().includes(search.toLowerCase())),
  );

  const toggleExpand = (name: string) => {
    setExpanded((prev) => ({ ...prev, [name]: !prev[name] }));
  };

  const handleAddLabel = async (node: NodeSummary) => {
    if (!newKey.trim()) return;
    setActionLoading(true);
    try {
      const updated = { ...(node.labels || {}), [newKey.trim()]: newValue.trim() };
      await setNodeLabels(node.name, updated);
      setNewKey("");
      setNewValue("");
      setEditNode(null);
      toast.success(`Label added to ${node.name}`);
      refresh();
    } catch (e) {
      toast.error("Failed to add label", e instanceof Error ? e.message : String(e));
    } finally {
      setActionLoading(false);
    }
  };

  const handleRemoveLabel = (node: NodeSummary, key: string) => {
    setPendingRemove({ node, key });
  };

  const runRemoveLabel = async () => {
    if (!pendingRemove) return;
    setActionLoading(true);
    try {
      const updated = { ...(pendingRemove.node.labels || {}) };
      delete updated[pendingRemove.key];
      await setNodeLabels(pendingRemove.node.name, updated);
      toast.success(`Label removed from ${pendingRemove.node.name}`);
      refresh();
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-th-heading">Node Labels</h1>
        <button
          onClick={refresh}
          className="px-3 py-1.5 text-sm bg-th-accent text-white rounded-lg hover:opacity-90 transition-opacity"
        >
          Refresh
        </button>
      </div>

      <input
        type="text"
        placeholder="Search nodes or labels..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full max-w-sm px-3 py-2 bg-th-subtle border border-th-line rounded-lg text-sm text-th-body placeholder:text-th-ghost focus:outline-none focus:ring-1 focus:ring-th-accent"
      />

      {loading && <TableSkeleton />}
      {error && <div className="p-3 bg-th-danger-s text-th-danger rounded-lg text-sm">{error}</div>}

      {!loading && (
        <div className="space-y-3">
          {filtered.map((node) => {
            const labels = node.labels || {};
            const labelEntries = Object.entries(labels);
            const isExpanded = expanded[node.name] ?? false;

            return (
              <div key={node.name} className="bg-th-panel border border-th-line rounded-xl shadow-card overflow-hidden">
                <button
                  onClick={() => toggleExpand(node.name)}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-th-hover transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <span
                      className={`inline-block w-2 h-2 rounded-full ${
                        node.status === "Ready" ? "bg-th-ok" : "bg-th-danger"
                      }`}
                    />
                    <span className="font-medium text-th-body">{node.name}</span>
                    <span className="text-xs text-th-ghost">{node.internal_ip}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs px-2 py-0.5 bg-th-info-s text-th-info rounded">
                      {labelEntries.length} labels
                    </span>
                    <svg
                      className={`w-4 h-4 text-th-dim transition-transform ${isExpanded ? "rotate-180" : ""}`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                    </svg>
                  </div>
                </button>

                {isExpanded && (
                  <div className="px-4 pb-4 border-t border-th-line">
                    <div className="mt-3 flex flex-wrap gap-2">
                      {labelEntries.map(([key, value]) => (
                        <div
                          key={key}
                          className="flex items-center gap-1 px-2 py-1 bg-th-subtle border border-th-line rounded text-xs"
                        >
                          <span className="font-medium text-th-body">{key}</span>
                          <span className="text-th-ghost">=</span>
                          <span className="text-th-dim">{value}</span>
                          <button
                            onClick={() => handleRemoveLabel(node, key)}
                            disabled={actionLoading}
                            className="ml-1 text-th-danger hover:opacity-80"
                            title="Remove label"
                          >
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      ))}
                      {labelEntries.length === 0 && (
                        <span className="text-sm text-th-ghost">No labels</span>
                      )}
                    </div>

                    {editNode === node.name ? (
                      <div className="mt-3 flex items-center gap-2">
                        <input
                          type="text"
                          placeholder="Key"
                          value={newKey}
                          onChange={(e) => setNewKey(e.target.value)}
                          className="px-2 py-1 bg-th-subtle border border-th-line rounded text-sm text-th-body placeholder:text-th-ghost focus:outline-none focus:ring-1 focus:ring-th-accent w-40"
                        />
                        <span className="text-th-ghost">=</span>
                        <input
                          type="text"
                          placeholder="Value"
                          value={newValue}
                          onChange={(e) => setNewValue(e.target.value)}
                          className="px-2 py-1 bg-th-subtle border border-th-line rounded text-sm text-th-body placeholder:text-th-ghost focus:outline-none focus:ring-1 focus:ring-th-accent w-40"
                        />
                        <button
                          onClick={() => handleAddLabel(node)}
                          disabled={actionLoading || !newKey.trim()}
                          className="px-2 py-1 text-xs bg-th-accent text-white rounded hover:opacity-90 disabled:opacity-50"
                        >
                          Add
                        </button>
                        <button
                          onClick={() => {
                            setEditNode(null);
                            setNewKey("");
                            setNewValue("");
                          }}
                          className="px-2 py-1 text-xs text-th-dim hover:text-th-body"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setEditNode(node.name)}
                        className="mt-3 px-2 py-1 text-xs bg-th-ok-s text-th-ok rounded hover:opacity-80"
                      >
                        + Add Label
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div className="text-center py-8 text-th-ghost">No nodes found</div>
          )}
        </div>
      )}
      <ConfirmModal
        open={pendingRemove !== null}
        onClose={() => setPendingRemove(null)}
        onConfirm={runRemoveLabel}
        title="Remove Label"
        message={<span>Remove label <span className="font-mono font-semibold text-th-heading">{pendingRemove?.key}</span> from node <span className="font-semibold text-th-heading">{pendingRemove?.node.name}</span>?</span>}
        confirmLabel="Remove"
        variant="warning"
      />
    </div>
  );
}
