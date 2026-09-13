import { useState, useEffect } from "react";
import { useToast } from "@/components/Toast";
import { useEscToClose } from "@/hooks/useEscToClose";
import jsYaml from "js-yaml";
import { applyManifest, getResourceYAML, updateResourceYAML } from "@/api/client";

interface Entry {
  key: string;
  value: string;
}

interface Props {
  onClose: () => void;
  onSaved: () => void;
  namespaces: string[];
  defaultNamespace?: string;
  /** When set, edit the existing ConfigMap: load it, pre-fill data, merge on save. */
  editTarget?: { namespace: string; name: string };
}

/**
 * Create or edit a ConfigMap's data entries. In edit mode it loads the live
 * object, pre-fills the key/value pairs, and merges the edited data back into
 * the original on save (preserving labels, annotations, and binaryData).
 */
export default function ConfigMapModal({ onClose, onSaved, namespaces, defaultNamespace, editTarget }: Props) {
  const isEdit = !!editTarget;
  const [name, setName] = useState(editTarget?.name || "");
  const [namespace, setNamespace] = useState(editTarget?.namespace || defaultNamespace || "default");
  const [entries, setEntries] = useState<Entry[]>([{ key: "", value: "" }]);
  const [original, setOriginal] = useState<Record<string, unknown> | null>(null);
  const [loadingEdit, setLoadingEdit] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  useEscToClose(!saving, onClose);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editTarget) return;
    let cancelled = false;
    getResourceYAML("ConfigMap", editTarget.namespace, editTarget.name)
      .then((obj) => {
        if (cancelled) return;
        setOriginal(obj);
        const data = (obj.data || {}) as Record<string, string>;
        const es = Object.entries(data).map(([key, value]) => ({ key, value: String(value) }));
        setEntries(es.length ? es : [{ key: "", value: "" }]);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => !cancelled && setLoadingEdit(false));
    return () => { cancelled = true; };
  }, [editTarget]);

  const addEntry = () => setEntries((e) => [...e, { key: "", value: "" }]);
  const removeEntry = (idx: number) => setEntries((e) => e.filter((_, i) => i !== idx));
  const updateEntry = (idx: number, field: keyof Entry, val: string) =>
    setEntries((e) => e.map((en, i) => (i === idx ? { ...en, [field]: val } : en)));

  const collectData = () => {
    const data: Record<string, string> = {};
    for (const e of entries) if (e.key.trim()) data[e.key.trim()] = e.value;
    return data;
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const data = collectData();
      if (isEdit && editTarget) {
        const obj = JSON.parse(JSON.stringify(original || {})) as Record<string, any>;
        obj.data = data; // replace managed data; labels/annotations/binaryData preserved
        await updateResourceYAML("ConfigMap", editTarget.namespace, editTarget.name, jsYaml.dump(obj, { noRefs: true }));
      } else {
        const manifest = jsYaml.dump(
          { apiVersion: "v1", kind: "ConfigMap", metadata: { name: name.trim(), namespace: namespace.trim() }, data },
          { noRefs: true },
        );
        await applyManifest(manifest);
      }
      toast.success("ConfigMap saved"); onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const lockedCls = isEdit ? " opacity-60 cursor-not-allowed" : "";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={saving ? undefined : onClose} />
      <div role="dialog" aria-modal="true" className="relative bg-th-panel rounded-xl shadow-card w-full max-w-lg mx-4 max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between border-b border-th-line px-6 py-4">
          <h3 className="text-lg font-semibold text-th-heading">{isEdit ? "Edit ConfigMap" : "Create ConfigMap"}</h3>
          <button onClick={onClose} aria-label="Close dialog" className="text-th-dim hover:text-th-body">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="flex-1 overflow-auto px-6 py-4 space-y-4">
          {loadingEdit ? (
            <div className="flex items-center justify-center py-16"><div className="w-6 h-6 border-2 border-th-accent border-t-transparent rounded-full animate-spin" /></div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-th-dim mb-1">Name</label>
                  <input type="text" value={name} onChange={(e) => setName(e.target.value)} disabled={isEdit}
                    placeholder="my-config" autoFocus={!isEdit}
                    className={"w-full px-3 py-2 bg-th-subtle border border-th-line rounded-lg text-sm text-th-body focus:outline-none focus:ring-1 focus:ring-th-accent" + lockedCls} />
                </div>
                <div>
                  <label className="block text-xs text-th-dim mb-1">Namespace</label>
                  <select value={namespace} onChange={(e) => setNamespace(e.target.value)} disabled={isEdit}
                    className={"w-full px-3 py-2 bg-th-subtle border border-th-line rounded-lg text-sm text-th-body focus:outline-none focus:ring-1 focus:ring-th-accent" + lockedCls}>
                    {namespaces.length === 0 && <option value={namespace}>{namespace}</option>}
                    {namespaces.map((ns) => <option key={ns} value={ns}>{ns}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-medium text-th-dim">Data Entries</label>
                  <button onClick={addEntry} className="text-xs text-th-accent hover:underline">+ Add Entry</button>
                </div>
                <div className="space-y-2">
                  {entries.map((entry, idx) => (
                    <div key={idx} className="flex gap-2 items-start">
                      <input type="text" placeholder="key" value={entry.key} onChange={(e) => updateEntry(idx, "key", e.target.value)}
                        className="w-1/3 px-2 py-1.5 bg-th-subtle border border-th-line rounded text-xs text-th-body focus:outline-none focus:ring-1 focus:ring-th-accent" />
                      <textarea placeholder="value" value={entry.value} onChange={(e) => updateEntry(idx, "value", e.target.value)} rows={2}
                        className="flex-1 px-2 py-1.5 bg-th-subtle border border-th-line rounded text-xs text-th-body font-mono focus:outline-none focus:ring-1 focus:ring-th-accent resize-y" />
                      {entries.length > 1 && (
                        <button onClick={() => removeEntry(idx)} className="text-th-danger hover:opacity-80 mt-1">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
              {error && <div className="p-2 bg-th-danger-s text-th-danger rounded text-xs">{error}</div>}
            </>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-th-line px-6 py-4">
          <button onClick={onClose} className="px-4 py-2 text-sm border border-th-line text-th-body rounded-lg hover:bg-th-hover">Cancel</button>
          <button onClick={handleSave} disabled={saving || loadingEdit || !name.trim()}
            className="px-4 py-2 text-sm bg-th-accent text-white rounded-lg hover:opacity-90 disabled:opacity-50">
            {saving ? (isEdit ? "Saving..." : "Creating...") : isEdit ? "Save changes" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
