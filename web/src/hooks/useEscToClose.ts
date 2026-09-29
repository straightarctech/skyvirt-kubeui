import { useEffect } from "react";

/**
 * Closes a dialog when Escape is pressed. Call unconditionally at the top of a
 * modal component and gate with `active` (e.g. open && !submitting) so it's a
 * no-op when the modal is closed or mid-save.
 */
export function useEscToClose(active: boolean, onClose: () => void) {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, onClose]);
}
