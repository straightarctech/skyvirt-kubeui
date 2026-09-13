import { useState, useMemo } from "react";
import { EmptyRow } from "@/components/EmptyState";
import { TableSkeleton } from "@/components/Skeleton";
import { useOutletContext } from "react-router-dom";
import { listCRDInstances, applyManifest, deleteResource, listHCIL2Networks, listHCIHostInterfaces } from "@/api/client";
import type { HCIL2Network, HCIHostInterfaces } from "@/api/client";
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

/**
 * The API answers 404 "<gvr>: kind not installed in this cluster" when the
 * owning operator (MetalLB, Multus) isn't deployed. That's an expected state,
 * not a server error — it gets a neutral notice instead of a red banner.
 */
function isNotInstalled(err: string | null): boolean {
  return !!err && /not installed/i.test(err);
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
  const [nadForm, setNadForm] = useState({ name: "", namespace: namespace !== "all" ? namespace : "default", vlanId: "", bridge: "", subnet: "", gateway: "", plugin: "ovs" as "ovs" | "bridge", hciNetworkId: "" });

  // Fetch MetalLB IPAddressPools
  const { data: rawPools, loading: poolsLoading, error: poolsError, refresh: refreshPools } =
    useResource<Record<string, unknown>[]>(() => listCRDInstances("metallb.io", "v1beta1", "ipaddresspools"), []);

  // Fetch MetalLB L2Advertisements
  const { data: rawL2, loading: l2Loading, error: l2Error, refresh: refreshL2 } =
    useResource<Record<string, unknown>[]>(() => listCRDInstances("metallb.io", "v1beta1", "l2advertisements"), []);

  // Logical networks from the SkyVirtHCI engine this console runs inside. The
  // engine knows every VLAN and the host bridge it rides on, so the operator
  // picks a network by NAME instead of discovering bridge + tag on a node.
  // Empty for a standalone KubeUI with no engine — the form then falls back to
  // free text rather than blocking.
  const { data: hciNets } = useResource<HCIL2Network[]>(() => listHCIL2Networks().catch(() => []), []);

  // The interfaces the nodes actually have, straight from the agent. Needed
  // because an advertisement announces out of a NAMED interface and there is no
  // reliable way to derive that name from a VLAN id — see host.l2_interfaces.
  const { data: hostIfaceData } = useResource<HCIHostInterfaces>(
    () => listHCIHostInterfaces().catch(() => ({ interfaces: [], unrepresented: [] })),
    [],
  );
  const hostIfaces = hostIfaceData?.interfaces ?? [];
  // Networks the operator created that no node can announce from. Shown as
  // disabled entries WITH THE REASON rather than omitted — a network missing
  // from this list with no explanation is what made a live VLAN-17 look like it
  // had never been created.
  const unrepresented = hostIfaceData?.unrepresented ?? [];
  // Why the list carries no network labels, when it does not. Silence here would
  // read as "these interfaces belong to no network".
  const correlationNote = hostIfaceData?.correlationNote;

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

  // MetalLB backs both pools and advertisements; Multus backs the NADs.
  const metalLBMissing = isNotInstalled(poolsError) || isNotInstalled(l2Error);
  const multusMissing = isNotInstalled(nadError);
  const tabMissing = tab === "nad" ? multusMissing : metalLBMissing;
  const missingOperator = tab === "nad" ? "Multus CNI" : "MetalLB";

  const handleCreate = async () => {
    setCreating(true);
    setCreateError(null);
    try {
      let yaml = "";
      if (createType === "pool") {
        const addrs = poolForm.addresses.split(",").map((a) => a.trim()).filter(Boolean);
        if (!poolForm.name.trim()) throw new Error("Pool name is required");
        // An IPAddressPool with no addresses would emit `addresses:` with nothing
        // under it, which YAML reads as null and the CRD schema rejects with a
        // message about types rather than about the empty field. Say it here.
        if (addrs.length === 0) throw new Error("At least one address range or CIDR is required");
        yaml = `apiVersion: metallb.io/v1beta1
kind: IPAddressPool
metadata:
  name: ${poolForm.name.trim()}
  namespace: ${poolForm.namespace}
spec:
  addresses:
${addrs.map((a) => `    - ${a}`).join("\n")}`;
      } else if (createType === "l2") {
        const poolsList = l2Form.pools.split(",").map((p) => p.trim()).filter(Boolean);
        const ifaceList = l2Form.interfaces.split(",").map((i) => i.trim()).filter(Boolean);
        if (!l2Form.name.trim()) throw new Error("Advertisement name is required");
        // Both fields empty is the DOCUMENTED way to say "all pools, all
        // interfaces" — and it used to emit a bare `spec:`, which YAML reads as
        // null: "spec in body must be of type object". The most ordinary
        // advertisement there is could not be created from this form. An empty
        // spec has to be written as an explicit empty object.
        const specBody =
          `${poolsList.length > 0 ? `\n  ipAddressPools:\n${poolsList.map((p) => `    - ${p}`).join("\n")}` : ""}` +
          `${ifaceList.length > 0 ? `\n  interfaces:\n${ifaceList.map((i) => `    - ${i}`).join("\n")}` : ""}`;
        yaml = `apiVersion: metallb.io/v1beta1
kind: L2Advertisement
metadata:
  name: ${l2Form.name.trim()}
  namespace: ${l2Form.namespace}
spec:${specBody || " {}"}`;
      } else {
        // NetworkAttachmentDefinition with bridge + VLAN
        if (!nadForm.name.trim()) throw new Error("Name is required");
        if (!nadForm.bridge.trim() && nadForm.plugin === "ovs") throw new Error("Bridge is required — pick one of the host's OVS bridges");
        const ipam = nadForm.subnet
          ? { type: "host-local", subnet: nadForm.subnet, gateway: nadForm.gateway || undefined }
          : { type: "dhcp" };
        // Two different plugins, and picking the wrong one fails SILENTLY at pod
        // start rather than at create time: `bridge` drives a LINUX bridge and
        // cannot attach to Open vSwitch, which is what an OVS/VLAN host runs.
        // `ovs` needs ovs-cni installed and takes the VLAN as `vlan`, with the
        // bridge named exactly as ovs-vsctl knows it.
        const config: Record<string, unknown> = nadForm.plugin === "ovs"
          ? {
              cniVersion: "0.3.1",
              type: "ovs",
              bridge: nadForm.bridge.trim(),
              vlan: nadForm.vlanId ? parseInt(nadForm.vlanId) : undefined,
              mtu: (hciNets ?? []).find((n) => n.id === nadForm.hciNetworkId)?.mtu,
              ipam,
            }
          : {
              cniVersion: "0.3.1",
              type: "bridge",
              bridge: nadForm.bridge || `br-vlan${nadForm.vlanId}`,
              vlan: nadForm.vlanId ? parseInt(nadForm.vlanId) : undefined,
              ipam,
            };
        yaml = `apiVersion: k8s.cni.cncf.io/v1
kind: NetworkAttachmentDefinition
metadata:
  name: ${nadForm.name.trim()}
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
            disabled={tabMissing}
            title={tabMissing ? `${missingOperator} is not installed in this cluster` : undefined}
            className="px-3 py-1.5 text-sm bg-th-ok text-white rounded-lg hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed">Create</button>
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
      {tabMissing ? (
        <div className="p-3 bg-th-subtle border border-th-line text-th-dim rounded-lg text-sm">
          <span className="font-medium text-th-body">{missingOperator} is not installed in this cluster.</span>{" "}
          {tab === "nad"
            ? "Install Multus CNI to attach pods to VLAN/bridge networks."
            : "Install MetalLB to hand out LoadBalancer IPs on the L2 network."}
        </div>
      ) : (
        error && <div className="p-3 bg-th-danger-s text-th-danger rounded-lg text-sm">{error}</div>
      )}

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
                <EmptyRow colSpan={5} title={isNotInstalled(poolsError) ? "MetalLB is not installed" : poolsError ? "Could not load IP address pools" : "No IP address pools found"} />
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
                <EmptyRow colSpan={5} title={isNotInstalled(l2Error) ? "MetalLB is not installed" : l2Error ? "Could not load L2 advertisements" : "No L2 advertisements found"} />
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
                <EmptyRow colSpan={6} title={isNotInstalled(nadError) ? "Multus CNI is not installed" : nadError ? "Could not load network attachment definitions" : "No network attachment definitions found"} />
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
                    {(hostIfaces.length > 0 || unrepresented.length > 0) && (
                      <>
                        <select
                          className={`${INPUT} mt-2`}
                          value=""
                          onChange={(e) => {
                            const name = e.target.value;
                            if (!name) return;
                            setL2Form((f) => {
                              const cur = f.interfaces.split(",").map((x) => x.trim()).filter(Boolean);
                              return cur.includes(name) ? f : { ...f, interfaces: [...cur, name].join(", ") };
                            });
                          }}
                        >
                          <option value="">Add an interface from this cluster's nodes…</option>
                          {hostIfaces.map((i) => (
                            <option key={i.name} value={i.name} disabled={!i.usable}>
                              {/* Lead with what SkyVirtHCI calls it — the operator
                                  created "VLAN-20", not "trunk0.20" — but keep the
                                  kernel name visible, because that is what actually
                                  goes into the advertisement. */}
                              {i.network_name ? `${i.network_name} (${i.name})` : i.name}
                              {i.vlan_id != null ? ` — VLAN ${i.vlan_id}` : ""}
                              {i.roles && i.roles.length > 0 ? ` — ${i.roles.join(" · ")}` : ""}
                              {i.addresses && i.addresses.length > 0 ? ` (${i.addresses[0]})` : ""}
                              {i.usable ? "" : " — down"}
                              {i.on_all_nodes ? "" : ` — only ${i.nodes} node(s)`}
                            </option>
                          ))}
                          {unrepresented.length > 0 && (
                            <optgroup label="No interface on any node — cannot announce">
                              {unrepresented.map((n) => (
                                <option key={n.id} value="" disabled>
                                  {n.name}
                                  {n.vlan_id != null ? ` — VLAN ${n.vlan_id}` : ""}
                                  {` — ${n.reason}`}
                                </option>
                              ))}
                            </optgroup>
                          )}
                        </select>
                        <p className="text-[10px] text-th-ghost mt-1">
                          Reported by the nodes themselves. An interface on only some nodes
                          announces from only those. A SkyVirtHCI network with no interface on
                          any node is listed but cannot be announced from.
                        </p>
                        {correlationNote && (
                          <p className="text-[10px] text-th-warn mt-1">{correlationNote}</p>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )}

              {createType === "nad" && (
                <div className="space-y-3">
                  {(hciNets ?? []).length > 0 && (
                    <div>
                      <label className="block text-xs text-th-dim mb-1">SkyVirtHCI network</label>
                      <select
                        className={INPUT}
                        value={nadForm.hciNetworkId}
                        onChange={(e) => {
                          const net = (hciNets ?? []).find((n) => n.id === e.target.value);
                          setNadForm((f) => net
                            ? {
                                ...f,
                                hciNetworkId: net.id,
                                bridge: net.bridge ?? f.bridge,
                                vlanId: net.vlan_id != null ? String(net.vlan_id) : "",
                                plugin: "ovs",
                                name: f.name || `${net.name.toLowerCase().replace(/[^a-z0-9-]/g, "-")}-net`,
                              }
                            : { ...f, hciNetworkId: "" });
                        }}
                      >
                        <option value="">Choose a network…</option>
                        {(hciNets ?? []).map((n) => (
                          <option key={n.id} value={n.id} disabled={!n.attachable}>
                            {n.name}
                            {n.vlan_id != null ? ` — VLAN ${n.vlan_id}` : ""}
                            {n.bridge ? ` on ${n.bridge}` : ""}
                            {n.roles && n.roles.length > 0 ? ` — ${n.roles.join(" · ")}` : ""}
                            {n.attachable ? "" : ` (${n.unattachable_reason ?? "not attachable"})`}
                          </option>
                        ))}
                      </select>
                      <p className="text-[10px] text-th-ghost mt-1">
                        Fills the bridge and VLAN below from the platform. Everything stays editable.
                      </p>
                    </div>
                  )}

                  <div>
                    <label className="block text-xs text-th-dim mb-1">Plugin</label>
                    <div className="flex gap-1 bg-th-subtle rounded-lg p-1">
                      {([["ovs", "Open vSwitch (ovs-cni)"], ["bridge", "Linux bridge"]] as const).map(([id, label]) => (
                        <button key={id} type="button" onClick={() => setNadForm((f) => ({ ...f, plugin: id }))}
                          className={`flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${nadForm.plugin === id ? "bg-th-panel text-th-body shadow-sm" : "text-th-dim"}`}>
                          {label}
                        </button>
                      ))}
                    </div>
                    <p className="text-[10px] text-th-ghost mt-1">
                      {nadForm.plugin === "ovs"
                        ? "Attaches to an existing OVS bridge on the host (e.g. trunk0). Requires ovs-cni."
                        : "Attaches to a Linux bridge. This cannot attach to an OVS bridge."}
                    </p>
                  </div>
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
                      <label className="block text-xs text-th-dim mb-1">
                        Bridge <span className="text-th-ghost">{nadForm.plugin === "ovs" ? "(required — as ovs-vsctl names it)" : "(auto if empty)"}</span>
                      </label>
                      <input className={INPUT} placeholder={nadForm.plugin === "ovs" ? "trunk0" : "br-vlan100"} value={nadForm.bridge} onChange={(e) => setNadForm((f) => ({ ...f, bridge: e.target.value }))} />
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
