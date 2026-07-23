import { useState } from "react";
import { setResourceProtection } from "@/api/client";

interface ProtectToggleProps {
  kind: string;
  namespace?: string;
  name: string;
  isProtected: boolean;
  onToggled?: (newState: boolean) => void;
}

export default function ProtectToggle({ kind, namespace, name, isProtected, onToggled }: ProtectToggleProps) {
  const [toggling, setToggling] = useState(false);

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setToggling(true);
    try {
      const res = await setResourceProtection(kind, namespace, name, !isProtected);
      onToggled?.(res.protected);
    } catch {
      // silently fail — user can retry
    } finally {
      setToggling(false);
    }
  };

  if (toggling) {
    return (
      <span className="inline-flex items-center justify-center w-6 h-6 text-th-dim animate-pulse">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <circle cx="12" cy="12" r="10" strokeDasharray="30" strokeDashoffset="10" />
        </svg>
      </span>
    );
  }

  return (
    <button
      onClick={handleClick}
      title={isProtected ? "Protected — click to unprotect" : "Unprotected — click to protect"}
      className={`inline-flex items-center justify-center w-6 h-6 rounded transition-colors ${
        isProtected
          ? "text-th-warn hover:text-th-warn-l"
          : "text-th-dim hover:text-th-body"
      }`}
    >
      {isProtected ? (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        </svg>
      ) : (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        </svg>
      )}
    </button>
  );
}
