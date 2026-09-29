import { useEffect, useState } from "react";
import { diagnosePod, diagnoseWorkload, explainFinding, applyProposedFix, getServerConfig, type Diagnosis, type DiagnosisFinding, type WorkloadDiagnosis, type ProposedFix } from "@/api/client";
import { useToast } from "@/components/Toast";

type FindingCtx = { namespace: string; name: string; phase: string; node: string };
type Owner = { kind: string; name: string };

/** Pre-validated, correctly-targeted safe remediations for a finding. The model
 * may only pick from these; nothing is executed without explicit approval. */
function candidateFixes(f: DiagnosisFinding, ctx: FindingCtx, owner?: Owner): ProposedFix[] {
  if (f.severity === "ok" || f.severity === "info") return [];
  const fixes: ProposedFix[] = [];
  if (owner && ["Deployment", "StatefulSet", "DaemonSet"].includes(owner.kind)) {
    fixes.push({ action: "restart", kind: owner.kind, namespace: ctx.namespace, name: owner.name, label: `Rolling-restart ${owner.kind.toLowerCase()} ${owner.name}` });
  }
  if (ctx.name && /crash-looping|not Ready|OOM-killed|restarted/i.test(f.title)) {
    fixes.push({ action: "delete_pod", kind: "Pod", namespace: ctx.namespace, name: ctx.name, label: `Delete pod ${ctx.name} (force recreate)`, danger: true });
  }
  if (/cordoned/i.test(f.title) && ctx.node) {
    fixes.push({ action: "uncordon", kind: "Node", name: ctx.node, label: `Uncordon node ${ctx.node}` });
  }
  return fixes;
}

const SEV: Record<string, { dot: string; chip: string; label: string }> = {
  critical: { dot: "bg-th-danger", chip: "bg-th-danger-s text-th-danger", label: "Critical" },
  warning: { dot: "bg-th-warn", chip: "bg-th-warn-s text-th-warn", label: "Warning" },
  info: { dot: "bg-th-info", chip: "bg-th-info-s text-th-info", label: "Info" },
  ok: { dot: "bg-th-ok", chip: "bg-th-ok-s text-th-ok", label: "Healthy" },
};

function FindingCard({ f, ctx, aiEnabled, owner, onApplied }: { f: DiagnosisFinding; ctx: FindingCtx; aiEnabled: boolean; owner?: Owner; onApplied?: () => void }) {
  const sev = SEV[f.severity] ?? SEV.info;
  const toast = useToast();
  const [ai, setAi] = useState<{ loading: boolean; text?: string; error?: string; fix?: ProposedFix | null } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);

  const explain = () => {
    setAi({ loading: true });
    explainFinding({ ...ctx, title: f.title, detail: f.detail, evidence: f.evidence, suggestion: f.suggestion, allowed_fixes: candidateFixes(f, ctx, owner) })
      .then((r) => setAi({ loading: false, text: r.explanation, fix: r.fix }))
      .catch((e) => setAi({ loading: false, error: e instanceof Error ? e.message : String(e) }));
  };

  const apply = (fix: ProposedFix) => {
    setApplying(true);
    applyProposedFix(fix)
      .then(() => { setApplied(true); toast.success("Fix applied", fix.label); onApplied?.(); })
      .catch((e) => toast.error("Fix failed", e instanceof Error ? e.message : String(e)))
      .finally(() => { setApplying(false); setConfirming(false); });
  };

  return (
    <div className="rounded-lg border border-th-line bg-th-subtle p-3">
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full shrink-0 ${sev.dot}`} />
        <span className="font-medium text-th-body text-sm">{f.title}</span>
        <span className={`ml-auto px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide ${sev.chip}`}>{sev.label}</span>
      </div>
      {f.detail && <p className="mt-1.5 text-xs text-th-dim">{f.detail}</p>}
      {f.evidence && f.evidence.length > 0 && (
        <div className="mt-2 space-y-1">
          {f.evidence.map((e, i) => (
            <pre key={i} className="text-[11px] leading-relaxed text-th-body bg-th-panel border border-th-line rounded p-2 overflow-x-auto whitespace-pre-wrap font-mono">{e}</pre>
          ))}
        </div>
      )}
      {f.suggestion && (
        <div className="mt-2 flex gap-1.5 text-xs text-th-body">
          <span className="text-th-accent shrink-0" aria-hidden>→</span>
          <span>{f.suggestion}</span>
        </div>
      )}

      {aiEnabled && f.severity !== "ok" && (
        <div className="mt-2.5 pt-2.5 border-t border-th-line">
          {!ai ? (
            <button onClick={explain} className="inline-flex items-center gap-1.5 text-xs font-medium text-th-accent hover:opacity-80">
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16 2.5 6.5L22 12l-6.5 2.5L13 21l-2.5-6.5L4 12l6.5-2.5L13 3z" /></svg>
              Explain with AI
            </button>
          ) : ai.loading ? (
            <div className="flex items-center gap-2 text-xs text-th-dim">
              <div className="w-3.5 h-3.5 border-2 border-th-accent border-t-transparent rounded-full animate-spin" />
              Asking the on-prem model…
            </div>
          ) : ai.error ? (
            <div className="text-xs text-th-danger">AI explain failed: {ai.error}</div>
          ) : (
            <div className="rounded-md bg-th-accent/5 border border-th-accent/20 p-2.5">
              <div className="flex items-center gap-1.5 mb-1 text-[10px] font-semibold uppercase tracking-wide text-th-accent">
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="m13 3-2.5 6.5L4 12l6.5 2.5L13 21l2.5-6.5L22 12l-6.5-2.5z" /></svg>
                AI explanation · advisory
              </div>
              <p className="text-xs text-th-body whitespace-pre-wrap leading-relaxed">{ai.text}</p>

              {ai.fix && (
                <div className="mt-2.5 pt-2.5 border-t border-th-accent/20">
                  <div className="flex items-center gap-1.5 mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-th-dim">Proposed fix · needs approval</div>
                  {applied ? (
                    <div className="flex items-center gap-1.5 text-xs text-th-ok font-medium">
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                      Applied · {ai.fix.label}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs text-th-body font-mono">{ai.fix.label}</span>
                      {!confirming ? (
                        <button onClick={() => setConfirming(true)}
                          className={`px-2.5 py-1 text-xs font-medium rounded-lg text-white ${ai.fix.danger ? "bg-th-danger" : "bg-th-accent"} hover:opacity-90`}>
                          Apply fix
                        </button>
                      ) : applying ? (
                        <span className="inline-flex items-center gap-1.5 text-xs text-th-dim"><div className="w-3.5 h-3.5 border-2 border-th-accent border-t-transparent rounded-full animate-spin" />Applying…</span>
                      ) : (
                        <>
                          <span className="text-xs text-th-body">Apply this?</span>
                          <button onClick={() => apply(ai.fix!)} className={`px-2.5 py-1 text-xs font-medium rounded-lg text-white ${ai.fix.danger ? "bg-th-danger" : "bg-th-accent"} hover:opacity-90`}>Confirm</button>
                          <button onClick={() => setConfirming(false)} className="px-2 py-1 text-xs text-th-dim hover:text-th-body">Cancel</button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * One-click "Diagnose" report for a pod: fetches the server-assembled analysis
 * (container states + events + node health + previous-crash logs) and renders
 * ranked findings with suggested fixes.
 */
function SummaryPills({ findings, healthy }: { findings: DiagnosisFinding[]; healthy: boolean }) {
  const critical = findings.filter((f) => f.severity === "critical").length;
  const warning = findings.filter((f) => f.severity === "warning").length;
  if (healthy) return <span className="inline-flex items-center gap-1.5 text-th-ok font-medium"><span className="h-2 w-2 rounded-full bg-th-ok" />Healthy</span>;
  return (
    <span className="text-th-body">
      {critical > 0 && <span className="text-th-danger font-medium">{critical} critical</span>}
      {critical > 0 && warning > 0 && <span className="text-th-dim"> · </span>}
      {warning > 0 && <span className="text-th-warn font-medium">{warning} warning</span>}
    </span>
  );
}

/** Findings for one pod (used directly for a pod, and per-pod in a workload). */
function PodReport({ d, aiEnabled, owner, onApplied }: { d: Diagnosis; aiEnabled: boolean; owner?: Owner; onApplied?: () => void }) {
  return (
    <>
      {d.findings.map((f, i) => (
        <FindingCard key={i} f={f} aiEnabled={aiEnabled} owner={owner} onApplied={onApplied} ctx={{ namespace: d.namespace, name: d.name, phase: d.phase, node: d.node }} />
      ))}
    </>
  );
}

/**
 * One-click "Diagnose" report. For a pod (default), shows the pod's findings.
 * For a workload (kind Deployment/StatefulSet/DaemonSet), shows workload-level
 * findings plus each pod's report, worst first — with AI "Explain" per finding.
 */
export default function DiagnoseModal({ namespace, name, kind = "Pod", onClose }: { namespace: string; name: string; kind?: string; onClose: () => void }) {
  const isWorkload = kind !== "Pod";
  const [pod, setPod] = useState<Diagnosis | null>(null);
  const [wl, setWl] = useState<WorkloadDiagnosis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [aiEnabled, setAiEnabled] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const p = isWorkload ? diagnoseWorkload(kind, namespace, name).then(setWl) : diagnosePod(namespace, name).then(setPod);
    p.catch((e) => setError(e instanceof Error ? e.message : String(e))).finally(() => setLoading(false));
    getServerConfig().then((c) => setAiEnabled(!!c.ai_enabled)).catch(() => setAiEnabled(false));
  }, [namespace, name, kind, isWorkload]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="bg-th-panel border border-th-line rounded-xl shadow-card w-full max-w-2xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-th-line">
          <div>
            <h2 className="text-lg font-semibold text-th-heading">Diagnose{isWorkload ? ` · ${kind}` : ""}</h2>
            <p className="text-xs text-th-dim font-mono">{namespace}/{name}</p>
          </div>
          <button onClick={onClose} className="text-th-dim hover:text-th-body">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="px-6 py-4 overflow-y-auto space-y-3">
          {loading && (
            <div className="flex items-center gap-3 text-th-dim text-sm py-6 justify-center">
              <div className="w-5 h-5 border-2 border-th-accent border-t-transparent rounded-full animate-spin" />
              {isWorkload ? "Analyzing the workload's pods…" : "Analyzing pod, events, node and crash logs…"}
            </div>
          )}
          {error && <div className="p-3 bg-th-danger-s text-th-danger rounded-lg text-sm">{error}</div>}

          {pod && !loading && !isWorkload && (
            <>
              <div className="flex items-center gap-2 text-sm">
                <SummaryPills findings={pod.findings} healthy={pod.healthy} />
                <span className="ml-auto text-xs text-th-dim">{pod.phase}{pod.node ? ` · ${pod.node}` : ""}</span>
              </div>
              <PodReport d={pod} aiEnabled={aiEnabled} />
            </>
          )}

          {wl && !loading && isWorkload && (
            <>
              <div className="flex items-center gap-2 text-sm">
                <SummaryPills findings={wl.findings} healthy={wl.healthy} />
                <span className="ml-auto text-xs text-th-dim">{wl.summary}</span>
              </div>
              {/* Workload-level findings — the owning controller enables a rolling-restart fix. */}
              {wl.findings.map((f, i) => <FindingCard key={`w${i}`} f={f} aiEnabled={aiEnabled} owner={{ kind: wl.kind, name: wl.name }} ctx={{ namespace: wl.namespace, name: wl.name, phase: "", node: "" }} />)}
              {/* Per-pod reports, worst first. */}
              {wl.pods.map((d) => (
                <div key={d.name} className="rounded-lg border border-th-line">
                  <div className="flex items-center gap-2 px-3 py-2 bg-th-subtle border-b border-th-line rounded-t-lg">
                    <span className="font-mono text-xs text-th-body truncate">{d.name}</span>
                    <span className="ml-auto"><SummaryPills findings={d.findings} healthy={d.healthy} /></span>
                  </div>
                  <div className="p-2 space-y-2">
                    <PodReport d={d} aiEnabled={aiEnabled} owner={{ kind: wl.kind, name: wl.name }} />
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
