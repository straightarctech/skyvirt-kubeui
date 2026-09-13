import { useState, useEffect } from "react";
import { useToast } from "@/components/Toast";
import { useEscToClose } from "@/hooks/useEscToClose";
import jsYaml from "js-yaml";
import FormField from "@/components/FormField";
import YAMLEditor from "@/components/YAMLEditor";
import { applyManifest, listCRDInstances, getResourceYAML, updateResourceYAML } from "@/api/client";

interface Props {
  onClose: () => void;
  onCreated?: () => void;
  defaultNamespace?: string;
  defaultType?: (typeof SERVICE_TYPES)[number];
  /** Overrides the modal title (e.g. "Create Load Balancer"). */
  title?: string;
  /** When set, the modal edits an existing Service instead of creating one:
   *  it loads the live object, pre-fills the form, and merges changes on save
   *  (preserving fields the form doesn't manage). */
  editTarget?: { namespace: string; name: string };
}

interface SelectorLabel {
  key: string;
  value: string;
}

interface PortEntry {
  name: string;
  port: string;
  targetPort: string;
  nodePort: string;
  protocol: string;
}

const SERVICE_TYPES = ["ClusterIP", "NodePort", "LoadBalancer"] as const;

export default function CreateServiceModal({ onClose, onCreated, defaultNamespace, defaultType, title, editTarget }: Props) {
  const isEdit = !!editTarget;
  const [name, setName] = useState(editTarget?.name || "");
  const [namespace, setNamespace] = useState(editTarget?.namespace || defaultNamespace || "default");
  const [serviceType, setServiceType] = useState<string>(defaultType || "ClusterIP");
  const [selectorLabels, setSelectorLabels] = useState<SelectorLabel[]>([{ key: "", value: "" }]);
  const [ports, setPorts] = useState<PortEntry[]>([
    { name: "http", port: "80", targetPort: "8080", nodePort: "", protocol: "TCP" },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const toast = useToast();
  useEscToClose(!submitting, onClose);
  const [error, setError] = useState<string | null>(null);
  const [yamlMode, setYamlMode] = useState(false);
  const [yamlValue, setYamlValue] = useState("");
  // The live object when editing — form changes merge into this so unmanaged
  // fields (labels, extra annotations, clusterIP, sessionAffinity…) are kept.
  const [original, setOriginal] = useState<Record<string, unknown> | null>(null);
  const [loadingEdit, setLoadingEdit] = useState(isEdit);
  // MetalLB address pools (one per VLAN / external network) for LoadBalancer type.
  const [pools, setPools] = useState<string[]>([]);
  const [addressPool, setAddressPool] = useState("");
  const [lbIP, setLbIP] = useState("");

  useEffect(() => {
    listCRDInstances("metallb.io", "v1beta1", "ipaddresspools")
      .then((items) => setPools(items.map((i) => String((i as { metadata?: { name?: string } }).metadata?.name || "")).filter(Boolean)))
      .catch(() => setPools([]));
  }, []);

  // Load and pre-fill the live Service when editing.
  useEffect(() => {
    if (!editTarget) return;
    let cancelled = false;
    getResourceYAML("Service", editTarget.namespace, editTarget.name)
      .then((obj) => {
        if (cancelled) return;
        setOriginal(obj);
        const spec = (obj.spec || {}) as Record<string, unknown>;
        const meta = (obj.metadata || {}) as Record<string, unknown>;
        setServiceType(String(spec.type || "ClusterIP"));
        const sel = (spec.selector || {}) as Record<string, string>;
        const selEntries = Object.entries(sel).map(([key, value]) => ({ key, value }));
        setSelectorLabels(selEntries.length ? selEntries : [{ key: "", value: "" }]);
        const specPorts = (spec.ports || []) as Record<string, unknown>[];
        setPorts(specPorts.length ? specPorts.map((p) => ({
          name: String(p.name || ""),
          port: String(p.port ?? ""),
          targetPort: p.targetPort != null ? String(p.targetPort) : "",
          nodePort: p.nodePort != null ? String(p.nodePort) : "",
          protocol: String(p.protocol || "TCP"),
        })) : [{ name: "", port: "", targetPort: "", nodePort: "", protocol: "TCP" }]);
        const ann = (meta.annotations || {}) as Record<string, string>;
        setAddressPool(ann["metallb.universe.tf/address-pool"] || "");
        setLbIP(ann["metallb.universe.tf/loadBalancerIPs"] || "");
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => !cancelled && setLoadingEdit(false));
    return () => { cancelled = true; };
  }, [editTarget]);

  const addSelectorLabel = () => setSelectorLabels([...selectorLabels, { key: "", value: "" }]);
  const removeSelectorLabel = (idx: number) => setSelectorLabels(selectorLabels.filter((_, i) => i !== idx));
  const updateSelectorLabel = (idx: number, field: "key" | "value", val: string) => {
    const updated = [...selectorLabels];
    updated[idx] = { ...updated[idx], [field]: val };
    setSelectorLabels(updated);
  };

  const addPort = () => setPorts([...ports, { name: "", port: "", targetPort: "", nodePort: "", protocol: "TCP" }]);
  const removePort = (idx: number) => setPorts(ports.filter((_, i) => i !== idx));
  const updatePort = (idx: number, field: keyof PortEntry, val: string) => {
    const updated = [...ports];
    updated[idx] = { ...updated[idx], [field]: val };
    setPorts(updated);
  };

  const buildSelector = () => {
    const selector: Record<string, string> = {};
    for (const l of selectorLabels) {
      if (l.key.trim()) selector[l.key.trim()] = l.value.trim();
    }
    return selector;
  };

  const buildPortSpecs = () =>
    ports
      .filter((p) => p.port)
      .map((p) => {
        const spec: Record<string, unknown> = { port: parseInt(p.port, 10), protocol: p.protocol };
        if (p.name.trim()) spec.name = p.name.trim();
        if (p.targetPort.trim()) {
          const parsed = parseInt(p.targetPort, 10);
          spec.targetPort = isNaN(parsed) ? p.targetPort.trim() : parsed;
        }
        if (serviceType === "NodePort" && p.nodePort.trim()) {
          spec.nodePort = parseInt(p.nodePort, 10);
        }
        return spec;
      });

  const poolAnnotations = () => {
    // MetalLB steers a LoadBalancer to a specific pool (VLAN/network) or IP.
    const annotations: Record<string, string> = {};
    if (serviceType === "LoadBalancer") {
      if (addressPool) annotations["metallb.universe.tf/address-pool"] = addressPool;
      if (lbIP.trim()) annotations["metallb.universe.tf/loadBalancerIPs"] = lbIP.trim();
    }
    return annotations;
  };

  const buildManifest = () => {
    const selector = buildSelector();
    const annotations = poolAnnotations();
    return {
      apiVersion: "v1",
      kind: "Service",
      metadata: {
        name: name.trim(),
        namespace: namespace.trim(),
        ...(Object.keys(annotations).length > 0 ? { annotations } : {}),
      },
      spec: {
        type: serviceType,
        ...(Object.keys(selector).length > 0 ? { selector } : {}),
        ports: buildPortSpecs(),
      },
    };
  };

  // Merge form fields into the live object so nothing the form doesn't manage
  // (labels, other annotations, clusterIP, sessionAffinity, …) is dropped.
  const buildEditManifest = () => {
    const obj = JSON.parse(JSON.stringify(original || {})) as Record<string, any>;
    obj.spec = obj.spec || {};
    obj.spec.type = serviceType;
    const selector = buildSelector();
    if (Object.keys(selector).length) obj.spec.selector = selector; else delete obj.spec.selector;
    obj.spec.ports = buildPortSpecs();
    obj.metadata = obj.metadata || {};
    const ann: Record<string, string> = { ...(obj.metadata.annotations || {}) };
    delete ann["metallb.universe.tf/address-pool"];
    delete ann["metallb.universe.tf/loadBalancerIPs"];
    Object.assign(ann, poolAnnotations());
    if (Object.keys(ann).length) obj.metadata.annotations = ann; else delete obj.metadata.annotations;
    return obj;
  };

  const generateYAML = () => jsYaml.dump(isEdit ? buildEditManifest() : buildManifest(), { noRefs: true });

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const yaml = yamlMode ? yamlValue : generateYAML();
      if (isEdit && editTarget) {
        await updateResourceYAML("Service", editTarget.namespace, editTarget.name, yaml);
        toast.success(isEdit ? "Service updated" : "Service created"); onCreated?.();
        return;
      }
      await applyManifest(yaml);
      toast.success(isEdit ? "Service updated" : "Service created"); onCreated?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass =
    "w-full px-3 py-2 bg-th-subtle border border-th-line rounded-lg text-sm text-th-body placeholder:text-th-ghost focus:outline-none focus:ring-1 focus:ring-th-accent";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div role="dialog" aria-modal="true" className="bg-th-panel border border-th-line rounded-xl shadow-card w-full max-w-2xl max-h-[85vh] flex flex-col m-4">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-th-line">
          <h2 className="text-lg font-semibold text-th-heading">{title || (isEdit ? "Edit Service" : "Create Service")}</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setYamlMode(!yamlMode);
                if (!yamlMode) setYamlValue(generateYAML());
              }}
              className="px-2 py-1 text-xs bg-th-subtle border border-th-line rounded text-th-body hover:opacity-80"
            >
              {yamlMode ? "Form" : "YAML"}
            </button>
            <button onClick={onClose} aria-label="Close dialog" className="text-th-dim hover:text-th-body">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {error && <div className="p-3 bg-th-danger-s text-th-danger rounded-lg text-sm">{error}</div>}

          {loadingEdit ? (
            <div className="flex items-center justify-center py-16"><div className="w-6 h-6 border-2 border-th-accent border-t-transparent rounded-full animate-spin" /></div>
          ) : yamlMode ? (
            <YAMLEditor value={yamlValue} onChange={setYamlValue} height="400px" />
          ) : (
            <>
              <FormField label="Name" required>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="my-service"
                  disabled={isEdit}
                  className={inputClass + (isEdit ? " opacity-60 cursor-not-allowed" : "")}
                />
              </FormField>

              <FormField label="Namespace">
                <input
                  type="text"
                  value={namespace}
                  onChange={(e) => setNamespace(e.target.value)}
                  placeholder="default"
                  disabled={isEdit}
                  className={inputClass + (isEdit ? " opacity-60 cursor-not-allowed" : "")}
                />
              </FormField>

              <FormField label="Type">
                <div className="flex gap-1">
                  {SERVICE_TYPES.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setServiceType(t)}
                      className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                        serviceType === t
                          ? "bg-th-accent text-white border-th-accent"
                          : "bg-th-subtle text-th-body border-th-line hover:bg-th-hover"
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </FormField>

              {serviceType === "LoadBalancer" && (
                <FormField label="Address Pool" description="Which MetalLB pool (VLAN / external network) this LoadBalancer draws its IP from">
                  {pools.length > 0 ? (
                    <select value={addressPool} onChange={(e) => setAddressPool(e.target.value)} className={inputClass}>
                      <option value="">Auto (default pool)</option>
                      {pools.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  ) : (
                    <p className="text-xs text-th-ghost">
                      No MetalLB address pools found. Create one per VLAN/network under Networking → L2 Networks, then reopen this dialog.
                    </p>
                  )}
                  <input
                    type="text"
                    value={lbIP}
                    onChange={(e) => setLbIP(e.target.value)}
                    placeholder="Specific IP (optional, must be in the pool's range)"
                    className={inputClass + " mt-2"}
                  />
                </FormField>
              )}

              <FormField label="Selector Labels" description="Labels used to select target pods">
                <div className="space-y-2">
                  {selectorLabels.map((label, idx) => (
                    <div key={idx} className="flex gap-2 items-center">
                      <input
                        type="text"
                        value={label.key}
                        onChange={(e) => updateSelectorLabel(idx, "key", e.target.value)}
                        placeholder="key"
                        className={inputClass}
                      />
                      <span className="text-th-dim">=</span>
                      <input
                        type="text"
                        value={label.value}
                        onChange={(e) => updateSelectorLabel(idx, "value", e.target.value)}
                        placeholder="value"
                        className={inputClass}
                      />
                      <button
                        type="button"
                        onClick={() => removeSelectorLabel(idx)}
                        className="px-2 py-1 text-xs text-th-danger hover:opacity-80 shrink-0"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={addSelectorLabel}
                    className="px-3 py-1 text-xs bg-th-subtle border border-th-line rounded text-th-body hover:opacity-80"
                  >
                    + Add Label
                  </button>
                </div>
              </FormField>

              <FormField label="Ports" required>
                <div className="space-y-3">
                  {ports.map((port, idx) => (
                    <div key={idx} className="bg-th-subtle border border-th-line rounded-lg p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-th-dim">Port {idx + 1}</span>
                        {ports.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removePort(idx)}
                            className="px-2 py-0.5 text-xs text-th-danger hover:opacity-80"
                          >
                            Remove
                          </button>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-xs text-th-dim">Name</label>
                          <input
                            type="text"
                            value={port.name}
                            onChange={(e) => updatePort(idx, "name", e.target.value)}
                            placeholder="http"
                            className={inputClass}
                          />
                        </div>
                        <div>
                          <label className="text-xs text-th-dim">Protocol</label>
                          <select
                            value={port.protocol}
                            onChange={(e) => updatePort(idx, "protocol", e.target.value)}
                            className={inputClass}
                          >
                            <option value="TCP">TCP</option>
                            <option value="UDP">UDP</option>
                          </select>
                        </div>
                        <div>
                          <label className="text-xs text-th-dim">Port</label>
                          <input
                            type="number"
                            value={port.port}
                            onChange={(e) => updatePort(idx, "port", e.target.value)}
                            placeholder="80"
                            className={inputClass}
                          />
                        </div>
                        <div>
                          <label className="text-xs text-th-dim">Target Port</label>
                          <input
                            type="text"
                            value={port.targetPort}
                            onChange={(e) => updatePort(idx, "targetPort", e.target.value)}
                            placeholder="8080"
                            className={inputClass}
                          />
                        </div>
                        {serviceType === "NodePort" && (
                          <div className="col-span-2">
                            <label className="text-xs text-th-dim">Node Port</label>
                            <input
                              type="number"
                              value={port.nodePort}
                              onChange={(e) => updatePort(idx, "nodePort", e.target.value)}
                              placeholder="30000-32767 (optional)"
                              className={inputClass}
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={addPort}
                    className="px-3 py-1 text-xs bg-th-subtle border border-th-line rounded text-th-body hover:opacity-80"
                  >
                    + Add Port
                  </button>
                </div>
              </FormField>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-th-line">
          <button onClick={onClose} className="px-4 py-2 text-sm text-th-dim hover:text-th-body">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || loadingEdit || !name.trim()}
            className="px-4 py-2 text-sm bg-th-accent text-white rounded-lg hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? (isEdit ? "Saving..." : "Creating...") : isEdit ? "Save changes" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
