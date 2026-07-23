import { useState } from "react";
import { useResource } from "@/hooks/useResource";
import {
  listNamespaces,
  listDeployments,
  listStatefulSets,
  listDaemonSets,
  listServices,
  listConfigMaps,
  listIngresses,
  getResourceYAML,
  applyManifest,
  type NamespaceSummary,
} from "@/api/client";
import { pruneToShape, lastApplied, stripNoise } from "@/lib/drift";
import { lineDiff, diffStats } from "@/lib/diff";
import DiffView from "@/components/DiffView";
import { useToast } from "@/components/Toast";
import jsYaml from "js-yaml";

type DriftItem = { kind: string; namespace: string; name: string; applied: string; live: string };

const KINDS: { kind: string; list: (ns?: string) => Promise<Array<{ namespace: string; name: string }>> }[] = [
  { kind: "Deployment", list: listDeployments },
  { kind: "StatefulSet", list: listStatefulSets },
  { kind: "DaemonSet", list: listDaemonSets },
  { kind: "Service", list: listServices },
  { kind: "ConfigMap", list: listConfigMaps },
  { kind: "Ingress", list: listIngresses },
];

const dump = (o: unknown) => jsYaml.dump(o, { sortKeys: true, lineWidth: -1, noRefs: true });

export default function Drift() {
  const { data: namespaces } = useResource<NamespaceSummary[]>(() => listNamespaces(), []);
  const [ns, setNs] = useState("");
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState("");
  const [drifted, setDrifted] = useState<DriftItem[] | null>(null);
  const [notTracked, setNotTracked] = useState(0);
  const [open, setOpen] = useState<DriftItem | null>(null);
  const toast = useToast();

  const scan = async () => {
    if (!ns) return;
    setScanning(true);
    setDrifted(null);
    setNotTracked(0);
    try {
      const refs: { kind: string; namespace: string; name: string }[] = [];
      for (const k of KINDS) {
        const items = await k.list(ns).catch(() => []);
        for (const it of items) refs.push({ kind: k.kind, namespace: it.namespace, name: it.name });
      }
      const found: DriftItem[] = [];
      let untracked = 0;
      for (let i = 0; i < refs.length; i++) {
        const r = refs[i];
        setProgress(`Checking ${r.kind} ${r.name} (${i + 1}/${refs.length})`);
        try {
          const live = await getResourceYAML(r.kind, r.namespace, r.name);
          const applied = lastApplied(live);
          if (!applied) {
            untracked++;
            continue;
          }
          const aY = dump(stripNoise(applied));
          const lY = dump(stripNoise(pruneToShape(live, applied) as Record<string, unknown>));
          const { added, removed } = diffStats(lineDiff(aY, lY));
          if (added + removed > 0) found.push({ kind: r.kind, namespace: r.namespace, name: r.name, applied: aY, live: lY });
        } catch {
          /* skip unreadable object */
        }
      }
      setDrifted(found);
      setNotTracked(untracked);
    } finally {
      setScanning(false);
      setProgress("");
    }
  };

  const revert = async (item: DriftItem) => {
    try {
      await applyManifest(item.applied);
      toast.success(`Reverted ${item.kind} ${item.name} to last-applied`);
      setOpen(null);
      scan();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Revert failed");
    }
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-th-heading">Configuration Drift</h1>
        <p className="mt-0.5 text-sm text-th-dim">
          Compare what's running against what was declared (last-applied config) — and revert drift in one click.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="block text-sm">
          <span className="mb-1 block text-th-dim">Namespace</span>
          <select value={ns} onChange={(e) => setNs(e.target.value)} className="min-w-[200px] rounded-lg border border-th-line bg-th-subtle px-3 py-2 text-sm text-th-body focus:outline-none focus:ring-1 focus:ring-th-accent">
            <option value="">Select…</option>
            {(namespaces ?? []).map((n) => <option key={n.name} value={n.name}>{n.name}</option>)}
          </select>
        </label>
        <button onClick={scan} disabled={!ns || scanning} className="rounded-lg bg-th-accent px-4 py-2 text-sm text-white hover:opacity-90 disabled:opacity-50">
          {scanning ? "Scanning…" : "Scan for drift"}
        </button>
      </div>
      {progress && <p className="animate-pulse text-xs text-th-dim">{progress}</p>}

      {drifted !== null &&
        (drifted.length === 0 ? (
          <div className="rounded-lg bg-th-ok-s px-3 py-2 text-sm text-th-ok">
            ✓ No drift — everything matches its last-applied config.
            {notTracked > 0 && <span className="text-th-dim"> ({notTracked} not tracked / not applied with kubectl)</span>}
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-th-warn">
              {drifted.length} resource(s) drifted from declared config.
              {notTracked > 0 && <span className="text-th-ghost"> ({notTracked} not tracked)</span>}
            </p>
            <div className="overflow-hidden rounded-xl border border-th-line bg-th-panel shadow-card">
              <table className="w-full text-sm">
                <thead className="bg-th-subtle text-left text-xs text-th-ghost">
                  <tr><th className="px-4 py-2">Kind</th><th className="px-4 py-2">Name</th><th className="px-4 py-2 text-right">Action</th></tr>
                </thead>
                <tbody className="divide-y divide-th-line">
                  {drifted.map((d, i) => (
                    <tr key={i} className="hover:bg-th-hover">
                      <td className="px-4 py-2 font-medium text-th-accent">{d.kind}</td>
                      <td className="px-4 py-2 text-th-body">{d.name}</td>
                      <td className="px-4 py-2 text-right">
                        <button onClick={() => setOpen(d)} className="rounded border border-th-line bg-th-subtle px-2 py-0.5 text-xs text-th-body hover:bg-th-hover">View diff</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8" role="dialog" aria-modal="true" onMouseDown={(e) => e.target === e.currentTarget && setOpen(null)}>
          <div className="w-full max-w-4xl rounded-xl border border-th-line bg-th-panel shadow-xl">
            <div className="flex items-center justify-between border-b border-th-line px-5 py-3">
              <div>
                <h2 className="text-base font-semibold text-th-heading">{open.kind} {open.name}</h2>
                <p className="text-xs text-th-dim">declared (last-applied) → live</p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => revert(open)} className="rounded-lg bg-th-warn-s px-3 py-1.5 text-sm text-th-warn hover:opacity-80">Revert to applied</button>
                <button onClick={() => setOpen(null)} aria-label="Close" className="text-th-ghost hover:text-th-body">✕</button>
              </div>
            </div>
            <div className="p-5">
              <DiffView before={open.applied} after={open.live} height="60vh" label={`${open.kind}/${open.name} · declared → live`} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
