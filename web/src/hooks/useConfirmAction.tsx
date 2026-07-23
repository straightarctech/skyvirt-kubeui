import { useState, ReactNode } from "react";
import ConfirmModal from "@/components/ConfirmModal";
import { useToast } from "@/components/Toast";

interface PendingAction {
  /** Unique key of the target (e.g. "ns/name") — exposed while running for per-row spinners. */
  key: string;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  fn: () => Promise<void>;
  successMsg?: string;
}

/**
 * Styled replacement for window.confirm() + alert() around a mutating action.
 * Usage:
 *   const confirm = useConfirmAction(refresh);
 *   confirm.request({ key, title, message, fn, successMsg });
 *   ... render {confirm.modal} once in the page.
 */
export function useConfirmAction(onSuccess?: () => void) {
  const toast = useToast();
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [runningKey, setRunningKey] = useState<string | null>(null);

  const run = async () => {
    if (!pending) return;
    setRunningKey(pending.key);
    try {
      await pending.fn();
      if (pending.successMsg) toast.success(pending.successMsg);
      onSuccess?.();
    } finally {
      setRunningKey(null);
    }
  };

  const modal = (
    <ConfirmModal
      open={pending !== null}
      onClose={() => setPending(null)}
      onConfirm={run}
      title={pending?.title ?? ""}
      message={pending?.message ?? ""}
      confirmLabel={pending?.confirmLabel ?? "Confirm"}
      variant={pending?.danger ? "danger" : "warning"}
    />
  );

  return { request: setPending, modal, runningKey };
}
