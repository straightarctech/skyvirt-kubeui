import { useState, useEffect } from "react";
import jsYaml from "js-yaml";
import YAMLEditor from "./YAMLEditor";
import { getResourceYAML, updateResourceYAML, getClusterResourceYAML, updateClusterResourceYAML } from "@/api/client";

interface EditYAMLModalProps {
  kind: string;
  namespace?: string;
  name: string;
  onClose: () => void;
  onUpdated?: () => void;
}

export default function EditYAMLModal({ kind, namespace, name, onClose, onUpdated }: EditYAMLModalProps) {
  const [yaml, setYaml] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const fetchFn = namespace ? getResourceYAML(kind, namespace, name) : getClusterResourceYAML(kind, name);
    fetchFn
      .then((data) => {
        if (!cancelled) {
          setYaml(jsYaml.dump(data, { indent: 2, lineWidth: -1, noRefs: true }));
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to fetch resource");
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [kind, namespace, name]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);

    try {
      if (namespace) {
        await updateResourceYAML(kind, namespace, name, yaml);
      } else {
        await updateClusterResourceYAML(kind, name, yaml);
      }
      onUpdated?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save resource");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={saving ? undefined : onClose} />

      {/* Modal card */}
      <div className="relative bg-th-panel rounded-lg shadow-card max-w-4xl w-full mx-4 max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-th-line px-6 py-4">
          <h2 className="text-lg font-semibold text-th-heading">
            Edit {kind}: {namespace ? `${namespace}/` : ""}{name}
          </h2>
          <button
            onClick={onClose}
            className="text-th-dim hover:text-th-body transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto px-6 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <span className="text-th-dim text-sm">Loading resource...</span>
            </div>
          ) : (
            <YAMLEditor
              value={yaml}
              onChange={setYaml}
              error={error}
              height="calc(85vh - 180px)"
            />
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-th-line px-6 py-4">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm border border-th-line rounded text-th-body hover:bg-th-hover transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || loading}
            className="px-4 py-2 text-sm rounded bg-th-accent text-white hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
