import { useState, useEffect } from "react";
import { getResourceProtection, setResourceProtection } from "@/api/client";
import { useToast } from "@/components/Toast";
import { useEscToClose } from "@/hooks/useEscToClose";

interface DeleteConfirmModalProps {
  open: boolean;
  onClose: () => void;
  onDeleted: () => void;
  resourceType: string;
  resourceName: string;
  namespace?: string;
  kind: string;
  deleteFn: () => Promise<void>;
}

export default function DeleteConfirmModal({
  open,
  onClose,
  onDeleted,
  resourceType,
  resourceName,
  namespace,
  kind,
  deleteFn,
}: DeleteConfirmModalProps) {
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isProtected, setIsProtected] = useState(false);
  const [loadingProtection, setLoadingProtection] = useState(true);
  const [togglingProtection, setTogglingProtection] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (!open) return;
    setConfirmText("");
    setError(null);
    setDeleting(false);
    setTogglingProtection(false);
    setLoadingProtection(true);

    getResourceProtection(kind, namespace, resourceName)
      .then((res) => setIsProtected(res.protected))
      .catch(() => setIsProtected(false))
      .finally(() => setLoadingProtection(false));
  }, [open, kind, namespace, resourceName]);

  useEscToClose(open && !deleting, onClose);

  if (!open) return null;

  const nameMatches = confirmText === resourceName;

  const handleDelete = async () => {
    if (!nameMatches || isProtected) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteFn();
      toast.success(`${resourceType} deleted`, namespace ? `${resourceName} · ${namespace}` : resourceName);
      onDeleted();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  };

  const handleUnprotect = async () => {
    setTogglingProtection(true);
    setError(null);
    try {
      await setResourceProtection(kind, namespace, resourceName, false);
      setIsProtected(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to unprotect");
    } finally {
      setTogglingProtection(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={deleting ? undefined : onClose} />
      <div role="dialog" aria-modal="true" aria-labelledby="delete-modal-title" className="relative bg-th-panel rounded-lg shadow-card max-w-md w-full mx-4">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-th-line px-6 py-4">
          <h2 id="delete-modal-title" className="text-lg font-semibold text-th-danger">
            Delete {resourceType}
          </h2>
          <button onClick={onClose} aria-label="Close dialog" disabled={deleting} className="text-th-dim hover:text-th-body transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-4 space-y-4">
          {loadingProtection ? (
            <div className="text-th-dim text-sm">Checking protection status...</div>
          ) : (
            <>
              {isProtected && (
                <div className="flex items-center justify-between bg-red-500/10 border border-red-500/30 rounded px-4 py-3">
                  <div className="flex items-center gap-2">
                    <svg className="w-5 h-5 text-th-danger" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v.01M12 9v3m-7 4h14a2 2 0 001.73-3l-7-12a2 2 0 00-3.46 0l-7 12A2 2 0 005 16z" />
                    </svg>
                    <span className="text-th-danger text-sm font-medium">Protected</span>
                  </div>
                  <button
                    onClick={handleUnprotect}
                    disabled={togglingProtection}
                    className="px-3 py-1 text-xs rounded border border-red-500/50 text-th-danger hover:bg-red-500/20 transition-colors disabled:opacity-50"
                  >
                    {togglingProtection ? "Removing..." : "Unprotect"}
                  </button>
                </div>
              )}

              <p className="text-th-body text-sm">
                Are you sure you want to delete{" "}
                <span className="font-semibold text-th-heading">{resourceName}</span>
                {namespace && (
                  <span className="text-th-dim"> in namespace {namespace}</span>
                )}
                ? This action cannot be undone.
              </p>

              <div>
                <label className="block text-sm text-th-dim mb-1">
                  Type <span className="font-mono font-semibold text-th-heading">{resourceName}</span> to confirm
                </label>
                <input
                  type="text"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder={resourceName}
                  disabled={isProtected}
                  className="w-full px-3 py-2 text-sm rounded border border-th-line bg-th-bg text-th-body placeholder:text-th-dim/50 focus:outline-none focus:border-th-accent disabled:opacity-50 disabled:cursor-not-allowed"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && nameMatches && !isProtected) handleDelete();
                  }}
                />
              </div>

              {error && (
                <p className="text-th-danger text-sm">{error}</p>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-th-line px-6 py-4">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm border border-th-line rounded text-th-body hover:bg-th-hover transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleDelete}
            disabled={!nameMatches || deleting || isProtected || loadingProtection}
            className="px-4 py-2 text-sm rounded bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {deleting ? "Deleting..." : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}
