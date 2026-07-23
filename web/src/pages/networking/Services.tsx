import { useState, useMemo } from "react";
import { useUrlSearch } from "@/hooks/useUrlState";
import { EmptyRow } from "@/components/EmptyState";
import { TableSkeleton } from "@/components/Skeleton";
import { useOutletContext, Link } from "react-router-dom";
import { listServices, listEndpoints, deleteService } from "@/api/client";
import type { ServiceSummary, EndpointSummary } from "@/api/client";
import { useLiveResource } from "@/hooks/useLiveResource";
import { useResource } from "@/hooks/useResource";
import { STATUS } from "@/lib/status";
import { backendHealth } from "@/lib/serviceHealth";
import LiveIndicator from "@/components/LiveIndicator";
import { useSortableTable, SortableTh } from "@/hooks/useSortableTable";
import { usePagination, TablePagination } from "@/hooks/usePagination";
import { useRowSelection } from "@/hooks/useRowSelection";
import BulkActionBar, { SelectCheckbox } from "@/components/BulkActionBar";
import { useLabelSelector, LabelSelectorInput } from "@/hooks/useLabelSelector";
import CreateServiceModal from "@/components/CreateServiceModal";
import EditYAMLModal from "@/components/EditYAMLModal";
import EditLBPoolModal from "@/components/EditLBPoolModal";
import DeleteConfirmModal from "@/components/DeleteConfirmModal";
import ProtectToggle from "@/components/ProtectToggle";
import { StatStrip } from "@/components/ResourceSummary";
import { DistributionBar } from "@/components/DistributionBar";

function age(created: string): string {
  const diff = Date.now() - new Date(created).getTime();
  const days = Math.floor(diff / 86400000);
  if (days > 0) return `${days}d`;
  const hours = Math.floor(diff / 3600000);
  if (hours > 0) return `${hours}h`;
  const mins = Math.floor(diff / 60000);
  return `${mins}m`;
}

function typeColor(type: string): string {
  switch (type) {
    case "ClusterIP":
      return "bg-th-info-s text-th-info";
    case "NodePort":
      return "bg-th-warn-s text-th-warn";
    case "LoadBalancer":
      return "bg-th-ok-s text-th-ok";
    case "ExternalName":
      return "bg-th-accent/20 text-th-accent";
    default:
      return "bg-th-muted text-th-dim";
  }
}

export default function Services() {
  const { namespace } = useOutletContext<{ namespace: string }>();
  const { data: items, loading, error, refresh, watchStatus, live, setLive } = useLiveResource<ServiceSummary[]>(
    () => listServices(namespace),
    "Service",
    namespace,
    [namespace],
    { keyOf: (s) => `${(s as ServiceSummary).namespace}/${(s as ServiceSummary).name}` },
  );
  const { data: endpoints } = useResource<EndpointSummary[]>(() => listEndpoints(namespace), [namespace]);
  const endpointMap = useMemo(
    () => new Map((endpoints ?? []).map((e) => [`${e.namespace}/${e.name}`, e])),
    [endpoints],
  );
  const [search, setSearch] = useUrlSearch();
  const [showCreate, setShowCreate] = useState(false);
  const [editSvc, setEditSvc] = useState<{ ns: string; name: string } | null>(null);
  const [editYaml, setEditYaml] = useState<{ kind: string; ns: string; name: string } | null>(null);
  const [editPool, setEditPool] = useState<{ ns: string; name: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ ns: string; name: string } | null>(null);
  const [protectedResources, setProtectedResources] = useState<Set<string>>(new Set());

  const labelSel = useLabelSelector({ urlKey: "" });
  const textFiltered = (items ?? []).filter(
    (s) =>
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.namespace.toLowerCase().includes(search.toLowerCase()) ||
      s.type.toLowerCase().includes(search.toLowerCase()),
  );
  const filtered = textFiltered.filter((s) => labelSel.match(s.labels));

  const { sorted, thProps } = useSortableTable(filtered, {
    name: (s) => s.name,
    namespace: (s) => s.namespace,
    type: (s) => s.type,
    cluster_ip: (s) => s.cluster_ip || "",
    external_ip: (s) => s.external_ip || "",
    age: (s) => Date.now() - new Date(s.created_at).getTime(),
  }, { key: "name", urlKey: "" });

  const pager = usePagination(sorted, { pageSize: 25, urlKey: "" });
  const sel = useRowSelection<ServiceSummary>((s) => `${s.namespace}/${s.name}`);

  const typeBar = useMemo(() => [
    { label: "ClusterIP", value: filtered.filter((s) => s.type === "ClusterIP" && s.cluster_ip !== "None").length, color: "#3b82f6" },
    { label: "LoadBalancer", value: filtered.filter((s) => s.type === "LoadBalancer").length, color: "var(--th-ok)" },
    { label: "NodePort", value: filtered.filter((s) => s.type === "NodePort").length, color: "var(--th-warn)" },
    { label: "Headless", value: filtered.filter((s) => s.cluster_ip === "None").length, color: "var(--th-dim)" },
    { label: "ExternalName", value: filtered.filter((s) => s.type === "ExternalName").length, color: "#a855f7" },
  ], [filtered]);

  const formatPorts = (ports: ServiceSummary["ports"]): string => {
    if (!ports || ports.length === 0) return "-";
    return ports
      .map((p) => {
        let s = `${p.port}`;
        if (p.target_port) s += `:${p.target_port}`;
        if (p.node_port) s += `:${p.node_port}`;
        s += `/${p.protocol}`;
        return s;
      })
      .join(", ");
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-th-heading">Services</h1>
        <div className="flex gap-2">
          <LiveIndicator live={live} status={watchStatus} onToggle={setLive} />
          <button onClick={() => setShowCreate(true)} className="px-3 py-1.5 text-sm bg-th-ok text-white rounded-lg hover:opacity-90 transition-opacity">
            Create
          </button>
          <button onClick={refresh} className="px-3 py-1.5 text-sm bg-th-accent text-white rounded-lg hover:opacity-90 transition-opacity">
            Refresh
          </button>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <input
          type="text"
          placeholder="Search services..."
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
        <>
          <StatStrip stats={[
            { label: "Services", value: filtered.length, tone: "accent" },
            { label: "ClusterIP", value: filtered.filter((s) => s.type === "ClusterIP" && s.cluster_ip !== "None").length, tone: "info" },
            { label: "LoadBalancer", value: filtered.filter((s) => s.type === "LoadBalancer").length, tone: "ok" },
            { label: "NodePort", value: filtered.filter((s) => s.type === "NodePort").length, tone: "neutral" },
            { label: "Headless", value: filtered.filter((s) => s.cluster_ip === "None").length, tone: "neutral" },
            { label: "ExternalName", value: filtered.filter((s) => s.type === "ExternalName").length, tone: "neutral" },
          ]} />
          <DistributionBar label="Type" segments={typeBar} />
        </>
      )}

      {!loading && (
        <div className="bg-th-panel border border-th-line rounded-xl overflow-hidden shadow-card">
          <div className="overflow-x-auto pin-actions">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-th-dim bg-th-subtle border-b border-th-line">
                  <th className="pl-4 pr-1 py-3 w-8"><SelectCheckbox ariaLabel="Select all services on this page" checked={sel.allSelected(pager.paged)} indeterminate={sel.someSelected(pager.paged)} onChange={() => sel.toggleAll(pager.paged)} /></th>
                  <SortableTh {...thProps("name")}>Name</SortableTh>
                  <SortableTh {...thProps("namespace")}>Namespace</SortableTh>
                  <SortableTh {...thProps("type")}>Type</SortableTh>
                  <SortableTh {...thProps("cluster_ip")}>Cluster IP</SortableTh>
                  <SortableTh {...thProps("external_ip")}>External IP</SortableTh>
                  <th className="px-4 py-3 font-medium">Ports</th>
                  <th className="px-4 py-3 font-medium">Backends</th>
                  <SortableTh {...thProps("age")}>Age</SortableTh>
                  <th className="w-10 px-2 py-3 font-medium" title="Protection"></th>
                  <th className="px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pager.paged.map((s) => {
                  const key = `${s.namespace}/${s.name}`;
                  return (
                    <tr key={key} className={`border-b border-th-line last:border-0 hover:bg-th-hover transition-colors ${sel.isSelected(key) ? "bg-th-accent/5" : ""}`}>
                      <td className="pl-4 pr-1 py-3"><SelectCheckbox ariaLabel={`Select ${s.name}`} checked={sel.isSelected(key)} onChange={() => sel.toggle(key)} /></td>
                      <td className="px-4 py-3 font-medium text-th-body">
                        <Link to={`/networking/services/${s.namespace}/${s.name}`} className="text-th-accent hover:underline">
                          {s.name}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-th-dim">{s.namespace}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${typeColor(s.type)}`}>{s.type}</span>
                      </td>
                      <td className="px-4 py-3 text-th-dim font-mono text-xs">{s.cluster_ip || "-"}</td>
                      <td className="px-4 py-3 text-th-dim font-mono text-xs">{s.external_ip || "-"}</td>
                      <td className="px-4 py-3 text-th-dim font-mono text-xs">{formatPorts(s.ports)}</td>
                      <td className="px-4 py-3">
                        {(() => { const hb = backendHealth(s, endpointMap.get(key)); return (
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS[hb.kind].badge}`} title="Ready backing endpoints">{hb.label}</span>
                        ); })()}
                      </td>
                      <td className="px-4 py-3 text-th-dim">{age(s.created_at)}</td>
                      <td className="px-2 py-3">
                        <ProtectToggle
                          kind="Service"
                          namespace={s.namespace}
                          name={s.name}
                          isProtected={protectedResources.has(key)}
                          onToggled={(v) => setProtectedResources((prev) => {
                            const next = new Set(prev);
                            v ? next.add(key) : next.delete(key);
                            return next;
                          })}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          <button
                            onClick={() => setEditSvc({ ns: s.namespace, name: s.name })}
                            className="px-2 py-1 text-xs bg-th-accent-s text-th-accent rounded hover:opacity-80"
                            title="Edit ports, selector, and type"
                          >
                            Edit
                          </button>
                          {s.type === "LoadBalancer" && (
                            <button
                              onClick={() => setEditPool({ ns: s.namespace, name: s.name })}
                              className="px-2 py-1 text-xs bg-th-info-s text-th-info rounded hover:opacity-80"
                              title="Change address pool (VLAN / external network)"
                            >
                              Pool
                            </button>
                          )}
                          <button
                            onClick={() => setEditYaml({ kind: "Service", ns: s.namespace, name: s.name })}
                            className="px-2 py-1 text-xs bg-th-subtle border border-th-line rounded text-th-body hover:opacity-80"
                          >
                            YAML
                          </button>
                          <button
                            onClick={() => setDeleteTarget({ ns: s.namespace, name: s.name })}
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
                  <EmptyRow colSpan={11} title="No services found" hint="No Services match your search or filters, or this namespace exposes none yet." />
                )}
              </tbody>
            </table>
          </div>
          <TablePagination {...pager} label="services" />
        </div>
      )}
      <BulkActionBar
        selected={sel.selectedRows(items ?? [])}
        noun="services"
        onClear={sel.clear}
        onComplete={refresh}
        actions={[{ label: "Delete", danger: true, gerund: "Deleting", run: (s) => deleteService(s.namespace, s.name) }]}
      />

      {showCreate && (
        <CreateServiceModal
          defaultNamespace={namespace !== "all" ? namespace : undefined}
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
      {editYaml && (
        <EditYAMLModal
          kind={editYaml.kind}
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
