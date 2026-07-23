import { useState, useEffect } from "react";
import { useToast } from "@/components/Toast";
import { useEscToClose } from "@/hooks/useEscToClose";
import jsYaml from "js-yaml";
import FormField from "@/components/FormField";
import YAMLEditor from "@/components/YAMLEditor";
import { applyManifest, getResourceYAML, updateResourceYAML } from "@/api/client";

interface Props {
  onClose: () => void;
  onCreated?: () => void;
  defaultNamespace?: string;
  /** When set, edit the existing Ingress: load it, pre-fill, merge on save. */
  editTarget?: { namespace: string; name: string };
}

interface PathEntry {
  path: string;
  pathType: string;
  serviceName: string;
  servicePort: string;
}

interface RuleEntry {
  host: string;
  paths: PathEntry[];
}

interface TLSEntry {
  hosts: string;
  secretName: string;
}

export default function CreateIngressModal({ onClose, onCreated, defaultNamespace, editTarget }: Props) {
  const isEdit = !!editTarget;
  const [name, setName] = useState(editTarget?.name || "");
  const [namespace, setNamespace] = useState(editTarget?.namespace || defaultNamespace || "default");
  const [ingressClass, setIngressClass] = useState("");
  const [rules, setRules] = useState<RuleEntry[]>([
    {
      host: "",
      paths: [{ path: "/", pathType: "Prefix", serviceName: "", servicePort: "80" }],
    },
  ]);
  const [tlsEntries, setTlsEntries] = useState<TLSEntry[]>([]);
  const [original, setOriginal] = useState<Record<string, unknown> | null>(null);
  const [loadingEdit, setLoadingEdit] = useState(isEdit);
  const [submitting, setSubmitting] = useState(false);
  const toast = useToast();
  useEscToClose(!submitting, onClose);
  const [error, setError] = useState<string | null>(null);
  const [yamlMode, setYamlMode] = useState(false);
  const [yamlValue, setYamlValue] = useState("");

  // Load and pre-fill the live Ingress when editing.
  useEffect(() => {
    if (!editTarget) return;
    let cancelled = false;
    getResourceYAML("Ingress", editTarget.namespace, editTarget.name)
      .then((obj) => {
        if (cancelled) return;
        setOriginal(obj);
        const spec = (obj.spec || {}) as Record<string, any>;
        setIngressClass(String(spec.ingressClassName || ""));
        const specRules = (spec.rules || []) as Record<string, any>[];
        setRules(specRules.length ? specRules.map((r) => ({
          host: String(r.host || ""),
          paths: (((r.http || {}).paths || []) as Record<string, any>[]).map((p) => ({
            path: String(p.path || "/"),
            pathType: String(p.pathType || "Prefix"),
            serviceName: String(p.backend?.service?.name || ""),
            servicePort: String(p.backend?.service?.port?.number ?? p.backend?.service?.port?.name ?? "80"),
          })) || [{ path: "/", pathType: "Prefix", serviceName: "", servicePort: "80" }],
        })) : rules);
        const specTls = (spec.tls || []) as Record<string, any>[];
        setTlsEntries(specTls.map((t) => ({
          hosts: (t.hosts || []).join(", "),
          secretName: String(t.secretName || ""),
        })));
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => !cancelled && setLoadingEdit(false));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editTarget]);

  const addRule = () =>
    setRules([
      ...rules,
      { host: "", paths: [{ path: "/", pathType: "Prefix", serviceName: "", servicePort: "80" }] },
    ]);

  const removeRule = (idx: number) => setRules(rules.filter((_, i) => i !== idx));

  const updateRuleHost = (idx: number, host: string) => {
    const updated = [...rules];
    updated[idx] = { ...updated[idx], host };
    setRules(updated);
  };

  const addPath = (ruleIdx: number) => {
    const updated = [...rules];
    updated[ruleIdx] = {
      ...updated[ruleIdx],
      paths: [...updated[ruleIdx].paths, { path: "/", pathType: "Prefix", serviceName: "", servicePort: "80" }],
    };
    setRules(updated);
  };

  const removePath = (ruleIdx: number, pathIdx: number) => {
    const updated = [...rules];
    updated[ruleIdx] = {
      ...updated[ruleIdx],
      paths: updated[ruleIdx].paths.filter((_, i) => i !== pathIdx),
    };
    setRules(updated);
  };

  const updatePath = (ruleIdx: number, pathIdx: number, field: keyof PathEntry, val: string) => {
    const updated = [...rules];
    const paths = [...updated[ruleIdx].paths];
    paths[pathIdx] = { ...paths[pathIdx], [field]: val };
    updated[ruleIdx] = { ...updated[ruleIdx], paths };
    setRules(updated);
  };

  const addTLS = () => setTlsEntries([...tlsEntries, { hosts: "", secretName: "" }]);
  const removeTLS = (idx: number) => setTlsEntries(tlsEntries.filter((_, i) => i !== idx));
  const updateTLS = (idx: number, field: keyof TLSEntry, val: string) => {
    const updated = [...tlsEntries];
    updated[idx] = { ...updated[idx], [field]: val };
    setTlsEntries(updated);
  };

  const buildManifest = () => {
    const spec: Record<string, unknown> = {};

    if (ingressClass.trim()) {
      spec.ingressClassName = ingressClass.trim();
    }

    spec.rules = rules.map((r) => {
      const rule: Record<string, unknown> = {};
      if (r.host.trim()) rule.host = r.host.trim();
      rule.http = {
        paths: r.paths.map((p) => ({
          path: p.path.trim() || "/",
          pathType: p.pathType,
          backend: {
            service: {
              name: p.serviceName.trim(),
              port: {
                number: parseInt(p.servicePort, 10) || 80,
              },
            },
          },
        })),
      };
      return rule;
    });

    const tls = tlsEntries
      .filter((t) => t.hosts.trim() || t.secretName.trim())
      .map((t) => {
        const entry: Record<string, unknown> = {};
        if (t.hosts.trim()) {
          entry.hosts = t.hosts
            .split(",")
            .map((h) => h.trim())
            .filter(Boolean);
        }
        if (t.secretName.trim()) entry.secretName = t.secretName.trim();
        return entry;
      });

    if (tls.length > 0) spec.tls = tls;

    return {
      apiVersion: "networking.k8s.io/v1",
      kind: "Ingress",
      metadata: {
        name: name.trim(),
        namespace: namespace.trim(),
      },
      spec,
    };
  };

  // Merge form fields into the live object so anything the form doesn't manage
  // (labels, annotations, status) is preserved.
  const buildEditManifest = () => {
    const built = buildManifest();
    const obj = JSON.parse(JSON.stringify(original || {})) as Record<string, any>;
    obj.spec = { ...(obj.spec || {}), ...built.spec };
    if (!ingressClass.trim()) delete obj.spec.ingressClassName;
    if (!obj.spec.tls || obj.spec.tls.length === 0) delete obj.spec.tls;
    return obj;
  };

  const generateYAML = () => jsYaml.dump(isEdit ? buildEditManifest() : buildManifest(), { noRefs: true });

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const yaml = yamlMode ? yamlValue : generateYAML();
      if (isEdit && editTarget) {
        await updateResourceYAML("Ingress", editTarget.namespace, editTarget.name, yaml);
      } else {
        await applyManifest(yaml);
      }
      toast.success(isEdit ? "Ingress updated" : "Ingress created"); onCreated?.();
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
          <h2 className="text-lg font-semibold text-th-heading">{isEdit ? "Edit Ingress" : "Create Ingress"}</h2>
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
                  placeholder="my-ingress"
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

              <FormField label="Ingress Class" description="Optional ingress controller class name">
                <input
                  type="text"
                  value={ingressClass}
                  onChange={(e) => setIngressClass(e.target.value)}
                  placeholder="nginx"
                  className={inputClass}
                />
              </FormField>

              <FormField label="Rules" required>
                <div className="space-y-3">
                  {rules.map((rule, rIdx) => (
                    <div key={rIdx} className="bg-th-subtle border border-th-line rounded-lg p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-th-dim">Rule {rIdx + 1}</span>
                        {rules.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeRule(rIdx)}
                            className="px-2 py-0.5 text-xs text-th-danger hover:opacity-80"
                          >
                            Remove Rule
                          </button>
                        )}
                      </div>
                      <div>
                        <label className="text-xs text-th-dim">Host</label>
                        <input
                          type="text"
                          value={rule.host}
                          onChange={(e) => updateRuleHost(rIdx, e.target.value)}
                          placeholder="example.com"
                          className={inputClass}
                        />
                      </div>
                      <div className="space-y-2">
                        <span className="text-xs font-medium text-th-dim">Paths</span>
                        {rule.paths.map((p, pIdx) => (
                          <div key={pIdx} className="grid grid-cols-2 gap-2 bg-th-panel rounded p-2 border border-th-line">
                            <div>
                              <label className="text-xs text-th-dim">Path</label>
                              <input
                                type="text"
                                value={p.path}
                                onChange={(e) => updatePath(rIdx, pIdx, "path", e.target.value)}
                                placeholder="/"
                                className={inputClass}
                              />
                            </div>
                            <div>
                              <label className="text-xs text-th-dim">Path Type</label>
                              <select
                                value={p.pathType}
                                onChange={(e) => updatePath(rIdx, pIdx, "pathType", e.target.value)}
                                className={inputClass}
                              >
                                <option value="Prefix">Prefix</option>
                                <option value="Exact">Exact</option>
                                <option value="ImplementationSpecific">ImplementationSpecific</option>
                              </select>
                            </div>
                            <div>
                              <label className="text-xs text-th-dim">Service Name</label>
                              <input
                                type="text"
                                value={p.serviceName}
                                onChange={(e) => updatePath(rIdx, pIdx, "serviceName", e.target.value)}
                                placeholder="my-service"
                                className={inputClass}
                              />
                            </div>
                            <div className="flex items-end gap-2">
                              <div className="flex-1">
                                <label className="text-xs text-th-dim">Service Port</label>
                                <input
                                  type="number"
                                  value={p.servicePort}
                                  onChange={(e) => updatePath(rIdx, pIdx, "servicePort", e.target.value)}
                                  placeholder="80"
                                  className={inputClass}
                                />
                              </div>
                              {rule.paths.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => removePath(rIdx, pIdx)}
                                  className="px-2 py-2 text-xs text-th-danger hover:opacity-80 shrink-0"
                                >
                                  Remove
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                        <button
                          type="button"
                          onClick={() => addPath(rIdx)}
                          className="px-3 py-1 text-xs bg-th-panel border border-th-line rounded text-th-body hover:opacity-80"
                        >
                          + Add Path
                        </button>
                      </div>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={addRule}
                    className="px-3 py-1 text-xs bg-th-subtle border border-th-line rounded text-th-body hover:opacity-80"
                  >
                    + Add Rule
                  </button>
                </div>
              </FormField>

              <FormField label="TLS" description="Optional TLS configuration">
                <div className="space-y-2">
                  {tlsEntries.map((tls, idx) => (
                    <div key={idx} className="bg-th-subtle border border-th-line rounded-lg p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-th-dim">TLS {idx + 1}</span>
                        <button
                          type="button"
                          onClick={() => removeTLS(idx)}
                          className="px-2 py-0.5 text-xs text-th-danger hover:opacity-80"
                        >
                          Remove
                        </button>
                      </div>
                      <div>
                        <label className="text-xs text-th-dim">Hosts (comma-separated)</label>
                        <input
                          type="text"
                          value={tls.hosts}
                          onChange={(e) => updateTLS(idx, "hosts", e.target.value)}
                          placeholder="example.com, www.example.com"
                          className={inputClass}
                        />
                      </div>
                      <div>
                        <label className="text-xs text-th-dim">Secret Name</label>
                        <input
                          type="text"
                          value={tls.secretName}
                          onChange={(e) => updateTLS(idx, "secretName", e.target.value)}
                          placeholder="tls-secret"
                          className={inputClass}
                        />
                      </div>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={addTLS}
                    className="px-3 py-1 text-xs bg-th-subtle border border-th-line rounded text-th-body hover:opacity-80"
                  >
                    + Add TLS
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
            disabled={submitting || loadingEdit || !name.trim() || !rules.every((r) => r.paths.every((p) => p.serviceName.trim()))}
            className="px-4 py-2 text-sm bg-th-accent text-white rounded-lg hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? (isEdit ? "Saving..." : "Creating...") : isEdit ? "Save changes" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
