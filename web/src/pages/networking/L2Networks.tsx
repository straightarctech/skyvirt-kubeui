import { useState, useMemo } from "react";
import { EmptyRow } from "@/components/EmptyState";
import { TableSkeleton } from "@/components/Skeleton";
import { useOutletContext } from "react-router-dom";
import { listCRDInstances, applyManifest, deleteResource } from "@/api/client";
import { useToast } from "@/components/Toast";
import { useResource } from "@/hooks/useResource";
import { useLiveResources } from "@/hooks/useLiveResource";
import LiveIndicator from "@/components/LiveIndicator";
import EditYAMLModal from "@/components/EditYAMLModal";
import DeleteConfirmModal from "@/components/DeleteConfirmModal";

// ---------------------------------------------------------------------------
// MetalLB types
// ---------------------------------------------------------------------------

interface IPPool {
  name: string;
  namespace: string;
  addresses: string[];
  autoAssign: boolean;
  avoidBuggyIPs: boolean;
  raw: Record<string, unknown>;
}

interface L2Advert {
  name: string;
  namespace: string;
  ipPools: string[];
  interfaces: string[];
  raw: Record<string, unknown>;
}

interface NetAttachDef {
  name: string;
  namespace: string;
  config: string;
  raw: Record<string, unknown>;
}

function parseIPPool(obj: Record<string, unknown>): IPPool {
  const meta = (obj.metadata || {}) as Record<string, unknown>;
  const spec = (obj.spec || {}) as Record<string, unknown>;
  return {
    name: String(meta.name || ""),
    namespace: String(meta.namespace || "metallb-system"),
    addresses: (spec.addresses as string[]) || [],
    autoAssign: spec.autoAssign !== false,
    avoidBuggyIPs: !!spec.avoidBuggyIPs,
    raw: obj,
  };
}

function parseL2Advert(obj: Record<string, unknown>): L2Advert {
  const meta = (obj.metadata || {}) as Record<string, unknown>;
  const spec = (obj.spec || {}) as Record<string, unknown>;
  return {
    name: String(meta.name || ""),
    namespace: String(meta.namespace || "metallb-system"),
    ipPools: (spec.ipAddressPools as string[]) || [],
    interfaces: (spec.interfaces as string[]) || [],
    raw: obj,
  };
}

function parseNetAttachDef(obj: Record<string, unknown>): NetAttachDef {
  const meta = (obj.metadata || {}) as Record<string, unknown>;
  const spec = (obj.spec || {}) as Record<string, unknown>;
  return {
    name: String(meta.name || ""),
    namespace: String(meta.namespace || ""),
    config: String(spec.config || ""),
    raw: obj,
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function L2Networks() {
  const toast = useToast();
  const { namespace } = useOutletContext<{ namespace: string }>();
  const [tab, setTab] = useState<"pools" | "l2" | "nad">("pools");
  const [editYaml, setEditYaml] = useState<{ kind: string; ns?: string; name: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ kind: string; ns: string; name: string } | null>(null);

  // Create modal
  const [showCreate, setShowCreate] = useState(false);
  const [createType, setCreateType] = useState<"pool" | "l2" | "nad">("pool");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Create form fields
  const [poolForm, setPoolForm] = useState({ name: "", addresses: "", namespace: "metallb-system" });
  const [l2Form, setL2Form] = useState({ name: "", pools: "", interfaces: "", namespace: "metallb-system" });
  const [nadForm, setNadForm] = useState({ name: "", namespace: namespace !== "all" ? namespace : "default", vlanId: "", bridge: "", subnet: "", gateway: "" });

  // Fetch MetalLB IPAddressPools
  const { data: rawPools, loading: poolsLoading, error: poolsError, refresh: refreshPools } =
    useResource<Record<string, unknown>[]>(() => listCRDInstances("metallb.io", "v1beta1", "ipaddresspools"), []);

  // Fetch MetalLB L2Advertisements
  const { data: rawL2, loading: l2Loading, error: l2Error, refresh: refreshL2 } =
    useResource<Record<string, unknown>[]>(() => listCRDInstances("metallb.io", "v1beta1", "l2advertisements"), []);

  // Fetch Multus NetworkAttachmentDefinitions
  const ns = namespace !== "all" ? namespace : undefined;
  const { data: rawNad, loading: nadLoading, error: nadError, refresh: refreshNad } =
    useResource<Record<string, unknown>[]>(() => listCRDInstances("k8s.cni.cncf.io", "v1", "network-attachment-definitions", ns), [namespace]);

  const pools = useMemo(() => (rawPools ?? []).map(parseIPPool), [rawPools]);
  const l2Adverts = useMemo(() => (rawL2 ?? []).map(parseL2Advert), [rawL2]);
  const nads = useMemo(() => (rawNad ?? []).map(parseNetAttachDef), [rawNad]);

  const refresh = () => { refreshPools(); refreshL2(); refreshNad(); };
  const { watchStatus, live, setLive } = useLiveResources(
    [{ kind: "IPAddressPool" }, { kind: "L2Advertisement" }, { kind: "NetworkAttachmentDefinition" }],
    refresh,
  );
  const loading = tab === "pools" ? poolsLoading : tab === "l2" ? l2Loading : nadLoading;
  const error = tab === "pools" ? poolsError : tab === "l2" ? l2Error : nadError;

  void poolsError; void nadError; // used for error display below

  const handleCreate = async () => {
    setCreating(true);
    setCreateError(null);
    try {
      let yaml = "";
      if (createType === "pool") {
        const addrs = poolForm.addresses.split(",").map((a) => a.trim()).filter(Boolean);
        yaml = `apiVersion: metallb.io/v1beta1
kind: IPAddressPool
metadata:
  name: ${poolForm.name}
  namespace: ${poolForm.namespace}
spec:
  addresses:
${addrs.map((a) => `    - ${a}`).join("\n")}`;
      } else if (createType === "l2") {
        const poolsList = l2Form.pools.split(",").map((p) => p.trim()).filter(Boolean);
        const ifaceList = l2Form.interfaces.split(",").map((i) => i.trim()).filter(Boolean);
        yaml = `apiVersion: metallb.io/v1beta1
kind: L2Advertisement
metadata:
  name: ${l2Form.name}
  namespace: ${l2Form.namespace}
spec:${poolsList.length > 0 ? `\n  ipAddressPools:\n${poolsList.map((p) => `    - ${p}`).join("\n")}` : ""}${ifaceList.length > 0 ? `\n  interfaces:\n${ifaceList.map((i) => `    - ${i}`).join("\n")}` : ""}`;
      } else {
        // NetworkAttachmentDefinition with bridge + VLAN
        const config: Record<string, unknown> = {
          cniVersion: "0.3.1",
          type: "bridge",
          bridge: nadForm.bridge || `br-vlan${nadForm.vlanId}`,
          vlan: nadForm.vlanId ? parseInt(nadForm.vlanId) : undefined,
          ipam: nadForm.subnet ? { type: "host-local", subnet: nadForm.subnet, gateway: nadForm.gateway || undefined } : { type: "dhcp" },
        };
        yaml = `apiVersion: k8s.cni.cncf.io/v1
kind: NetworkAttachmentDefinition
metadata:
  name: ${nadForm.name}
  namespace: ${nadForm.namespace}
spec:
  config: '${JSON.stringify(config)}'`;
      }
      await applyManifest(yaml);
      toast.success("Network resource created");
      setShowCreate(false);
      refresh();
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  };

  const INPUT = "w-full px-3 py-2 bg-th-subtle border border-th-line rounded-lg text-sm text-th-body placeholder:text-th-ghost focus:outline-none focus:ring-1 focus:ring-th-accent";

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-th-heading">L2 Networking</h1>
        <div className="flex items-center gap-2">
          <LiveIndicator live={live} status={watchStatus} onToggle={setLive} />
          <button onClick={() => { setCreateType(tab === "nad" ? "nad" : tab === "l2" ? "l2" : "pool"); setShowCreate(true); }}
            className="px-3 py-1.5 text-sm bg-th-ok text-white rounded-lg hover:opacity-90 transition-opacity">Create</button>
          <button onClick={refresh} className="px-3 py-1.5 text-sm bg-th-accent text-white rounded-lg hover:opacity-90 transition-opacity">Refresh</button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-th-subtle rounded-lg p-1 w-fit">
        <button onClick={() => setTab("pools")}
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${tab === "pools" ? "bg-th-panel text-th-body shadow-sm" : "text-th-dim hover:text-th-body"}`}>
          IP Pools ({pools.length})
        </button>
        <button onClick={() => setTab("l2")}
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${tab === "l2" ? "bg-th-panel text-th-body shadow-sm" : "text-th-dim hover:text-th-body"}`}>
          L2 Advertisements ({l2Adverts.length})
        </button>
        <button onClick={() => setTab("nad")}
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${tab === "nad" ? "bg-th-panel text-th-body shadow-sm" : "text-th-dim hover:text-th-body"}`}>
          Network Attachments ({nads.length})
        </button>
      </div>

      {loading && <TableSkeleton />}
      {error && <div className="p-3 bg-th-danger-s text-th-danger rounded-lg text-sm">{error}</div>}

      {/* Summary cards */}
      {!loading && (
        <div className="grid grid-cols-12 gap-4">
          <div className="col-span-4 bg-th-panel border border-th-line rounded-xl p-4 shadow-card flex flex-col items-center justify-center">
            <p className="text-3xl font-black text-th-accent">{pools.length}</p>
            <p className="text-[10px] text-th-dim uppercase tracking-wider">IP Pools</p>
          </div>
          <div className="col-span-4 bg-th-panel border border-th-line rounded-xl p-4 shadow-card flex flex-col items-center justify-center">
            <p className="text-3xl font-black text-th-info">{l2Adverts.length}</p>
            <p className="text-[10px] text-th-dim uppercase tracking-wider">L2 Advertisements</p>
          </div>
          <div className="col-span-4 bg-th-panel border border-th-line rounded-xl p-4 shadow-card flex flex-col items-center justify-center">
            <p className="text-3xl font-black text-th-ok">{nads.length}</p>
            <p className="text-[10px] text-th-dim uppercase tracking-wider">Net Attach Defs</p>
          </div>
        </div>
      )}

      {/* ---- IP Address Pools ---- */}
      {!loading && tab === "pools" && (
        <div className="bg-th-panel border border-th-line rounded-xl overflow-hidden shadow-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-th-dim bg-th-subtle border-b border-th-line">
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Namespace</th>
                <th className="px-4 py-3 font-medium">Addresses</th>
                <th className="px-4 py-3 font-medium">Auto Assign</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pools.map((p) => (
                <tr key={`${p.namespace}/${p.name}`} className="border-b border-th-line last:border-0 hover:bg-th-hover transition-colors">
                  <td className="px-4 py-3 font-medium text-th-body">{p.name}</td>
                  <td className="px-4 py-3 text-th-dim">{p.namespace}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {p.addresses.map((a, i) => (
                        <span key={i} className="px-2 py-0.5 bg-th-accent/10 text-th-accent rounded text-xs font-mono">{a}</span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${p.autoAssign ? "bg-th-ok-s text-th-ok" : "bg-th-subtle text-th-dim"}`}>
                      {p.autoAssign ? "Yes" : "No"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      <button onClick={() => setEditYaml({ kind: "IPAddressPool", ns: p.namespace, name: p.name })}
                        className="px-2 py-1 text-xs bg-th-subtle text-th-body border border-th-line rounded hover:opacity-80">YAML</button>
                      <button onClick={() => setDeleteTarget({ kind: "IPAddressPool", ns: p.namespace, name: p.name })}
                        className="px-2 py-1 text-xs bg-th-danger-s text-th-danger rounded hover:opacity-80">Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
              {pools.length === 0 && (
                <EmptyRow colSpan={5} title={poolsError ? "MetalLB not installed or no IP pools defined" : "No IP address pools found"} />
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ---- L2 Advertisements ---- */}
      {!loading && tab === "l2" && (
        <div className="bg-th-panel border border-th-line rounded-xl overflow-hidden shadow-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-th-dim bg-th-subtle border-b border-th-line">
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Namespace</th>
                <th className="px-4 py-3 font-medium">IP Pools</th>
                <th className="px-4 py-3 font-medium">Interfaces</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {l2Adverts.map((a) => (
                <tr key={`${a.namespace}/${a.name}`} className="border-b border-th-line last:border-0 hover:bg-th-hover transition-colors">
                  <td className="px-4 py-3 font-medium text-th-body">{a.name}</td>
                  <td className="px-4 py-3 text-th-dim">{a.namespace}</td>
                  <td className="px-4 py-3">
                    {a.ipPools.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {a.ipPools.map((p, i) => (
                          <span key={i} className="px-2 py-0.5 bg-th-info/10 text-th-info rounded text-xs">{p}</span>
                        ))}
                      </div>
                    ) : <span className="text-th-ghost text-xs">All pools</span>}
                  </td>
                  <td className="px-4 py-3">
                    {a.interfaces.length > 0 ? (
                      <span className="text-xs font-mono text-th-body">{a.interfaces.join(", ")}</span>
                    ) : <span className="text-th-ghost text-xs">All interfaces</span>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      <button onClick={() => setEditYaml({ kind: "L2Advertisement", ns: a.namespace, name: a.name })}
                        className="px-2 py-1 text-xs bg-th-subtle text-th-body border border-th-line rounded hover:opacity-80">YAML</button>
                      <button onClick={() => setDeleteTarget({ kind: "L2Advertisement", ns: a.namespace, name: a.name })}
                        className="px-2 py-1 text-xs bg-th-danger-s text-th-danger rounded hover:opacity-80">Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
              {l2Adverts.length === 0 && (
                <EmptyRow colSpan={5} title="No L2 advertisements found" />
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ---- Network Attachment Definitions ---- */}
      {!loading && tab === "nad" && (
        <div className="bg-th-panel border border-th-line rounded-xl overflow-hidden shadow-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-th-dim bg-th-subtle border-b border-th-line">
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Namespace</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">VLAN</th>
                <th className="px-4 py-3 font-medium">Subnet</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {nads.map((n) => {
                let cfg: Record<string, unknown> = {};
                try { cfg = JSON.parse(n.config); } catch { /* ignore */ }
                return (
                  <tr key={`${n.namespace}/${n.name}`} className="border-b border-th-line last:border-0 hover:bg-th-hover transition-colors">
                    <td className="px-4 py-3 font-medium text-th-body">{n.name}</td>
                    <td className="px-4 py-3 text-th-dim">{n.namespace}</td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 bg-th-accent/10 text-th-accent rounded text-xs">{String(cfg.type || "unknown")}</span>
                    </td>
                    <td className="px-4 py-3 text-th-body font-mono text-xs">{cfg.vlan ? String(cfg.vlan) : "-"}</td>
                    <td className="px-4 py-3 text-th-dim font-mono text-xs">
                      {(cfg.ipam as Record<string, unknown>)?.subnet ? String((cfg.ipam as Record<string, unknown>).subnet) : "DHCP"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        <button onClick={() => setEditYaml({ kind: "NetworkAttachmentDefinition", ns: n.namespace, name: n.name })}
                          className="px-2 py-1 text-xs bg-th-subtle text-th-body border border-th-line rounded hover:opacity-80">YAML</button>
                        <button onClick={() => setDeleteTarget({ kind: "NetworkAttachmentDefinition", ns: n.namespace, name: n.name })}
                          className="px-2 py-1 text-xs bg-th-danger-s text-th-danger rounded hover:opacity-80">Delete</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {nads.length === 0 && (
                <EmptyRow colSpan={6} title={nadError ? "Multus CNI not installed" : "No network attachment definitions found"} />
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Info banner */}
      <div className="bg-th-panel border border-th-line rounded-xl p-4 shadow-card">
        <h3 className="text-sm font-semibold text-th-heading mb-2">L2 Networking Guide</h3>
        <div className="text-xs text-th-dim space-y-1">
          <p><strong>IP Address Pools</strong> — Define IP ranges MetalLB can assign to LoadBalancer services. Use CIDR (192.168.1.240/29) or ranges (192.168.1.240-192.168.1.250).</p>
          <p><strong>L2 Advertisements</strong> — Enable ARP/NDP responses for pool IPs. Create one per pool or one for all. Optionally restrict to specific network interfaces.</p>
          <p><strong>Network Attachments</strong> — Multus CNI definitions for attaching pods to VLAN/bridge L2 networks. Pods use <code className="bg-th-subtle px-1 rounded">k8s.v1.cni.cncf.io/networks: net-name</code> annotation.</p>
        </div>
      </div>

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowCreate(false)} />
          <div className="relative bg-th-panel rounded-xl shadow-card w-full max-w-lg mx-4 max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-th-line px-6 py-4">
              <h3 className="text-lg font-semibold text-th-heading">Create L2 Resource</h3>
              <button onClick={() => setShowCreate(false)} className="text-th-dim hover:text-th-body">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="flex-1 overflow-auto px-6 py-4 space-y-4">
              {/* Type selector */}
              <div className="flex gap-1 bg-th-subtle rounded-lg p-1">
                {([["pool", "IP Pool"], ["l2", "L2 Advert"], ["nad", "Net Attach Def"]] as const).map(([id, label]) => (
                  <button key={id} onClick={() => setCreateType(id)}
                    className={`flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${createType === id ? "bg-th-panel text-th-body shadow-sm" : "text-th-dim"}`}>
                    {label}
                  </button>
                ))}
              </div>

              {createType === "pool" && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs text-th-dim mb-1">Pool Name</label>
                    <input className={INPUT} placeholder="vlan100-pool" value={poolForm.name} onChange={(e) => setPoolForm((f) => ({ ...f, name: e.target.value }))} />
                  </div>
                  <div>
                    <label className="block text-xs text-th-dim mb-1">Addresses <span className="text-th-ghost">(comma-separated CIDRs or ranges)</span></label>
                    <input className={INPUT} placeholder="192.168.1.240-192.168.1.250, 192.168.100.0/28" value={poolForm.addresses} onChange={(e) => setPoolForm((f) => ({ ...f, addresses: e.target.value }))} />
                  </div>
                </div>
              )}

              {createType === "l2" && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs text-th-dim mb-1">Advertisement Name</label>
                    <input className={INPUT} placeholder="l2-advert-vlan100" value={l2Form.name} onChange={(e) => setL2Form((f) => ({ ...f, name: e.target.value }))} />
                  </div>
                  <div>
                    <label className="block text-xs text-th-dim mb-1">IP Pools <span className="text-th-ghost">(comma-separated, empty = all pools)</span></label>
                    <input className={INPUT} placeholder="vlan100-pool" value={l2Form.pools} onChange={(e) => setL2Form((f) => ({ ...f, pools: e.target.value }))} />
                  </div>
                  <div>
                    <label className="block text-xs text-th-dim mb-1">Interfaces <span className="text-th-ghost">(comma-separated, empty = all)</span></label>
                    <input className={INPUT} placeholder="eth0, eno1" value={l2Form.interfaces} onChange={(e) => setL2Form((f) => ({ ...f, interfaces: e.target.value }))} />
                  </div>
                </div>
              )}

              {createType === "nad" && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-th-dim mb-1">Name</label>
                      <input className={INPUT} placeholder="vlan100-net" value={nadForm.name} onChange={(e) => setNadForm((f) => ({ ...f, name: e.target.value }))} />
                    </div>
                    <div>
                      <label className="block text-xs text-th-dim mb-1">Namespace</label>
                      <input className={INPUT} value={nadForm.namespace} onChange={(e) => setNadForm((f) => ({ ...f, namespace: e.target.value }))} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-th-dim mb-1">VLAN ID</label>
                      <input className={INPUT} type="number" placeholder="100" value={nadForm.vlanId} onChange={(e) => setNadForm((f) => ({ ...f, vlanId: e.target.value }))} />
                    </div>
                    <div>
                      <label className="block text-xs text-th-dim mb-1">Bridge <span className="text-th-ghost">(auto if empty)</span></label>
                      <input className={INPUT} placeholder="br-vlan100" value={nadForm.bridge} onChange={(e) => setNadForm((f) => ({ ...f, bridge: e.target.value }))} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-th-dim mb-1">Subnet <span className="text-th-ghost">(empty = DHCP)</span></label>
                      <input className={INPUT} placeholder="192.168.100.0/24" value={nadForm.subnet} onChange={(e) => setNadForm((f) => ({ ...f, subnet: e.target.value }))} />
                    </div>
                    <div>
                      <label className="block text-xs text-th-dim mb-1">Gateway</label>
                      <input className={INPUT} placeholder="192.168.100.1" value={nadForm.gateway} onChange={(e) => setNadForm((f) => ({ ...f, gateway: e.target.value }))} />
                    </div>
                  </div>
                </div>
              )}

              {createError && <div className="p-2 bg-th-danger-s text-th-danger rounded text-xs">{createError}</div>}
            </div>
            <div className="flex justify-end gap-2 border-t border-th-line px-6 py-4">
              <button onClick={() => setShowCreate(false)} className="px-4 py-2 text-sm border border-th-line text-th-body rounded-lg hover:bg-th-hover">Cancel</button>
              <button onClick={handleCreate} disabled={creating}
                className="px-4 py-2 text-sm bg-th-accent text-white rounded-lg hover:opacity-90 disabled:opacity-50">
                {creating ? "Creating..." : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}

      {editYaml && (
        <EditYAMLModal kind={editYaml.kind} namespace={editYaml.ns} name={editYaml.name} onClose={() => setEditYaml(null)} onUpdated={refresh} />
      )}

      <DeleteConfirmModal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onDeleted={refresh}
        resourceType={deleteTarget?.kind ?? ""}
        resourceName={deleteTarget?.name ?? ""}
        namespace={deleteTarget?.ns}
        kind={deleteTarget?.kind ?? ""}
        deleteFn={() => deleteResource(deleteTarget!.kind, deleteTarget!.ns, deleteTarget!.name)}
      />
    </div>
  );
}
