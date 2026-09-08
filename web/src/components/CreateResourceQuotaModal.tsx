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

interface HardLimit {
  resource: string;
  value: string;
}

const RESOURCE_OPTIONS = [
  "pods",
  "requests.cpu",
  "requests.memory",
  "limits.cpu",
  "limits.memory",
  "configmaps",
  "secrets",
  "services",
  "persistentvolumeclaims",
];

export default function CreateResourceQuotaModal({ onClose, onCreated, defaultNamespace }: Props) {
  const [name, setName] = useState("");
  const [namespace, setNamespace] = useState(defaultNamespace || "default");
  const [hardLimits, setHardLimits] = useState<HardLimit[]>([{ resource: "pods", value: "10" }]);
  const [submitting, setSubmitting] = useState(false);
  const toast = useToast();
  useEscToClose(!submitting, onClose);
  const [error, setError] = useState<string | null>(null);
  const [yamlMode, setYamlMode] = useState(false);
  const [yamlValue, setYamlValue] = useState("");

  const addLimit = () => {
    const usedResources = new Set(hardLimits.map((l) => l.resource));
    const next = RESOURCE_OPTIONS.find((r) => !usedResources.has(r)) || RESOURCE_OPTIONS[0];
    setHardLimits([...hardLimits, { resource: next, value: "" }]);
  };

  const removeLimit = (idx: number) => setHardLimits(hardLimits.filter((_, i) => i !== idx));

  const updateLimit = (idx: number, field: keyof HardLimit, val: string) => {
    const updated = [...hardLimits];
    updated[idx] = { ...updated[idx], [field]: val };
    setHardLimits(updated);
  };

  const buildManifest = () => {
    const hard: Record<string, string> = {};
    for (const limit of hardLimits) {
      if (limit.resource.trim() && limit.value.trim()) {
        hard[limit.resource.trim()] = limit.value.trim();
      }
    }

    return {
      apiVersion: "v1",
      kind: "ResourceQuota",
      metadata: {
        name: name.trim(),
        namespace: namespace.trim(),
      },
      spec: {
        hard,
      },
    };
  };

  const generateYAML = () => jsYaml.dump(buildManifest(), { noRefs: true });

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const yaml = yamlMode ? yamlValue : generateYAML();
      await applyManifest(yaml);
      toast.success("ResourceQuota created"); onCreated?.();
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
          <h2 className="text-lg font-semibold text-th-heading">Create ResourceQuota</h2>
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
                  placeholder="my-quota"
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

              <FormField label="Hard Limits" required description="Resource limits for the namespace">
                <div className="space-y-2">
                  {hardLimits.map((limit, idx) => (
                    <div key={idx} className="flex gap-2 items-center">
                      <select
                        value={limit.resource}
                        onChange={(e) => updateLimit(idx, "resource", e.target.value)}
                        className={inputClass}
                      >
                        {RESOURCE_OPTIONS.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                      <span className="text-th-dim">=</span>
                      <input
                        type="text"
                        value={limit.value}
                        onChange={(e) => updateLimit(idx, "value", e.target.value)}
                        placeholder="e.g. 10, 4, 8Gi"
                        className={inputClass}
                      />
                      <button
                        type="button"
                        onClick={() => removeLimit(idx)}
                        className="px-2 py-1 text-xs text-th-danger hover:opacity-80 shrink-0"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={addLimit}
                    className="px-3 py-1 text-xs bg-th-subtle border border-th-line rounded text-th-body hover:opacity-80"
                  >
                    + Add Limit
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
