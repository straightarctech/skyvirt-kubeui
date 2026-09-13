import { useState, useEffect } from "react";
import { useToast } from "@/components/Toast";
import { useEscToClose } from "@/hooks/useEscToClose";
import jsYaml from "js-yaml";
import { getResourceYAML, updateResourceYAML } from "@/api/client";

interface Entry {
  key: string;
  value: string; // decoded text, OR raw base64 when the value isn't UTF-8 text
  decoded: boolean; // false => value holds raw base64 (binary), passed through untouched
}

interface Props {
  namespace: string;
  name: string;
  onClose: () => void;
  onSaved: () => void;
}

// UTF-8-safe base64 (btoa/atob are latin1-only).
function encodeB64(text: string): string {
  return btoa(unescape(encodeURIComponent(text)));
}
function tryDecodeB64(b64: string): { text: string; ok: boolean } {
  try {
    return { text: decodeURIComponent(escape(atob(b64))), ok: true };
  } catch {
    return { text: b64, ok: false };
  }
}

/**
 * Edit a Secret's data as key/value pairs. Values are base64-decoded for display
 * and re-encoded on save; values that aren't UTF-8 text (binary) are shown as
 * raw base64, flagged, and passed through untouched. Merges into the live object
 * so type, labels, annotations and unedited keys are preserved.
 */
export default function EditSecretModal({ namespace, name, onClose, onSaved }: Props) {
  const [original, setOriginal] = useState<Record<string, any> | null>(null);
  const [secretType, setSecretType] = useState("Opaque");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  useEscToClose(!saving, onClose);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getResourceYAML("Secret", namespace, name)
      .then((obj) => {
        if (cancelled) return;
        setOriginal(obj);
        setSecretType(String(obj.type || "Opaque"));
        const data = (obj.data || {}) as Record<string, string>;
        const es = Object.entries(data).map(([key, b64]) => {
          const { text, ok } = tryDecodeB64(String(b64));
          return { key, value: text, decoded: ok };
        });
        setEntries(es.length ? es : [{ key: "", value: "", decoded: true }]);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [namespace, name]);

  const addEntry = () => setEntries((e) => [...e, { key: "", value: "", decoded: true }]);
  const removeEntry = (idx: number) => setEntries((e) => e.filter((_, i) => i !== idx));
  const updateEntry = (idx: number, field: "key" | "value", val: string) =>
    setEntries((e) => e.map((en, i) => (i === idx ? { ...en, [field]: val } : en)));

  const handleSave = async () => {
    if (!original) return;
    setSaving(true);
    setError(null);
    try {
      const data: Record<string, string> = {};
      for (const e of entries) {
        if (!e.key.trim()) continue;
        // Binary (undecodable) values keep their raw base64; text values are re-encoded.
        data[e.key.trim()] = e.decoded ? encodeB64(e.value) : e.value;
      }
      const obj = JSON.parse(JSON.stringify(original)) as Record<string, any>;
      obj.data = data; // replace managed data; type/labels/annotations/stringData preserved
      await updateResourceYAML("Secret", namespace, name, jsYaml.dump(obj, { noRefs: true }));
      toast.success("Secret updated"); onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={saving ? undefined : onClose} />
      <div role="dialog" aria-modal="true" className="relative bg-th-panel rounded-xl shadow-card w-full max-w-lg mx-4 max-h-[82vh] flex flex-col">
        <div className="flex items-center justify-between border-b border-th-line px-6 py-4">
          <h3 className="text-lg font-semibold text-th-heading">Edit Secret · <span className="text-th-dim font-normal">{namespace}/{name}</span></h3>
          <button onClick={onClose} aria-label="Close dialog" className="text-th-dim hover:text-th-body">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="flex-1 overflow-auto px-6 py-4 space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-16"><div className="w-6 h-6 border-2 border-th-accent border-t-transparent rounded-full animate-spin" /></div>
          ) : (
            <>
              <div className="text-xs text-th-dim">Type: <span className="font-mono text-th-body">{secretType}</span> · values are stored base64-encoded</div>
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
                      <div className="flex-1">
                        <textarea placeholder="value" value={entry.value} onChange={(e) => updateEntry(idx, "value", e.target.value)} rows={2}
                          className="w-full px-2 py-1.5 bg-th-subtle border border-th-line rounded text-xs text-th-body font-mono focus:outline-none focus:ring-1 focus:ring-th-accent resize-y" />
                        {!entry.decoded && <p className="mt-0.5 text-[10px] text-th-warn">binary — shown as base64, passed through unless changed</p>}
                      </div>
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
          <button onClick={handleSave} disabled={saving || loading} className="px-4 py-2 text-sm bg-th-accent text-white rounded-lg hover:opacity-90 disabled:opacity-50">
            {saving ? "Saving..." : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
