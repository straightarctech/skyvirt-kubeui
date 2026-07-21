import { useState } from "react";
import { useEscToClose } from "@/hooks/useEscToClose";

interface ConfirmModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void> | void;
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  variant?: "danger" | "warning" | "default";
}

/**
 * Generic styled confirmation dialog for non-delete actions
 * (cordon, drain, restart, suspend, taint removal, ...).
 * Destructive deletes should keep using DeleteConfirmModal (type-to-confirm).
 */
export default function ConfirmModal({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = "Confirm",
  variant = "default",
}: ConfirmModalProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEscToClose(open && !busy, onClose);

  if (!open) return null;

  const titleColor =
    variant === "danger" ? "text-th-danger" : variant === "warning" ? "text-th-warn" : "text-th-heading";
  const confirmBtn =
    variant === "danger"
      ? "bg-red-600 hover:bg-red-700 text-white"
      : variant === "warning"
        ? "bg-amber-600 hover:bg-amber-700 text-white"
        : "bg-th-accent hover:opacity-90 text-white";

  const handleConfirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={busy ? undefined : onClose} />
      <div role="dialog" aria-modal="true" aria-labelledby="confirm-modal-title" className="relative bg-th-panel rounded-lg shadow-card max-w-md w-full mx-4">
        <div className="flex items-center justify-between border-b border-th-line px-6 py-4">
          <h2 id="confirm-modal-title" className={`text-lg font-semibold ${titleColor}`}>{title}</h2>
          <button onClick={onClose} aria-label="Close dialog" className="text-th-dim hover:text-th-body transition-colors" disabled={busy}>
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="px-6 py-4 space-y-3">
          <div className="text-th-body text-sm">{message}</div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
        </div>
        <div className="flex items-center justify-end gap-3 border-t border-th-line px-6 py-4">
          <button
            onClick={onClose}
            disabled={busy}
            className="px-4 py-2 text-sm border border-th-line rounded text-th-body hover:bg-th-hover transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={busy}
            autoFocus
            className={`px-4 py-2 text-sm rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${confirmBtn}`}
          >
            {busy ? "Working..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
