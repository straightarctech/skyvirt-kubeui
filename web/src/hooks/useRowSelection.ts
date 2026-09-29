import { useCallback, useMemo, useState } from "react";

export interface RowSelection<T> {
  /** Number of selected rows. */
  count: number;
  isSelected: (key: string) => boolean;
  toggle: (key: string) => void;
  /** Toggle all of `rows`: selects them if not all selected, else deselects them. */
  toggleAll: (rows: T[]) => void;
  clear: () => void;
  /** True when every row in `rows` is selected (and rows is non-empty). */
  allSelected: (rows: T[]) => boolean;
  /** True when some — but not all — of `rows` are selected. */
  someSelected: (rows: T[]) => boolean;
  /** The selected rows, resolved from `all` by key. Survives paging/filtering. */
  selectedRows: (all: T[]) => T[];
}

/**
 * Tracks a set of selected rows by stable key (e.g. "namespace/name"). Selection
 * persists across pagination and filtering because it stores keys, not indices.
 */
export function useRowSelection<T>(keyOf: (row: T) => string): RowSelection<T> {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggle = useCallback((key: string) => {
    setSelected((s) => {
      const n = new Set(s);
      n.has(key) ? n.delete(key) : n.add(key);
      return n;
    });
  }, []);

  const toggleAll = useCallback((rows: T[]) => {
    const keys = rows.map(keyOf);
    setSelected((s) => {
      const allOn = keys.length > 0 && keys.every((k) => s.has(k));
      const n = new Set(s);
      if (allOn) keys.forEach((k) => n.delete(k));
      else keys.forEach((k) => n.add(k));
      return n;
    });
  }, [keyOf]);

  const clear = useCallback(() => setSelected(new Set()), []);

  return useMemo(() => ({
    count: selected.size,
    isSelected: (key: string) => selected.has(key),
    toggle,
    toggleAll,
    clear,
    allSelected: (rows: T[]) => rows.length > 0 && rows.every((r) => selected.has(keyOf(r))),
    someSelected: (rows: T[]) => {
      const on = rows.filter((r) => selected.has(keyOf(r))).length;
      return on > 0 && on < rows.length;
    },
    selectedRows: (all: T[]) => all.filter((r) => selected.has(keyOf(r))),
  }), [selected, toggle, toggleAll, clear, keyOf]);
}

/**
 * Runs an async op over items with bounded concurrency, reporting progress.
 * Never rejects — failures are collected per-item.
 */
export async function runBulk<T>(
  items: T[],
  fn: (item: T) => Promise<void>,
  onProgress?: (done: number, total: number) => void,
  concurrency = 5,
): Promise<{ ok: number; failed: { item: T; error: string }[] }> {
  const failed: { item: T; error: string }[] = [];
  let done = 0;
  const queue = [...items];

  const worker = async () => {
    for (;;) {
      const item = queue.shift();
      if (item === undefined) return;
      try {
        await fn(item);
      } catch (e) {
        failed.push({ item, error: e instanceof Error ? e.message : String(e) });
      }
      done++;
      onProgress?.(done, items.length);
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return { ok: items.length - failed.length, failed };
}
