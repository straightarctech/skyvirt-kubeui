// Single source of truth for resource STATUS (health) semantics.
//
// Every surface that conveys health — list badges, topology circles, the
// service-mesh graph, pod-security levels — classifies through here and draws
// from the same palette, so green/amber/red/gray mean the same thing everywhere
// (and are paired with shape/label cues, never color alone: WCAG 1.4.1).
//
// This is deliberately separate from qualitative/categorical palettes (e.g. the
// per-namespace chart series in lib/palette.ts). Those encode identity, not
// health, and must not be conflated with status.
//
// Colors are plain hex (SVG presentation attributes can't resolve CSS var()).
// They are audited to keep the perceivable edge of a filled shape ≥3:1 against
// both theme backgrounds: on light the darker `ring` carries it (≥5:1 on white),
// on dark the bright `fill` carries it (≥4.8:1 on #12151d). HTML/CSS consumers
// should prefer the `--status-*` tokens in index.css over these hex values.

export type StatusKind = "ok" | "warn" | "error" | "info" | "unknown";

export interface StatusStyle {
  /** Bright fill for the shape body. */
  fill: string;
  /** Darker outline — the WCAG-perceivable edge on light backgrounds. */
  ring: string;
  /** Tailwind token classes for an HTML pill (soft bg + on-color text). */
  badge: string;
  /** Human label for legends and tooltips. */
  label: string;
}

export const STATUS: Record<StatusKind, StatusStyle> = {
  ok: { fill: "#22c55e", ring: "#15803d", badge: "bg-th-ok-s text-th-ok", label: "Healthy" },
  warn: { fill: "#f59e0b", ring: "#b45309", badge: "bg-th-warn-s text-th-warn", label: "Warning" },
  error: { fill: "#ef4444", ring: "#b91c1c", badge: "bg-th-danger-s text-th-danger", label: "Error" },
  info: { fill: "#3b82f6", ring: "#1d4ed8", badge: "bg-th-info-s text-th-info", label: "Info" },
  unknown: { fill: "#94a3b8", ring: "#475569", badge: "bg-th-muted text-th-dim", label: "Unknown" },
};

// Status strings grouped by health. Matching is case-insensitive and also
// tolerates the common "Reason"-style variants Kubernetes surfaces.
const OK = new Set([
  "running", "succeeded", "completed", "ready", "active", "bound", "available",
  "deployed", "healthy", "true", "normal", "restricted",
]);
const WARN = new Set([
  "pending", "containercreating", "progressing", "terminating", "updating",
  "notready", "pending-install", "pending-upgrade", "uninstalling", "baseline",
  "warning", "degraded", "podinitializing",
]);
const ERROR = new Set([
  "failed", "crashloopbackoff", "error", "imagepullbackoff", "errimagepull",
  "oomkilled", "evicted", "unhealthy", "lost", "privileged", "false",
  "createcontainerconfigerror", "invalidimagename", "backoff",
]);
const INFO = new Set(["superseded", "info"]);

/** Classify any Kubernetes status/phase/reason string into a health kind. */
export function classifyStatus(status: string): StatusKind {
  const s = (status || "").trim().toLowerCase();
  if (!s) return "unknown";
  if (OK.has(s)) return "ok";
  if (ERROR.has(s)) return "error";
  if (WARN.has(s)) return "warn";
  if (INFO.has(s)) return "info";
  return "unknown";
}

/** Convenience: the full style for a raw status string. */
export function statusStyle(status: string): StatusStyle {
  return STATUS[classifyStatus(status)];
}

/** A translucent tint of a status fill, for soft backgrounds/fills in SVG. */
export function statusSoft(kind: StatusKind, alpha = 0.12): string {
  const h = STATUS[kind].fill.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
