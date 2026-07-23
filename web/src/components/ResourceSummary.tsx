import type { ReactNode } from "react";
import type { StatusKind } from "@/lib/status";

export type StatTone = StatusKind | "accent" | "neutral";

export interface Stat {
  label: string;
  value: ReactNode;
  /** Colors the value. Defaults to the heading tier. */
  tone?: StatTone;
}

const toneClass: Record<StatTone, string> = {
  ok: "text-th-ok",
  warn: "text-th-warn",
  error: "text-th-danger",
  info: "text-th-info",
  unknown: "text-th-dim",
  accent: "text-th-accent",
  neutral: "text-th-heading",
};

/**
 * A compact, consistent health roll-up for the top of a resource list — the
 * same visual language everywhere (Rancher's praised "summary card" pattern).
 * Each tile is a big number over a small uppercase label; tone colors the number
 * from the shared status palette so a non-zero "Failed" reads red at a glance.
 */
export function StatStrip({ stats }: { stats: Stat[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {stats.map((s) => (
        <div key={s.label} className="rounded-xl border border-th-line bg-th-panel px-4 py-3 shadow-card">
          <div className={`text-2xl font-black leading-none ${toneClass[s.tone ?? "neutral"]}`}>{s.value}</div>
          <div className="mt-1.5 text-[10px] uppercase tracking-wider text-th-dim">{s.label}</div>
        </div>
      ))}
    </div>
  );
}
