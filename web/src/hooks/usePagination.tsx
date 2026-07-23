import { useEffect, useMemo } from "react";
import { useMaybeUrlState } from "@/hooks/useUrlState";

const DEFAULT_PAGE_SIZES = [10, 25, 50, 100];

export interface UsePaginationResult<T> {
  /** The rows for the current page. */
  paged: T[];
  page: number;
  setPage: (p: number) => void;
  pageSize: number;
  setPageSize: (n: number) => void;
  total: number;
  pageCount: number;
  /** 1-indexed first row shown (0 when empty). */
  from: number;
  /** 1-indexed last row shown. */
  to: number;
}

/**
 * Client-side pagination. Feed it the already-filtered+sorted rows; it slices
 * out the current page. The page auto-clamps when the row count shrinks (e.g. a
 * search narrows results) so you never get stranded on an empty page.
 */
export function usePagination<T>(rows: T[], opts?: { pageSize?: number; urlKey?: string }): UsePaginationResult<T> {
  const defaultSize = opts?.pageSize ?? 25;
  const [pageSize, setPageSizeRaw] = useMaybeUrlState<number>(
    opts?.urlKey, "size", defaultSize,
    (s) => parseInt(s, 10) || defaultSize, (v) => String(v),
  );
  const [page, setPage] = useMaybeUrlState<number>(
    opts?.urlKey, "page", 1,
    (s) => Math.max(1, parseInt(s, 10) || 1), (v) => String(v),
  );

  const total = rows.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [pageCount, page]);

  const setPageSize = (n: number) => {
    // Reset to page 1 FIRST, then set the size, so the size write is the last
    // navigate of the tick. Both URL-state setters merge from the same (stale)
    // query snapshot, so if setPage(1) — which deletes the default page param —
    // ran last it would clobber the new size back to the default. The page
    // clamp effect then trims any now-out-of-range page.
    setPage(1);
    setPageSizeRaw(n);
  };

  const paged = useMemo(() => {
    const start = (page - 1) * pageSize;
    return rows.slice(start, start + pageSize);
  }, [rows, page, pageSize]);

  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return { paged, page, setPage, pageSize, setPageSize, total, pageCount, from, to };
}

/** Compact page-number list with ellipses, e.g. 1 … 4 5 [6] 7 8 … 20. */
function pageWindow(page: number, pageCount: number): (number | "…")[] {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1);
  const out: (number | "…")[] = [1];
  const lo = Math.max(2, page - 1);
  const hi = Math.min(pageCount - 1, page + 1);
  if (lo > 2) out.push("…");
  for (let i = lo; i <= hi; i++) out.push(i);
  if (hi < pageCount - 1) out.push("…");
  out.push(pageCount);
  return out;
}

/**
 * Pagination footer for a table. Spread a usePagination() result onto it:
 *   <TablePagination {...pg} />
 * Hides itself when everything fits on one page AND the default size is shown.
 */
export function TablePagination<T>({
  page,
  setPage,
  pageSize,
  setPageSize,
  total,
  pageCount,
  from,
  to,
  pageSizeOptions = DEFAULT_PAGE_SIZES,
  label = "items",
}: UsePaginationResult<T> & { pageSizeOptions?: number[]; label?: string }) {
  if (total === 0) return null;

  const win = pageWindow(page, pageCount);
  const btn =
    "min-w-[2rem] h-8 px-2 inline-flex items-center justify-center rounded-md text-xs font-medium border border-th-line transition-colors disabled:opacity-40 disabled:cursor-not-allowed";

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t border-th-line text-th-dim">
      <div className="flex items-center gap-3 text-xs tabular-nums">
        <span>
          Showing <span className="font-semibold text-th-body">{from.toLocaleString()}</span>–
          <span className="font-semibold text-th-body">{to.toLocaleString()}</span> of{" "}
          <span className="font-semibold text-th-body">{total.toLocaleString()}</span> {label}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="text-th-ghost">·</span>
          <label htmlFor="page-size" className="sr-only">Rows per page</label>
          <select
            id="page-size"
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value))}
            className="bg-th-subtle border border-th-line rounded-md px-2 py-1 text-xs text-th-body focus:outline-none focus:ring-1 focus:ring-th-accent"
          >
            {pageSizeOptions.map((n) => (
              <option key={n} value={n}>{n} / page</option>
            ))}
          </select>
        </span>
      </div>

      <div className="flex items-center gap-1">
        <button className={`${btn} bg-th-subtle text-th-body hover:bg-th-hover`} onClick={() => setPage(page - 1)} disabled={page <= 1} aria-label="Previous page">‹</button>
        {win.map((p, i) =>
          p === "…" ? (
            <span key={`e${i}`} className="px-1 text-th-ghost text-xs select-none">…</span>
          ) : (
            <button
              key={p}
              onClick={() => setPage(p)}
              aria-current={p === page ? "page" : undefined}
              className={`${btn} ${p === page ? "bg-th-accent text-white border-th-accent" : "bg-th-subtle text-th-body hover:bg-th-hover"}`}
            >
              {p}
            </button>
          ),
        )}
        <button className={`${btn} bg-th-subtle text-th-body hover:bg-th-hover`} onClick={() => setPage(page + 1)} disabled={page >= pageCount} aria-label="Next page">›</button>
      </div>
    </div>
  );
}
