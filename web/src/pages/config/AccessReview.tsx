import { useState } from "react";
import { accessReview, listRiskyBindings, listAdminReach, type AccessReviewResult, type RiskyBinding, type AdminReachSubject } from "@/api/client";
import { useResource } from "@/hooks/useResource";
import { TableSkeleton } from "@/components/Skeleton";

const INPUT =
  "w-full px-3 py-2 bg-th-subtle border border-th-line rounded-lg text-sm text-th-body placeholder:text-th-ghost focus:outline-none focus:ring-1 focus:ring-th-accent";
const VERBS = ["get", "list", "watch", "create", "update", "patch", "delete", "deletecollection", "*"];
const RESOURCES = ["pods", "deployments", "services", "secrets", "configmaps", "nodes", "namespaces", "persistentvolumeclaims", "jobs", "cronjobs", "ingresses", "*"];

export default function AccessReview() {
  const [kind, setKind] = useState("User");
  const [subject, setSubject] = useState("");
  const [saNs, setSaNs] = useState("");
  const [verb, setVerb] = useState("get");
  const [resource, setResource] = useState("pods");
  const [namespace, setNamespace] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AccessReviewResult | null>(null);
  const [error, setError] = useState("");

  const risky = useResource<RiskyBinding[]>(() => listRiskyBindings(), []);
  const reach = useResource<AdminReachSubject[]>(() => listAdminReach(), []);

  const check = async () => {
    if (!subject.trim() || !resource.trim()) return;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      setResult(
        await accessReview({
          subject_kind: kind,
          subject_name: subject.trim(),
          subject_namespace: kind === "ServiceAccount" ? saNs.trim() : undefined,
          verb,
          resource: resource.trim(),
          namespace: namespace.trim() || undefined,
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Check failed");
    } finally {
      setBusy(false);
    }
  };

  const subjectLabel = () => {
    if (kind === "ServiceAccount") return `system:serviceaccount:${saNs || "<ns>"}:${subject || "<name>"}`;
    return subject || `<${kind.toLowerCase()}>`;
  };

  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-th-heading">Access Review</h1>
        <p className="mt-0.5 text-sm text-th-dim">
          Ask the cluster exactly who can do what — the authoritative RBAC answer, with the reason.
        </p>
      </div>

      {/* can-i checker */}
      <div className="space-y-4 rounded-xl border border-th-line bg-th-panel p-5 shadow-card">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block text-sm"><span className="mb-1 block text-th-dim">Subject kind</span>
            <select className={INPUT} value={kind} onChange={(e) => setKind(e.target.value)}>
              <option>User</option>
              <option>Group</option>
              <option>ServiceAccount</option>
            </select>
          </label>
          <label className="block text-sm"><span className="mb-1 block text-th-dim">Subject name</span>
            <input className={INPUT} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={kind === "ServiceAccount" ? "default" : "alice@corp"} />
          </label>
          {kind === "ServiceAccount" && (
            <label className="block text-sm"><span className="mb-1 block text-th-dim">SA namespace</span>
              <input className={INPUT} value={saNs} onChange={(e) => setSaNs(e.target.value)} placeholder="default" />
            </label>
          )}
          <label className="block text-sm"><span className="mb-1 block text-th-dim">Verb</span>
            <select className={INPUT} value={verb} onChange={(e) => setVerb(e.target.value)}>
              {VERBS.map((v) => <option key={v}>{v}</option>)}
            </select>
          </label>
          <label className="block text-sm"><span className="mb-1 block text-th-dim">Resource</span>
            <input className={INPUT} value={resource} onChange={(e) => setResource(e.target.value)} list="ar-resources" />
            <datalist id="ar-resources">{RESOURCES.map((r) => <option key={r} value={r} />)}</datalist>
          </label>
          <label className="block text-sm"><span className="mb-1 block text-th-dim">Namespace (blank = cluster-scoped)</span>
            <input className={INPUT} value={namespace} onChange={(e) => setNamespace(e.target.value)} placeholder="prod" />
          </label>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={check} disabled={busy || !subject.trim()} className="rounded-lg bg-th-accent px-4 py-2 text-sm text-white hover:opacity-90 disabled:opacity-50">
            {busy ? "Checking…" : "Can they?"}
          </button>
          <span className="text-xs text-th-ghost">
            Can <span className="font-mono text-th-dim">{subjectLabel()}</span> <b className="text-th-body">{verb}</b> <b className="text-th-body">{resource}</b>{namespace ? ` in ${namespace}` : " (cluster-wide)"}?
          </span>
        </div>
        {error && <p className="text-sm text-th-danger">{error}</p>}
        {result && (
          <div className={`rounded-lg px-4 py-3 text-sm ${result.allowed ? "bg-th-ok-s text-th-ok" : "bg-th-danger-s text-th-danger"}`}>
            <div className="font-semibold">{result.allowed ? "✓ Allowed" : "✕ Denied"}</div>
            {result.reason && <div className="mt-1 text-th-dim">{result.reason}</div>}
          </div>
        )}
      </div>

      {/* over-broad bindings audit */}
      <div>
        <h2 className="mb-2 text-sm font-semibold text-th-label">Over-broad cluster bindings</h2>
        {risky.loading ? (
          <TableSkeleton rows={3} />
        ) : (risky.data?.length ?? 0) === 0 ? (
          <div className="rounded-lg bg-th-ok-s px-3 py-2 text-sm text-th-ok">✓ No cluster-admin or everyone-group bindings found.</div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-th-line bg-th-panel shadow-card">
            <table className="w-full text-sm">
              <thead className="bg-th-subtle text-left text-xs text-th-ghost">
                <tr>
                  <th className="px-4 py-2">Binding</th>
                  <th className="px-4 py-2">Role</th>
                  <th className="px-4 py-2">Subjects</th>
                  <th className="px-4 py-2">Why flagged</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-th-line">
                {(risky.data ?? []).map((b, i) => (
                  <tr key={i} className="hover:bg-th-hover">
                    <td className="px-4 py-2 font-medium text-th-body">{b.name}</td>
                    <td className="px-4 py-2 font-mono text-xs text-th-danger">{b.role}</td>
                    <td className="px-4 py-2 text-xs text-th-dim">{b.subjects?.join(", ")}</td>
                    <td className="px-4 py-2">
                      {b.reasons?.map((r, j) => (
                        <span key={j} className="mr-1 inline-block rounded bg-th-warn-s px-1.5 py-0.5 text-xs text-th-warn">{r}</span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* cluster-admin reach / escalation paths */}
      <div>
        <h2 className="mb-1 text-sm font-semibold text-th-label">Who can reach cluster-admin</h2>
        <p className="mb-2 text-xs text-th-dim">
          Subjects that hold cluster-admin — or a right that lets them <span className="text-th-body">grant it to themselves</span>: writing RBAC bindings, <span className="font-mono">escalate</span>, <span className="font-mono">bind</span>, or <span className="font-mono">impersonate</span>. Read-only.
        </p>
        {reach.loading ? (
          <TableSkeleton rows={3} />
        ) : (reach.data?.length ?? 0) === 0 ? (
          <div className="rounded-lg bg-th-ok-s px-3 py-2 text-sm text-th-ok">✓ No subjects can reach cluster-admin.</div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-th-line bg-th-panel shadow-card">
            <table className="w-full text-sm">
              <thead className="bg-th-subtle text-left text-xs text-th-ghost">
                <tr>
                  <th className="px-4 py-2">Severity</th>
                  <th className="px-4 py-2">Subject</th>
                  <th className="px-4 py-2">How</th>
                  <th className="px-4 py-2">Via</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-th-line">
                {(reach.data ?? []).map((s, i) => {
                  const vias = Array.from(new Set(s.paths.map((p) => p.via)));
                  const clusterAdmin = s.paths.some((p) => p.via === "cluster-admin" || p.via === "wildcard");
                  return (
                    <tr key={i} className="hover:bg-th-hover align-top">
                      <td className="px-4 py-2">
                        <span className={`rounded px-1.5 py-0.5 text-xs font-semibold uppercase ${s.severity === "critical" ? "bg-th-danger-s text-th-danger" : "bg-th-warn-s text-th-warn"}`}>{s.severity}</span>
                      </td>
                      <td className="px-4 py-2">
                        <div className="font-medium text-th-body">{s.kind === "ServiceAccount" && s.namespace ? `${s.namespace}/${s.name}` : s.name}</div>
                        <div className="text-[11px] text-th-ghost">{s.kind}</div>
                      </td>
                      <td className="px-4 py-2 text-xs text-th-dim">
                        {clusterAdmin
                          ? "Holds cluster-admin"
                          : "Can self-escalate — " + s.paths.filter((p) => p.via !== "cluster-admin" && p.via !== "wildcard").map((p) => `${p.role} (${p.scope})`).filter((v, j, a) => a.indexOf(v) === j).slice(0, 3).join(", ")}
                      </td>
                      <td className="px-4 py-2">
                        {vias.map((v, j) => (
                          <span key={j} className={`mr-1 mb-1 inline-block rounded px-1.5 py-0.5 text-xs ${v === "cluster-admin" || v === "wildcard" || v === "rbac-write" ? "bg-th-danger-s text-th-danger" : "bg-th-warn-s text-th-warn"}`}>{v}</span>
                        ))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
