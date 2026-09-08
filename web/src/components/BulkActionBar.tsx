import { useState, type ReactNode } from "react";
import { useToast } from "@/components/Toast";
import { runBulk } from "@/hooks/useRowSelection";

export interface BulkAction<T> {
  label: string;
  /** Run against one selected item; throw to mark that item failed. */
  run: (item: T) => Promise<void>;
  danger?: boolean;
  /** Verb shown while running, e.g. "Deleting". Defaults to `${label}ing`. */
  gerund?: string;
  icon?: ReactNode;
}

/**
 * Sticky action bar shown when rows are selected. Each action confirms, then
 * runs over all selected items with bounded concurrency + a live progress
 * counter, toasts the outcome (incl. partial failures), and refreshes.
 */
export default function BulkActionBar<T>({
  selected,
  noun,
  actions,
  onClear,
  onComplete,
}: {
  selected: T[];
  /** Plural resource label, e.g. "pods". */
  noun: string;
  actions: BulkAction<T>[];
  onClear: () => void;
  onComplete: () => void;
}) {
  const toast = useToast();
  const [pending, setPending] = useState<BulkAction<T> | null>(null);
  const [running, setRunning] = useState<BulkAction<T> | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [confirmText, setConfirmText] = useState("");

  const count = selected.length;
  if (count === 0) return null;

  const gerund = (a: BulkAction<T>) => a.gerund || `${a.label}ing`;

  const execute = async (action: BulkAction<T>) => {
    setPending(null);
    setRunning(action);
    setProgress({ done: 0, total: count });
    const { ok, failed } = await runBulk(
      selected,
      action.run,
      (done, total) => setProgress({ done, total }),
    );
    setProgress(null);
    setRunning(null);
    if (failed.length === 0) {
      toast.success(`${action.label} complete`, `${ok} ${noun}`);
    } else {
      toast.error(`${action.label}: ${failed.length} failed`, `${ok} ok · ${failed[0].error}`);
    }
    onClear();
    onComplete();
  };

  return (
    <div className="sticky bottom-4 z-30 mx-auto w-fit max-w-full">
      <div className="flex items-center gap-3 rounded-xl border border-th-line bg-th-panel px-4 py-2.5 shadow-lg">
        <span className="text-sm font-medium text-th-body whitespace-nowrap">
          <span className="text-th-accent font-semibold tabular-nums">{count}</span> selected
        </span>
        <span className="h-5 w-px bg-th-line" />

        {running && progress ? (
          <span className="text-sm text-th-dim tabular-nums">
            {gerund(running)} {progress.done}/{progress.total}…
          </span>
        ) : pending ? (
          <div className="flex items-center gap-2">
            <span className="text-sm text-th-body">
              {pending.label} <span className="font-semibold">{count}</span> {noun}?
            </span>
            {pending.danger && (
              <input
                autoFocus
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder={`type "${pending.label.toLowerCase()}"`}
                aria-label={`Type ${pending.label.toLowerCase()} to confirm`}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && confirmText.toLowerCase() === pending.label.toLowerCase()) execute(pending);
                }}
                className="w-32 px-2 py-1 text-xs rounded border border-th-line bg-th-subtle text-th-body placeholder:text-th-ghost focus:outline-none focus:ring-1 focus:ring-th-accent"
              />
            )}
            <button
              onClick={() => execute(pending)}
              disabled={pending.danger && confirmText.toLowerCase() !== pending.label.toLowerCase()}
              className={`px-3 py-1 text-xs font-medium rounded-lg text-white ${pending.danger ? "bg-th-danger" : "bg-th-accent"} hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed`}
            >
              Confirm
            </button>
            <button onClick={() => { setPending(null); setConfirmText(""); }} className="px-3 py-1 text-xs text-th-dim hover:text-th-body">
              Cancel
            </button>
          </div>
        ) : (
          <>
            {actions.map((a) => (
              <button
                key={a.label}
                onClick={() => { setPending(a); setConfirmText(""); }}
                className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-lg border transition-colors ${
                  a.danger
                    ? "border-th-danger/40 bg-th-danger-s text-th-danger hover:bg-th-danger/20"
                    : "border-th-line bg-th-subtle text-th-body hover:bg-th-hover"
                }`}
              >
                {a.icon}{a.label}
              </button>
            ))}
            <span className="h-5 w-px bg-th-line" />
            <button onClick={onClear} className="text-xs text-th-dim hover:text-th-body" title="Clear selection">
              Clear
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/** Header/row checkbox styled for the selection column. */
export function SelectCheckbox({
  checked,
  indeterminate = false,
  onChange,
  ariaLabel,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
  ariaLabel: string;
}) {
  return (
    <input
      type="checkbox"
      aria-label={ariaLabel}
      checked={checked}
      ref={(el) => { if (el) el.indeterminate = indeterminate && !checked; }}
      onChange={onChange}
      onClick={(e) => e.stopPropagation()}
      className="h-4 w-4 rounded border-th-line text-th-accent focus:ring-th-accent cursor-pointer accent-[rgb(var(--th-accent))]"
    />
  );
}
