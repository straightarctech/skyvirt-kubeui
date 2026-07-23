import { useState, useMemo, useCallback } from "react";
import { useOutletContext } from "react-router-dom";
import {
  listHelmRepos,
  searchCatalog,
  addHelmRepo,
  removeHelmRepo,
  showChart,
  installHelmChart,
  getServerConfig,
  aiHelmValues,
  type CatalogChart,
} from "@/api/client";
import { useResource } from "@/hooks/useResource";
import { useToast } from "@/components/Toast";
import { EmptyState } from "@/components/EmptyState";
import { TableSkeleton } from "@/components/Skeleton";
import { useEscToClose } from "@/hooks/useEscToClose";

const INPUT =
  "w-full px-3 py-2 bg-th-subtle border border-th-line rounded-lg text-sm text-th-body placeholder:text-th-ghost focus:outline-none focus:ring-1 focus:ring-th-accent";
const BTN_PRIMARY =
  "px-3 py-1.5 text-sm font-medium bg-th-accent text-white rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50";
const BTN_GHOST =
  "px-3 py-1.5 text-sm bg-th-subtle border border-th-line text-th-body rounded-lg hover:bg-th-hover transition-colors";

// "repo/chart" → { repo, chart }
function splitRef(name: string): { repo: string; chart: string } {
  const i = name.indexOf("/");
  return i < 0 ? { repo: "", chart: name } : { repo: name.slice(0, i), chart: name.slice(i + 1) };
}

// SkyVirt Essentials — the cluster add-ons almost everyone needs, one click each.
// URLs are the public chart repos; in an air-gapped cluster, point them at your
// internal mirror (edit here or add the repo manually).
type Essential = { name: string; desc: string; repo: string; url: string; chart: string };
const ESSENTIALS: Essential[] = [
  { name: "Ingress NGINX", desc: "The de-facto ingress controller.", repo: "ingress-nginx", url: "https://kubernetes.github.io/ingress-nginx", chart: "ingress-nginx" },
  { name: "cert-manager", desc: "Automated TLS certificate management.", repo: "jetstack", url: "https://charts.jetstack.io", chart: "cert-manager" },
  { name: "metrics-server", desc: "Resource metrics for HPA and top.", repo: "metrics-server", url: "https://kubernetes-sigs.github.io/metrics-server", chart: "metrics-server" },
  { name: "MetalLB", desc: "Bare-metal LoadBalancer for on-prem.", repo: "metallb", url: "https://metallb.github.io/metallb", chart: "metallb" },
  { name: "Velero", desc: "Cluster backup & restore (Backup console).", repo: "vmware-tanzu", url: "https://vmware-tanzu.github.io/helm-charts", chart: "velero" },
  { name: "Prometheus Stack", desc: "Prometheus + Grafana + Alertmanager.", repo: "prometheus-community", url: "https://prometheus-community.github.io/helm-charts", chart: "kube-prometheus-stack" },
  { name: "Trivy Operator", desc: "Continuous image CVE scanning (Vulnerabilities).", repo: "aqua", url: "https://aquasecurity.github.io/helm-charts", chart: "trivy-operator" },
];

export default function Catalog() {
  const { namespace } = useOutletContext<{ namespace: string }>();
  const toast = useToast();
  const defaultNs = namespace && namespace !== "all" ? namespace : "default";

  const repos = useResource(() => listHelmRepos(), []);
  const [search, setSearch] = useState("");
  const charts = useResource(() => searchCatalog(), []);

  const [showRepos, setShowRepos] = useState(false);
  const [installChart, setInstallChart] = useState<CatalogChart | null>(null);

  const filtered = useMemo(() => {
    const list = charts.data ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (c) => c.name.toLowerCase().includes(q) || (c.description ?? "").toLowerCase().includes(q),
    );
  }, [charts.data, search]);

  const refreshAll = useCallback(() => {
    repos.refresh();
    charts.refresh();
  }, [repos, charts]);

  const hasRepos = (repos.data?.length ?? 0) > 0;

  const installEssential = async (e: Essential) => {
    try {
      await addHelmRepo(e.repo, e.url);
      repos.refresh();
      charts.refresh();
      setInstallChart({ name: `${e.repo}/${e.chart}`, version: "", app_version: "", description: e.desc });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add repository (offline? point it at your mirror)");
    }
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-th-heading">App Catalog</h1>
          <p className="mt-0.5 text-sm text-th-dim">
            Browse and install Helm charts from your configured repositories.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowRepos(true)} className={BTN_GHOST}>
            Manage repositories
          </button>
          <button onClick={refreshAll} className={BTN_GHOST}>
            Refresh
          </button>
        </div>
      </div>

      {/* SkyVirt Essentials — one-click cluster add-ons */}
      <div>
        <h2 className="mb-2 text-sm font-semibold text-th-label">
          SkyVirt Essentials <span className="font-normal text-th-ghost">— one-click cluster add-ons</span>
        </h2>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {ESSENTIALS.map((e) => (
            <div key={e.repo} className="flex items-center justify-between gap-2 rounded-lg border border-th-line bg-th-panel px-3 py-2 shadow-sm">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-th-body">{e.name}</p>
                <p className="truncate text-xs text-th-dim">{e.desc}</p>
              </div>
              <button onClick={() => installEssential(e)} className="shrink-0 rounded-md bg-th-accent-s px-2 py-1 text-xs font-medium text-th-accent hover:opacity-80">
                Install
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Search */}
      {hasRepos && (
        <input
          className={INPUT + " max-w-md"}
          placeholder="Search charts by name or description…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      )}

      {/* Body */}
      {charts.loading || repos.loading ? (
        <TableSkeleton rows={6} />
      ) : !hasRepos ? (
        <EmptyState
          title="No chart repositories yet"
          hint="Add a Helm repository (HTTP or OCI) to start browsing installable apps. Everything works offline against an internal mirror."
          action={
            <button onClick={() => setShowRepos(true)} className={BTN_PRIMARY}>
              Add repository
            </button>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          title={search ? "No charts match your search" : "No charts found in your repositories"}
          hint={search ? "Try a different term." : "Add another repository, or refresh the indexes."}
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((c) => {
            const { repo, chart } = splitRef(c.name);
            return (
              <div
                key={c.name}
                className="flex flex-col rounded-xl border border-th-line bg-th-panel p-4 shadow-sm transition-colors hover:border-th-accent"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-th-heading">{chart}</p>
                    {repo && <p className="truncate text-xs text-th-ghost">{repo}</p>}
                  </div>
                  <span className="shrink-0 rounded-md bg-th-subtle px-2 py-0.5 font-mono text-[11px] text-th-dim">
                    v{c.version}
                  </span>
                </div>
                <p className="mt-2 line-clamp-3 flex-1 text-xs text-th-dim">
                  {c.description || "No description provided."}
                </p>
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-[11px] text-th-ghost">
                    {c.app_version ? `app ${c.app_version}` : " "}
                  </span>
                  <button onClick={() => setInstallChart(c)} className={BTN_PRIMARY}>
                    Install
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showRepos && (
        <RepoManager
          onClose={() => setShowRepos(false)}
          onChanged={refreshAll}
        />
      )}

      {installChart && (
        <InstallModal
          chart={installChart}
          defaultNamespace={defaultNs}
          onClose={() => setInstallChart(null)}
          onInstalled={(name) => {
            toast.success(`Installed ${name}`);
            setInstallChart(null);
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function RepoManager({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const repos = useResource(() => listHelmRepos(), []);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  useEscToClose(true, onClose);

  const add = async () => {
    if (!name.trim() || !url.trim()) return;
    setBusy(true);
    try {
      await addHelmRepo(name.trim(), url.trim());
      toast.success(`Added repository ${name.trim()}`);
      setName("");
      setUrl("");
      repos.refresh();
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add repository");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (n: string) => {
    try {
      await removeHelmRepo(n);
      toast.success(`Removed ${n}`);
      repos.refresh();
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to remove repository");
    }
  };

  return (
    <Modal title="Chart repositories" onClose={onClose}>
      <div className="space-y-4">
        <div className="space-y-2">
          {(repos.data ?? []).length === 0 && (
            <p className="text-sm text-th-dim">No repositories configured yet.</p>
          )}
          {(repos.data ?? []).map((r) => (
            <div
              key={r.name}
              className="flex items-center justify-between gap-3 rounded-lg border border-th-line bg-th-subtle px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-th-body">{r.name}</p>
                <p className="truncate font-mono text-xs text-th-ghost">{r.url}</p>
              </div>
              <button
                onClick={() => remove(r.name)}
                className="shrink-0 text-xs text-th-danger hover:underline"
              >
                Remove
              </button>
            </div>
          ))}
        </div>

        <div className="space-y-2 border-t border-th-line pt-4">
          <p className="text-sm font-medium text-th-heading">Add a repository</p>
          <input className={INPUT} placeholder="Name (e.g. bitnami)" value={name} onChange={(e) => setName(e.target.value)} />
          <input
            className={INPUT}
            placeholder="URL (https://… or oci://…)"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <div className="flex justify-end">
            <button onClick={add} disabled={busy || !name.trim() || !url.trim()} className={BTN_PRIMARY}>
              {busy ? "Adding…" : "Add repository"}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------

function InstallModal({
  chart,
  defaultNamespace,
  onClose,
  onInstalled,
}: {
  chart: CatalogChart;
  defaultNamespace: string;
  onClose: () => void;
  onInstalled: (releaseName: string) => void;
}) {
  const toast = useToast();
  const { chart: chartName } = splitRef(chart.name);
  const [releaseName, setReleaseName] = useState(chartName);
  const [ns, setNs] = useState(defaultNamespace);
  const [busy, setBusy] = useState(false);
  useEscToClose(true, onClose);

  // Seed the values editor with the chart's default values.yaml.
  const values = useResource(() => showChart(chart.name, "values", chart.version).catch(() => ""), [chart.name]);
  const [valuesText, setValuesText] = useState<string | null>(null);
  const effectiveValues = valuesText ?? values.data ?? "";

  const cfg = useResource(() => getServerConfig(), []);
  const [aiAnswer, setAiAnswer] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const askAI = async (ask: string) => {
    setAiBusy(true);
    setAiAnswer("");
    try {
      setAiAnswer(await aiHelmValues(chart.name, effectiveValues, ask));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "AI request failed");
    } finally {
      setAiBusy(false);
    }
  };

  const install = async () => {
    if (!releaseName.trim() || !ns.trim()) return;
    setBusy(true);
    try {
      await installHelmChart({
        release_name: releaseName.trim(),
        namespace: ns.trim(),
        repo_url: "",
        chart: chart.name,
        version: chart.version,
        values_yaml: effectiveValues,
      });
      onInstalled(releaseName.trim());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Install failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Install ${chartName}`} onClose={onClose} wide>
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1 block text-th-dim">Release name</span>
            <input className={INPUT} value={releaseName} onChange={(e) => setReleaseName(e.target.value)} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-th-dim">Namespace</span>
            <input className={INPUT} value={ns} onChange={(e) => setNs(e.target.value)} />
          </label>
        </div>
        <div className="text-xs text-th-ghost">
          {chart.name} · v{chart.version}
          {chart.app_version ? ` · app ${chart.app_version}` : ""} — namespace is created if missing.
        </div>
        <label className="block text-sm">
          <span className="mb-1 block text-th-dim">Values (YAML)</span>
          {values.loading ? (
            <div className="rounded-lg border border-th-line bg-th-subtle p-3 text-xs text-th-ghost">
              Loading default values…
            </div>
          ) : (
            <textarea
              className={INPUT + " h-64 resize-y font-mono text-xs leading-relaxed"}
              spellCheck={false}
              value={effectiveValues}
              onChange={(e) => setValuesText(e.target.value)}
            />
          )}
        </label>

        {cfg.data?.ai_enabled && (
          <div className="rounded-lg border border-th-accent/30 bg-th-accent-s/50 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-th-accent">✨ Ask on-prem AI</span>
              <button onClick={() => askAI("Explain the most important values and what to change.")} disabled={aiBusy} className="rounded-md bg-th-panel px-2 py-1 text-xs text-th-body hover:bg-th-hover disabled:opacity-50">Explain values</button>
              <button onClick={() => askAI("Recommend safe production-ready settings for this chart.")} disabled={aiBusy} className="rounded-md bg-th-panel px-2 py-1 text-xs text-th-body hover:bg-th-hover disabled:opacity-50">Production-ready?</button>
            </div>
            {(aiBusy || aiAnswer) && (
              <pre className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap rounded bg-th-panel p-2 text-xs text-th-body">
                {aiBusy ? "Thinking…" : aiAnswer}
              </pre>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className={BTN_GHOST}>
            Cancel
          </button>
          <button onClick={install} disabled={busy || !releaseName.trim() || !ns.trim()} className={BTN_PRIMARY}>
            {busy ? "Installing…" : "Install"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------

function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={`w-full ${wide ? "max-w-2xl" : "max-w-md"} rounded-xl border border-th-line bg-th-panel shadow-xl`}>
        <div className="flex items-center justify-between border-b border-th-line px-5 py-3">
          <h2 className="text-base font-semibold text-th-heading">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="text-th-ghost hover:text-th-body">
            ✕
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
