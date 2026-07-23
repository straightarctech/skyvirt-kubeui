import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { navigation } from "@/components/Sidebar";
import {
  listPods, listDeployments, listStatefulSets, listDaemonSets, listJobs, listCronJobs, listHPAs,
  listServices, listIngresses, listNetworkPolicies,
  listConfigMaps, listSecrets, listServiceAccounts, listNamespaces,
  listPVCs, listPVs, listStorageClasses, listNodes,
} from "@/api/client";

interface PaletteItem {
  key: string;
  category: string;
  title: string;
  subtitle?: string;
  path: string;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

const CATEGORY_BADGE: Record<string, string> = {
  Page: "bg-th-subtle text-th-dim",
  Pod: "bg-th-ok-s text-th-ok",
  Deployment: "bg-th-info-s text-th-info",
  Service: "bg-th-accent/15 text-th-accent",
  Node: "bg-th-warn-s text-th-warn",
  Namespace: "bg-th-danger-s text-th-danger",
};

const enc = encodeURIComponent;

interface Res { name: string; namespace?: string; status?: string }
interface KindSpec {
  cat: string;
  list: () => Promise<Res[]>;
  path: (r: Res) => string;
  sub?: (r: Res) => string | undefined;
}

// Every kind the palette indexes. Kinds with a detail route deep-link straight
// to it; list-only kinds jump to their list page filtered by name (?q=) — which
// works because list pages are URL-state-backed (T12).
const RESOURCE_SPECS: KindSpec[] = [
  { cat: "Pod", list: listPods, path: (r) => `/workloads/pods/${r.namespace}/${r.name}`, sub: (r) => `${r.namespace} · ${r.status}` },
  { cat: "Deployment", list: listDeployments, path: (r) => `/workloads/deployments/${r.namespace}/${r.name}`, sub: (r) => r.namespace! },
  { cat: "StatefulSet", list: listStatefulSets, path: (r) => `/workloads/statefulsets/${r.namespace}/${r.name}`, sub: (r) => r.namespace! },
  { cat: "DaemonSet", list: listDaemonSets, path: (r) => `/workloads/daemonsets/${r.namespace}/${r.name}`, sub: (r) => r.namespace! },
  { cat: "Job", list: listJobs, path: (r) => `/workloads/jobs/${r.namespace}/${r.name}`, sub: (r) => r.namespace! },
  { cat: "CronJob", list: listCronJobs, path: (r) => `/workloads/cronjobs/${r.namespace}/${r.name}`, sub: (r) => r.namespace! },
  { cat: "HPA", list: listHPAs, path: (r) => `/workloads/hpas?q=${enc(r.name)}`, sub: (r) => r.namespace! },
  { cat: "Service", list: listServices, path: (r) => `/networking/services/${r.namespace}/${r.name}`, sub: (r) => r.namespace! },
  { cat: "Ingress", list: listIngresses, path: (r) => `/networking/ingress?q=${enc(r.name)}`, sub: (r) => r.namespace! },
  { cat: "NetworkPolicy", list: listNetworkPolicies, path: (r) => `/networking/policies?q=${enc(r.name)}`, sub: (r) => r.namespace! },
  { cat: "ConfigMap", list: listConfigMaps, path: (r) => `/config/configmaps?q=${enc(r.name)}`, sub: (r) => r.namespace! },
  { cat: "Secret", list: listSecrets, path: (r) => `/config/secrets?q=${enc(r.name)}`, sub: (r) => r.namespace! },
  { cat: "ServiceAccount", list: listServiceAccounts, path: (r) => `/config/service-accounts?q=${enc(r.name)}`, sub: (r) => r.namespace! },
  { cat: "PVC", list: listPVCs, path: (r) => `/storage/pvcs?q=${enc(r.name)}`, sub: (r) => r.namespace! },
  { cat: "PV", list: listPVs, path: (r) => `/storage/pvs?q=${enc(r.name)}` },
  { cat: "StorageClass", list: listStorageClasses, path: (r) => `/storage/classes?q=${enc(r.name)}` },
  { cat: "Node", list: listNodes, path: (r) => `/nodes/${r.name}`, sub: (r) => r.status },
  { cat: "Namespace", list: listNamespaces, path: () => `/config/namespaces` },
];

export default function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [resources, setResources] = useState<PaletteItem[]>([]);
  const [loadingResources, setLoadingResources] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const pageItems: PaletteItem[] = useMemo(
    () =>
      navigation.flatMap((group) =>
        group.items.map((item) => ({
          key: `page:${item.path}`,
          category: "Page",
          title: group.label === item.label ? item.label : `${group.label} › ${item.label}`,
          path: item.path,
        })),
      ),
    [],
  );

  // Load live resources once per open.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSelected(0);
    setLoadingResources(true);
    setTimeout(() => inputRef.current?.focus(), 0);

    Promise.allSettled(RESOURCE_SPECS.map((s) => s.list()))
      .then((settled) => {
        const items: PaletteItem[] = [];
        settled.forEach((res, i) => {
          if (res.status !== "fulfilled") return;
          const spec = RESOURCE_SPECS[i];
          for (const r of res.value) {
            items.push({
              key: `${spec.cat}:${r.namespace ?? ""}/${r.name}`,
              category: spec.cat,
              title: r.name,
              subtitle: spec.sub?.(r),
              path: spec.path(r),
            });
          }
        });
        setResources(items);
      })
      .finally(() => setLoadingResources(false));
  }, [open]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = [...pageItems, ...resources];
    if (!q) return pageItems.slice(0, 12);
    const scored = all
      .map((item) => {
        const t = item.title.toLowerCase();
        const sub = (item.subtitle ?? "").toLowerCase();
        let score = -1;
        if (t === q) score = 100;
        else if (t.startsWith(q)) score = 80;
        else if (t.includes(q)) score = 60;
        else if (sub.includes(q)) score = 30;
        return { item, score };
      })
      .filter((r) => r.score >= 0)
      .sort((a, b) => b.score - a.score);
    return scored.slice(0, 15).map((r) => r.item);
  }, [query, pageItems, resources]);

  useEffect(() => setSelected(0), [query]);

  const choose = useCallback(
    (item: PaletteItem | undefined) => {
      if (!item) return;
      navigate(item.path);
      onClose();
    },
    [navigate, onClose],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(results[selected]);
    } else if (e.key === "Escape") {
      onClose();
    }
  };

  // Keep the selected row visible.
  useEffect(() => {
    const el = listRef.current?.children[selected] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center pt-[15vh]">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative w-full max-w-xl mx-4 bg-th-panel border border-th-line rounded-xl shadow-2xl overflow-hidden animate-fade-in">
        <div className="flex items-center gap-3 px-4 border-b border-th-line">
          <svg className="w-4 h-4 text-th-ghost shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search any page or resource — pods, services, configmaps, secrets…"
            className="w-full py-3.5 bg-transparent text-sm text-th-body placeholder:text-th-ghost focus:outline-none"
          />
          <kbd className="hidden sm:block text-[10px] text-th-ghost border border-th-line rounded px-1.5 py-0.5 shrink-0">ESC</kbd>
        </div>

        <div ref={listRef} className="max-h-[50vh] overflow-y-auto py-1">
          {results.map((item, i) => (
            <button
              key={item.key}
              onClick={() => choose(item)}
              onMouseEnter={() => setSelected(i)}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                i === selected ? "bg-th-hover" : ""
              }`}
            >
              <span className={`shrink-0 w-28 text-center truncate px-1.5 py-0.5 rounded text-[10px] font-medium ${CATEGORY_BADGE[item.category] ?? "bg-th-subtle text-th-dim"}`}>
                {item.category}
              </span>
              <span className="text-sm text-th-body truncate">{item.title}</span>
              {item.subtitle && <span className="ml-auto text-xs text-th-ghost truncate shrink-0">{item.subtitle}</span>}
            </button>
          ))}
          {results.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-th-ghost">
              {loadingResources ? "Indexing cluster resources…" : "No matches"}
            </p>
          )}
        </div>

        <div className="flex items-center gap-4 px-4 py-2 border-t border-th-line text-[10px] text-th-ghost">
          <span><kbd className="border border-th-line rounded px-1">↑↓</kbd> navigate</span>
          <span><kbd className="border border-th-line rounded px-1">↵</kbd> open</span>
          {loadingResources && <span className="ml-auto">indexing resources…</span>}
        </div>
      </div>
    </div>
  );
}
