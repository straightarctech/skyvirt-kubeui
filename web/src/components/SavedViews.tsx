import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useSavedViews } from "@/hooks/useSavedViews";

/**
 * Context-aware saved-views control for the top bar. It reads the current route
 * and query, lists the views saved for this page (click to apply), and lets you
 * save the current filter/sort as a named view. Renders only when there's
 * something to show — an existing view for this page, or active query state
 * worth saving — so it stays out of the way elsewhere.
 */
export default function SavedViews() {
  const location = useLocation();
  const navigate = useNavigate();
  const { add, remove, forPath } = useSavedViews();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  const here = forPath(location.pathname);
  const hasQuery = location.search.length > 1;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  // Default a sensible name from the current query (e.g. the search term).
  useEffect(() => {
    if (!open) return;
    const q = new URLSearchParams(location.search).get("q");
    setName(q ? q : "");
  }, [open, location.search]);

  // Hide entirely when there's nothing relevant here.
  if (here.length === 0 && !hasQuery) return null;

  const apply = (search: string) => { navigate(location.pathname + search); setOpen(false); };
  const saveCurrent = () => {
    if (!name.trim() || !hasQuery) return;
    add(name, location.pathname, location.search);
    setName("");
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={`relative p-2 rounded-lg transition-all duration-300 ${open ? "bg-th-accent-s text-th-accent" : "bg-th-subtle text-th-dim hover:text-th-body hover:bg-th-hover"}`}
        title="Saved views"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z" />
        </svg>
        {here.length > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[15px] h-[15px] px-1 rounded-full bg-th-accent text-white text-[9px] font-bold flex items-center justify-center">{here.length}</span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-72 bg-th-panel border border-th-line rounded-xl shadow-2xl overflow-hidden z-[80]">
          <div className="px-3 py-2 border-b border-th-line text-[10px] font-bold uppercase tracking-wider text-th-dim">Saved views</div>

          <div className="max-h-64 overflow-y-auto">
            {here.length === 0 && (
              <p className="px-3 py-3 text-xs text-th-dim">No saved views for this page yet.</p>
            )}
            {here.map((v) => (
              <div key={v.id} className="group flex items-center gap-2 px-3 py-2 hover:bg-th-hover">
                <button onClick={() => apply(v.search)} className="flex-1 min-w-0 text-left">
                  <span className="block text-sm text-th-body truncate">{v.name}</span>
                  <span className="block text-[10px] font-mono text-th-ghost truncate">{v.search}</span>
                </button>
                <button onClick={() => remove(v.id)} title="Delete view" className="shrink-0 text-th-ghost hover:text-th-danger opacity-0 group-hover:opacity-100 transition-opacity">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
            ))}
          </div>

          <div className="border-t border-th-line p-2">
            {hasQuery ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={name}
                  autoFocus
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") saveCurrent(); }}
                  placeholder="Name this view…"
                  className="flex-1 min-w-0 px-2 py-1.5 bg-th-subtle border border-th-line rounded text-xs text-th-body placeholder:text-th-ghost focus:outline-none focus:ring-1 focus:ring-th-accent"
                />
                <button onClick={saveCurrent} disabled={!name.trim()} className="shrink-0 px-3 py-1.5 text-xs bg-th-accent text-white rounded hover:opacity-90 disabled:opacity-50">Save</button>
              </div>
            ) : (
              <p className="px-1 py-1 text-[11px] text-th-dim">Filter or sort this list, then save it as a view.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
