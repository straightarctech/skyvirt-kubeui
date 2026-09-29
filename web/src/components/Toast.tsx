import { createContext, useCallback, useContext, useRef, useState, ReactNode } from "react";

type ToastVariant = "success" | "error" | "info" | "warning";

interface ToastItem {
  id: number;
  variant: ToastVariant;
  title: string;
  detail?: string;
  leaving?: boolean;
}

interface ToastAPI {
  success: (title: string, detail?: string) => void;
  error: (title: string, detail?: string) => void;
  info: (title: string, detail?: string) => void;
  warning: (title: string, detail?: string) => void;
}

const ToastContext = createContext<ToastAPI | null>(null);

export function useToast(): ToastAPI {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

const VARIANT_STYLES: Record<ToastVariant, { border: string; iconColor: string; icon: ReactNode }> = {
  success: {
    border: "border-l-th-ok",
    iconColor: "text-th-ok",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  error: {
    border: "border-l-th-danger",
    iconColor: "text-th-danger",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  warning: {
    border: "border-l-th-warn",
    iconColor: "text-th-warn",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
      </svg>
    ),
  },
  info: {
    border: "border-l-th-info",
    iconColor: "text-th-info",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
      </svg>
    ),
  },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((ts) => ts.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== id)), 200);
  }, []);

  const push = useCallback(
    (variant: ToastVariant, title: string, detail?: string) => {
      const id = nextId.current++;
      setToasts((ts) => [...ts.slice(-4), { id, variant, title, detail }]);
      const ttl = variant === "error" ? 8000 : 4500;
      setTimeout(() => dismiss(id), ttl);
    },
    [dismiss],
  );

  const api = useRef<ToastAPI>({
    success: (t, d) => push("success", t, d),
    error: (t, d) => push("error", t, d),
    info: (t, d) => push("info", t, d),
    warning: (t, d) => push("warning", t, d),
  });
  // Keep push closure fresh (push is stable via useCallback deps).
  api.current.success = (t, d) => push("success", t, d);
  api.current.error = (t, d) => push("error", t, d);
  api.current.info = (t, d) => push("info", t, d);
  api.current.warning = (t, d) => push("warning", t, d);

  return (
    <ToastContext.Provider value={api.current}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 w-96 max-w-[calc(100vw-2rem)]">
        {toasts.map((t) => {
          const s = VARIANT_STYLES[t.variant];
          return (
            <div
              key={t.id}
              className={`flex items-start gap-3 rounded-lg border border-th-line border-l-4 ${s.border} bg-th-panel shadow-card px-4 py-3 transition-all duration-200 ${
                t.leaving ? "opacity-0 translate-x-4" : "opacity-100 translate-x-0 animate-toast-in"
              }`}
              role="status"
            >
              <span className={`shrink-0 mt-0.5 ${s.iconColor}`}>{s.icon}</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-th-heading break-words">{t.title}</p>
                {t.detail && <p className="text-xs text-th-dim mt-0.5 break-words line-clamp-4">{t.detail}</p>}
              </div>
              <button
                onClick={() => dismiss(t.id)}
                className="shrink-0 text-th-dim hover:text-th-body transition-colors"
                aria-label="Dismiss"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
