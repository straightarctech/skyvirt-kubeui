import { useState, useMemo } from "react";
import { TableSkeleton } from "@/components/Skeleton";
import { useOutletContext } from "react-router-dom";
import { listEvents } from "@/api/client";
import type { EventSummary } from "@/api/client";
import { useResource } from "@/hooks/useResource";
import { StatStrip } from "@/components/ResourceSummary";

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(diff / 3600000);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

export default function Alerts() {
  const { namespace } = useOutletContext<{ namespace: string }>();
  const { data: events, loading, error, refresh } = useResource<EventSummary[]>(
    () => listEvents(namespace),
    [namespace],
  );
  const [search, setSearch] = useState("");

  const warnings = useMemo(
    () =>
      (events ?? [])
        .filter((e) => e.type === "Warning")
        .sort((a, b) => new Date(b.last_seen).getTime() - new Date(a.last_seen).getTime()),
    [events],
  );

  const filtered = warnings.filter(
    (e) =>
      e.message.toLowerCase().includes(search.toLowerCase()) ||
      e.reason.toLowerCase().includes(search.toLowerCase()) ||
      e.regarding_name.toLowerCase().includes(search.toLowerCase()),
  );

  const reasonData = useMemo(() => {
    const reasonCounts: Record<string, number> = {};
    warnings.forEach((w) => { reasonCounts[w.reason] = (reasonCounts[w.reason] || 0) + 1; });
    return Object.entries(reasonCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([name, value]) => ({ name, value }));
  }, [warnings]);

  const totalOccurrences = warnings.reduce((sum, w) => sum + (w.count || 1), 0);
  const uniqueResources = new Set(warnings.map((w) => `${w.regarding_kind}/${w.regarding_name}`)).size;

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-th-heading">Alerts</h1>
          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-th-warn-s text-th-warn">
            {warnings.length} warnings
          </span>
        </div>
        <button onClick={refresh} className="px-3 py-1.5 text-sm bg-th-accent text-white rounded-lg hover:opacity-90 transition-opacity">Refresh</button>
      </div>

      {!loading && warnings.length > 0 && (
        <StatStrip stats={[
          { label: "Unique Alerts", value: warnings.length, tone: "warn" },
          { label: "Occurrences", value: totalOccurrences, tone: "error" },
          { label: "Resources", value: uniqueResources, tone: "info" },
          { label: "Reasons", value: reasonData.length, tone: "neutral" },
          { label: "Top Reason", value: reasonData[0]?.name ?? "—", tone: "neutral" },
        ]} />
      )}

      <input
        type="text"
        placeholder="Search alerts..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full max-w-sm px-3 py-2 bg-th-subtle border border-th-line rounded-lg text-sm text-th-body placeholder:text-th-ghost focus:outline-none focus:ring-1 focus:ring-th-accent"
      />

      {loading && <TableSkeleton />}
      {error && <div className="p-3 bg-th-danger-s text-th-danger rounded-lg text-sm">{error}</div>}

      {!loading && (
        <div className="space-y-3">
          {filtered.map((e, i) => (
            <div key={`${e.namespace}-${e.name}-${i}`} className="bg-th-panel border border-th-line rounded-xl p-4 shadow-card">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="px-2 py-0.5 rounded text-xs font-medium bg-th-warn-s text-th-warn">{e.reason}</span>
                    <span className="text-xs text-th-ghost">{e.regarding_kind}/{e.regarding_name}</span>
                    {e.count > 1 && (
                      <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-th-danger-s text-th-danger">
                        x{e.count}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-th-body">{e.message}</p>
                  <p className="text-xs text-th-ghost mt-1">{e.namespace} &middot; {e.source} &middot; {timeAgo(e.last_seen)}</p>
                </div>
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="bg-th-panel border border-th-line rounded-xl p-8 text-center shadow-card">
              <p className="text-th-ok font-medium">No warning events</p>
              <p className="text-sm text-th-ghost mt-1">All systems operating normally</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
