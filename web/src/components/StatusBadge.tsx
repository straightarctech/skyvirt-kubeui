import { STATUS, classifyStatus, type StatusKind } from "@/lib/status";

// A distinct SHAPE per health kind, so status never rides on color alone
// (WCAG 1.4.1). The trio that matters most — ok / warn / error — get maximally
// different silhouettes: filled circle, triangle, cross.
const GLYPH: Record<StatusKind, string> = {
  ok: "●",
  warn: "▲",
  error: "✕",
  info: "◆",
  unknown: "○",
};

/**
 * The one way to render a health status inline: a shape glyph + text label,
 * tinted from the shared status palette. Three redundant cues (shape, text,
 * color) so it stays legible to colorblind users and in grayscale.
 *
 * Pass `kind` directly, or a raw Kubernetes `status` string to classify. Use
 * `label` to override the display text (e.g. show the literal phase "Running"
 * instead of the generic "Healthy").
 */
export function StatusBadge({
  kind,
  status,
  label,
  className = "",
}: {
  kind?: StatusKind;
  status?: string;
  label?: string;
  className?: string;
}) {
  const k = kind ?? classifyStatus(status ?? "");
  const text = label ?? status ?? STATUS[k].label;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-xs font-medium ${STATUS[k].badge} ${className}`}
      title={STATUS[k].label}
    >
      <span aria-hidden="true" className="text-[9px] leading-none">{GLYPH[k]}</span>
      <span className="truncate">{text}</span>
    </span>
  );
}

/**
 * A bare status dot for dense spots (cards, list gutters) where a full badge
 * is too heavy. Still colorblind-safe: the shape glyph carries the meaning and
 * an accessible label is always present (visually-hidden unless `showLabel`).
 */
export function StatusDot({
  kind,
  status,
  showLabel = false,
  className = "",
}: {
  kind?: StatusKind;
  status?: string;
  showLabel?: boolean;
  className?: string;
}) {
  const k = kind ?? classifyStatus(status ?? "");
  const name = status || STATUS[k].label;
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <span
        aria-hidden="true"
        className="text-[10px] leading-none"
        style={{ color: STATUS[k].fill }}
      >
        {GLYPH[k]}
      </span>
      <span className={showLabel ? "text-xs text-th-dim" : "sr-only"}>{name}</span>
    </span>
  );
}
