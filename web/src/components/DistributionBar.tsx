import { useEffect, useState } from "react";

export interface DistSegment {
  label: string;
  value: number;
  color: string;
}

/**
 * A compact, single-row proportional breakdown — a thin stacked bar with an
 * inline legend. Restores the "at a glance" distribution a chart panel gave,
 * without the vertical space.
 *
 * Segments animate: they grow in on mount and smoothly re-flow when values
 * change on a live refresh (e.g. a pod moving Pending → Running). Every segment
 * stays mounted (zero-value ones render at 0 width) so the width transition
 * always animates instead of popping.
 */
export function DistributionBar({ label = "Status", segments }: { label?: string; segments: DistSegment[] }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const legend = segments.filter((s) => s.value > 0);
  if (legend.length === 0) return null;
  const total = segments.reduce((a, s) => a + s.value, 0) || 1;

  return (
    <div className="flex items-center gap-3 rounded-xl border border-th-line bg-th-panel px-4 py-2.5 shadow-card">
      <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-th-dim">{label}</span>
      <div className="flex h-2.5 flex-1 overflow-hidden rounded-full bg-th-subtle">
        {segments.map((s) => (
          <div
            key={s.label}
            title={`${s.label}: ${s.value}`}
            style={{
              width: mounted ? `${(s.value / total) * 100}%` : "0%",
              backgroundColor: s.color,
              transition: "width 0.7s cubic-bezier(0.22, 1, 0.36, 1)",
            }}
          />
        ))}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        {legend.map((s) => (
          <span key={s.label} className="flex items-center gap-1.5 text-th-dim">
            <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: s.color }} />
            {s.label} <span className="font-semibold text-th-body tabular-nums">{s.value}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
