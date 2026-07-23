import { useState, useMemo } from "react";
import { useUrlSearch } from "@/hooks/useUrlState";
import { EmptyRow } from "@/components/EmptyState";
import { TableSkeleton } from "@/components/Skeleton";
import { useOutletContext } from "react-router-dom";
import { listNamespaces, createNamespace, deleteNamespace } from "@/api/client";
import type { NamespaceSummary } from "@/api/client";
import { useLiveResource } from "@/hooks/useLiveResource";
import LiveIndicator from "@/components/LiveIndicator";
import { useToast } from "@/components/Toast";
import { useSortableTable, SortableTh } from "@/hooks/useSortableTable";
import { usePagination, TablePagination } from "@/hooks/usePagination";
import { useLabelSelector, LabelSelectorInput } from "@/hooks/useLabelSelector";
import DeleteConfirmModal from "@/components/DeleteConfirmModal";
import EditYAMLModal from "@/components/EditYAMLModal";
import ProtectToggle from "@/components/ProtectToggle";
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";

const NS_STATUS_COLORS: Record<string, string> = { Active: "var(--th-ok)", Terminating: "var(--th-warn)" };

function age(created: string): string {
  const diff = Date.now() - new Date(created).getTime();
  const days = Math.floor(diff / 86400000);
  if (days > 0) return `${days}d`;
  const hours = Math.floor(diff / 3600000);
  if (hours > 0) return `${hours}h`;
  const mins = Math.floor(diff / 60000);
  return `${mins}m`;
}

function statusColor(status: string): string {
  switch (status) {
    case "Active":
      return "bg-th-ok-s text-th-ok";
    case "Terminating":
      return "bg-th-warn-s text-th-warn";
    default:
      return "bg-th-muted text-th-dim";
  }
}

export default function Namespaces() {
  useOutletContext<{ namespace: string }>();
  const { data: items, loading, error, refresh, watchStatus, live, setLive } = useLiveResource<NamespaceSummary[]>(listNamespaces, "Namespace", undefined);
  const toast = useToast();
  const [search, setSearch] = useUrlSearch();
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [createLoading, setCreateLoading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [editYaml, setEditYaml] = useState<string | null>(null);
  const [protectedResources, setProtectedResources] = useState<Set<string>>(new Set());

  const labelSel = useLabelSelector({ urlKey: "" });
  const textFiltered = (items ?? []).filter((n) =>
    n.name.toLowerCase().includes(search.toLowerCase()),
  );
  const filtered = textFiltered.filter((n) => labelSel.match(n.labels));

  const { sorted, thProps } = useSortableTable(filtered, {
    name: (n) => n.name,
    status: (n) => n.status,
    age: (n) => Date.now() - new Date(n.created_at).getTime(),
  }, { key: "name", urlKey: "" });

  const pager = usePagination(sorted, { pageSize: 25, urlKey: "" });

  const statusData = useMemo(() => {
    const counts: Record<string, number> = {};
    filtered.forEach((n) => { counts[n.status] = (counts[n.status] || 0) + 1; });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [filtered]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreateLoading(true);
    try {
      await createNamespace(newName.trim());
      setNewName("");
      setShowCreate(false);
      toast.success("Namespace created");
      refresh();
    } catch (e) {
      toast.error("Failed to create namespace", e instanceof Error ? e.message : String(e));
    } finally {
      setCreateLoading(false);
    }
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-th-heading">Namespaces</h1>
        <div className="flex gap-2">
          <LiveIndicator live={live} status={watchStatus} onToggle={setLive} />
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="px-3 py-1.5 text-sm bg-th-ok-s text-th-ok rounded-lg hover:opacity-90 transition-opacity"
          >
            Create
          </button>
          <button onClick={refresh} className="px-3 py-1.5 text-sm bg-th-accent text-white rounded-lg hover:opacity-90 transition-opacity">
            Refresh
          </button>
        </div>
      </div>

      {showCreate && (
        <div className="p-4 bg-th-panel border border-th-line rounded-xl shadow-card">
          <h3 className="text-sm font-medium text-th-body mb-2">Create Namespace</h3>
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Namespace name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              className="px-3 py-1.5 bg-th-subtle border border-th-line rounded-lg text-sm text-th-body placeholder:text-th-ghost focus:outline-none focus:ring-1 focus:ring-th-accent w-64"
            />
            <button
              onClick={handleCreate}
              disabled={createLoading || !newName.trim()}
              className="px-3 py-1.5 text-sm bg-th-accent text-white rounded-lg hover:opacity-90 disabled:opacity-50"
            >
              {createLoading ? "Creating..." : "Create"}
            </button>
            <button
              onClick={() => { setShowCreate(false); setNewName(""); }}
              className="px-3 py-1.5 text-sm text-th-dim hover:text-th-body"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-2">
        <input
          type="text"
          placeholder="Search namespaces..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full sm:max-w-sm px-3 py-2 bg-th-subtle border border-th-line rounded-lg text-sm text-th-body placeholder:text-th-ghost focus:outline-none focus:ring-1 focus:ring-th-accent"
        />
        <LabelSelectorInput
          value={labelSel.query}
          onChange={labelSel.setQuery}
          matched={filtered.length}
          total={textFiltered.length}
          invalid={labelSel.invalid}
          className="w-full sm:max-w-sm"
        />
      </div>

      {loading && <TableSkeleton />}
      {error && <div className="p-3 bg-th-danger-s text-th-danger rounded-lg text-sm">{error}</div>}

      {!loading && filtered.length > 0 && (
        <div className="grid grid-cols-12 gap-4">
          <div className="col-span-12 md:col-span-4 bg-th-panel border border-th-line rounded-xl p-4 shadow-card">
            <h3 className="text-xs font-bold text-th-dim uppercase tracking-wider mb-2">Status</h3>
            <div className="flex items-center gap-4">
              <div className="w-24 h-24">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart><Pie data={statusData} cx="50%" cy="50%" innerRadius={24} outerRadius={42} paddingAngle={3} dataKey="value" stroke="none">
                    {statusData.map((d) => <Cell key={d.name} fill={NS_STATUS_COLORS[d.name] || "var(--th-dim)"} />)}
                  </Pie></PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-col gap-1">
                {statusData.map((d) => (
                  <div key={d.name} className="flex items-center gap-2 text-xs">
                    <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: NS_STATUS_COLORS[d.name] || "var(--th-dim)" }} />
                    <span className="text-th-dim">{d.name}</span>
                    <span className="font-semibold text-th-body">{d.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="col-span-12 md:col-span-8 flex gap-4">
            <div className="flex-1 bg-th-panel border border-th-line rounded-xl p-4 shadow-card flex flex-col items-center justify-center">
              <p className="text-3xl font-black text-th-accent">{filtered.length}</p>
              <p className="text-[10px] text-th-dim uppercase tracking-wider">Namespaces</p>
            </div>
            <div className="flex-1 bg-th-panel border border-th-line rounded-xl p-4 shadow-card flex flex-col items-center justify-center">
              <p className="text-3xl font-black text-th-ok">{filtered.filter((n) => n.status === "Active").length}</p>
              <p className="text-[10px] text-th-dim uppercase tracking-wider">Active</p>
            </div>
          </div>
        </div>
      )}

      {!loading && (
        <div className="bg-th-panel border border-th-line rounded-xl overflow-hidden shadow-card">
          <div className="overflow-x-auto pin-actions">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-th-dim bg-th-subtle border-b border-th-line">
                  <SortableTh {...thProps("name")}>Name</SortableTh>
                  <SortableTh {...thProps("status")}>Status</SortableTh>
                  <SortableTh {...thProps("age")}>Age</SortableTh>
                  <th className="w-10 px-2 py-3 font-medium" title="Protection"></th>
                  <th className="px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pager.paged.map((n) => (
                  <tr key={n.name} className="border-b border-th-line last:border-0 hover:bg-th-hover transition-colors">
                    <td className="px-4 py-3 font-medium text-th-body">{n.name}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusColor(n.status)}`}>
                        {n.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-th-ghost">{age(n.created_at)}</td>
                    <td className="px-2 py-3">
                      <ProtectToggle
                        kind="Namespace"
                        name={n.name}
                        isProtected={protectedResources.has(n.name)}
                        onToggled={(v) => setProtectedResources((prev) => {
                          const next = new Set(prev);
                          v ? next.add(n.name) : next.delete(n.name);
                          return next;
                        })}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                      <button
                        onClick={() => setEditYaml(n.name)}
                        className="px-2 py-1 text-xs bg-th-info-s text-th-info rounded hover:opacity-80"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => setDeleteTarget(n.name)}
                        disabled={["default", "kube-system", "kube-public", "kube-node-lease"].includes(n.name)}
                        className="px-2 py-1 text-xs bg-th-danger-s text-th-danger rounded hover:opacity-80 disabled:opacity-40"
                      >
                        Delete
                      </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <EmptyRow colSpan={5} title="No namespaces found" />
                )}
              </tbody>
            </table>
          </div>
          <TablePagination {...pager} label="namespaces" />
        </div>
      )}

      <DeleteConfirmModal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onDeleted={refresh}
        resourceType="Namespace"
        resourceName={deleteTarget ?? ""}
        kind="Namespace"
        deleteFn={() => deleteNamespace(deleteTarget!)}
      />
      {editYaml && (
        <EditYAMLModal
          kind="Namespace"
          name={editYaml}
          onClose={() => setEditYaml(null)}
          onUpdated={refresh}
        />
      )}
    </div>
  );
}
