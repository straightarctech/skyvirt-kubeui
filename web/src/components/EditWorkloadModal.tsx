import { useState, useEffect } from "react";
import { useToast } from "@/components/Toast";
import { useEscToClose } from "@/hooks/useEscToClose";
import jsYaml from "js-yaml";
import { getResourceYAML, updateResourceYAML } from "@/api/client";

interface EnvVar {
  name: string;
  value: string;
}
interface ContainerEdit {
  name: string;
  image: string;
  env: EnvVar[];
}

interface Props {
  kind: string; // Deployment | StatefulSet | DaemonSet
  namespace: string;
  name: string;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Focused, merge-safe editor for the fields people actually change on a
 * workload: replica count and, per container, the image and simple (name/value)
 * env vars. It loads the live object, edits in place, and writes it back — so
 * probes, volumes, resources, affinity and everything else are preserved. For
 * anything deeper, the YAML editor remains available.
 */
export default function EditWorkloadModal({ kind, namespace, name, onClose, onSaved }: Props) {
  const [original, setOriginal] = useState<Record<string, any> | null>(null);
  const [replicas, setReplicas] = useState<number | null>(null);
  const [containers, setContainers] = useState<ContainerEdit[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  useEscToClose(!saving, onClose);
  const [error, setError] = useState<string | null>(null);

  const hasReplicas = kind === "Deployment" || kind === "StatefulSet";

  useEffect(() => {
    let cancelled = false;
    getResourceYAML(kind, namespace, name)
      .then((obj) => {
        if (cancelled) return;
        setOriginal(obj);
        const spec = (obj.spec || {}) as Record<string, any>;
        if (hasReplicas) setReplicas(typeof spec.replicas === "number" ? spec.replicas : 1);
        const cs = (spec.template?.spec?.containers || []) as Record<string, any>[];
        setContainers(cs.map((c) => ({
          name: String(c.name || ""),
          image: String(c.image || ""),
          env: ((c.env || []) as Record<string, any>[])
            .filter((e) => e.value !== undefined) // only simple value env; valueFrom left untouched in original
            .map((e) => ({ name: String(e.name || ""), value: String(e.value ?? "") })),
        })));
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [kind, namespace, name, hasReplicas]);

  const setImage = (i: number, image: string) =>
    setContainers((cs) => cs.map((c, idx) => (idx === i ? { ...c, image } : c)));
  const addEnv = (i: number) =>
    setContainers((cs) => cs.map((c, idx) => (idx === i ? { ...c, env: [...c.env, { name: "", value: "" }] } : c)));
  const removeEnv = (i: number, j: number) =>
    setContainers((cs) => cs.map((c, idx) => (idx === i ? { ...c, env: c.env.filter((_, k) => k !== j) } : c)));
  const updateEnv = (i: number, j: number, field: keyof EnvVar, val: string) =>
    setContainers((cs) => cs.map((c, idx) => (idx === i ? { ...c, env: c.env.map((e, k) => (k === j ? { ...e, [field]: val } : e)) } : c)));

  const handleSave = async () => {
    if (!original) return;
    setSaving(true);
    setError(null);
    try {
      const obj = JSON.parse(JSON.stringify(original)) as Record<string, any>;
      obj.spec = obj.spec || {};
      if (hasReplicas && replicas != null) obj.spec.replicas = replicas;
      const specContainers = (obj.spec.template?.spec?.containers || []) as Record<string, any>[];
      containers.forEach((edit, i) => {
        if (!specContainers[i]) return;
        specContainers[i].image = edit.image;
        // Preserve any valueFrom-based env; replace only the simple name/value ones.
        const preserved = ((specContainers[i].env || []) as Record<string, any>[]).filter((e) => e.value === undefined);
        const simple = edit.env.filter((e) => e.name.trim()).map((e) => ({ name: e.name.trim(), value: e.value }));
        const merged = [...preserved, ...simple];
        if (merged.length) specContainers[i].env = merged; else delete specContainers[i].env;
      });
      await updateResourceYAML(kind, namespace, name, jsYaml.dump(obj, { noRefs: true }));
      toast.success("Workload updated"); onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const inputCls = "w-full px-3 py-2 bg-th-subtle border border-th-line rounded-lg text-sm text-th-body focus:outline-none focus:ring-1 focus:ring-th-accent";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={saving ? undefined : onClose} />
      <div role="dialog" aria-modal="true" className="relative bg-th-panel rounded-xl shadow-card w-full max-w-2xl mx-4 max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between border-b border-th-line px-6 py-4">
          <h3 className="text-lg font-semibold text-th-heading">Edit {kind} · <span className="text-th-dim font-normal">{namespace}/{name}</span></h3>
          <button onClick={onClose} aria-label="Close dialog" className="text-th-dim hover:text-th-body">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="flex-1 overflow-auto px-6 py-4 space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-16"><div className="w-6 h-6 border-2 border-th-accent border-t-transparent rounded-full animate-spin" /></div>
          ) : (
            <>
              {hasReplicas && (
                <div>
                  <label className="block text-xs text-th-dim mb-1">Replicas</label>
                  <input type="number" min={0} value={replicas ?? 0} onChange={(e) => setReplicas(Math.max(0, parseInt(e.target.value) || 0))} className={inputCls + " max-w-[8rem]"} />
                </div>
              )}
              {containers.map((c, i) => (
                <div key={i} className="rounded-lg border border-th-line bg-th-subtle p-3 space-y-3">
                  <div className="text-xs font-semibold text-th-dim">Container · {c.name}</div>
                  <div>
                    <label className="block text-xs text-th-dim mb-1">Image</label>
                    <input type="text" value={c.image} onChange={(e) => setImage(i, e.target.value)} placeholder="repo/image:tag" className={inputCls + " font-mono text-xs"} />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs text-th-dim">Environment (name/value)</label>
                      <button onClick={() => addEnv(i)} className="text-xs text-th-accent hover:underline">+ Add</button>
                    </div>
                    <div className="space-y-2">
                      {c.env.length === 0 && <p className="text-xs text-th-dim">No simple env vars. (valueFrom entries are preserved and edited via YAML.)</p>}
                      {c.env.map((e, j) => (
                        <div key={j} className="flex gap-2 items-center">
                          <input type="text" placeholder="NAME" value={e.name} onChange={(ev) => updateEnv(i, j, "name", ev.target.value)} className="w-1/3 px-2 py-1.5 bg-th-panel border border-th-line rounded text-xs text-th-body font-mono focus:outline-none focus:ring-1 focus:ring-th-accent" />
                          <input type="text" placeholder="value" value={e.value} onChange={(ev) => updateEnv(i, j, "value", ev.target.value)} className="flex-1 px-2 py-1.5 bg-th-panel border border-th-line rounded text-xs text-th-body font-mono focus:outline-none focus:ring-1 focus:ring-th-accent" />
                          <button onClick={() => removeEnv(i, j)} className="text-th-danger hover:opacity-80">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
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
