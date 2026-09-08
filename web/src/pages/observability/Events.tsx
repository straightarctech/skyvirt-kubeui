import { useState, useMemo } from "react";
import { TableSkeleton } from "@/components/Skeleton";
import { useOutletContext } from "react-router-dom";
import { listEvents } from "@/api/client";
import type { EventSummary } from "@/api/client";
import { useLiveResource } from "@/hooks/useLiveResource";
import LiveIndicator from "@/components/LiveIndicator";
import { EmptyState } from "@/components/EmptyState";
import { StatStrip } from "@/components/ResourceSummary";
import { DistributionBar } from "@/components/DistributionBar";

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function Events() {
  const { namespace } = useOutletContext<{ namespace: string }>();
  const { data: events, loading, error, refresh, watchStatus, live, setLive } = useLiveResource<EventSummary[]>(
    () => listEvents(namespace),
    "Event",
    namespace,
    [namespace],
  );
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "Normal" | "Warning">("all");

  const filtered = (events ?? []).filter((e) => {
    if (typeFilter !== "all" && e.type !== typeFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        e.reason.toLowerCase().includes(q) ||
        e.message.toLowerCase().includes(q) ||
        e.regarding_name.toLowerCase().includes(q) ||
        e.regarding_kind.toLowerCase().includes(q) ||
        (e.namespace || "").toLowerCase().includes(q)
      );
    }
    return true;
  });

  const normalCount = (events ?? []).filter((e) => e.type === "Normal").length;
  const warningCount = (events ?? []).filter((e) => e.type === "Warning").length;

  const reasonData = useMemo(() => {
    const reasonCounts: Record<string, number> = {};
    (events ?? []).forEach((e) => { reasonCounts[e.reason] = (reasonCounts[e.reason] || 0) + 1; });
    return Object.entries(reasonCounts).sort((a, b) => b[1] - a[1]).map(([name, value]) => ({ name, value }));
  }, [events]);

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-th-heading">Events Timeline</h1>
        <div className="flex items-center gap-2">
          <LiveIndicator live={live} status={watchStatus} onToggle={setLive} />
          <button onClick={refresh} className="px-3 py-1.5 text-sm bg-th-accent text-white rounded-lg hover:opacity-90 transition-opacity">
            Refresh
          </button>
        </div>
      </div>

      {!loading && (events ?? []).length > 0 && (
        <>
          <StatStrip stats={[
            { label: "Events", value: (events ?? []).length, tone: "accent" },
            { label: "Normal", value: normalCount, tone: "ok" },
            { label: "Warning", value: warningCount, tone: warningCount ? "warn" : "neutral" },
            { label: "Reasons", value: reasonData.length, tone: "neutral" },
            { label: "Top Reason", value: reasonData[0]?.name ?? "—", tone: "neutral" },
          ]} />
          <DistributionBar label="Type" segments={[
            { label: "Normal", value: normalCount, color: "var(--th-ok)" },
            { label: "Warning", value: warningCount, color: "var(--th-warn)" },
          ]} />
        </>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3">
        <input
          type="text"
          placeholder="Search events..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full max-w-sm px-3 py-2 bg-th-subtle border border-th-line rounded-lg text-sm text-th-body placeholder:text-th-ghost focus:outline-none focus:ring-1 focus:ring-th-accent"
        />
        <div className="flex gap-1 bg-th-subtle rounded-lg p-1">
          <button
            onClick={() => setTypeFilter("all")}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
              typeFilter === "all" ? "bg-th-panel text-th-body shadow-sm" : "text-th-dim hover:text-th-body"
            }`}
          >
            All
          </button>
          <button
            onClick={() => setTypeFilter("Normal")}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
              typeFilter === "Normal" ? "bg-th-panel text-th-ok shadow-sm" : "text-th-dim hover:text-th-body"
            }`}
          >
            Normal
          </button>
          <button
            onClick={() => setTypeFilter("Warning")}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
              typeFilter === "Warning" ? "bg-th-panel text-th-warn shadow-sm" : "text-th-dim hover:text-th-body"
            }`}
          >
            Warning
          </button>
        </div>
      </div>

      {loading && <TableSkeleton />}
      {error && <div className="p-3 bg-th-danger-s text-th-danger rounded-lg text-sm">{error}</div>}

      {!loading && (
        <div className="space-y-2">
          {filtered.map((e, i) => (
            <div
              key={`${e.namespace}-${e.name}-${i}`}
              className={`bg-th-panel border rounded-xl p-4 shadow-card transition-colors ${
                e.type === "Warning" ? "border-th-warn/30" : "border-th-line"
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3 min-w-0">
                  <span
                    className={`mt-0.5 inline-block w-2 h-2 rounded-full shrink-0 ${
                      e.type === "Warning" ? "bg-th-warn" : "bg-th-ok"
                    }`}
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-medium ${
                          e.type === "Warning" ? "bg-th-warn-s text-th-warn" : "bg-th-ok-s text-th-ok"
                        }`}
                      >
                        {e.type}
                      </span>
                      <span className="text-sm font-medium text-th-body">{e.reason}</span>
                      <span className="text-xs text-th-ghost">
                        {e.regarding_kind}/{e.regarding_name}
                      </span>
                      {e.namespace && (
                        <span className="text-xs px-1.5 py-0.5 bg-th-subtle border border-th-line rounded text-th-dim">
                          {e.namespace}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-th-dim mt-1 break-words">{e.message}</p>
                    {e.source && (
                      <p className="text-xs text-th-ghost mt-1">Source: {e.source}</p>
                    )}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs text-th-ghost whitespace-nowrap">{timeAgo(e.last_seen)}</p>
                  {e.count > 1 && (
                    <p className="text-xs text-th-dim mt-0.5">{e.count}x</p>
                  )}
                </div>
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <EmptyState
              title={search || typeFilter !== "all" ? "No matching events" : "No events"}
              hint={search || typeFilter !== "all"
                ? "Try clearing the search or the Normal/Warning filter."
                : "The cluster hasn't reported any events in this scope. Events appear here as workloads are scheduled, pulled, and started."}
            />
          )}
        </div>
      )}
    </div>
  );
}
