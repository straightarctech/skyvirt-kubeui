import { useEffect, useState } from "react";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { forwardSecurity, getForwardConfig, putForwardConfig, type ForwardConfig } from "@/api/client";
import { useToast } from "@/components/Toast";

const INPUT =
  "w-full px-3 py-2 bg-th-subtle border border-th-line rounded-lg text-sm text-th-body placeholder:text-th-ghost focus:outline-none focus:ring-1 focus:ring-th-accent";
const BTN = "px-3 py-1.5 text-sm font-medium bg-th-accent text-white rounded-lg hover:opacity-90 disabled:opacity-50";

type Mode = "embed" | "link";
type Integration = { id: string; name: string; url: string; mode: Mode };

// Quick-adds for the StraightArc ecosystem + common tools. URL left blank so the
// operator fills their own host (in-cluster service, ingress, or LB address).
const SUGGESTIONS: { name: string; hint: string; mode: Mode }[] = [
  { name: "SecSphere SOC", hint: "SecSphere web console (service or ingress)", mode: "embed" },
  { name: "Grafana", hint: "kube-prometheus-stack Grafana", mode: "embed" },
  { name: "Prometheus", hint: "Prometheus UI :9090", mode: "link" },
];

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

export default function Integrations() {
  const [items, setItems] = useLocalStorage<Integration[]>("kubeui.integrations", []);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [mode, setMode] = useState<Mode>("embed");
  const [active, setActive] = useState<Integration | null>(null);

  const add = () => {
    if (!name.trim() || !url.trim()) return;
    const u = url.trim().startsWith("http") ? url.trim() : `https://${url.trim()}`;
    setItems([...items, { id: uid(), name: name.trim(), url: u, mode }]);
    setName("");
    setUrl("");
  };
  const remove = (id: string) => {
    setItems(items.filter((i) => i.id !== id));
    if (active?.id === id) setActive(null);
  };
  const openItem = (i: Integration) => {
    if (i.mode === "link") window.open(i.url, "_blank", "noopener");
    else setActive(active?.id === i.id ? null : i);
  };

  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-th-heading">Integrations</h1>
        <p className="mt-0.5 text-sm text-th-dim">
          Bring your other consoles into KubeUI — embed a dashboard or link out. Great for wiring in
          SecSphere SOC, Grafana, or any internal tool.
        </p>
      </div>

      {/* configured integrations */}
      {items.length > 0 && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((i) => (
            <div key={i.id} className={`flex items-center justify-between gap-2 rounded-lg border bg-th-panel px-3 py-2 shadow-sm ${active?.id === i.id ? "border-th-accent" : "border-th-line"}`}>
              <button onClick={() => openItem(i)} className="min-w-0 flex-1 text-left">
                <p className="truncate text-sm font-medium text-th-body">{i.name}</p>
                <p className="truncate font-mono text-xs text-th-ghost">{i.url}</p>
              </button>
              <div className="flex shrink-0 items-center gap-1.5">
                <span className="rounded bg-th-subtle px-1.5 py-0.5 text-[10px] uppercase text-th-dim">{i.mode}</span>
                <button onClick={() => remove(i.id)} className="text-xs text-th-danger hover:underline">✕</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* embedded view */}
      {active && active.mode === "embed" && (
        <div className="overflow-hidden rounded-xl border border-th-line bg-th-panel shadow-card">
          <div className="flex items-center justify-between border-b border-th-line bg-th-subtle px-4 py-2">
            <span className="text-sm font-medium text-th-body">{active.name}</span>
            <a href={active.url} target="_blank" rel="noreferrer noopener" className="text-xs text-th-accent hover:underline">Open in new tab ↗</a>
          </div>
          <iframe title={active.name} src={active.url} className="h-[70vh] w-full" />
          <p className="border-t border-th-line px-4 py-1.5 text-[11px] text-th-ghost">
            If the panel is blank, the target sets X-Frame-Options and can't be embedded — use "Open in new tab".
          </p>
        </div>
      )}

      {/* add form */}
      <div className="space-y-3 rounded-xl border border-th-line bg-th-panel p-4 shadow-card">
        <h2 className="text-sm font-semibold text-th-heading">Add an integration</h2>
        <div className="flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((s) => (
            <button key={s.name} onClick={() => { setName(s.name); setMode(s.mode); }} title={s.hint}
              className="rounded-md border border-th-line bg-th-subtle px-2 py-1 text-xs text-th-body hover:bg-th-hover">
              + {s.name}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <input className={INPUT} placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <input className={INPUT + " sm:col-span-2"} placeholder="URL (https://…)" value={url} onChange={(e) => setUrl(e.target.value)} />
          <select className={INPUT} value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
            <option value="embed">Embed (iframe)</option>
            <option value="link">Link (new tab)</option>
          </select>
        </div>
        <div className="flex justify-end">
          <button onClick={add} disabled={!name.trim() || !url.trim()} className={BTN}>Add</button>
        </div>
      </div>

      <SiemForwarder />
    </div>
  );
}

const SIGNALS: { key: keyof ForwardConfig["signals"]; label: string; hint: string }[] = [
  { key: "vuln", label: "Image CVEs", hint: "Trivy VulnerabilityReports" },
  { key: "cert", label: "Expiring certs", hint: "TLS secrets ≤30 days" },
  { key: "config", label: "Misconfigurations", hint: "Trivy ConfigAuditReports" },
  { key: "rbac", label: "Risky RBAC", hint: "cluster-admin / everyone-group bindings" },
];

function SiemForwarder() {
  const toast = useToast();
  const [syslog, setSyslog] = useState("");
  const [http, setHttp] = useState("");
  const [hec, setHec] = useState("");
  const [hecToken, setHecToken] = useState("");
  const [tokenSet, setTokenSet] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [interval, setIntervalMin] = useState(60);
  const [signals, setSignals] = useState<ForwardConfig["signals"]>({ vuln: true, cert: true, config: false, rbac: false });
  const [lastRun, setLastRun] = useState<string | undefined>();
  const [lastResult, setLastResult] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ collected: number; sent: number; errors: string[] } | null>(null);

  // Load the server-side config (source of truth — the schedule runs in the backend).
  useEffect(() => {
    getForwardConfig()
      .then((c) => {
        setSyslog(c.target.syslog_addr ?? "");
        setHttp(c.target.http_url ?? "");
        setHec(c.target.hec_url ?? "");
        setTokenSet(!!c.hec_token_set);
        setEnabled(c.enabled);
        setIntervalMin(c.interval_minutes || 60);
        setSignals(c.signals);
        setLastRun(c.last_run);
        setLastResult(c.last_result);
      })
      .catch(() => {/* defaults are fine on first use */});
  }, []);

  const target = () => ({
    syslog_addr: syslog.trim() || undefined,
    http_url: http.trim() || undefined,
    hec_url: hec.trim() || undefined,
    hec_token: hecToken.trim() || undefined,
  });

  const send = async () => {
    if (!syslog.trim() && !http.trim() && !hec.trim()) {
      toast.error("Enter a syslog, HEC, or HTTP endpoint");
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const r = await forwardSecurity(target());
      setResult(r);
      if (r.errors.length === 0) toast.success(`Forwarded ${r.sent}/${r.collected} security events`);
      else toast.error(r.errors.join("; "));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Forward failed");
    } finally {
      setBusy(false);
    }
  };

  const saveSchedule = async () => {
    if (enabled && !syslog.trim() && !http.trim() && !hec.trim()) {
      toast.error("Enter a target before enabling auto-forward");
      return;
    }
    setSaving(true);
    try {
      const saved = await putForwardConfig({ enabled, interval_minutes: interval, signals, target: target() });
      setTokenSet(!!saved.hec_token_set);
      setHecToken(""); // token now stored server-side; keep the field blank
      setLastRun(saved.last_run);
      setLastResult(saved.last_result);
      toast.success(enabled ? `Auto-forward on — every ${saved.interval_minutes} min` : "Auto-forward saved (off)");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 rounded-xl border border-th-line bg-th-panel p-4 shadow-card">
      <div>
        <h2 className="text-sm font-semibold text-th-heading">Forward security signals to SecSphere / SIEM</h2>
        <p className="mt-0.5 text-xs text-th-dim">
          Ship KubeUI's CVEs, misconfigurations, expiring certs, and risky RBAC to your SOC. SecSphere's log-pipeline ingests via its
          <span className="font-mono"> HEC collector :8088</span> — the recommended path. Syslog and a plain HTTP endpoint are also supported.
        </p>
      </div>

      {/* target */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block text-sm"><span className="mb-1 block text-th-dim">HEC collector — URL <span className="text-th-ghost">(recommended)</span></span>
          <input className={INPUT + " font-mono"} placeholder="http://…:8088/services/collector/event" value={hec} onChange={(e) => setHec(e.target.value)} />
        </label>
        <label className="block text-sm"><span className="mb-1 block text-th-dim">HEC token <span className="text-th-ghost">{tokenSet ? "(stored — leave blank to keep)" : "(optional)"}</span></span>
          <input className={INPUT + " font-mono"} type="password" placeholder={tokenSet ? "•••••••• stored" : "Splunk HEC token"} value={hecToken} onChange={(e) => setHecToken(e.target.value)} />
        </label>
        <label className="block text-sm"><span className="mb-1 block text-th-dim">Syslog (UDP) — host:port</span>
          <input className={INPUT + " font-mono"} placeholder="syslog.example.com:514" value={syslog} onChange={(e) => setSyslog(e.target.value)} />
        </label>
        <label className="block text-sm"><span className="mb-1 block text-th-dim">HTTP JSON endpoint</span>
          <input className={INPUT + " font-mono"} placeholder="https://integrations-hub…/ingest" value={http} onChange={(e) => setHttp(e.target.value)} />
        </label>
      </div>

      {/* signals */}
      <div>
        <span className="mb-1.5 block text-xs text-th-dim">Signals to forward</span>
        <div className="flex flex-wrap gap-2">
          {SIGNALS.map((s) => (
            <button
              key={s.key}
              type="button"
              title={s.hint}
              onClick={() => setSignals({ ...signals, [s.key]: !signals[s.key] })}
              className={`rounded-md border px-2.5 py-1 text-xs ${signals[s.key] ? "border-th-accent bg-th-accent/10 text-th-body" : "border-th-line bg-th-subtle text-th-ghost"}`}
            >
              {signals[s.key] ? "✓ " : ""}{s.label}
            </button>
          ))}
        </div>
      </div>

      {/* manual */}
      <div className="flex items-center gap-3 border-t border-th-line pt-3">
        <button onClick={send} disabled={busy} className={BTN}>{busy ? "Forwarding…" : "Forward now"}</button>
        {result && (
          <span className="text-xs text-th-dim">
            collected {result.collected} · sent {result.sent}
            {result.errors.length > 0 && <span className="text-th-danger"> · {result.errors.join("; ")}</span>}
          </span>
        )}
      </div>

      {/* schedule */}
      <div className="space-y-2 rounded-lg border border-th-line bg-th-subtle p-3">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-th-body">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4 accent-th-accent" />
            Auto-forward on a schedule
          </label>
          <span className="flex items-center gap-1.5 text-sm text-th-dim">
            every
            <input type="number" min={5} max={1440} value={interval} onChange={(e) => setIntervalMin(Number(e.target.value) || 60)} className={INPUT + " w-20 text-center"} />
            min
          </span>
          <button onClick={saveSchedule} disabled={saving} className={BTN + " ml-auto"}>{saving ? "Saving…" : "Save auto-forward"}</button>
        </div>
        <p className="text-[11px] text-th-ghost">
          Runs server-side (no browser needed). Config + token are stored in a Secret in KubeUI's namespace. Interval is clamped to 5–1440 min.
          {lastRun && <span className="text-th-dim"> · Last run {new Date(lastRun).toLocaleString()}{lastResult ? ` — ${lastResult}` : ""}</span>}
        </p>
      </div>
    </div>
  );
}
