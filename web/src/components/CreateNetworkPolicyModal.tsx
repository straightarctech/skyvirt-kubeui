import { useState } from "react";
import { useToast } from "@/components/Toast";
import { useEscToClose } from "@/hooks/useEscToClose";
import jsYaml from "js-yaml";
import FormField from "@/components/FormField";
import YAMLEditor from "@/components/YAMLEditor";
import { applyManifest } from "@/api/client";

interface Props {
  onClose: () => void;
  onCreated?: () => void;
  defaultNamespace?: string;
}

interface LabelEntry {
  key: string;
  value: string;
}

interface PolicyPort {
  port: string;
  protocol: string;
}

interface IngressRule {
  podSelector: LabelEntry[];
  namespaceSelector: LabelEntry[];
  cidr: string;
  ports: PolicyPort[];
}

interface EgressRule {
  podSelector: LabelEntry[];
  namespaceSelector: LabelEntry[];
  cidr: string;
  ports: PolicyPort[];
}

function labelsToMap(labels: LabelEntry[]): Record<string, string> | undefined {
  const map: Record<string, string> = {};
  let count = 0;
  for (const l of labels) {
    if (l.key.trim()) {
      map[l.key.trim()] = l.value.trim();
      count++;
    }
  }
  return count > 0 ? map : undefined;
}

export default function CreateNetworkPolicyModal({ onClose, onCreated, defaultNamespace }: Props) {
  const [name, setName] = useState("");
  const [namespace, setNamespace] = useState(defaultNamespace || "default");
  const [podSelector, setPodSelector] = useState<LabelEntry[]>([{ key: "", value: "" }]);
  const [enableIngress, setEnableIngress] = useState(true);
  const [enableEgress, setEnableEgress] = useState(false);
  const [ingressRules, setIngressRules] = useState<IngressRule[]>([
    { podSelector: [{ key: "", value: "" }], namespaceSelector: [], cidr: "", ports: [{ port: "", protocol: "TCP" }] },
  ]);
  const [egressRules, setEgressRules] = useState<EgressRule[]>([
    { podSelector: [{ key: "", value: "" }], namespaceSelector: [], cidr: "", ports: [{ port: "", protocol: "TCP" }] },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const toast = useToast();
  useEscToClose(!submitting, onClose);
  const [error, setError] = useState<string | null>(null);
  const [yamlMode, setYamlMode] = useState(false);
  const [yamlValue, setYamlValue] = useState("");

  // Pod selector helpers
  const addPodSelectorLabel = () => setPodSelector([...podSelector, { key: "", value: "" }]);
  const removePodSelectorLabel = (idx: number) => setPodSelector(podSelector.filter((_, i) => i !== idx));
  const updatePodSelectorLabel = (idx: number, field: "key" | "value", val: string) => {
    const updated = [...podSelector];
    updated[idx] = { ...updated[idx], [field]: val };
    setPodSelector(updated);
  };

  // Ingress rule helpers
  const addIngressRule = () =>
    setIngressRules([
      ...ingressRules,
      { podSelector: [{ key: "", value: "" }], namespaceSelector: [], cidr: "", ports: [{ port: "", protocol: "TCP" }] },
    ]);
  const removeIngressRule = (idx: number) => setIngressRules(ingressRules.filter((_, i) => i !== idx));

  const updateIngressRulePodSelector = (rIdx: number, labels: LabelEntry[]) => {
    const updated = [...ingressRules];
    updated[rIdx] = { ...updated[rIdx], podSelector: labels };
    setIngressRules(updated);
  };

  const updateIngressRuleNsSelector = (rIdx: number, labels: LabelEntry[]) => {
    const updated = [...ingressRules];
    updated[rIdx] = { ...updated[rIdx], namespaceSelector: labels };
    setIngressRules(updated);
  };

  const updateIngressRuleCidr = (rIdx: number, cidr: string) => {
    const updated = [...ingressRules];
    updated[rIdx] = { ...updated[rIdx], cidr };
    setIngressRules(updated);
  };

  const updateIngressRulePorts = (rIdx: number, ports: PolicyPort[]) => {
    const updated = [...ingressRules];
    updated[rIdx] = { ...updated[rIdx], ports };
    setIngressRules(updated);
  };

  // Egress rule helpers
  const addEgressRule = () =>
    setEgressRules([
      ...egressRules,
      { podSelector: [{ key: "", value: "" }], namespaceSelector: [], cidr: "", ports: [{ port: "", protocol: "TCP" }] },
    ]);
  const removeEgressRule = (idx: number) => setEgressRules(egressRules.filter((_, i) => i !== idx));

  const updateEgressRulePodSelector = (rIdx: number, labels: LabelEntry[]) => {
    const updated = [...egressRules];
    updated[rIdx] = { ...updated[rIdx], podSelector: labels };
    setEgressRules(updated);
  };

  const updateEgressRuleNsSelector = (rIdx: number, labels: LabelEntry[]) => {
    const updated = [...egressRules];
    updated[rIdx] = { ...updated[rIdx], namespaceSelector: labels };
    setEgressRules(updated);
  };

  const updateEgressRuleCidr = (rIdx: number, cidr: string) => {
    const updated = [...egressRules];
    updated[rIdx] = { ...updated[rIdx], cidr };
    setEgressRules(updated);
  };

  const updateEgressRulePorts = (rIdx: number, ports: PolicyPort[]) => {
    const updated = [...egressRules];
    updated[rIdx] = { ...updated[rIdx], ports };
    setEgressRules(updated);
  };

  const buildPeerBlock = (rule: IngressRule | EgressRule) => {
    const from: Record<string, unknown>[] = [];
    const podSel = labelsToMap(rule.podSelector);
    const nsSel = labelsToMap(rule.namespaceSelector);

    if (podSel || nsSel) {
      const peer: Record<string, unknown> = {};
      if (podSel) peer.podSelector = { matchLabels: podSel };
      if (nsSel) peer.namespaceSelector = { matchLabels: nsSel };
      from.push(peer);
    }

    if (rule.cidr.trim()) {
      from.push({ ipBlock: { cidr: rule.cidr.trim() } });
    }

    return from;
  };

  const buildPortsBlock = (ports: PolicyPort[]) => {
    return ports
      .filter((p) => p.port.trim())
      .map((p) => ({
        port: parseInt(p.port, 10),
        protocol: p.protocol,
      }));
  };

  const buildManifest = () => {
    const policyTypes: string[] = [];
    if (enableIngress) policyTypes.push("Ingress");
    if (enableEgress) policyTypes.push("Egress");

    const podSel = labelsToMap(podSelector);

    const spec: Record<string, unknown> = {
      podSelector: podSel ? { matchLabels: podSel } : {},
      policyTypes,
    };

    if (enableIngress) {
      spec.ingress = ingressRules.map((rule) => {
        const entry: Record<string, unknown> = {};
        const from = buildPeerBlock(rule);
        if (from.length > 0) entry.from = from;
        const ports = buildPortsBlock(rule.ports);
        if (ports.length > 0) entry.ports = ports;
        return entry;
      });
    }

    if (enableEgress) {
      spec.egress = egressRules.map((rule) => {
        const entry: Record<string, unknown> = {};
        const to = buildPeerBlock(rule);
        if (to.length > 0) entry.to = to;
        const ports = buildPortsBlock(rule.ports);
        if (ports.length > 0) entry.ports = ports;
        return entry;
      });
    }

    return {
      apiVersion: "networking.k8s.io/v1",
      kind: "NetworkPolicy",
      metadata: {
        name: name.trim(),
        namespace: namespace.trim(),
      },
      spec,
    };
  };

  const generateYAML = () => jsYaml.dump(buildManifest(), { noRefs: true });

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const yaml = yamlMode ? yamlValue : generateYAML();
      await applyManifest(yaml);
      toast.success("NetworkPolicy created"); onCreated?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass =
    "w-full px-3 py-2 bg-th-subtle border border-th-line rounded-lg text-sm text-th-body placeholder:text-th-ghost focus:outline-none focus:ring-1 focus:ring-th-accent";

  const renderLabelEditor = (
    labels: LabelEntry[],
    setLabels: (labels: LabelEntry[]) => void,
    title: string,
  ) => (
    <div className="space-y-1">
      <span className="text-xs text-th-dim">{title}</span>
      {labels.map((l, i) => (
        <div key={i} className="flex gap-2 items-center">
          <input
            type="text"
            value={l.key}
            onChange={(e) => {
              const updated = [...labels];
              updated[i] = { ...updated[i], key: e.target.value };
              setLabels(updated);
            }}
            placeholder="key"
            className={inputClass}
          />
          <span className="text-th-dim">=</span>
          <input
            type="text"
            value={l.value}
            onChange={(e) => {
              const updated = [...labels];
              updated[i] = { ...updated[i], value: e.target.value };
              setLabels(updated);
            }}
            placeholder="value"
            className={inputClass}
          />
          <button
            type="button"
            onClick={() => setLabels(labels.filter((_, idx) => idx !== i))}
            className="px-1 text-xs text-th-danger hover:opacity-80 shrink-0"
          >
            X
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => setLabels([...labels, { key: "", value: "" }])}
        className="px-2 py-0.5 text-xs bg-th-panel border border-th-line rounded text-th-body hover:opacity-80"
      >
        + Add
      </button>
    </div>
  );

  const renderPortEditor = (ports: PolicyPort[], setPorts: (ports: PolicyPort[]) => void) => (
    <div className="space-y-1">
      <span className="text-xs text-th-dim">Ports</span>
      {ports.map((p, i) => (
        <div key={i} className="flex gap-2 items-center">
          <input
            type="number"
            value={p.port}
            onChange={(e) => {
              const updated = [...ports];
              updated[i] = { ...updated[i], port: e.target.value };
              setPorts(updated);
            }}
            placeholder="port"
            className={inputClass}
          />
          <select
            value={p.protocol}
            onChange={(e) => {
              const updated = [...ports];
              updated[i] = { ...updated[i], protocol: e.target.value };
              setPorts(updated);
            }}
            className={inputClass}
          >
            <option value="TCP">TCP</option>
            <option value="UDP">UDP</option>
          </select>
          <button
            type="button"
            onClick={() => setPorts(ports.filter((_, idx) => idx !== i))}
            className="px-1 text-xs text-th-danger hover:opacity-80 shrink-0"
          >
            X
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => setPorts([...ports, { port: "", protocol: "TCP" }])}
        className="px-2 py-0.5 text-xs bg-th-panel border border-th-line rounded text-th-body hover:opacity-80"
      >
        + Add Port
      </button>
    </div>
  );

  const renderRuleBlock = (
    type: "ingress" | "egress",
    rules: (IngressRule | EgressRule)[],
    removeRule: (idx: number) => void,
    updatePodSelector: (idx: number, labels: LabelEntry[]) => void,
    updateNsSelector: (idx: number, labels: LabelEntry[]) => void,
    updateCidr: (idx: number, cidr: string) => void,
    updatePorts: (idx: number, ports: PolicyPort[]) => void,
    addRule: () => void,
  ) => (
    <div className="space-y-3">
      {rules.map((rule, rIdx) => (
        <div key={rIdx} className="bg-th-subtle border border-th-line rounded-lg p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-th-dim">
              {type === "ingress" ? "Ingress" : "Egress"} Rule {rIdx + 1}
            </span>
            {rules.length > 1 && (
              <button
                type="button"
                onClick={() => removeRule(rIdx)}
                className="px-2 py-0.5 text-xs text-th-danger hover:opacity-80"
              >
                Remove
              </button>
            )}
          </div>
          {renderLabelEditor(
            rule.podSelector,
            (labels) => updatePodSelector(rIdx, labels),
            type === "ingress" ? "From Pod Selector" : "To Pod Selector",
          )}
          {renderLabelEditor(
            rule.namespaceSelector,
            (labels) => updateNsSelector(rIdx, labels),
            type === "ingress" ? "From Namespace Selector" : "To Namespace Selector",
          )}
          <div>
            <span className="text-xs text-th-dim">CIDR</span>
            <input
              type="text"
              value={rule.cidr}
              onChange={(e) => updateCidr(rIdx, e.target.value)}
              placeholder="10.0.0.0/8"
              className={inputClass}
            />
          </div>
          {renderPortEditor(rule.ports, (ports) => updatePorts(rIdx, ports))}
        </div>
      ))}
      <button
        type="button"
        onClick={addRule}
        className="px-3 py-1 text-xs bg-th-subtle border border-th-line rounded text-th-body hover:opacity-80"
      >
        + Add {type === "ingress" ? "Ingress" : "Egress"} Rule
      </button>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div role="dialog" aria-modal="true" className="bg-th-panel border border-th-line rounded-xl shadow-card w-full max-w-2xl max-h-[85vh] flex flex-col m-4">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-th-line">
          <h2 className="text-lg font-semibold text-th-heading">Create NetworkPolicy</h2>
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

          {yamlMode ? (
            <YAMLEditor value={yamlValue} onChange={setYamlValue} height="400px" />
          ) : (
            <>
              <FormField label="Name" required>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="my-network-policy"
                  className={inputClass}
                />
              </FormField>

              <FormField label="Namespace">
                <input
                  type="text"
                  value={namespace}
                  onChange={(e) => setNamespace(e.target.value)}
                  placeholder="default"
                  className={inputClass}
                />
              </FormField>

              <FormField label="Pod Selector" description="Select pods this policy applies to (empty = all pods)">
                <div className="space-y-2">
                  {podSelector.map((label, idx) => (
                    <div key={idx} className="flex gap-2 items-center">
                      <input
                        type="text"
                        value={label.key}
                        onChange={(e) => updatePodSelectorLabel(idx, "key", e.target.value)}
                        placeholder="key"
                        className={inputClass}
                      />
                      <span className="text-th-dim">=</span>
                      <input
                        type="text"
                        value={label.value}
                        onChange={(e) => updatePodSelectorLabel(idx, "value", e.target.value)}
                        placeholder="value"
                        className={inputClass}
                      />
                      <button
                        type="button"
                        onClick={() => removePodSelectorLabel(idx)}
                        className="px-2 py-1 text-xs text-th-danger hover:opacity-80 shrink-0"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={addPodSelectorLabel}
                    className="px-3 py-1 text-xs bg-th-subtle border border-th-line rounded text-th-body hover:opacity-80"
                  >
                    + Add Label
                  </button>
                </div>
              </FormField>

              <FormField label="Policy Types">
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 text-sm text-th-body cursor-pointer">
                    <input
                      type="checkbox"
                      checked={enableIngress}
                      onChange={(e) => setEnableIngress(e.target.checked)}
                      className="rounded border-th-line text-th-accent focus:ring-th-accent"
                    />
                    Ingress
                  </label>
                  <label className="flex items-center gap-2 text-sm text-th-body cursor-pointer">
                    <input
                      type="checkbox"
                      checked={enableEgress}
                      onChange={(e) => setEnableEgress(e.target.checked)}
                      className="rounded border-th-line text-th-accent focus:ring-th-accent"
                    />
                    Egress
                  </label>
                </div>
              </FormField>

              {enableIngress && (
                <FormField label="Ingress Rules" description="Define allowed incoming traffic">
                  {renderRuleBlock(
                    "ingress",
                    ingressRules,
                    removeIngressRule,
                    updateIngressRulePodSelector,
                    updateIngressRuleNsSelector,
                    updateIngressRuleCidr,
                    updateIngressRulePorts,
                    addIngressRule,
                  )}
                </FormField>
              )}

              {enableEgress && (
                <FormField label="Egress Rules" description="Define allowed outgoing traffic">
                  {renderRuleBlock(
                    "egress",
                    egressRules,
                    removeEgressRule,
                    updateEgressRulePodSelector,
                    updateEgressRuleNsSelector,
                    updateEgressRuleCidr,
                    updateEgressRulePorts,
                    addEgressRule,
                  )}
                </FormField>
              )}
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
            disabled={submitting || !name.trim()}
            className="px-4 py-2 text-sm bg-th-accent text-white rounded-lg hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? "Creating..." : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
