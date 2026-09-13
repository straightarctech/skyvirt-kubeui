import { useState, useMemo } from "react";
import { TableSkeleton } from "@/components/Skeleton";
import { useOutletContext } from "react-router-dom";
import { listResourceQuotas, deleteResourceQuota } from "@/api/client";
import type { ResourceQuotaSummary } from "@/api/client";
import { useLiveResource } from "@/hooks/useLiveResource";
import LiveIndicator from "@/components/LiveIndicator";
import CreateResourceQuotaModal from "@/components/CreateResourceQuotaModal";
import { BarMeter } from "@/components/viz";

// Parse a k8s quantity to a comparable number (used & hard share a unit per resource).
function parseQty(s: string): number {
  if (!s) return 0;
  const v = parseFloat(s);
  const u: Record<string, number> = { Ki: 1024, Mi: 1024 ** 2, Gi: 1024 ** 3, Ti: 1024 ** 4, k: 1e3, M: 1e6, G: 1e9, T: 1e12 };
  if (s.endsWith("m")) return v / 1000;
  for (const [suf, mul] of Object.entries(u)) if (s.endsWith(suf)) return v * mul;
  return v;
}
import EditYAMLModal from "@/components/EditYAMLModal";
import DeleteConfirmModal from "@/components/DeleteConfirmModal";
import { EmptyState } from "@/components/EmptyState";
import { StatStrip } from "@/components/ResourceSummary";

function age(created: string): string {
  const diff = Date.now() - new Date(created).getTime();
  const days = Math.floor(diff / 86400000);
  if (days > 0) return `${days}d`;
  const hours = Math.floor(diff / 3600000);
  if (hours > 0) return `${hours}h`;
  return `${Math.floor(diff / 60000)}m`;
}



export default function Quotas() {
  const { namespace } = useOutletContext<{ namespace: string }>();
  const { data: items, loading, error, refresh, watchStatus, live, setLive } = useLiveResource<ResourceQuotaSummary[]>(
    () => listResourceQuotas(namespace),
    "ResourceQuota",
    namespace,
    [namespace],
  );
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [editYaml, setEditYaml] = useState<{ kind: string; ns: string; name: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ ns: string; name: string } | null>(null);

  const filtered = (items ?? []).filter(
    (q) =>
      q.name.toLowerCase().includes(search.toLowerCase()) ||
      q.namespace.toLowerCase().includes(search.toLowerCase()),
  );

  // Quotas where any resource is at/over 90% of its hard limit — the ones to watch.
  const atLimit = useMemo(() => filtered.filter((q) => {
    const hard = q.hard || {};
    return Object.keys(hard).some((r) => {
      const h = parseQty(hard[r]);
      return h > 0 && (parseQty((q.used || {})[r] || "0") / h) * 100 >= 90;
    });
  }).length, [filtered]);

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-th-heading">Resource Quotas</h1>
        <div className="flex gap-2">
          <LiveIndicator live={live} status={watchStatus} onToggle={setLive} />
          <button onClick={() => setShowCreate(true)} className="px-3 py-1.5 text-sm bg-th-ok text-white rounded-lg hover:opacity-90 transition-opacity">
            Create
          </button>
          <button onClick={refresh} className="px-3 py-1.5 text-sm bg-th-accent text-white rounded-lg hover:opacity-90 transition-opacity">Refresh</button>
        </div>
      </div>

      <input
        type="text"
        placeholder="Search quotas..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full max-w-sm px-3 py-2 bg-th-subtle border border-th-line rounded-lg text-sm text-th-body placeholder:text-th-ghost focus:outline-none focus:ring-1 focus:ring-th-accent"
      />

      {loading && <TableSkeleton />}
      {error && <div className="p-3 bg-th-danger-s text-th-danger rounded-lg text-sm">{error}</div>}

      {!loading && filtered.length > 0 && (
        <StatStrip stats={[
          { label: "Quotas", value: filtered.length, tone: "accent" },
          { label: "Namespaces", value: new Set(filtered.map((q) => q.namespace)).size, tone: "info" },
          { label: "At/Over Limit", value: atLimit, tone: atLimit > 0 ? "warn" : "ok" },
        ]} />
      )}

      {!loading && (
        <div className="space-y-4">
          {filtered.map((q) => {
            const key = `${q.namespace}/${q.name}`;
            const resources = Object.keys(q.hard || {});
            return (
              <div key={key} className="bg-th-panel border border-th-line rounded-xl p-4 shadow-card">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="font-medium text-th-body">{q.name}</h3>
                    <p className="text-xs text-th-dim">{q.namespace} &middot; {age(q.created_at)}</p>
                  </div>
                  <div className="flex gap-1">
                    <button
                      onClick={() => setEditYaml({ kind: "ResourceQuota", ns: q.namespace, name: q.name })}
                      className="px-2 py-1 text-xs bg-th-subtle border border-th-line rounded text-th-body hover:opacity-80"
                    >
                      YAML
                    </button>
                    <button
                      onClick={() => setDeleteTarget({ ns: q.namespace, name: q.name })}
                      className="px-2 py-1 text-xs bg-th-danger-s text-th-danger rounded hover:opacity-80"
                    >Delete</button>
                  </div>
                </div>
                {resources.length > 0 ? (
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                    {resources.map((r) => {
                      const used = (q.used || {})[r] || "0";
                      const hard = q.hard[r];
                      const h = parseQty(hard);
                      const pct = h > 0 ? (parseQty(used) / h) * 100 : 0;
                      const over = pct >= 100;
                      const near = pct >= 90 && !over;
                      return (
                        <div key={r} className={`rounded-lg p-3 ${over ? "bg-th-danger-s ring-1 ring-th-danger/40" : "bg-th-subtle"}`}>
                          <p className="text-xs text-th-dim mb-1 truncate" title={r}>{r}</p>
                          <p className={`text-sm font-medium mb-2 ${over ? "text-th-danger" : "text-th-body"}`}>
                            {used} <span className="text-th-ghost">/ {hard}</span>
                            {over && <span className="ml-1.5 text-[10px] font-bold text-th-danger">OVER</span>}
                            {near && <span className="ml-1.5 text-[10px] font-bold text-th-warn">{Math.round(pct)}%</span>}
                          </p>
                          <BarMeter value={pct} width="100%" />
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-sm text-th-ghost">No resource limits defined</p>
                )}
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div className="bg-th-panel border border-th-line rounded-xl shadow-card">
              <EmptyState
                title={search ? "No matching quotas" : "No resource quotas"}
                hint={search
                  ? "No quotas match your search in this scope."
                  : "Resource quotas cap the CPU, memory, and object counts a namespace can consume. Create one to start enforcing limits."}
                action={!search && (
                  <button onClick={() => setShowCreate(true)} className="px-3 py-1.5 text-sm bg-th-ok text-white rounded-lg hover:opacity-90 transition-opacity">
                    Create Quota
                  </button>
                )}
              />
            </div>
          )}
        </div>
      )}

      {showCreate && (
        <CreateResourceQuotaModal
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

      <DeleteConfirmModal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onDeleted={refresh}
        resourceType="Resource Quota"
        resourceName={deleteTarget?.name ?? ""}
        namespace={deleteTarget?.ns}
        kind="ResourceQuota"
        deleteFn={() => deleteResourceQuota(deleteTarget!.ns, deleteTarget!.name)}
      />
    </div>
  );
}
