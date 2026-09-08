import { useState } from "react";
import YAMLEditor from "@/components/YAMLEditor";
import { applyManifest } from "@/api/client";
import { useToast } from "@/components/Toast";

interface CreateYAMLModalProps {
  title: string;
  template: string;
  onClose: () => void;
  onCreated?: () => void;
}

/**
 * Generic create-from-YAML modal seeded with a per-kind template.
 * Submits through the server-side apply endpoint, so it also works for
 * multi-document manifests and custom resources.
 */
export default function CreateYAMLModal({ title, template, onClose, onCreated }: CreateYAMLModalProps) {
  const toast = useToast();
  const [yaml, setYaml] = useState(template);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const results = await applyManifest(yaml);
      const summary = results.map((r) => `${r.kind}/${r.name} ${r.action}`).join(", ");
      toast.success("Applied", summary);
      onCreated?.();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-th-panel border border-th-line rounded-xl shadow-2xl w-full max-w-2xl p-6 space-y-4 mx-4" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold text-th-heading">{title}</h2>
        {error && <div className="p-2 bg-th-danger-s text-th-danger rounded text-sm break-words">{error}</div>}
        <YAMLEditor value={yaml} onChange={setYaml} height="380px" />
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm bg-th-subtle border border-th-line rounded-lg hover:bg-th-hover">Cancel</button>
          <button
            onClick={handleCreate}
            disabled={submitting || !yaml.trim()}
            className="px-4 py-2 text-sm bg-th-accent text-white rounded-lg hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? "Applying..." : "Apply"}
          </button>
        </div>
      </div>
    </div>
  );
}
