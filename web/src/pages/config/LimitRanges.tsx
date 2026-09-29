import { useState } from "react";
import { TableSkeleton } from "@/components/Skeleton";
import { useOutletContext } from "react-router-dom";
import { listLimitRanges } from "@/api/client";
import type { LimitRangeSummary, LimitRangeItem } from "@/api/client";
import { useLiveResource } from "@/hooks/useLiveResource";
import LiveIndicator from "@/components/LiveIndicator";
import EditYAMLModal from "@/components/EditYAMLModal";
import { StatStrip } from "@/components/ResourceSummary";
import { EmptyState } from "@/components/EmptyState";

function age(created: string): string {
  const diff = Date.now() - new Date(created).getTime();
  const days = Math.floor(diff / 86400000);
  if (days > 0) return `${days}d`;
  const hours = Math.floor(diff / 3600000);
  if (hours > 0) return `${hours}h`;
  return `${Math.floor(diff / 60000)}m`;
}

function fmtLimits(rec: Record<string, string>): string {
  const entries = Object.entries(rec || {});
  if (entries.length === 0) return "-";
  return entries.map(([k, v]) => `${k}=${v}`).join(", ");
}

function LimitRow({ item }: { item: LimitRangeItem }) {
  return (
    <div className="grid grid-cols-5 gap-2 text-xs py-1">
      <span className="font-medium text-th-body">{item.type}</span>
      <span className="text-th-dim">{fmtLimits(item.min)}</span>
      <span className="text-th-dim">{fmtLimits(item.max)}</span>
      <span className="text-th-dim">{fmtLimits(item.default_request)}</span>
      <span className="text-th-dim">{fmtLimits(item.default)}</span>
    </div>
  );
}

export default function LimitRanges() {
  const { namespace } = useOutletContext<{ namespace: string }>();
  const { data: items, loading, error, refresh, watchStatus, live, setLive } = useLiveResource<LimitRangeSummary[]>(
    () => listLimitRanges(namespace),
    "LimitRange",
    namespace,
    [namespace],
  );
  const [search, setSearch] = useState("");
  const [editYaml, setEditYaml] = useState<{ ns: string; name: string } | null>(null);

  const filtered = (items ?? []).filter(
    (l) =>
      l.name.toLowerCase().includes(search.toLowerCase()) ||
      l.namespace.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-th-heading">Limit Ranges</h1>
        <div className="flex items-center gap-2">
          <LiveIndicator live={live} status={watchStatus} onToggle={setLive} />
          <button onClick={refresh} className="px-3 py-1.5 text-sm bg-th-accent text-white rounded-lg hover:opacity-90 transition-opacity">Refresh</button>
        </div>
      </div>

      <input
        type="text"
        placeholder="Search limit ranges..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full max-w-sm px-3 py-2 bg-th-subtle border border-th-line rounded-lg text-sm text-th-body placeholder:text-th-ghost focus:outline-none focus:ring-1 focus:ring-th-accent"
      />

      {loading && <TableSkeleton />}
      {error && <div className="p-3 bg-th-danger-s text-th-danger rounded-lg text-sm">{error}</div>}

      {!loading && (items ?? []).length > 0 && (
        <StatStrip stats={[
          { label: "Limit Ranges", value: (items ?? []).length, tone: "accent" },
          { label: "Namespaces", value: new Set((items ?? []).map((l) => l.namespace)).size, tone: "info" },
        ]} />
      )}

      {!loading && (
        <div className="space-y-3">
          {filtered.map((l) => (
            <div key={`${l.namespace}/${l.name}`} className="bg-th-panel border border-th-line rounded-xl shadow-card p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-3">
                  <span className="font-medium text-th-body">{l.name}</span>
                  <span className="px-2 py-0.5 rounded text-xs bg-th-subtle text-th-dim">{l.namespace}</span>
                  <span className="text-xs text-th-ghost">{age(l.created_at)}</span>
                </div>
                <button
                  onClick={() => setEditYaml({ ns: l.namespace, name: l.name })}
                  className="px-2 py-1 text-xs bg-th-info-s text-th-info rounded hover:opacity-80"
                >Edit</button>
              </div>
              <div className="grid grid-cols-5 gap-2 text-[10px] uppercase tracking-wider text-th-ghost border-b border-th-line pb-1 mb-1">
                <span>Type</span><span>Min</span><span>Max</span><span>Default Request</span><span>Default Limit</span>
              </div>
              {(l.limits || []).map((item, i) => <LimitRow key={i} item={item} />)}
              {(!l.limits || l.limits.length === 0) && (
                <p className="text-xs text-th-ghost">No limit items defined</p>
              )}
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="bg-th-panel border border-th-line rounded-xl shadow-card">
              <EmptyState
                title={search ? "No matching limit ranges" : "No limit ranges"}
                hint={search
                  ? "No limit ranges match your search in this scope."
                  : "Limit ranges set default and min/max CPU and memory for containers in a namespace, so pods without explicit requests still get sensible bounds."}
              />
            </div>
          )}
        </div>
      )}

      {editYaml && (
        <EditYAMLModal
          kind="LimitRange"
          namespace={editYaml.ns}
          name={editYaml.name}
          onClose={() => setEditYaml(null)}
          onUpdated={refresh}
        />
      )}
    </div>
  );
}
