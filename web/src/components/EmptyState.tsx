import type { ReactNode } from "react";

/**
 * A designed empty state: an invitation to act, not a dead end. Use it wherever
 * a list, table, or panel can come up empty. Title reads in the body tier (never
 * the faint ghost tier), an optional hint explains, and an optional action gives
 * the next step.
 */
export function EmptyState({
  icon,
  title,
  hint,
  action,
  compact,
}: {
  icon?: ReactNode;
  title: string;
  hint?: string;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`flex flex-col items-center justify-center text-center ${compact ? "py-8" : "py-14"}`}>
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-th-subtle text-th-dim ring-1 ring-th-line">
        {icon ?? <DefaultIcon />}
      </div>
      <p className="text-sm font-medium text-th-body">{title}</p>
      {hint && <p className="mt-1 max-w-sm text-xs text-th-dim">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/**
 * EmptyState pre-wrapped in a full-width table row — the drop-in for the common
 * `<tr><td colSpan=..>No X found</td></tr>` pattern.
 */
export function EmptyRow({
  colSpan,
  icon,
  title,
  hint,
  action,
}: {
  colSpan: number;
  icon?: ReactNode;
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4">
        <EmptyState icon={icon} title={title} hint={hint} action={action} compact />
      </td>
    </tr>
  );
}

function DefaultIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 7.5 5 4h14l2 3.5" />
      <path d="M3 7.5V19a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V7.5" />
      <path d="M8 11h8" opacity="0.5" />
    </svg>
  );
}
