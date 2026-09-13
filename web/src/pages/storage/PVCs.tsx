import { useState, useEffect } from "react";
import { useToast } from "@/components/Toast";
import { useUrlSearch } from "@/hooks/useUrlState";
import { EmptyRow } from "@/components/EmptyState";
import { TableSkeleton } from "@/components/Skeleton";
import { useOutletContext } from "react-router-dom";
import { listPVCs, deletePVC, resizePVC, getClusterResourceYAML } from "@/api/client";
import type { PVCSummary } from "@/api/client";
import { useLiveResource } from "@/hooks/useLiveResource";
import LiveIndicator from "@/components/LiveIndicator";
import { useSortableTable, SortableTh } from "@/hooks/useSortableTable";
import { usePagination, TablePagination } from "@/hooks/usePagination";
import { useRowSelection } from "@/hooks/useRowSelection";
import BulkActionBar, { SelectCheckbox } from "@/components/BulkActionBar";
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip } from "recharts";
import CreatePVCModal from "@/components/CreatePVCModal";
import EditYAMLModal from "@/components/EditYAMLModal";
import DeleteConfirmModal from "@/components/DeleteConfirmModal";

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
    case "Bound":
      return "bg-th-ok-s text-th-ok";
    case "Pending":
      return "bg-th-warn-s text-th-warn";
    case "Lost":
      return "bg-th-danger-s text-th-danger";
    default:
      return "bg-th-muted text-th-dim";
  }
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024 * 1024) return (bytes / (1024 * 1024 * 1024 * 1024)).toFixed(1) + " Ti";
  if (bytes >= 1024 * 1024 * 1024) return (bytes / (1024 * 1024 * 1024)).toFixed(1) + " Gi";
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(0) + " Mi";
  return (bytes / 1024).toFixed(0) + " Ki";
}

function usageBarColor(pct: number): string {
  if (pct >= 90) return "bg-th-danger";
  if (pct >= 75) return "bg-th-warn";
  return "bg-th-ok";
}

// Parse a Kubernetes quantity (e.g. "10Gi", "500Mi", "1T", "1000000000") to bytes.
const QTY_UNITS: Record<string, number> = {
  Ki: 1024, Mi: 1024 ** 2, Gi: 1024 ** 3, Ti: 1024 ** 4, Pi: 1024 ** 5,
  K: 1e3, M: 1e6, G: 1e9, T: 1e12, P: 1e15,
};
function parseQty(q: string): number | null {
  const s = (q || "").trim();
  const m = s.match(/^(\d+(?:\.\d+)?)\s*([KMGTP]i?)?$/);
  if (!m) return null;
  return parseFloat(m[1]) * (m[2] ? (QTY_UNITS[m[2]] ?? 1) : 1);
}

function ExpandModal({ pvc, onClose, onResized }: { pvc: PVCSummary; onClose: () => void; onResized: () => void }) {
  const toast = useToast();
  const [capacity, setCapacity] = useState(pvc.capacity || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // StorageClass expansion support: undefined = checking, true/false = known.
  const [expandable, setExpandable] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    if (!pvc.storage_class) { setExpandable(true); return; } // no SC named → can't check, don't block
    let cancelled = false;
    getClusterResourceYAML("StorageClass", pvc.storage_class)
      .then((sc) => { if (!cancelled) setExpandable((sc as any).allowVolumeExpansion === true); })
      .catch(() => { if (!cancelled) setExpandable(undefined); }); // unknown on error
    return () => { cancelled = true; };
  }, [pvc.storage_class]);

  const currentBytes = pvc.capacity_bytes ?? parseQty(pvc.capacity) ?? 0;
  const newBytes = parseQty(capacity);
  const invalidQty = capacity.trim() !== "" && newBytes == null;
  const notLarger = newBytes != null && currentBytes > 0 && newBytes <= currentBytes;
  const canSubmit = newBytes != null && !invalidQty && !notLarger && !loading;

  const preset = (factor: number) => {
    if (currentBytes <= 0) return;
    const gi = (currentBytes * factor) / (1024 ** 3);
    setCapacity(`${Math.max(1, Math.ceil(gi))}Gi`);
  };

  const handleExpand = async () => {
    if (!canSubmit) return;
    setLoading(true);
    setError("");
    try {
      await resizePVC(pvc.namespace, pvc.name, capacity.trim());
      toast.success("Volume expansion requested", `${pvc.name} → ${capacity.trim()}`);
      onResized();
    } catch (e: any) {
      setError(e.message || "Expand failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="bg-th-panel border border-th-line rounded-xl p-6 w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-th-heading mb-1">Expand Volume</h2>
        <p className="text-xs text-th-dim mb-4">A PVC can only grow — Kubernetes does not support shrinking a volume.</p>
        <div className="space-y-3">
          <div>
            <p className="text-sm text-th-dim">PVC: <span className="text-th-body font-medium">{pvc.namespace}/{pvc.name}</span></p>
            <p className="text-sm text-th-dim">StorageClass: <span className="text-th-body font-medium">{pvc.storage_class || "—"}</span></p>
            <p className="text-sm text-th-dim">Current capacity: <span className="text-th-body font-medium">{pvc.capacity || "unknown"}</span></p>
            {pvc.used_bytes != null && pvc.capacity_bytes != null && (
              <p className="text-sm text-th-dim">Used: <span className="text-th-body font-medium">{formatBytes(pvc.used_bytes)} / {formatBytes(pvc.capacity_bytes)} ({pvc.used_percent?.toFixed(1)}%)</span></p>
            )}
          </div>

          {expandable === false && (
            <div className="p-2 bg-th-warn-s text-th-warn rounded text-xs">
              StorageClass <span className="font-medium">{pvc.storage_class}</span> has <code>allowVolumeExpansion: false</code> — the API will reject this. Ask an admin to enable expansion on the StorageClass.
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-th-body mb-1">New Capacity</label>
            <input
              type="text"
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
              placeholder="e.g. 20Gi"
              className="w-full px-3 py-2 bg-th-subtle border border-th-line rounded-lg text-sm text-th-body placeholder:text-th-ghost focus:outline-none focus:ring-1 focus:ring-th-accent"
            />
            <div className="flex items-center gap-1.5 mt-2">
              <span className="text-[10px] text-th-dim uppercase tracking-wider mr-1">Quick</span>
              <button onClick={() => preset(1.5)} className="px-2 py-0.5 text-xs bg-th-subtle border border-th-line rounded text-th-body hover:bg-th-hover">+50%</button>
              <button onClick={() => preset(2)} className="px-2 py-0.5 text-xs bg-th-subtle border border-th-line rounded text-th-body hover:bg-th-hover">Double</button>
              <button onClick={() => preset(4)} className="px-2 py-0.5 text-xs bg-th-subtle border border-th-line rounded text-th-body hover:bg-th-hover">4×</button>
            </div>
            {invalidQty && <p className="text-xs text-th-danger mt-1">Not a valid size — use e.g. 20Gi, 500Mi, 1Ti.</p>}
            {notLarger && <p className="text-xs text-th-danger mt-1">Must be larger than the current {pvc.capacity}.</p>}
          </div>
          {error && <div className="p-2 bg-th-danger-s text-th-danger rounded text-sm">{error}</div>}
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="px-3 py-1.5 text-sm bg-th-subtle border border-th-line rounded-lg text-th-body hover:opacity-80">Cancel</button>
          <button onClick={handleExpand} disabled={!canSubmit} className="px-3 py-1.5 text-sm bg-th-accent text-white rounded-lg hover:opacity-90 disabled:opacity-50">
            {loading ? "Expanding..." : "Expand"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function PVCs() {
  const { namespace } = useOutletContext<{ namespace: string }>();
  const { data: items, loading, error, refresh, watchStatus, live, setLive } = useLiveResource<PVCSummary[]>(
    () => listPVCs(namespace),
    "PersistentVolumeClaim",
    namespace,
    [namespace],
  );
  const [search, setSearch] = useUrlSearch();
  const [showCreate, setShowCreate] = useState(false);
  const [editYaml, setEditYaml] = useState<{ kind: string; ns: string; name: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ ns: string; name: string } | null>(null);
  const [resizeTarget, setResizeTarget] = useState<PVCSummary | null>(null);

  const filtered = (items ?? []).filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.namespace.toLowerCase().includes(search.toLowerCase()) ||
      (p.storage_class || "").toLowerCase().includes(search.toLowerCase()),
  );

  const { sorted, thProps } = useSortableTable(filtered, {
    name: (p) => p.name,
    namespace: (p) => p.namespace,
    status: (p) => p.status,
    capacity: (p) => p.capacity_bytes ?? 0,
    storage_class: (p) => p.storage_class,
    age: (p) => Date.now() - new Date(p.created_at).getTime(),
  }, { key: "name", urlKey: "" });

  const pager = usePagination(sorted, { pageSize: 25, urlKey: "" });
  const sel = useRowSelection<PVCSummary>((p) => `${p.namespace}/${p.name}`);

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-th-heading">Persistent Volume Claims</h1>
        <div className="flex items-center gap-2">
          <LiveIndicator live={live} status={watchStatus} onToggle={setLive} />
          <button onClick={() => setShowCreate(true)} className="px-3 py-1.5 text-sm bg-th-ok text-white rounded-lg hover:opacity-90 transition-opacity">
            Create
          </button>
          <button onClick={refresh} className="px-3 py-1.5 text-sm bg-th-accent text-white rounded-lg hover:opacity-90 transition-opacity">
            Refresh
          </button>
        </div>
      </div>

      <input
        type="text"
        placeholder="Search PVCs..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full max-w-sm px-3 py-2 bg-th-subtle border border-th-line rounded-lg text-sm text-th-body placeholder:text-th-ghost focus:outline-none focus:ring-1 focus:ring-th-accent"
      />

      {loading && <TableSkeleton />}
      {error && <div className="p-3 bg-th-danger-s text-th-danger rounded-lg text-sm">{error}</div>}

      {/* Visual summary */}
      {!loading && filtered.length > 0 && (() => {
        const statusCounts: Record<string, number> = {};
        const scCounts: Record<string, number> = {};
        let totalCapGi = 0;
        let totalUsedGi = 0;
        filtered.forEach((p) => {
          statusCounts[p.status] = (statusCounts[p.status] || 0) + 1;
          const sc = p.storage_class || "none";
          scCounts[sc] = (scCounts[sc] || 0) + 1;
          const cap = p.capacity || "";
          const match = cap.match(/^(\d+(?:\.\d+)?)(Gi|Mi|Ti)?$/);
          if (match) {
            const val = parseFloat(match[1]);
            const unit = match[2] || "Gi";
            if (unit === "Ti") totalCapGi += val * 1024;
            else if (unit === "Mi") totalCapGi += val / 1024;
            else totalCapGi += val;
          }
          if (p.used_bytes != null) totalUsedGi += p.used_bytes / (1024 * 1024 * 1024);
        });
        const statusData = Object.entries(statusCounts).map(([name, value]) => ({ name, value }));
        const scData = Object.entries(scCounts).map(([name, value]) => ({ name: name.length > 14 ? name.slice(0, 14) + "..." : name, value }));
        const statusColors: Record<string, string> = { Bound: "var(--th-ok)", Pending: "var(--th-warn)", Lost: "var(--th-danger)" };
        const overallUsedPct = totalCapGi > 0 ? (totalUsedGi / totalCapGi) * 100 : 0;

        return (
          <div className="grid grid-cols-12 gap-4">
            {/* Status donut */}
            <div className="col-span-12 md:col-span-3 bg-th-panel border border-th-line rounded-xl p-4 shadow-card">
              <h3 className="text-xs font-bold text-th-dim uppercase tracking-wider mb-2">PVC Status</h3>
              <div className="flex items-center gap-4">
                <div className="w-24 h-24">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={statusData} cx="50%" cy="50%" innerRadius={24} outerRadius={42} paddingAngle={2} dataKey="value" stroke="none">
                        {statusData.map((d) => <Cell key={d.name} fill={statusColors[d.name] || "var(--th-dim)"} />)}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex flex-col gap-1">
                  {statusData.map((d) => (
                    <div key={d.name} className="flex items-center gap-2 text-xs">
                      <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: statusColors[d.name] || "var(--th-dim)" }} />
                      <span className="text-th-dim w-14">{d.name}</span>
                      <span className="font-semibold text-th-body">{d.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Capacity by StorageClass */}
            <div className="col-span-12 md:col-span-4 bg-th-panel border border-th-line rounded-xl p-4 shadow-card">
              <h3 className="text-xs font-bold text-th-dim uppercase tracking-wider mb-2">PVCs by StorageClass</h3>
              <div className="h-28">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={scData} layout="vertical">
                    <XAxis type="number" tick={{ fontSize: 10, fill: "var(--th-dim)" }} axisLine={false} tickLine={false} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: "var(--th-dim)" }} axisLine={false} tickLine={false} width={100} />
                    <Tooltip
                      contentStyle={{ backgroundColor: "var(--th-panel)", border: "1px solid var(--th-line)", borderRadius: "8px", fontSize: "11px" }}
                      labelStyle={{ color: "var(--th-heading)" }}
                    />
                    <Bar dataKey="value" fill="var(--th-accent)" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Quick stats */}
            <div className="col-span-12 md:col-span-2 bg-th-panel border border-th-line rounded-xl p-4 shadow-card flex flex-col justify-center gap-3">
              <div className="text-center">
                <p className="text-3xl font-black text-th-accent">{filtered.length}</p>
                <p className="text-[10px] text-th-dim uppercase tracking-wider">Total PVCs</p>
              </div>
              <div className="border-t border-th-line pt-3 text-center">
                <p className="text-2xl font-bold text-th-info">{totalCapGi >= 1024 ? (totalCapGi / 1024).toFixed(1) + " Ti" : totalCapGi.toFixed(0) + " Gi"}</p>
                <p className="text-[10px] text-th-dim uppercase tracking-wider">Total Capacity</p>
              </div>
            </div>

            {/* Overall usage bar */}
            <div className="col-span-12 md:col-span-3 bg-th-panel border border-th-line rounded-xl p-4 shadow-card flex flex-col justify-center">
              <h3 className="text-xs font-bold text-th-dim uppercase tracking-wider mb-2">Overall Usage</h3>
              {totalUsedGi > 0 ? (
                <>
                  <div className="w-full h-4 bg-th-subtle rounded-full overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${usageBarColor(overallUsedPct)}`} style={{ width: `${Math.min(overallUsedPct, 100)}%` }} />
                  </div>
                  <p className="text-xs text-th-dim mt-1.5 text-center">
                    {totalUsedGi.toFixed(1)} Gi / {totalCapGi >= 1024 ? (totalCapGi / 1024).toFixed(1) + " Ti" : totalCapGi.toFixed(0) + " Gi"} ({overallUsedPct.toFixed(1)}%)
                  </p>
                </>
              ) : (
                <p className="text-xs text-th-ghost text-center">No usage data</p>
              )}
            </div>
          </div>
        );
      })()}

      {!loading && (
        <div className="bg-th-panel border border-th-line rounded-xl overflow-hidden shadow-card">
          <div className="overflow-x-auto pin-actions">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-th-dim bg-th-subtle border-b border-th-line">
                  <th className="pl-4 pr-1 py-3 w-8"><SelectCheckbox ariaLabel="Select all PVCs on this page" checked={sel.allSelected(pager.paged)} indeterminate={sel.someSelected(pager.paged)} onChange={() => sel.toggleAll(pager.paged)} /></th>
                  <SortableTh {...thProps("name")}>Name</SortableTh>
                  <SortableTh {...thProps("namespace")}>Namespace</SortableTh>
                  <SortableTh {...thProps("status")}>Status</SortableTh>
                  <SortableTh {...thProps("capacity")}>Capacity / Usage</SortableTh>
                  <th className="px-4 py-3 font-medium">Access Modes</th>
                  <SortableTh {...thProps("storage_class")}>Storage Class</SortableTh>
                  <SortableTh {...thProps("age")}>Age</SortableTh>
                  <th className="px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pager.paged.map((p) => {
                  const key = `${p.namespace}/${p.name}`;
                  const hasUsage = p.used_bytes != null && p.capacity_bytes != null && p.capacity_bytes > 0;
                  const usedPct = hasUsage ? (p.used_bytes! / p.capacity_bytes!) * 100 : 0;
                  return (
                    <tr key={key} className={`border-b border-th-line last:border-0 hover:bg-th-hover transition-colors ${sel.isSelected(key) ? "bg-th-accent/5" : ""}`}>
                      <td className="pl-4 pr-1 py-3"><SelectCheckbox ariaLabel={`Select ${p.name}`} checked={sel.isSelected(key)} onChange={() => sel.toggle(key)} /></td>
                      <td className="px-4 py-3 font-medium text-th-body">{p.name}</td>
                      <td className="px-4 py-3 text-th-dim">{p.namespace}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusColor(p.status)}`}>
                          {p.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="min-w-[140px]">
                          <div className="text-xs text-th-dim mb-0.5">
                            {hasUsage
                              ? `${formatBytes(p.used_bytes!)} / ${formatBytes(p.capacity_bytes!)} (${usedPct.toFixed(1)}%)`
                              : p.capacity || "-"
                            }
                          </div>
                          {hasUsage && (
                            <div className="w-full h-2 bg-th-subtle rounded-full overflow-hidden">
                              <div className={`h-full rounded-full transition-all ${usageBarColor(usedPct)}`} style={{ width: `${Math.min(usedPct, 100)}%` }} />
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-th-dim text-xs">{(p.access_modes || []).join(", ") || "-"}</td>
                      <td className="px-4 py-3 text-th-dim">{p.storage_class || "-"}</td>
                      <td className="px-4 py-3 text-th-ghost">{age(p.created_at)}</td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          <button
                            onClick={() => setResizeTarget(p)}
                            className="px-2 py-1 text-xs bg-th-accent-s border border-th-accent/30 text-th-accent rounded hover:opacity-80"
                            title="Expand this volume (grow only)"
                          >
                            Expand
                          </button>
                          <button
                            onClick={() => setEditYaml({ kind: "PersistentVolumeClaim", ns: p.namespace, name: p.name })}
                            className="px-2 py-1 text-xs bg-th-subtle border border-th-line rounded text-th-body hover:opacity-80"
                          >
                            YAML
                          </button>
                          <button
                            onClick={() => setDeleteTarget({ ns: p.namespace, name: p.name })}
                            className="px-2 py-1 text-xs bg-th-danger-s text-th-danger rounded hover:opacity-80"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <EmptyRow colSpan={9} title="No PVCs found" />
                )}
              </tbody>
            </table>
          </div>
          <TablePagination {...pager} label="PVCs" />
        </div>
      )}
      <BulkActionBar
        selected={sel.selectedRows(items ?? [])}
        noun="PVCs"
        onClear={sel.clear}
        onComplete={refresh}
        actions={[{ label: "Delete", danger: true, gerund: "Deleting", run: (p) => deletePVC(p.namespace, p.name) }]}
      />

      {showCreate && (
        <CreatePVCModal
          defaultNamespace={namespace !== "all" ? namespace : undefined}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); refresh(); }}
        />
      )}
      {editYaml && (
        <EditYAMLModal
          kind={editYaml.kind}
          namespace={editYaml.ns}
          name={editYaml.name}
          onClose={() => setEditYaml(null)}
          onUpdated={refresh}
        />
      )}
      {resizeTarget && (
        <ExpandModal
          pvc={resizeTarget}
          onClose={() => setResizeTarget(null)}
          onResized={() => { setResizeTarget(null); refresh(); }}
        />
      )}
      <DeleteConfirmModal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onDeleted={refresh}
        resourceType="PVC"
        resourceName={deleteTarget?.name ?? ""}
        namespace={deleteTarget?.ns}
        kind="PersistentVolumeClaim"
        deleteFn={() => deletePVC(deleteTarget!.ns, deleteTarget!.name)}
      />
    </div>
  );
}
