import { useEffect, useState } from "react";
import { getDrainPlan, drainNode } from "@/api/client";
import type { DrainReport, DrainPod } from "@/api/client";
import { useEscToClose } from "@/hooks/useEscToClose";

/** Drain a node safely: preview the eviction plan (what moves, what is exempt,
 *  what a PodDisruptionBudget guards), then evict through the PDB-aware Eviction
 *  API and show the result. */
export default function DrainModal({
  nodeName,
  onClose,
  onDone,
}: {
  nodeName: string;
  onClose: () => void;
  onDone: () => void;
}) {
  useEscToClose(true, onClose);
  const [plan, setPlan] = useState<DrainReport | null>(null);
  const [planError, setPlanError] = useState("");
  const [result, setResult] = useState<DrainReport | null>(null);
  const [draining, setDraining] = useState(false);
  const [error, setError] = useState("");
  const [timeout, setTimeoutS] = useState(120);

  useEffect(() => {
    let live = true;
    getDrainPlan(nodeName)
      .then((p) => live && setPlan(p))
      .catch((e) => live && setPlanError(e instanceof Error ? e.message : String(e)));
    return () => { live = false; };
  }, [nodeName]);

  async function handleDrain() {
    setDraining(true);
    setError("");
    try {
      const rep = await drainNode(nodeName, { timeout_seconds: timeout });
      setResult(rep);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDraining(false);
    }
  }

  const podRow = (p: DrainPod, i: number) => (
    <div key={i} className="flex items-center justify-between px-3 py-1.5 text-xs border-b border-th-line last:border-0">
      <span className="font-mono text-th-body truncate">{p.namespace}/{p.name}</span>
      <span className="flex items-center gap-2 shrink-0">
        {p.pdb && <span className="px-1.5 py-0.5 rounded bg-th-info-s text-th-info" title="Guarded by a PodDisruptionBudget">PDB: {p.pdb}</span>}
        {p.reason && <span className="text-th-dim">{p.reason}</span>}
      </span>
    </div>
  );

  const Section = ({ title, pods, empty }: { title: string; pods?: DrainPod[]; empty: string }) => (
    <div>
      <h3 className="text-xs font-semibold text-th-label mb-1">{title} <span className="text-th-ghost font-normal">({pods?.length ?? 0})</span></h3>
      <div className="rounded-lg border border-th-line bg-th-subtle max-h-40 overflow-y-auto">
        {pods && pods.length > 0 ? pods.map(podRow) : <div className="px-3 py-2 text-xs text-th-dim">{empty}</div>}
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:p-8" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bg-th-panel border border-th-line rounded-xl shadow-2xl w-full max-w-2xl p-6 space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-th-heading">Drain {nodeName}</h2>
          <p className="text-xs text-th-dim">Cordons the node and evicts its pods through the disruption-budget-aware Eviction API. DaemonSet, static, and completed pods are left in place.</p>
        </div>

        {planError && <div className="p-2 bg-th-danger-s text-th-danger rounded text-sm">{planError}</div>}
        {error && <div className="p-2 bg-th-danger-s text-th-danger rounded text-sm whitespace-pre-wrap">{error}</div>}

        {!result && (
          <>
            {!plan && !planError && <div className="text-sm text-th-dim">Building drain plan…</div>}
            {plan && (
              <div className="space-y-3">
                <Section title="Will be evicted" pods={plan.evictable} empty="No evictable pods on this node." />
                <Section title="Left in place" pods={plan.skipped} empty="Nothing exempt." />
                {plan.evictable.some((p) => p.pdb) && (
                  <p className="text-xs text-th-dim">Pods with a <span className="text-th-info">PDB</span> badge may evict slowly or block if eviction would breach the budget.</p>
                )}
                <div className="flex items-center gap-2">
                  <label className="text-xs text-th-label">Timeout</label>
                  <input type="number" min={10} className="w-20 px-2 py-1 text-sm bg-th-subtle border border-th-line rounded text-th-body" value={timeout} onChange={(e) => setTimeoutS(Number(e.target.value) || 120)} />
                  <span className="text-xs text-th-ghost">seconds</span>
                </div>
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={onClose} className="px-4 py-2 text-sm bg-th-subtle border border-th-line rounded-lg hover:bg-th-hover">Cancel</button>
              <button
                onClick={handleDrain}
                disabled={draining || !plan}
                className="px-4 py-2 text-sm bg-th-danger text-white rounded-lg hover:opacity-90 disabled:opacity-50"
              >
                {draining ? "Draining…" : `Drain ${plan?.evictable.length ?? 0} pod${(plan?.evictable.length ?? 0) === 1 ? "" : "s"}`}
              </button>
            </div>
          </>
        )}

        {result && (
          <div className="space-y-3">
            <div className={`p-2 rounded text-sm ${result.timed_out ? "bg-th-warn-s text-th-warn" : "bg-th-ok-s text-th-ok"}`}>
              {result.timed_out
                ? `Drain incomplete: ${result.blocked?.length ?? 0} pod(s) still up at the deadline (disruption budget).`
                : `Drained — ${result.evicted?.length ?? 0} pod(s) evicted in ${((result.duration_ms ?? 0) / 1000).toFixed(1)}s.`}
            </div>
            <Section title="Evicted" pods={result.evicted} empty="None." />
            {result.blocked && result.blocked.length > 0 && <Section title="Blocked (budget)" pods={result.blocked} empty="None." />}
            <div className="flex justify-end pt-2">
              <button onClick={onClose} className="px-4 py-2 text-sm bg-th-accent text-white rounded-lg hover:opacity-90">Done</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
