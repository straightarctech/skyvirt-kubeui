import type { WatchStatus } from "@/hooks/useWatch";

/**
 * Live-updates pill. Click to toggle real-time updates on/off. When live, a
 * pulsing dot reflects the watch connection status; when paused, the user drives
 * updates with the Refresh button.
 */
export default function LiveIndicator({
  live,
  status,
  onToggle,
}: {
  live: boolean;
  status: WatchStatus;
  onToggle: (v: boolean) => void;
}) {
  const paused = !live || status === "paused";
  // "unavailable" isn't a failure — the resource simply has no API endpoint in
  // this cluster, so it reads as a muted "No live data", not a red "Reconnecting".
  const label =
    paused ? "Paused"
    : status === "live" ? "Live"
    : status === "unavailable" ? "No live data"
    : status === "error" ? "Reconnecting"
    : "Connecting";

  const dot =
    paused ? "bg-th-ghost"
    : status === "live" ? "bg-th-ok"
    : status === "unavailable" ? "bg-th-ghost"
    : status === "error" ? "bg-th-danger"
    : "bg-th-warn";

  const title =
    status === "unavailable"
      ? "This resource type isn't installed in this cluster — nothing to stream"
      : live
        ? "Real-time updates on — click to pause"
        : "Real-time updates paused — click to resume";

  return (
    <button
      onClick={() => onToggle(!live)}
      title={title}
      aria-pressed={live}
      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-th-line bg-th-subtle text-th-body hover:bg-th-hover transition-colors"
    >
      <span className="relative flex h-2 w-2">
        {!paused && status === "live" && (
          <span className={`absolute inline-flex h-full w-full rounded-full opacity-60 animate-ping ${dot}`} />
        )}
        <span className={`relative inline-flex rounded-full h-2 w-2 ${dot}`} />
      </span>
      {label}
    </button>
  );
}
