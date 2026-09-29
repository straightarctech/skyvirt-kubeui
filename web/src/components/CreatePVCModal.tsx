import { useState, useEffect } from "react";
import { useToast } from "@/components/Toast";
import { useEscToClose } from "@/hooks/useEscToClose";
import jsYaml from "js-yaml";
import FormField from "@/components/FormField";
import YAMLEditor from "@/components/YAMLEditor";
import { applyManifest, listStorageClasses } from "@/api/client";
import type { StorageClassSummary } from "@/api/client";

interface Props {
  onClose: () => void;
  onCreated?: () => void;
  defaultNamespace?: string;
}

const ACCESS_MODES = [
  { label: "RWO", value: "ReadWriteOnce", description: "Read/Write by one node" },
  { label: "ROX", value: "ReadOnlyMany", description: "Read-only by many nodes" },
  { label: "RWX", value: "ReadWriteMany", description: "Read/Write by many nodes" },
] as const;

export default function CreatePVCModal({ onClose, onCreated, defaultNamespace }: Props) {
  const [name, setName] = useState("");
  const [namespace, setNamespace] = useState(defaultNamespace || "default");
  const [storageClass, setStorageClass] = useState("");
  const [accessMode, setAccessMode] = useState("ReadWriteOnce");
  const [capacity, setCapacity] = useState("10Gi");
  const [storageClasses, setStorageClasses] = useState<StorageClassSummary[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const toast = useToast();
  useEscToClose(!submitting, onClose);
  const [error, setError] = useState<string | null>(null);
  const [yamlMode, setYamlMode] = useState(false);
  const [yamlValue, setYamlValue] = useState("");

  useEffect(() => {
    listStorageClasses()
      .then(setStorageClasses)
      .catch(() => {});
  }, []);

  const buildManifest = () => {
    const spec: Record<string, unknown> = {
      accessModes: [accessMode],
      resources: {
        requests: {
          storage: capacity.trim(),
        },
      },
    };

    if (storageClass.trim()) {
      spec.storageClassName = storageClass.trim();
    }

    return {
      apiVersion: "v1",
      kind: "PersistentVolumeClaim",
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
      toast.success("PersistentVolumeClaim created"); onCreated?.();
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
          <h2 className="text-lg font-semibold text-th-heading">Create PersistentVolumeClaim</h2>
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
                  placeholder="my-pvc"
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

              <FormField label="Storage Class" description="Leave empty for default storage class">
                {storageClasses.length > 0 ? (
                  <select
                    value={storageClass}
                    onChange={(e) => setStorageClass(e.target.value)}
                    className={inputClass}
                  >
                    <option value="">(default)</option>
                    {storageClasses.map((sc) => (
                      <option key={sc.name} value={sc.name}>
                        {sc.name} ({sc.provisioner}){sc.is_default ? " - default" : ""}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={storageClass}
                    onChange={(e) => setStorageClass(e.target.value)}
                    placeholder="standard"
                    className={inputClass}
                  />
                )}
              </FormField>

              <FormField label="Access Mode">
                <div className="flex gap-1">
                  {ACCESS_MODES.map((mode) => (
                    <button
                      key={mode.value}
                      type="button"
                      onClick={() => setAccessMode(mode.value)}
                      className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                        accessMode === mode.value
                          ? "bg-th-accent text-white border-th-accent"
                          : "bg-th-subtle text-th-body border-th-line hover:bg-th-hover"
                      }`}
                      title={mode.description}
                    >
                      {mode.label}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-th-dim mt-1">
                  {ACCESS_MODES.find((m) => m.value === accessMode)?.description}
                </p>
              </FormField>

              <FormField label="Capacity" required description="Storage size (e.g. 1Gi, 500Mi, 100Gi)">
                <input
                  type="text"
                  value={capacity}
                  onChange={(e) => setCapacity(e.target.value)}
                  placeholder="10Gi"
                  className={inputClass}
                />
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
            disabled={submitting || !name.trim() || !capacity}
            className="px-4 py-2 text-sm bg-th-accent text-white rounded-lg hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? "Creating..." : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
