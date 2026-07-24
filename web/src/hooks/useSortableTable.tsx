import { useMemo, ReactNode } from "react";
import { useMaybeUrlState } from "@/hooks/useUrlState";

export type SortDir = "asc" | "desc";

/** A column's sort accessor: return a string or number to sort by. */
type Accessor<T> = (row: T) => string | number | null | undefined;

interface UseSortableTableResult<T> {
  sorted: T[];
  sortKey: string | null;
  sortDir: SortDir;
  /** Toggle sort on a column key (asc → desc → asc). */
  toggleSort: (key: string) => void;
  /** Props to spread onto a <SortableTh>. */
  thProps: (key: string) => { sortKey: string | null; sortDir: SortDir; onSort: () => void; columnKey: string };
}

/**
 * Client-side table sorting. Pass rows and a map of columnKey → accessor.
 * Numbers sort numerically, strings case-insensitively; null/undefined sink
 * to the bottom regardless of direction.
 */
export function useSortableTable<T>(
  rows: T[],
  accessors: Record<string, Accessor<T>>,
  initial?: { key: string; dir?: SortDir; urlKey?: string },
): UseSortableTableResult<T> {
  const [sortKey, setSortKey] = useMaybeUrlState<string | null>(
    initial?.urlKey, "sort", initial?.key ?? null,
    (s) => s, (v) => v ?? "",
  );
  const [sortDir, setSortDir] = useMaybeUrlState<SortDir>(
    initial?.urlKey, "dir", initial?.dir ?? "asc",
    (s) => (s === "desc" ? "desc" : "asc"), (v) => v,
  );

  const toggleSort = (key: string) => {
    if (key === sortKey) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const sorted = useMemo(() => {
    if (!sortKey || !accessors[sortKey]) return rows;
    const acc = accessors[sortKey];
    const dir = sortDir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = acc(a);
      const vb = acc(b);
      // Nulls always sink to the bottom.
      const na = va === null || va === undefined || va === "";
      const nb = vb === null || vb === undefined || vb === "";
      if (na && nb) return 0;
      if (na) return 1;
      if (nb) return -1;
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
      return String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: "base" }) * dir;
    });
  }, [rows, sortKey, sortDir, accessors]);

  const thProps = (key: string) => ({ sortKey, sortDir, onSort: () => toggleSort(key), columnKey: key });

  return { sorted, sortKey, sortDir, toggleSort, thProps };
}

/**
 * Sortable table header cell. Renders the label with an up/down caret that
 * reflects the active sort. Non-sortable columns should stay plain <th>.
 */
export function SortableTh({
  children,
  columnKey,
  sortKey,
  sortDir,
  onSort,
  className = "",
  align = "left",
}: {
  children: ReactNode;
  columnKey: string;
  sortKey: string | null;
  sortDir: SortDir;
  onSort: () => void;
  className?: string;
  align?: "left" | "right" | "center";
}) {
  const active = sortKey === columnKey;
  const justify = align === "right" ? "justify-end" : align === "center" ? "justify-center" : "";
  return (
    <th className={`px-4 py-3 font-medium select-none ${className}`}>
      <button
        type="button"
        onClick={onSort}
        className={`group inline-flex items-center gap-1 hover:text-th-body transition-colors ${justify} ${active ? "text-th-body" : ""}`}
        title="Sort"
      >
        {children}
        <span className={`transition-opacity ${active ? "opacity-100 text-th-accent" : "opacity-0 group-hover:opacity-40"}`}>
          {active && sortDir === "desc" ? (
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
            </svg>
          ) : (
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
            </svg>
          )}
        </span>
      </button>
    </th>
  );
}
