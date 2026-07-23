import { useState, useMemo } from "react";
import { useUrlSearch } from "@/hooks/useUrlState";
import { EmptyRow } from "@/components/EmptyState";
import { TableSkeleton } from "@/components/Skeleton";
import { useOutletContext } from "react-router-dom";
import {
  listValidatingWebhooks,
  listMutatingWebhooks,
  deleteValidatingWebhook,
  deleteMutatingWebhook,
} from "@/api/client";
import type { WebhookSummary } from "@/api/client";
import { useResource } from "@/hooks/useResource";
import { useLiveResources } from "@/hooks/useLiveResource";
import LiveIndicator from "@/components/LiveIndicator";
import { useSortableTable, SortableTh } from "@/hooks/useSortableTable";
import { usePagination, TablePagination } from "@/hooks/usePagination";
import DeleteConfirmModal from "@/components/DeleteConfirmModal";
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";

const TYPE_COLORS = ["#6366f1", "#a855f7", "#3b82f6", "#22c55e", "#f59e0b", "#ef4444"];

function age(created: string): string {
  const diff = Date.now() - new Date(created).getTime();
  const days = Math.floor(diff / 86400000);
  if (days > 0) return `${days}d`;
  const hours = Math.floor(diff / 3600000);
  if (hours > 0) return `${hours}h`;
  return `${Math.floor(diff / 60000)}m`;
}

export default function Webhooks() {
  useOutletContext<{ namespace: string }>();
  const { data: validating, loading: l1, error: e1, refresh: r1 } = useResource<WebhookSummary[]>(
    () => listValidatingWebhooks(),
    [],
  );
  const { data: mutating, loading: l2, error: e2, refresh: r2 } = useResource<WebhookSummary[]>(
    () => listMutatingWebhooks(),
    [],
  );
  const [search, setSearch] = useUrlSearch();
  const [tab, setTab] = useState<"validating" | "mutating">("validating");
  const [deleteTarget, setDeleteTarget] = useState<{ name: string; kind: string } | null>(null);

  const loading = l1 || l2;
  const error = e1 || e2;
  const refresh = () => { r1(); r2(); };
  const { watchStatus, live, setLive } = useLiveResources(
    [{ kind: "ValidatingWebhookConfiguration" }, { kind: "MutatingWebhookConfiguration" }],
    refresh,
  );

  const items = tab === "validating" ? validating : mutating;
  const filtered = (items ?? []).filter((w) => w.name.toLowerCase().includes(search.toLowerCase()));

  const { sorted, thProps } = useSortableTable(filtered, {
    name: (w) => w.name,
    webhooks: (w) => w.webhooks,
    failure_policy: (w) => w.failure_policy,
    side_effects: (w) => w.side_effects,
    age: (w) => Date.now() - new Date(w.created_at).getTime(),
  }, { key: "name", urlKey: "" });

  const pager = usePagination(sorted, { pageSize: 25, urlKey: "" });

  const typeData = useMemo(() => {
    const vCount = (validating ?? []).length;
    const mCount = (mutating ?? []).length;
    const data: { name: string; value: number }[] = [];
    if (vCount > 0) data.push({ name: "Validating", value: vCount });
    if (mCount > 0) data.push({ name: "Mutating", value: mCount });
    return data;
  }, [validating, mutating]);

  const totalWebhooks = useMemo(() => (validating ?? []).length + (mutating ?? []).length, [validating, mutating]);
  const failCount = useMemo(() => {
    const all = [...(validating ?? []), ...(mutating ?? [])];
    return all.filter((w) => w.failure_policy === "Fail").length;
  }, [validating, mutating]);

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-th-heading">Webhook Configurations</h1>
        <div className="flex items-center gap-2">
          <LiveIndicator live={live} status={watchStatus} onToggle={setLive} />
          <button onClick={refresh} className="px-3 py-1.5 text-sm bg-th-accent text-white rounded-lg hover:opacity-90 transition-opacity">Refresh</button>
        </div>
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => setTab("validating")}
          className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${tab === "validating" ? "bg-th-accent text-white" : "bg-th-subtle text-th-dim hover:text-th-body"}`}
        >Validating ({(validating ?? []).length})</button>
        <button
          onClick={() => setTab("mutating")}
          className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${tab === "mutating" ? "bg-th-accent text-white" : "bg-th-subtle text-th-dim hover:text-th-body"}`}
        >Mutating ({(mutating ?? []).length})</button>
      </div>

      <input
        type="text"
        placeholder="Search webhooks..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full max-w-sm px-3 py-2 bg-th-subtle border border-th-line rounded-lg text-sm text-th-body placeholder:text-th-ghost focus:outline-none focus:ring-1 focus:ring-th-accent"
      />

      {loading && <TableSkeleton />}
      {error && <div className="p-3 bg-th-danger-s text-th-danger rounded-lg text-sm">{error}</div>}

      {!loading && totalWebhooks > 0 && (
        <div className="grid grid-cols-12 gap-4">
          <div className="col-span-12 md:col-span-4 bg-th-panel border border-th-line rounded-xl p-4 shadow-card">
            <h3 className="text-xs font-bold text-th-dim uppercase tracking-wider mb-2">By Type</h3>
            <div className="flex items-center gap-4">
              <div className="w-24 h-24">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart><Pie data={typeData} cx="50%" cy="50%" innerRadius={24} outerRadius={42} paddingAngle={3} dataKey="value" stroke="none">
                    {typeData.map((_, i) => <Cell key={i} fill={TYPE_COLORS[i % TYPE_COLORS.length]} />)}
                  </Pie></PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-col gap-1">
                {typeData.map((d, i) => (
                  <div key={d.name} className="flex items-center gap-2 text-xs">
                    <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: TYPE_COLORS[i % TYPE_COLORS.length] }} />
                    <span className="text-th-dim truncate">{d.name}</span>
                    <span className="font-semibold text-th-body">{d.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="col-span-12 md:col-span-8 flex gap-4">
            <div className="flex-1 bg-th-panel border border-th-line rounded-xl p-4 shadow-card flex flex-col items-center justify-center">
              <p className="text-3xl font-black text-th-accent">{totalWebhooks}</p>
              <p className="text-[10px] text-th-dim uppercase tracking-wider">Webhooks</p>
            </div>
            <div className="flex-1 bg-th-panel border border-th-line rounded-xl p-4 shadow-card flex flex-col items-center justify-center">
              <p className="text-3xl font-black text-th-danger">{failCount}</p>
              <p className="text-[10px] text-th-dim uppercase tracking-wider">Fail Policy</p>
            </div>
          </div>
        </div>
      )}

      {!loading && (
        <div className="bg-th-panel border border-th-line rounded-xl overflow-hidden shadow-card">
          <div className="overflow-x-auto pin-actions">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-th-dim bg-th-subtle border-b border-th-line">
                  <SortableTh {...thProps("name")}>Name</SortableTh>
                  <SortableTh {...thProps("webhooks")}>Webhooks</SortableTh>
                  <SortableTh {...thProps("failure_policy")}>Failure Policy</SortableTh>
                  <SortableTh {...thProps("side_effects")}>Side Effects</SortableTh>
                  <SortableTh {...thProps("age")}>Age</SortableTh>
                  <th className="px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pager.paged.map((w) => (
                  <tr key={w.name} className="border-b border-th-line last:border-0 hover:bg-th-hover transition-colors">
                    <td className="px-4 py-3 font-medium text-th-body text-xs">{w.name}</td>
                    <td className="px-4 py-3 text-th-dim">{w.webhooks}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${w.failure_policy === "Fail" ? "bg-th-danger-s text-th-danger" : "bg-th-warn-s text-th-warn"}`}>
                        {w.failure_policy || "-"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-th-dim text-xs">{w.side_effects || "-"}</td>
                    <td className="px-4 py-3 text-th-ghost">{age(w.created_at)}</td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => setDeleteTarget({ name: w.name, kind: tab === "validating" ? "ValidatingWebhookConfiguration" : "MutatingWebhookConfiguration" })}
                        className="px-2 py-1 text-xs bg-th-danger-s text-th-danger rounded hover:opacity-80"
                      >Delete</button>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <EmptyRow colSpan={6} title="No webhooks found" />
                )}
              </tbody>
            </table>
          </div>
          <TablePagination {...pager} label="webhooks" />
        </div>
      )}

      <DeleteConfirmModal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onDeleted={refresh}
        resourceType={deleteTarget?.kind === "ValidatingWebhookConfiguration" ? "Validating Webhook" : "Mutating Webhook"}
        resourceName={deleteTarget?.name ?? ""}
        kind={deleteTarget?.kind ?? "ValidatingWebhookConfiguration"}
        deleteFn={() =>
          deleteTarget?.kind === "ValidatingWebhookConfiguration"
            ? deleteValidatingWebhook(deleteTarget!.name)
            : deleteMutatingWebhook(deleteTarget!.name)
        }
      />
    </div>
  );
}
