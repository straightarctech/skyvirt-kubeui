import { useState, useEffect, useCallback } from "react";
import { fetchGitManifests, getResourceYAML, applyManifest,
  listGitOpsSources, saveGitOpsSource, deleteGitOpsSource, syncGitOpsSource } from "@/api/client";
import type { GitOpsSource } from "@/api/client";
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
  const [showAuth, setShowAuth] = useState(false);
  const [username, setUsername] = useState("");
  const [token, setToken] = useState("");
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
      const raw = await fetchGitManifests(repo.trim(), ref.trim(), path.trim(), token.trim() ? { username: username.trim() || undefined, token: token.trim() } : undefined);
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

        <div className="sm:col-span-4">
          <button type="button" onClick={() => setShowAuth((v) => !v)} className="text-xs text-th-accent hover:underline">
            {showAuth ? "▾ Private repository (token)" : "▸ Private repository? Add a token"}
          </button>
          {showAuth && (
            <div className="mt-2 grid grid-cols-1 gap-3 rounded-lg border border-th-line bg-th-subtle p-3 sm:grid-cols-4">
              <label className="block text-sm"><span className="mb-1 block text-th-dim">Username <span className="text-th-ghost">(optional)</span></span>
                <input className={INPUT + " font-mono"} value={username} onChange={(e) => setUsername(e.target.value)} placeholder="oauth2" />
              </label>
              <label className="block text-sm sm:col-span-3"><span className="mb-1 block text-th-dim">Access token <span className="text-th-ghost">(PAT — used once, never stored)</span></span>
                <input className={INPUT + " font-mono"} type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="ghp_… / glpat-…" />
              </label>
              <p className="text-[11px] text-th-ghost sm:col-span-4">
                GitHub: leave username blank or use <span className="font-mono">oauth2</span> with a PAT. GitLab: username <span className="font-mono">oauth2</span> + a project/personal access token. The token authenticates the clone over HTTPS and is discarded after fetch.
              </p>
            </div>
          )}
        </div>

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

      <GitOpsSources />
    </div>
  );
}

function relTime(iso?: string): string {
  if (!iso) return "never";
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// GitOpsSources manages persistent repos that KubeUI reconciles on a schedule:
// detect drift (server-side, dry-run) and, when auto-apply is on, heal it.
function GitOpsSources() {
  const toast = useToast();
  const [sources, setSources] = useState<GitOpsSource[]>([]);
  const [busy, setBusy] = useState<string>("");
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: "", repo_url: "", ref: "", path: "", interval_min: 5, auto_apply: false });

  const load = useCallback(async () => {
    try { setSources(await listGitOpsSources()); } catch { /* surfaced elsewhere */ }
  }, []);
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    if (!form.repo_url.trim()) return;
    setBusy("add");
    try {
      await saveGitOpsSource({
        name: form.name.trim() || form.repo_url.trim(),
        repo_url: form.repo_url.trim(), ref: form.ref.trim(), path: form.path.trim(),
        interval_sec: Math.max(30, form.interval_min * 60), auto_apply: form.auto_apply,
      });
      setShowAdd(false);
      setForm({ name: "", repo_url: "", ref: "", path: "", interval_min: 5, auto_apply: false });
      await load();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not save source"); }
    finally { setBusy(""); }
  };

  const syncNow = async (s: GitOpsSource) => {
    setBusy(s.id);
    try { await syncGitOpsSource(s.id); await load(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Sync failed"); }
    finally { setBusy(""); }
  };

  const remove = async (s: GitOpsSource) => {
    setBusy(s.id);
    try { await deleteGitOpsSource(s.id); await load(); }
    finally { setBusy(""); }
  };

  const statusBadge = (s: GitOpsSource) => {
    if (s.last_error) return <span className="rounded px-1.5 py-0.5 text-xs bg-th-danger-s text-th-danger" title={s.last_error}>Error</span>;
    if (!s.last_checked) return <span className="rounded px-1.5 py-0.5 text-xs bg-th-subtle text-th-dim">Pending</span>;
    if (s.in_sync) return <span className="rounded px-1.5 py-0.5 text-xs bg-th-ok-s text-th-ok">In sync</span>;
    return <span className="rounded px-1.5 py-0.5 text-xs bg-th-warn-s text-th-warn">Drift: {s.create} new · {s.update} changed</span>;
  };

  return (
    <div className="space-y-3 rounded-xl border border-th-line bg-th-panel p-4 shadow-card">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-th-heading">Tracked sources — auto-sync</h2>
          <p className="mt-0.5 text-xs text-th-dim">Repos KubeUI reconciles on a schedule: it detects drift, and heals it when auto-apply is on. Detect-only by default.</p>
        </div>
        <button onClick={() => setShowAdd((v) => !v)} className="rounded-lg bg-th-accent px-3 py-1.5 text-sm text-white hover:opacity-90">{showAdd ? "Cancel" : "Add source"}</button>
      </div>

      {showAdd && (
        <div className="grid grid-cols-1 gap-3 rounded-lg border border-th-line bg-th-subtle p-3 sm:grid-cols-6">
          <label className="block text-sm sm:col-span-2"><span className="mb-1 block text-th-dim">Name</span><input className={INPUT} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="prod-manifests" /></label>
          <label className="block text-sm sm:col-span-4"><span className="mb-1 block text-th-dim">Repository URL (public / network-reachable)</span><input className={INPUT} value={form.repo_url} onChange={(e) => setForm((f) => ({ ...f, repo_url: e.target.value }))} placeholder="https://git.internal/team/manifests.git" /></label>
          <label className="block text-sm sm:col-span-2"><span className="mb-1 block text-th-dim">Branch / tag</span><input className={INPUT} value={form.ref} onChange={(e) => setForm((f) => ({ ...f, ref: e.target.value }))} placeholder="main" /></label>
          <label className="block text-sm sm:col-span-2"><span className="mb-1 block text-th-dim">Path</span><input className={INPUT} value={form.path} onChange={(e) => setForm((f) => ({ ...f, path: e.target.value }))} placeholder="k8s/prod" /></label>
          <label className="block text-sm"><span className="mb-1 block text-th-dim">Every (min)</span><input type="number" min={1} className={INPUT} value={form.interval_min} onChange={(e) => setForm((f) => ({ ...f, interval_min: Number(e.target.value) || 5 }))} /></label>
          <label className="flex items-end gap-2 text-sm pb-2"><input type="checkbox" checked={form.auto_apply} onChange={(e) => setForm((f) => ({ ...f, auto_apply: e.target.checked }))} /><span className="text-th-dim">Auto-apply drift</span></label>
          <div className="sm:col-span-6"><button onClick={add} disabled={busy === "add" || !form.repo_url.trim()} className="rounded-lg bg-th-ok px-4 py-2 text-sm text-white hover:opacity-90 disabled:opacity-50">{busy === "add" ? "Saving…" : "Save source"}</button></div>
        </div>
      )}

      {sources.length === 0 ? (
        <p className="text-sm text-th-dim">No tracked sources yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-th-ghost"><tr><th className="px-2 py-1">Name</th><th className="px-2 py-1">Status</th><th className="px-2 py-1">Mode</th><th className="px-2 py-1">Last checked</th><th className="px-2 py-1 text-right"></th></tr></thead>
            <tbody className="divide-y divide-th-line">
              {sources.map((s) => (
                <tr key={s.id} className="hover:bg-th-hover">
                  <td className="px-2 py-2"><div className="font-medium text-th-body">{s.name}</div><div className="text-[11px] text-th-ghost font-mono truncate max-w-xs">{s.repo_url}{s.path ? ` · ${s.path}` : ""}</div></td>
                  <td className="px-2 py-2">{statusBadge(s)}</td>
                  <td className="px-2 py-2">{s.auto_apply ? <span className="rounded px-1.5 py-0.5 text-xs bg-th-info-s text-th-info">auto-apply</span> : <span className="text-xs text-th-dim">detect-only</span>}</td>
                  <td className="px-2 py-2 text-th-dim text-xs">{relTime(s.last_checked)}</td>
                  <td className="px-2 py-2 text-right whitespace-nowrap">
                    <button onClick={() => syncNow(s)} disabled={busy === s.id} className="rounded border border-th-line bg-th-subtle px-2 py-0.5 text-xs text-th-body hover:bg-th-hover disabled:opacity-50">{busy === s.id ? "…" : "Sync now"}</button>
                    <button onClick={() => remove(s)} disabled={busy === s.id} className="ml-2 rounded border border-th-danger/20 bg-th-danger-s px-2 py-0.5 text-xs text-th-danger hover:opacity-80 disabled:opacity-50">Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
