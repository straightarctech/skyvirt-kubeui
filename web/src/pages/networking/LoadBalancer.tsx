import { useState, useMemo } from "react";
import { useUrlSearch } from "@/hooks/useUrlState";
import { EmptyState } from "@/components/EmptyState";
import { StatStrip } from "@/components/ResourceSummary";
import { TableSkeleton } from "@/components/Skeleton";
import { useOutletContext } from "react-router-dom";
import { listServices, listEndpoints, deleteService } from "@/api/client";
import type { ServiceSummary, EndpointSummary } from "@/api/client";
import { useLiveResource } from "@/hooks/useLiveResource";
import { useResource } from "@/hooks/useResource";
import LiveIndicator from "@/components/LiveIndicator";
import { useSortableTable, SortableTh } from "@/hooks/useSortableTable";
import { usePagination, TablePagination } from "@/hooks/usePagination";
import DeleteConfirmModal from "@/components/DeleteConfirmModal";
import EditYAMLModal from "@/components/EditYAMLModal";
import EditLBPoolModal from "@/components/EditLBPoolModal";
import CreateServiceModal from "@/components/CreateServiceModal";
import { STATUS } from "@/lib/status";
import { backendHealth } from "@/lib/serviceHealth";

function age(created: string): string {
  const diff = Date.now() - new Date(created).getTime();
  const days = Math.floor(diff / 86400000);
  if (days > 0) return `${days}d`;
  const hours = Math.floor(diff / 3600000);
  if (hours > 0) return `${hours}h`;
  return `${Math.floor(diff / 60000)}m`;
}

export default function LoadBalancer() {
  const { namespace } = useOutletContext<{ namespace: string }>();
  const { data: allServices, loading, error, refresh, watchStatus, live, setLive } = useLiveResource<ServiceSummary[]>(
    () => listServices(namespace),
    "Service",
    namespace,
    [namespace],
  );
  const { data: endpoints } = useResource<EndpointSummary[]>(() => listEndpoints(namespace), [namespace]);
  const endpointMap = useMemo(
    () => new Map((endpoints ?? []).map((e) => [`${e.namespace}/${e.name}`, e])),
    [endpoints],
  );
  const [deleteTarget, setDeleteTarget] = useState<{ ns: string; name: string } | null>(null);
  const [search, setSearch] = useUrlSearch();
  const [editYaml, setEditYaml] = useState<{ ns: string; name: string } | null>(null);
  const [editPool, setEditPool] = useState<{ ns: string; name: string } | null>(null);
  const [editSvc, setEditSvc] = useState<{ ns: string; name: string } | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const lbServices = (allServices ?? []).filter((s) => s.type === "LoadBalancer" || s.type === "NodePort");
  const filtered = lbServices.filter(
    (s) =>
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.namespace.toLowerCase().includes(search.toLowerCase()),
  );

  const { sorted, thProps } = useSortableTable(filtered, {
    name: (s) => s.name,
    namespace: (s) => s.namespace,
    type: (s) => s.type,
    external_ip: (s) => s.external_ip || "",
    age: (s) => Date.now() - new Date(s.created_at).getTime(),
  }, { key: "name", urlKey: "" });

  const pager = usePagination(sorted, { pageSize: 25, urlKey: "" });

  const lbCount = useMemo(() => filtered.filter((s) => s.type === "LoadBalancer").length, [filtered]);
  const npCount = useMemo(() => filtered.filter((s) => s.type === "NodePort").length, [filtered]);
  const pendingCount = useMemo(() => filtered.filter((s) => s.type === "LoadBalancer" && (!s.external_ip || s.external_ip === "<pending>")).length, [filtered]);
  const degradedCount = useMemo(
    () => filtered.filter((s) => ["error", "warn"].includes(backendHealth(s, endpointMap.get(`${s.namespace}/${s.name}`)).kind)).length,
    [filtered, endpointMap],
  );

  const handleDelete = (ns: string, name: string) => setDeleteTarget({ ns, name });

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-th-heading">Load Balancers & NodePorts</h1>
        <div className="flex items-center gap-2">
          <LiveIndicator live={live} status={watchStatus} onToggle={setLive} />
          <button onClick={refresh} className="px-3 py-1.5 text-sm bg-th-subtle text-th-body border border-th-line rounded-lg hover:bg-th-hover transition-colors">Refresh</button>
          <button onClick={() => setShowCreate(true)} className="px-3 py-1.5 text-sm bg-th-accent text-white rounded-lg hover:opacity-90 transition-opacity flex items-center gap-1.5">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
            Create Load Balancer
          </button>
        </div>
      </div>

      <input
        type="text"
        placeholder="Search services..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full max-w-sm px-3 py-2 bg-th-subtle border border-th-line rounded-lg text-sm text-th-body placeholder:text-th-ghost focus:outline-none focus:ring-1 focus:ring-th-accent"
      />

      {loading && <TableSkeleton />}
      {error && <div className="p-3 bg-th-danger-s text-th-danger rounded-lg text-sm">{error}</div>}

      {!loading && (
        <StatStrip stats={[
          { label: "Load Balancers", value: lbCount, tone: "accent" },
          { label: "NodePorts", value: npCount, tone: "info" },
          { label: "Pending IP", value: pendingCount, tone: pendingCount ? "warn" : "neutral" },
          { label: "Degraded backends", value: degradedCount, tone: degradedCount ? "error" : "ok" },
        ]} />
      )}

      {!loading && filtered.length === 0 && (
        <div className="bg-th-panel border border-th-line rounded-xl shadow-card">
          <EmptyState
            title="No load balancers or NodePorts yet"
            hint="Expose a workload to the network by creating a Service. A LoadBalancer draws an external IP from a MetalLB pool; a NodePort opens a port on every node."
            action={
              <button onClick={() => setShowCreate(true)} className="px-4 py-2 text-sm bg-th-accent text-white rounded-lg hover:opacity-90 transition-opacity">
                Create Load Balancer
              </button>
            }
          />
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div className="bg-th-panel border border-th-line rounded-xl overflow-hidden shadow-card">
          <div className="overflow-x-auto pin-actions">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-th-dim bg-th-subtle border-b border-th-line">
                  <SortableTh {...thProps("name")}>Name</SortableTh>
                  <SortableTh {...thProps("namespace")}>Namespace</SortableTh>
                  <SortableTh {...thProps("type")}>Type</SortableTh>
                  <SortableTh {...thProps("external_ip")}>External IP</SortableTh>
                  <th className="px-4 py-3 font-medium">Cluster IP</th>
                  <th className="px-4 py-3 font-medium">Ports</th>
                  <th className="px-4 py-3 font-medium">Backends</th>
                  <SortableTh {...thProps("age")}>Age</SortableTh>
                  <th className="px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pager.paged.map((s) => {
                  const key = `${s.namespace}/${s.name}`;
                  const ports = (s.ports || []).map((p) => {
                    let str = `${p.port}`;
                    if (p.node_port) str += `:${p.node_port}`;
                    str += `/${p.protocol}`;
                    return str;
                  }).join(", ");
                  const health = backendHealth(s, endpointMap.get(key));
                  const pending = s.type === "LoadBalancer" && (!s.external_ip || s.external_ip === "<pending>");
                  return (
                    <tr key={key} className="border-b border-th-line last:border-0 hover:bg-th-hover transition-colors">
                      <td className="px-4 py-3 font-medium text-th-body">{s.name}</td>
                      <td className="px-4 py-3 text-th-dim">{s.namespace}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${s.type === "LoadBalancer" ? "bg-th-accent-s text-th-accent" : "bg-th-info-s text-th-info"}`}>
                          {s.type}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">
                        {pending
                          ? <span className="text-th-warn">&lt;pending&gt;</span>
                          : <span className="text-th-body">{s.external_ip || "-"}</span>}
                      </td>
                      <td className="px-4 py-3 text-th-dim font-mono text-xs">{s.cluster_ip || "-"}</td>
                      <td className="px-4 py-3 text-th-dim font-mono text-xs">{ports || "-"}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS[health.kind].badge}`} title="Ready backing endpoints">
                          {health.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-th-dim">{age(s.created_at)}</td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          <button
                            onClick={() => setEditSvc({ ns: s.namespace, name: s.name })}
                            className="px-2 py-1 text-xs bg-th-accent-s text-th-accent rounded hover:opacity-80"
                            title="Edit ports, selector, and pool"
                          >Edit</button>
                          {s.type === "LoadBalancer" && (
                            <button
                              onClick={() => setEditPool({ ns: s.namespace, name: s.name })}
                              className="px-2 py-1 text-xs bg-th-info-s text-th-info rounded hover:opacity-80"
                              title="Change address pool (VLAN / external network)"
                            >Pool</button>
                          )}
                          <button
                            onClick={() => setEditYaml({ ns: s.namespace, name: s.name })}
                            className="px-2 py-1 text-xs bg-th-subtle text-th-body border border-th-line rounded hover:opacity-80"
                          >YAML</button>
                          <button
                            onClick={() => handleDelete(s.namespace, s.name)}
                            className="px-2 py-1 text-xs bg-th-danger-s text-th-danger rounded hover:opacity-80"
                          >Delete</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <TablePagination {...pager} label="services" />
        </div>
      )}
      {editYaml && (
        <EditYAMLModal
          kind="Service"
          namespace={editYaml.ns}
          name={editYaml.name}
          onClose={() => setEditYaml(null)}
          onUpdated={refresh}
        />
      )}
      {editPool && (
        <EditLBPoolModal
          namespace={editPool.ns}
          name={editPool.name}
          onClose={() => setEditPool(null)}
          onUpdated={refresh}
        />
      )}
      {showCreate && (
        <CreateServiceModal
          title="Create Load Balancer"
          defaultType="LoadBalancer"
          defaultNamespace={namespace && namespace !== "all" ? namespace : "default"}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); refresh(); }}
        />
      )}
      {editSvc && (
        <CreateServiceModal
          editTarget={{ namespace: editSvc.ns, name: editSvc.name }}
          onClose={() => setEditSvc(null)}
          onCreated={() => { setEditSvc(null); refresh(); }}
        />
      )}
      <DeleteConfirmModal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onDeleted={refresh}
        resourceType="Service"
        resourceName={deleteTarget?.name ?? ""}
        namespace={deleteTarget?.ns}
        kind="Service"
        deleteFn={() => deleteService(deleteTarget!.ns, deleteTarget!.name)}
      />
    </div>
  );
}
