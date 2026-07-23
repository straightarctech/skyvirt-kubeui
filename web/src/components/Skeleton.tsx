/**
 * Shimmer loading skeletons shown while list/detail data loads.
 * Replaces the bare centered spinner for a calmer, more polished feel.
 */
export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="bg-th-panel border border-th-line rounded-xl overflow-hidden shadow-card animate-fade-in">
      <div className="bg-th-subtle border-b border-th-line px-4 py-3 flex gap-6">
        {[24, 16, 12, 16, 10].map((w, i) => (
          <div key={i} className={`h-3 rounded skeleton-shimmer`} style={{ width: `${w}%` }} />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="px-4 py-3.5 border-b border-th-line last:border-0 flex gap-6 items-center">
          {[22, 14, 10, 18, 8].map((w, i) => (
            <div
              key={i}
              className="h-3 rounded skeleton-shimmer"
              style={{ width: `${w}%`, animationDelay: `${(r * 5 + i) * 60}ms` }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
