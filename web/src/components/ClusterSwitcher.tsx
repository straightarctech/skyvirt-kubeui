import { useEffect, useRef, useState } from "react";
import { getClusterContext } from "@/lib/clusterContext";

/**
 * Header control for switching between clusters. Lists the sibling clusters the
 * portal passed at launch; selecting one navigates to its portal deep-link,
 * which mints that cluster's token and opens its KubeUI. Renders nothing when
 * KubeUI wasn't launched with a multi-cluster context (e.g. direct login).
 */
export default function ClusterSwitcher() {
  const ctx = getClusterContext();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  // Nothing to switch to → no control (keeps single-cluster installs clean).
  if (!ctx || ctx.peers.length < 2) return null;

  const others = ctx.peers.filter((p) => p.id !== ctx.current.id);

  const go = (url?: string) => {
    if (url) window.location.href = url;
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 pl-2.5 pr-2 py-1.5 rounded-lg bg-th-subtle border border-th-line text-sm text-th-body hover:border-th-accent/50 transition-colors max-w-[220px]"
        title="Switch cluster"
      >
        <svg className="w-4 h-4 text-th-accent shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16M4 12h16M4 17h16" />
          <circle cx="7" cy="7" r="1.4" fill="currentColor" stroke="none" />
          <circle cx="7" cy="12" r="1.4" fill="currentColor" stroke="none" />
        </svg>
        <span className="font-medium truncate">{ctx.current.name}</span>
        <svg className={`w-3.5 h-3.5 text-th-ghost shrink-0 transition-transform ${open ? "rotate-180" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 mt-1.5 w-64 max-h-80 overflow-y-auto rounded-lg border border-th-line bg-th-panel shadow-card z-50 py-1">
          <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-th-ghost">Clusters</div>
          <div className="flex items-center gap-2 px-3 py-2 text-sm text-th-body">
            <span className="h-2 w-2 rounded-full bg-th-ok shrink-0" />
            <span className="truncate font-medium">{ctx.current.name}</span>
            <span className="ml-auto text-[10px] text-th-dim">current</span>
          </div>
          {others.length > 0 && <div className="my-1 border-t border-th-line" />}
          {others.map((p) => (
            <button
              key={p.id}
              onClick={() => go(p.switchUrl)}
              disabled={!p.switchUrl}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-th-body hover:bg-th-hover disabled:opacity-40 transition-colors"
              title={p.switchUrl ? `Open ${p.name} in KubeUI` : "No KubeUI link for this cluster"}
            >
              <span className="h-2 w-2 rounded-full bg-th-ghost shrink-0" />
              <span className="truncate">{p.name}</span>
              <svg className="w-3.5 h-3.5 text-th-ghost ml-auto shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
