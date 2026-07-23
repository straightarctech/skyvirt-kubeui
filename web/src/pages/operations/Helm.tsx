import { useState, useMemo } from "react";
import { STATUS } from "@/lib/status";
import { TableSkeleton } from "@/components/Skeleton";
import { useOutletContext } from "react-router-dom";
import {
  listHelmReleases,
  installHelmChart,
  upgradeHelmRelease,
  uninstallHelmRelease,
  rollbackHelmRelease,
  getHelmReleaseValues,
  getHelmReleaseHistory,
  getHelmReleaseNotes,
  getHelmReleaseManifest,
  searchHelmRepo,
} from "@/api/client";
import type { HelmRelease } from "@/api/client";
import { useResource } from "@/hooks/useResource";
import { useSortableTable, SortableTh } from "@/hooks/useSortableTable";
import { usePagination, TablePagination } from "@/hooks/usePagination";
import { useConfirmAction } from "@/hooks/useConfirmAction";
import DeleteConfirmModal from "@/components/DeleteConfirmModal";
import HelmRevisionDiff from "@/components/HelmRevisionDiff";
import YAMLEditor from "@/components/YAMLEditor";

type HelmResource = { kind: string; name: string; namespace?: string };

// Parse a rendered Helm manifest (multi-doc YAML) into the objects it owns —
// the release's footprint. Lightweight (regex, not a full YAML parse): kind +
// the first low-indent metadata.name per document.
function parseManifestResources(manifest: string): HelmResource[] {
  const out: HelmResource[] = [];
  for (const doc of manifest.split(/^---\s*$/m)) {
    const kind = doc.match(/^kind:\s*(\S+)/m)?.[1];
    const name = doc.match(/^\s{0,2}name:\s*["']?([^"'\s]+)/m)?.[1];
    const ns = doc.match(/^\s{0,2}namespace:\s*["']?([^"'\s]+)/m)?.[1];
    if (kind && name) out.push({ kind, name, namespace: ns });
  }
  return out;
}
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";

// Hex (not var()) because these feed recharts <Cell fill>, an SVG attribute
// that can't resolve CSS variables. Sourced from the shared status palette.
const HELM_STATUS_COLORS: Record<string, string> = {
  deployed: STATUS.ok.fill, failed: STATUS.error.fill,
  "pending-install": STATUS.warn.fill, "pending-upgrade": STATUS.warn.fill,
  superseded: STATUS.info.fill, uninstalling: STATUS.warn.fill,
};

function timeAgo(dateStr: string): string {
  if (!dateStr) return "-";
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

function statusColor(status: string): string {
  switch (status.toLowerCase()) {
    case "deployed":
      return "bg-th-ok-s text-th-ok";
    case "failed":
      return "bg-th-danger-s text-th-danger";
    case "pending-install":
    case "pending-upgrade":
    case "pending-rollback":
      return "bg-th-warn-s text-th-warn";
    case "superseded":
      return "bg-th-subtle text-th-ghost";
    case "uninstalling":
      return "bg-th-warn-s text-th-warn";
    default:
      return "bg-th-subtle text-th-dim";
  }
}

const INPUT_CLS =
  "w-full px-3 py-2 bg-th-subtle border border-th-line rounded-lg text-sm text-th-body placeholder:text-th-ghost focus:outline-none focus:ring-1 focus:ring-th-accent";

export default function Helm() {
  const { namespace } = useOutletContext<{ namespace: string }>();
  const { data: releases, loading, error, refresh } = useResource<HelmRelease[]>(
    () => listHelmReleases(namespace),
    [namespace],
  );
  const confirmAction = useConfirmAction();
  const [search, setSearch] = useState("");

  // Install modal
  const [showInstall, setShowInstall] = useState(false);
  const defaultNs = namespace && namespace !== "all" ? namespace : "default";
  const [installForm, setInstallForm] = useState({
    release_name: "",
    namespace: defaultNs,
    repo_url: "",
    chart: "",
    version: "",
    values_text: "",
  });
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState("");

  // Chart search (within the repo typed into the install form)
  const [chartQuery, setChartQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<Record<string, unknown>[] | null>(null);

  const handleChartSearch = async () => {
    if (!installForm.repo_url) return;
    setSearching(true);
    setInstallError("");
    try {
      const res = await searchHelmRepo(installForm.repo_url, chartQuery || undefined);
      setSearchResults(res || []);
    } catch (e) {
      setInstallError(e instanceof Error ? e.message : String(e));
      setSearchResults(null);
    } finally {
      setSearching(false);
    }
  };

  // Upgrade modal
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [upgradeForm, setUpgradeForm] = useState({ version: "", values_text: "" });
  const [upgrading, setUpgrading] = useState(false);
  const [upgradeError, setUpgradeError] = useState("");

  // Detail/actions
  const [diffRev, setDiffRev] = useState<number | null>(null);
  const [selectedRelease, setSelectedRelease] = useState<HelmRelease | null>(null);
  const [releaseValues, setReleaseValues] = useState<string | null>(null);
  const [releaseHistory, setReleaseHistory] = useState<Record<string, unknown>[] | null>(null);
  const [releaseNotes, setReleaseNotes] = useState<string>("");
  const [releaseResources, setReleaseResources] = useState<HelmResource[]>([]);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{ ns: string; name: string } | null>(null);

  const filtered = (releases ?? []).filter(
    (r) =>
      r.name.toLowerCase().includes(search.toLowerCase()) ||
      r.namespace.toLowerCase().includes(search.toLowerCase()) ||
      r.chart.toLowerCase().includes(search.toLowerCase()),
  );

  const { sorted, thProps } = useSortableTable(filtered, {
    name: (r) => r.name,
    namespace: (r) => r.namespace,
    chart: (r) => r.chart,
    status: (r) => r.status,
    revision: (r) => Number(r.revision),
  }, { key: "name" });

  const pager = usePagination(sorted, { pageSize: 25 });

  const statusData = useMemo(() => {
    const counts: Record<string, number> = {};
    filtered.forEach((r) => { counts[r.status.toLowerCase()] = (counts[r.status.toLowerCase()] || 0) + 1; });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [filtered]);

  async function handleInstall() {
    setInstalling(true);
    setInstallError("");
    try {
      const vals: Record<string, string> = {};
      if (installForm.values_text.trim()) {
        for (const line of installForm.values_text.split("\n")) {
          const eq = line.indexOf("=");
          if (eq > 0) vals[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
        }
      }
      await installHelmChart({
        release_name: installForm.release_name,
        namespace: installForm.namespace,
        repo_url: installForm.repo_url,
        chart: installForm.chart,
        version: installForm.version || undefined,
        values: Object.keys(vals).length > 0 ? vals : undefined,
      });
      setShowInstall(false);
      setInstallForm({ release_name: "", namespace: defaultNs, repo_url: "", chart: "", version: "", values_text: "" });
      refresh();
    } catch (err) {
      setInstallError(err instanceof Error ? err.message : "Install failed");
    } finally {
      setInstalling(false);
    }
  }

  function handleUninstall(r: HelmRelease) {
    setDeleteTarget({ ns: r.namespace, name: r.name });
  }

  function handleRollback(r: HelmRelease, rev: number) {
    confirmAction.request({
      key: `${r.namespace}/${r.name}`,
      title: "Rollback Release",
      message: <span>Rollback <span className="font-semibold text-th-heading">{r.name}</span> to revision {rev}?</span>,
      confirmLabel: "Rollback",
      fn: async () => {
        setActionLoading(true);
        setActionError("");
        try {
          await rollbackHelmRelease(r.namespace, r.name, rev);
          setSelectedRelease(null);
          refresh();
        } finally {
          setActionLoading(false);
        }
      },
      successMsg: `Rolled back ${r.name} to revision ${rev}`,
    });
  }

  async function handleUpgrade() {
    if (!selectedRelease) return;
    setUpgrading(true);
    setUpgradeError("");
    try {
      const vals: Record<string, string> = {};
      if (upgradeForm.values_text.trim()) {
        for (const line of upgradeForm.values_text.split("\n")) {
          const eq = line.indexOf("=");
          if (eq > 0) vals[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
        }
      }
      await upgradeHelmRelease(selectedRelease.namespace, selectedRelease.name, {
        version: upgradeForm.version || undefined,
        values: Object.keys(vals).length > 0 ? vals : undefined,
      });
      setShowUpgrade(false);
      setSelectedRelease(null);
      refresh();
    } catch (err) {
      setUpgradeError(err instanceof Error ? err.message : "Upgrade failed");
    } finally {
      setUpgrading(false);
    }
  }

  async function showDetails(r: HelmRelease) {
    setSelectedRelease(r);
    setReleaseValues(null);
    setReleaseHistory(null);
    setReleaseNotes("");
    setReleaseResources([]);
    setActionError("");
    try {
      const [vals, hist, notes, manifest] = await Promise.all([
        getHelmReleaseValues(r.namespace, r.name).catch(() => ({ values: "" })),
        getHelmReleaseHistory(r.namespace, r.name).catch(() => []),
        getHelmReleaseNotes(r.namespace, r.name).catch(() => ({ notes: "" })),
        getHelmReleaseManifest(r.namespace, r.name).catch(() => ({ manifest: "" })),
      ]);
      setReleaseValues(vals.values);
      setReleaseHistory(hist);
      setReleaseNotes(notes.notes || "");
      setReleaseResources(parseManifestResources(manifest.manifest || ""));
    } catch {
      // partial data is ok
    }
  }

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-th-heading">Helm Releases</h1>
        <div className="flex gap-2">
          <button onClick={refresh} className="px-3 py-1.5 text-sm bg-th-subtle border border-th-line text-th-body rounded-lg hover:bg-th-hover transition-colors">
            Refresh
          </button>
          <button onClick={() => setShowInstall(true)} className="px-3 py-1.5 text-sm bg-th-accent text-white rounded-lg hover:opacity-90 transition-opacity">
            + Install Chart
          </button>
        </div>
      </div>

      <input
        type="text"
        placeholder="Search releases..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full max-w-sm px-3 py-2 bg-th-subtle border border-th-line rounded-lg text-sm text-th-body placeholder:text-th-ghost focus:outline-none focus:ring-1 focus:ring-th-accent"
      />

      {loading && <TableSkeleton />}
      {error && <div className="p-3 bg-th-danger-s text-th-danger rounded-lg text-sm">{error}</div>}

      {!loading && filtered.length > 0 && (
        <div className="grid grid-cols-12 gap-4">
          <div className="col-span-12 md:col-span-4 bg-th-panel border border-th-line rounded-xl p-4 shadow-card">
            <h3 className="text-xs font-bold text-th-dim uppercase tracking-wider mb-2">Release Status</h3>
            <div className="flex items-center gap-4">
              <div className="w-24 h-24">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart><Pie data={statusData} cx="50%" cy="50%" innerRadius={24} outerRadius={42} paddingAngle={2} dataKey="value" stroke="none">
                    {statusData.map((d) => <Cell key={d.name} fill={HELM_STATUS_COLORS[d.name] || STATUS.unknown.fill} />)}
                  </Pie></PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-col gap-1">
                {statusData.map((d) => (
                  <div key={d.name} className="flex items-center gap-2 text-xs">
                    <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: HELM_STATUS_COLORS[d.name] || STATUS.unknown.fill }} />
                    <span className="text-th-dim">{d.name}</span>
                    <span className="font-semibold text-th-body">{d.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="col-span-12 md:col-span-8 flex gap-4">
            <div className="flex-1 bg-th-panel border border-th-line rounded-xl p-4 shadow-card flex flex-col items-center justify-center">
              <p className="text-3xl font-black text-th-accent">{filtered.length}</p>
              <p className="text-[10px] text-th-dim uppercase tracking-wider">Releases</p>
            </div>
            <div className="flex-1 bg-th-panel border border-th-line rounded-xl p-4 shadow-card flex flex-col items-center justify-center">
              <p className="text-3xl font-black text-th-ok">{filtered.filter((r) => r.status.toLowerCase() === "deployed").length}</p>
              <p className="text-[10px] text-th-dim uppercase tracking-wider">Deployed</p>
            </div>
            <div className="flex-1 bg-th-panel border border-th-line rounded-xl p-4 shadow-card flex flex-col items-center justify-center">
              <p className="text-3xl font-black text-th-info">{new Set(filtered.map((r) => r.namespace)).size}</p>
              <p className="text-[10px] text-th-dim uppercase tracking-wider">Namespaces</p>
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
                  <SortableTh {...thProps("namespace")}>Namespace</SortableTh>
                  <SortableTh {...thProps("chart")}>Chart</SortableTh>
                  <th className="px-4 py-3 font-medium">App Ver</th>
                  <SortableTh {...thProps("status")}>Status</SortableTh>
                  <SortableTh {...thProps("revision")}>Rev</SortableTh>
                  <th className="px-4 py-3 font-medium">Updated</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pager.paged.map((r) => (
                  <tr key={`${r.namespace}/${r.name}`} className="border-b border-th-line last:border-0 hover:bg-th-hover transition-colors">
                    <td className="px-4 py-3 font-medium text-th-body">{r.name}</td>
                    <td className="px-4 py-3 text-th-dim">{r.namespace}</td>
                    <td className="px-4 py-3 text-th-dim">{r.chart}</td>
                    <td className="px-4 py-3 text-th-dim">{r.app_version || r.version}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusColor(r.status)}`}>
                        {r.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-th-dim">{r.revision}</td>
                    <td className="px-4 py-3 text-th-ghost">{timeAgo(r.updated_at)}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => showDetails(r)} className="px-2 py-1 text-xs bg-th-subtle border border-th-line rounded hover:bg-th-hover" title="Details">
                          Details
                        </button>
                        <button onClick={() => handleUninstall(r)} className="px-2 py-1 text-xs bg-th-danger-s text-th-danger border border-th-danger/20 rounded hover:opacity-80" title="Uninstall">
                          Uninstall
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-th-ghost">
                      No Helm releases found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <TablePagination {...pager} label="releases" />
        </div>
      )}

      {/* Install Modal */}
      {showInstall && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowInstall(false)}>
          <div className="bg-th-panel border border-th-line rounded-xl shadow-2xl w-full max-w-lg p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-th-heading">Install Helm Chart</h2>
            {installError && <div className="p-2 bg-th-danger-s text-th-danger rounded text-sm">{installError}</div>}
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-th-label mb-1">Release Name *</label>
                <input className={INPUT_CLS} placeholder="my-app" value={installForm.release_name} onChange={(e) => setInstallForm((f) => ({ ...f, release_name: e.target.value }))} />
              </div>
              <div>
                <label className="block text-xs font-medium text-th-label mb-1">Namespace</label>
                <input className={INPUT_CLS} placeholder="default" value={installForm.namespace} onChange={(e) => setInstallForm((f) => ({ ...f, namespace: e.target.value }))} />
              </div>
              <div>
                <label className="block text-xs font-medium text-th-label mb-1">Repository URL *</label>
                <input className={INPUT_CLS} placeholder="https://charts.bitnami.com/bitnami" value={installForm.repo_url} onChange={(e) => setInstallForm((f) => ({ ...f, repo_url: e.target.value }))} />
              </div>
              <div>
                <label className="block text-xs font-medium text-th-label mb-1">Chart Name *</label>
                <div className="flex gap-2">
                  <input className={INPUT_CLS} placeholder="nginx" value={installForm.chart} onChange={(e) => setInstallForm((f) => ({ ...f, chart: e.target.value }))} />
                  <input
                    className={INPUT_CLS + " max-w-[130px]"}
                    placeholder="search…"
                    value={chartQuery}
                    onChange={(e) => setChartQuery(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleChartSearch(); }}
                  />
                  <button
                    type="button"
                    onClick={handleChartSearch}
                    disabled={searching || !installForm.repo_url}
                    title={installForm.repo_url ? "Search charts in this repository" : "Enter a repository URL first"}
                    className="px-3 py-2 text-xs bg-th-info-s text-th-info rounded-lg hover:opacity-80 disabled:opacity-50 shrink-0"
                  >
                    {searching ? "…" : "Search"}
                  </button>
                </div>
                {searchResults !== null && (
                  <div className="mt-2 max-h-40 overflow-y-auto border border-th-line rounded-lg divide-y divide-th-line">
                    {searchResults.length === 0 && (
                      <p className="px-3 py-2 text-xs text-th-ghost">No charts matched</p>
                    )}
                    {searchResults.map((c, i) => {
                      const cname = String(c.name ?? "").replace(/^.*\//, "");
                      const cver = String(c.version ?? "");
                      return (
                        <button
                          key={i}
                          type="button"
                          onClick={() => {
                            setInstallForm((f) => ({ ...f, chart: cname, version: cver }));
                            setSearchResults(null);
                          }}
                          className="w-full flex items-center justify-between px-3 py-1.5 text-left hover:bg-th-hover transition-colors"
                        >
                          <span className="text-xs text-th-body font-medium">{cname}</span>
                          <span className="text-[10px] text-th-ghost">{cver}{c.description ? ` — ${String(c.description).slice(0, 40)}` : ""}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-th-label mb-1">Version <span className="text-th-ghost font-normal">(leave empty for latest)</span></label>
                <input className={INPUT_CLS} placeholder="1.2.3" value={installForm.version} onChange={(e) => setInstallForm((f) => ({ ...f, version: e.target.value }))} />
              </div>
              <div>
                <label className="block text-xs font-medium text-th-label mb-1">Values <span className="text-th-ghost font-normal">(key=value, one per line)</span></label>
                <textarea className={INPUT_CLS + " h-24 font-mono text-xs"} placeholder={"service.type=LoadBalancer\nreplicaCount=2"} value={installForm.values_text} onChange={(e) => setInstallForm((f) => ({ ...f, values_text: e.target.value }))} />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setShowInstall(false)} className="px-4 py-2 text-sm bg-th-subtle border border-th-line rounded-lg hover:bg-th-hover">Cancel</button>
              <button
                onClick={handleInstall}
                disabled={installing || !installForm.release_name || !installForm.chart || !installForm.repo_url}
                className="px-4 py-2 text-sm bg-th-accent text-white rounded-lg hover:opacity-90 disabled:opacity-50"
              >
                {installing ? "Installing..." : "Install"}
              </button>
            </div>
          </div>
        </div>
      )}

      <DeleteConfirmModal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onDeleted={() => { setSelectedRelease(null); refresh(); }}
        resourceType="Helm Release"
        resourceName={deleteTarget?.name ?? ""}
        namespace={deleteTarget?.ns}
        kind="Helm"
        deleteFn={() => uninstallHelmRelease(deleteTarget!.ns, deleteTarget!.name)}
      />

      {selectedRelease && diffRev !== null && (
        <HelmRevisionDiff
          namespace={selectedRelease.namespace}
          name={selectedRelease.name}
          fromRevision={diffRev}
          currentRevision={Number(selectedRelease.revision)}
          onClose={() => setDiffRev(null)}
        />
      )}

      {/* Release Detail Modal */}
      {selectedRelease && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setSelectedRelease(null)}>
          <div className="bg-th-panel border border-th-line rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] overflow-y-auto p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-th-heading">{selectedRelease.name}</h2>
              <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusColor(selectedRelease.status)}`}>{selectedRelease.status}</span>
            </div>
            {actionError && <div className="p-2 bg-th-danger-s text-th-danger rounded text-sm">{actionError}</div>}

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><span className="text-th-ghost">Namespace:</span> <span className="text-th-body">{selectedRelease.namespace}</span></div>
              <div><span className="text-th-ghost">Chart:</span> <span className="text-th-body">{selectedRelease.chart}</span></div>
              <div><span className="text-th-ghost">Revision:</span> <span className="text-th-body">{selectedRelease.revision}</span></div>
              <div><span className="text-th-ghost">Updated:</span> <span className="text-th-body">{timeAgo(selectedRelease.updated_at)}</span></div>
            </div>

            {/* History */}
            {releaseHistory && releaseHistory.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-th-label mb-2">Revision History</h3>
                <div className="overflow-hidden rounded-lg border border-th-line">
                  <table className="w-full text-xs">
                    <thead className="bg-th-subtle">
                      <tr>
                        <th className="px-3 py-2 text-left text-th-ghost">Rev</th>
                        <th className="px-3 py-2 text-left text-th-ghost">Status</th>
                        <th className="px-3 py-2 text-left text-th-ghost">Chart</th>
                        <th className="px-3 py-2 text-left text-th-ghost">Description</th>
                        <th className="px-3 py-2 text-right text-th-ghost">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-th-line-sub">
                      {releaseHistory.map((h, i) => (
                        <tr key={i}>
                          <td className="px-3 py-2 text-th-body">{String(h.revision)}</td>
                          <td className="px-3 py-2">
                            <span className={`px-1.5 py-0.5 rounded text-xs ${statusColor(String(h.status))}`}>{String(h.status)}</span>
                          </td>
                          <td className="px-3 py-2 text-th-dim">{String(h.chart)}</td>
                          <td className="px-3 py-2 text-th-dim truncate max-w-[200px]">{String(h.description || "")}</td>
                          <td className="px-3 py-2 text-right">
                            <div className="flex justify-end gap-1.5">
                              {Number(h.revision) !== Number(selectedRelease.revision) && (
                                <button
                                  onClick={() => setDiffRev(Number(h.revision))}
                                  className="px-2 py-0.5 text-xs bg-th-subtle border border-th-line text-th-body rounded hover:bg-th-hover"
                                >
                                  Diff
                                </button>
                              )}
                              {String(h.status) !== "deployed" && (
                                <button
                                  onClick={() => handleRollback(selectedRelease, Number(h.revision))}
                                  disabled={actionLoading}
                                  className="px-2 py-0.5 text-xs bg-th-warn-s text-th-warn rounded hover:opacity-80"
                                >
                                  Rollback
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Resource footprint */}
            {releaseResources.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-th-label mb-2">
                  Resources <span className="font-normal text-th-ghost">({releaseResources.length})</span>
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {releaseResources.map((res, i) => (
                    <span key={i} className="inline-flex items-center gap-1.5 rounded-md border border-th-line bg-th-subtle px-2 py-1 text-xs">
                      <span className="font-medium text-th-accent">{res.kind}</span>
                      <span className="text-th-body">{res.name}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Values */}
            {releaseValues && (
              <div>
                <h3 className="text-sm font-semibold text-th-label mb-2">Values</h3>
                <YAMLEditor value={releaseValues} readOnly language="yaml" label="values.yaml" height="220px" />
              </div>
            )}

            {/* NOTES */}
            {releaseNotes.trim() && (
              <div>
                <h3 className="text-sm font-semibold text-th-label mb-2">Notes</h3>
                <pre className="max-h-56 overflow-y-auto whitespace-pre-wrap rounded-lg border border-th-line bg-th-subtle p-3 text-xs text-th-body">{releaseNotes}</pre>
              </div>
            )}

            <div className="flex justify-between pt-2">
              <div className="flex gap-2">
                <button
                  onClick={() => { setUpgradeForm({ version: "", values_text: releaseValues || "" }); setShowUpgrade(true); }}
                  disabled={actionLoading}
                  className="px-4 py-2 text-sm bg-th-info text-white rounded-lg hover:opacity-90 disabled:opacity-50"
                >
                  Upgrade
                </button>
                <button
                  onClick={() => handleUninstall(selectedRelease)}
                  disabled={actionLoading}
                  className="px-4 py-2 text-sm bg-th-danger-s text-th-danger border border-th-danger/20 rounded-lg hover:opacity-80 disabled:opacity-50"
                >
                  Uninstall
                </button>
              </div>
              <button onClick={() => setSelectedRelease(null)} className="px-4 py-2 text-sm bg-th-subtle border border-th-line rounded-lg hover:bg-th-hover">Close</button>
            </div>
          </div>
        </div>
      )}
      {/* Upgrade Modal */}
      {showUpgrade && selectedRelease && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50" onClick={() => setShowUpgrade(false)}>
          <div className="bg-th-panel border border-th-line rounded-xl shadow-2xl w-full max-w-lg p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-th-heading">Upgrade {selectedRelease.name}</h2>
            <p className="text-xs text-th-dim">Current chart: {selectedRelease.chart} (rev {selectedRelease.revision})</p>
            {upgradeError && <div className="p-2 bg-th-danger-s text-th-danger rounded text-sm">{upgradeError}</div>}
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-th-label mb-1">New Version <span className="text-th-ghost font-normal">(leave empty for latest)</span></label>
                <input className={INPUT_CLS} placeholder="1.3.0" value={upgradeForm.version} onChange={(e) => setUpgradeForm((f) => ({ ...f, version: e.target.value }))} />
              </div>
              <div>
                <label className="block text-xs font-medium text-th-label mb-1">Values <span className="text-th-ghost font-normal">(key=value, one per line)</span></label>
                <textarea className={INPUT_CLS + " h-32 font-mono text-xs"} value={upgradeForm.values_text} onChange={(e) => setUpgradeForm((f) => ({ ...f, values_text: e.target.value }))} />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setShowUpgrade(false)} className="px-4 py-2 text-sm bg-th-subtle border border-th-line rounded-lg hover:bg-th-hover">Cancel</button>
              <button onClick={handleUpgrade} disabled={upgrading}
                className="px-4 py-2 text-sm bg-th-accent text-white rounded-lg hover:opacity-90 disabled:opacity-50">
                {upgrading ? "Upgrading..." : "Upgrade"}
              </button>
            </div>
          </div>
        </div>
      )}
      {confirmAction.modal}
    </div>
  );
}
