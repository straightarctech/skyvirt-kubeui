import { useState, useMemo } from "react";
import { useUrlSearch } from "@/hooks/useUrlState";
import { EmptyRow } from "@/components/EmptyState";
import { TableSkeleton } from "@/components/Skeleton";
import { useOutletContext } from "react-router-dom";
import { listPriorityClasses, deletePriorityClass } from "@/api/client";
import type { PriorityClassSummary } from "@/api/client";
import { useLiveResource } from "@/hooks/useLiveResource";
import LiveIndicator from "@/components/LiveIndicator";
import DeleteConfirmModal from "@/components/DeleteConfirmModal";
import CreateYAMLModal from "@/components/CreateYAMLModal";
import EditYAMLModal from "@/components/EditYAMLModal";
import { useSortableTable, SortableTh } from "@/hooks/useSortableTable";
import { usePagination, TablePagination } from "@/hooks/usePagination";

const PC_TEMPLATE = `apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata:
  name: high-priority
value: 1000
globalDefault: false
description: "High priority workloads"
`;

function age(created: string): string {
  const diff = Date.now() - new Date(created).getTime();
  const days = Math.floor(diff / 86400000);
  if (days > 0) return `${days}d`;
  const hours = Math.floor(diff / 3600000);
  if (hours > 0) return `${hours}h`;
  return `${Math.floor(diff / 60000)}m`;
}

export default function PriorityClasses() {
  useOutletContext<{ namespace: string }>();
  const { data: items, loading, error, refresh, watchStatus, live, setLive } = useLiveResource<PriorityClassSummary[]>(
    () => listPriorityClasses(),
    "PriorityClass",
    undefined,
    [],
  );
  const [search, setSearch] = useUrlSearch();
  const [showCreate, setShowCreate] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [editYaml, setEditYaml] = useState<string | null>(null);

  const filtered = (items ?? []).filter(
    (p) => p.name.toLowerCase().includes(search.toLowerCase()),
  );

  const { sorted, thProps } = useSortableTable(filtered, {
    name: (p) => p.name,
    value: (p) => p.value,
    global_default: (p) => (p.global_default ? 1 : 0),
    preemption: (p) => p.preemption_policy,
    age: (p) => Date.now() - new Date(p.created_at).getTime(),
  }, { key: "value", dir: "desc", urlKey: "" });

  const pager = usePagination(sorted, { pageSize: 25, urlKey: "" });

  const globalDefaultCount = useMemo(() => filtered.filter((p) => p.global_default).length, [filtered]);
  const preemptCount = useMemo(() => filtered.filter((p) => p.preemption_policy === "PreemptLowerPriority").length, [filtered]);

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-th-heading">Priority Classes</h1>
        <div className="flex items-center gap-2">
          <LiveIndicator live={live} status={watchStatus} onToggle={setLive} />
          <button onClick={() => setShowCreate(true)} className="px-3 py-1.5 text-sm bg-th-ok text-white rounded-lg hover:opacity-90 transition-opacity">Create</button>
          <button onClick={refresh} className="px-3 py-1.5 text-sm bg-th-accent text-white rounded-lg hover:opacity-90 transition-opacity">Refresh</button>
        </div>
      </div>

      <input
        type="text"
        placeholder="Search priority classes..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full max-w-sm px-3 py-2 bg-th-subtle border border-th-line rounded-lg text-sm text-th-body placeholder:text-th-ghost focus:outline-none focus:ring-1 focus:ring-th-accent"
      />

      {loading && <TableSkeleton />}
      {error && <div className="p-3 bg-th-danger-s text-th-danger rounded-lg text-sm">{error}</div>}

      {!loading && filtered.length > 0 && (
        <div className="flex gap-4">
          <div className="flex-1 bg-th-panel border border-th-line rounded-xl p-4 shadow-card flex flex-col items-center justify-center">
            <p className="text-3xl font-black text-th-accent">{filtered.length}</p>
            <p className="text-[10px] text-th-dim uppercase tracking-wider">Priority Classes</p>
          </div>
          <div className="flex-1 bg-th-panel border border-th-line rounded-xl p-4 shadow-card flex flex-col items-center justify-center">
            <p className="text-3xl font-black text-th-ok">{globalDefaultCount}</p>
            <p className="text-[10px] text-th-dim uppercase tracking-wider">Global Default</p>
          </div>
          <div className="flex-1 bg-th-panel border border-th-line rounded-xl p-4 shadow-card flex flex-col items-center justify-center">
            <p className="text-3xl font-black text-th-info">{preemptCount}</p>
            <p className="text-[10px] text-th-dim uppercase tracking-wider">Preempting</p>
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
                  <SortableTh {...thProps("value")}>Value</SortableTh>
                  <SortableTh {...thProps("global_default")}>Global Default</SortableTh>
                  <SortableTh {...thProps("preemption")}>Preemption</SortableTh>
                  <th className="px-4 py-3 font-medium">Description</th>
                  <SortableTh {...thProps("age")}>Age</SortableTh>
                  <th className="px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pager.paged.map((p) => (
                  <tr key={p.name} className="border-b border-th-line last:border-0 hover:bg-th-hover transition-colors">
                    <td className="px-4 py-3 font-medium text-th-body">{p.name}</td>
                    <td className="px-4 py-3 text-th-dim font-mono">{p.value.toLocaleString()}</td>
                    <td className="px-4 py-3">
                      {p.global_default ? (
                        <span className="px-2 py-0.5 rounded text-xs font-medium bg-th-ok-s text-th-ok">Yes</span>
                      ) : (
                        <span className="text-th-ghost text-xs">No</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-th-dim text-xs">{p.preemption_policy}</td>
                    <td className="px-4 py-3 text-th-dim text-xs max-w-xs truncate" title={p.description}>{p.description || "-"}</td>
                    <td className="px-4 py-3 text-th-ghost">{age(p.created_at)}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        <button
                          onClick={() => setEditYaml(p.name)}
                          className="px-2 py-1 text-xs bg-th-info-s text-th-info rounded hover:opacity-80"
                        >Edit</button>
                        <button
                          onClick={() => setDeleteTarget(p.name)}
                          className="px-2 py-1 text-xs bg-th-danger-s text-th-danger rounded hover:opacity-80"
                        >Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <EmptyRow colSpan={7} title="No priority classes found" />
                )}
              </tbody>
            </table>
          </div>
          <TablePagination {...pager} label="priority classes" />
        </div>
      )}

      <DeleteConfirmModal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onDeleted={refresh}
        resourceType="Priority Class"
        resourceName={deleteTarget ?? ""}
        kind="PriorityClass"
        deleteFn={() => deletePriorityClass(deleteTarget!)}
      />
      {showCreate && (
        <CreateYAMLModal
          title="Create Priority Class"
          template={PC_TEMPLATE}
          onClose={() => setShowCreate(false)}
          onCreated={refresh}
        />
      )}
      {editYaml && (
        <EditYAMLModal
          kind="PriorityClass"
          name={editYaml}
          onClose={() => setEditYaml(null)}
          onUpdated={refresh}
        />
      )}
    </div>
  );
}
