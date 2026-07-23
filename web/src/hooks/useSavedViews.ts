import { useCallback, useState } from "react";

export interface SavedView {
  id: string;
  name: string;
  /** Route pathname the view belongs to, e.g. "/workloads/pods". */
  path: string;
  /** The URL query (incl. leading "?"), e.g. "?q=keda&sort=age". */
  search: string;
}

const KEY = "kubeui.savedViews";

function load(): SavedView[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
function persist(v: SavedView[]) {
  localStorage.setItem(KEY, JSON.stringify(v));
}

/**
 * localStorage-backed named views: a saved (path, query) snapshot of a list's
 * filter/sort/page state, so common filtered views are one click away. Purely
 * client-side — fits the air-gap, per-user model with no backend.
 */
export function useSavedViews() {
  const [views, setViews] = useState<SavedView[]>(load);

  const add = useCallback((name: string, path: string, search: string) => {
    const view: SavedView = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      name: name.trim(),
      path,
      search,
    };
    setViews((prev) => {
      const next = [...prev, view];
      persist(next);
      return next;
    });
  }, []);

  const remove = useCallback((id: string) => {
    setViews((prev) => {
      const next = prev.filter((v) => v.id !== id);
      persist(next);
      return next;
    });
  }, []);

  const forPath = useCallback((path: string) => views.filter((v) => v.path === path), [views]);

  return { views, add, remove, forPath };
}
