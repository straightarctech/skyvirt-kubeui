import { useState, useEffect } from "react";
import { useToast } from "@/components/Toast";
import { useEscToClose } from "@/hooks/useEscToClose";
import jsYaml from "js-yaml";
import { getResourceYAML, updateResourceYAML } from "@/api/client";

interface Props {
  namespace: string;
  name: string;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Edit a Job's mutable fields. A Job's pod template is immutable in Kubernetes —
 * image/env/command can't be changed after creation (the API rejects it), so
 * this edits only what k8s actually allows: parallelism, the active deadline,
 * and suspend/resume. Changes are merged into the live object. For a different
 * image, recreate the Job (or use a CronJob).
 */
export default function EditJobModal({ namespace, name, onClose, onSaved }: Props) {
  const [original, setOriginal] = useState<Record<string, any> | null>(null);
  const [parallelism, setParallelism] = useState<number>(1);
  const [deadline, setDeadline] = useState<string>(""); // activeDeadlineSeconds, blank = unset
  const [suspend, setSuspend] = useState<boolean>(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  useEscToClose(!saving, onClose);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getResourceYAML("Job", namespace, name)
      .then((obj) => {
        if (cancelled) return;
        setOriginal(obj);
        const spec = (obj.spec || {}) as Record<string, any>;
        setParallelism(typeof spec.parallelism === "number" ? spec.parallelism : 1);
        setDeadline(spec.activeDeadlineSeconds != null ? String(spec.activeDeadlineSeconds) : "");
        setSuspend(spec.suspend === true);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [namespace, name]);

  const handleSave = async () => {
    if (!original) return;
    setSaving(true);
    setError(null);
    try {
      const obj = JSON.parse(JSON.stringify(original)) as Record<string, any>;
      obj.spec = obj.spec || {};
      obj.spec.parallelism = Math.max(0, parallelism);
      obj.spec.suspend = suspend;
      if (deadline.trim() === "") delete obj.spec.activeDeadlineSeconds;
      else obj.spec.activeDeadlineSeconds = Math.max(1, parseInt(deadline, 10) || 0);
      await updateResourceYAML("Job", namespace, name, jsYaml.dump(obj, { noRefs: true }));
      toast.success("Job updated"); onSaved();
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
      <div role="dialog" aria-modal="true" className="relative bg-th-panel rounded-xl shadow-card w-full max-w-md mx-4 flex flex-col">
        <div className="flex items-center justify-between border-b border-th-line px-6 py-4">
          <h3 className="text-lg font-semibold text-th-heading">Edit Job · <span className="text-th-dim font-normal">{namespace}/{name}</span></h3>
          <button onClick={onClose} aria-label="Close dialog" className="text-th-dim hover:text-th-body">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="px-6 py-4 space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-12"><div className="w-6 h-6 border-2 border-th-accent border-t-transparent rounded-full animate-spin" /></div>
          ) : (
            <>
              <p className="text-xs text-th-dim">A Job's pod template (image, env, command) is immutable — recreate the Job to change it. These fields can be updated in place:</p>
              <div>
                <label className="block text-xs text-th-dim mb-1">Parallelism</label>
                <input type="number" min={0} value={parallelism} onChange={(e) => setParallelism(Math.max(0, parseInt(e.target.value) || 0))} className={inputCls + " max-w-[8rem]"} />
              </div>
              <div>
                <label className="block text-xs text-th-dim mb-1">Active deadline (seconds)</label>
                <input type="number" min={1} value={deadline} onChange={(e) => setDeadline(e.target.value)} placeholder="unset" className={inputCls + " max-w-[12rem]"} />
              </div>
              <label className="flex items-center gap-2 text-sm text-th-body cursor-pointer">
                <input type="checkbox" checked={suspend} onChange={(e) => setSuspend(e.target.checked)} className="accent-[color:var(--th-accent)]" />
                Suspend (pause — stops creating pods)
              </label>
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
