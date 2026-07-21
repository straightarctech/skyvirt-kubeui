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

export default function CreateHPAModal({ onClose, onCreated, defaultNamespace }: Props) {
  const [name, setName] = useState("");
  const [namespace, setNamespace] = useState(defaultNamespace || "default");
  const [targetKind, setTargetKind] = useState("Deployment");
  const [targetName, setTargetName] = useState("");
  const [minReplicas, setMinReplicas] = useState("1");
  const [maxReplicas, setMaxReplicas] = useState("10");
  const [cpuTarget, setCpuTarget] = useState("80");
  const [memoryTarget, setMemoryTarget] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const toast = useToast();
  useEscToClose(!submitting, onClose);
  const [error, setError] = useState<string | null>(null);
  const [yamlMode, setYamlMode] = useState(false);
  const [yamlValue, setYamlValue] = useState("");

  const buildManifest = () => {
    const metrics: Record<string, unknown>[] = [];

    if (cpuTarget.trim()) {
      metrics.push({
        type: "Resource",
        resource: {
          name: "cpu",
          target: {
            type: "Utilization",
            averageUtilization: parseInt(cpuTarget, 10),
          },
        },
      });
    }

    if (memoryTarget.trim()) {
      metrics.push({
        type: "Resource",
        resource: {
          name: "memory",
          target: {
            type: "Utilization",
            averageUtilization: parseInt(memoryTarget, 10),
          },
        },
      });
    }

    const spec: Record<string, unknown> = {
      scaleTargetRef: {
        apiVersion: "apps/v1",
        kind: targetKind,
        name: targetName.trim(),
      },
      minReplicas: parseInt(minReplicas, 10) || 1,
      maxReplicas: parseInt(maxReplicas, 10) || 10,
    };

    if (metrics.length > 0) {
      spec.metrics = metrics;
    }

    return {
      apiVersion: "autoscaling/v2",
      kind: "HorizontalPodAutoscaler",
      metadata: {
        name: name.trim(),
        namespace: namespace.trim(),
      },
      spec,
    };
  };

  const generateYAML = () => jsYaml.dump(buildManifest(), { noRefs: true });

  const handleSubmit = async () => {
    const min = parseInt(minReplicas, 10) || 1;
    const max = parseInt(maxReplicas, 10) || 10;
    if (!yamlMode && min > max) {
      setError(`Min replicas (${min}) cannot exceed max replicas (${max})`);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const yaml = yamlMode ? yamlValue : generateYAML();
      await applyManifest(yaml);
      toast.success("HorizontalPodAutoscaler created"); onCreated?.();
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
          <h2 className="text-lg font-semibold text-th-heading">Create HorizontalPodAutoscaler</h2>
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
                  placeholder="my-hpa"
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

              <FormField label="Target Kind">
                <div className="flex gap-1">
                  {["Deployment", "StatefulSet"].map((kind) => (
                    <button
                      key={kind}
                      type="button"
                      onClick={() => setTargetKind(kind)}
                      className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                        targetKind === kind
                          ? "bg-th-accent text-white border-th-accent"
                          : "bg-th-subtle text-th-body border-th-line hover:bg-th-hover"
                      }`}
                    >
                      {kind}
                    </button>
                  ))}
                </div>
              </FormField>

              <FormField label="Target Name" required description={`Name of the ${targetKind} to scale`}>
                <input
                  type="text"
                  value={targetName}
                  onChange={(e) => setTargetName(e.target.value)}
                  placeholder="my-deployment"
                  className={inputClass}
                />
              </FormField>

              <div className="grid grid-cols-2 gap-4">
                <FormField label="Min Replicas">
                  <input
                    type="number"
                    value={minReplicas}
                    onChange={(e) => setMinReplicas(e.target.value)}
                    min="1"
                    placeholder="1"
                    className={inputClass}
                  />
                </FormField>
                <FormField label="Max Replicas">
                  <input
                    type="number"
                    value={maxReplicas}
                    onChange={(e) => setMaxReplicas(e.target.value)}
                    min="1"
                    placeholder="10"
                    className={inputClass}
                  />
                </FormField>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField label="CPU Target %" description="Optional. Average CPU utilization target.">
                  <input
                    type="number"
                    value={cpuTarget}
                    onChange={(e) => setCpuTarget(e.target.value)}
                    min="1"
                    max="100"
                    placeholder="80"
                    className={inputClass}
                  />
                </FormField>
                <FormField label="Memory Target %" description="Optional. Average memory utilization target.">
                  <input
                    type="number"
                    value={memoryTarget}
                    onChange={(e) => setMemoryTarget(e.target.value)}
                    min="1"
                    max="100"
                    placeholder="(none)"
                    className={inputClass}
                  />
                </FormField>
              </div>
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
            disabled={submitting || !name.trim() || !targetName}
            className="px-4 py-2 text-sm bg-th-accent text-white rounded-lg hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? "Creating..." : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
