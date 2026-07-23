import { useState } from "react";
import { fetchGitManifests, getResourceYAML, applyManifest } from "@/api/client";
import { pruneToShape, stripNoise } from "@/lib/drift";
import { lineDiff, diffStats } from "@/lib/diff";
import DiffView from "@/components/DiffView";
import { useToast } from "@/components/Toast";
import jsYaml from "js-yaml";

const INPUT =
  "w-full px-3 py-2 bg-th-subtle border border-th-line rounded-lg text-sm text-th-body placeholder:text-th-ghost focus:outline-none focus:ring-1 focus:ring-th-accent";
const dump = (o: unknown) => jsYaml.dump(o, { sortKeys: true, lineWidth: -1, noRefs: true });

type Action = "Create" | "Update" | "Unchanged" | "Apply";
type Plan = { kind: string; name: string; namespace: string; action: Action; before: string; after: string };

const actionClass: Record<Action, string> = {
  Create: "bg-th-ok-s text-th-ok",
  Update: "bg-th-warn-s text-th-warn",
  Unchanged: "bg-th-subtle text-th-dim",
  Apply: "bg-th-info-s text-th-info",
};

export default function CICD() {
  const toast = useToast();
  const [repo, setRepo] = useState("");
  const [ref, setRef] = useState("main");
  const [path, setPath] = useState(".");
  const [manifests, setManifests] = useState("");
  const [plan, setPlan] = useState<Plan[] | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [open, setOpen] = useState<Plan | null>(null);

  const preview = async () => {
    if (!repo.trim()) return;
    setBusy("Fetching");
    setError("");
    setPlan(null);
    try {
      const raw = await fetchGitManifests(repo.trim(), ref.trim(), path.trim());
      setManifests(raw);
      const docs = (jsYaml.loadAll(raw) as Record<string, unknown>[]).filter((d) => d && d.kind && d.metadata);
      const out: Plan[] = [];
      for (const d of docs) {
        const kind = String(d.kind);
        const meta = d.metadata as Record<string, unknown>;
        const name = String(meta.name ?? "");
        const ns = String(meta.namespace ?? "");
        const declared = dump(stripNoise(d));
        if (!ns) {
          out.push({ kind, name, namespace: "", action: "Apply", before: "", after: declared });
          continue;
        }
        try {
          const live = await getResourceYAML(kind, ns, name);
          const prunedLive = dump(stripNoise(pruneToShape(live, d) as Record<string, unknown>));
          const { added, removed } = diffStats(lineDiff(prunedLive, declared));
          out.push({ kind, name, namespace: ns, action: added + removed > 0 ? "Update" : "Unchanged", before: prunedLive, after: declared });
        } catch {
          out.push({ kind, name, namespace: ns, action: "Create", before: "", after: declared });
        }
      }
      setPlan(out);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fetch failed");
    } finally {
      setBusy("");
    }
  };

  const sync = async () => {
    setBusy("Syncing");
    try {
      await applyManifest(manifests);
      toast.success("Synced — cluster now matches the repo");
      preview();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setBusy("");
    }
  };

  const changes = (plan ?? []).filter((p) => p.action !== "Unchanged").length;

  return (
    <div className="space-y-4 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-th-heading">GitOps</h1>
        <p className="mt-0.5 text-sm text-th-dim">
          Point at a Git repo, preview the diff against the live cluster, and sync — no Argo or Flux controller to operate.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 rounded-xl border border-th-line bg-th-panel p-4 shadow-card sm:grid-cols-4">
        <label className="block text-sm sm:col-span-2"><span className="mb-1 block text-th-dim">Repository URL (http/https)</span>
          <input className={INPUT} value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="https://git.internal/team/manifests.git" />
        </label>
        <label className="block text-sm"><span className="mb-1 block text-th-dim">Branch / tag</span>
          <input className={INPUT} value={ref} onChange={(e) => setRef(e.target.value)} placeholder="main" />
        </label>
        <label className="block text-sm"><span className="mb-1 block text-th-dim">Path</span>
          <input className={INPUT} value={path} onChange={(e) => setPath(e.target.value)} placeholder="k8s/prod" />
        </label>
        <div className="flex items-center gap-3 sm:col-span-4">
          <button onClick={preview} disabled={!!busy || !repo.trim()} className="rounded-lg bg-th-accent px-4 py-2 text-sm text-white hover:opacity-90 disabled:opacity-50">
            {busy === "Fetching" ? "Fetching…" : "Fetch & preview"}
          </button>
          {plan && changes > 0 && (
            <button onClick={sync} disabled={!!busy} className="rounded-lg bg-th-ok px-4 py-2 text-sm text-white hover:opacity-90 disabled:opacity-50">
              {busy === "Syncing" ? "Syncing…" : `Sync ${changes} change${changes > 1 ? "s" : ""}`}
            </button>
          )}
        </div>
      </div>

      {error && <div className="rounded-lg bg-th-danger-s p-3 text-sm text-th-danger">{error}</div>}

      {plan &&
        (changes === 0 ? (
          <div className="rounded-lg bg-th-ok-s px-3 py-2 text-sm text-th-ok">✓ In sync — the cluster already matches the repo ({plan.length} resource(s)).</div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-th-line bg-th-panel shadow-card">
            <table className="w-full text-sm">
              <thead className="bg-th-subtle text-left text-xs text-th-ghost">
                <tr><th className="px-4 py-2">Action</th><th className="px-4 py-2">Kind</th><th className="px-4 py-2">Name</th><th className="px-4 py-2">Namespace</th><th className="px-4 py-2 text-right"></th></tr>
              </thead>
              <tbody className="divide-y divide-th-line">
                {plan.map((p, i) => (
                  <tr key={i} className="hover:bg-th-hover">
                    <td className="px-4 py-2"><span className={`rounded px-1.5 py-0.5 text-xs font-medium ${actionClass[p.action]}`}>{p.action}</span></td>
                    <td className="px-4 py-2 font-medium text-th-accent">{p.kind}</td>
                    <td className="px-4 py-2 text-th-body">{p.name}</td>
                    <td className="px-4 py-2 text-th-dim">{p.namespace || "—"}</td>
                    <td className="px-4 py-2 text-right">
                      {p.action !== "Unchanged" && <button onClick={() => setOpen(p)} className="rounded border border-th-line bg-th-subtle px-2 py-0.5 text-xs text-th-body hover:bg-th-hover">View diff</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8" role="dialog" aria-modal="true" onMouseDown={(e) => e.target === e.currentTarget && setOpen(null)}>
          <div className="w-full max-w-4xl rounded-xl border border-th-line bg-th-panel shadow-xl">
            <div className="flex items-center justify-between border-b border-th-line px-5 py-3">
              <h2 className="text-base font-semibold text-th-heading">{open.kind} {open.name}</h2>
              <button onClick={() => setOpen(null)} aria-label="Close" className="text-th-ghost hover:text-th-body">✕</button>
            </div>
            <div className="p-5">
              <DiffView before={open.before} after={open.after} height="60vh" label={`live → repo · ${open.kind}/${open.name}`} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
