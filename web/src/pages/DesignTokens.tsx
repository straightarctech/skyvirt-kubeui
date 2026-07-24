import { useEffect, useState } from "react";
import { STATUS, type StatusKind } from "@/lib/status";
import { StatStrip } from "@/components/ResourceSummary";
import { EmptyState } from "@/components/EmptyState";

/**
 * Living design-token + component reference — the "contract" that keeps the UI
 * (and any future extension) visually consistent. It reads the REAL CSS
 * variables at runtime via getComputedStyle, so it can never drift from
 * index.css, and it re-reads on theme change. Every text token shows its
 * measured WCAG contrast against the panel surface with a pass/fail badge.
 *
 * Unlinked by design (reachable at /design) — a maintainer/contributor tool,
 * not an end-user feature.
 */

/* ---- WCAG contrast (same math as internal/theme/contrast_test.go) ------ */
function lin(c: number) {
  c /= 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function relLum(hex: string) {
  const h = hex.replace("#", "");
  if (h.length < 6) return 0;
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function contrast(a: string, b: string) {
  const la = relLum(a), lb = relLum(b);
  const hi = Math.max(la, lb), lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

function readVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

const SURFACES = ["--th-page", "--th-panel", "--th-panel-alt", "--th-subtle", "--th-hover", "--th-muted", "--th-line"];
const TEXT = ["--th-heading", "--th-body", "--th-label", "--th-dim", "--th-ghost", "--th-faint"];
const ACCENTS = ["--th-accent", "--th-danger", "--th-warn", "--th-ok", "--th-info"];
const STATUS_TOKENS = ["--status-ok", "--status-warn", "--status-error", "--status-info", "--status-unknown"];

function Swatch({ name, value }: { name: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-th-line bg-th-panel p-2">
      <span className="h-9 w-9 shrink-0 rounded-md border border-th-line" style={{ background: value }} />
      <div className="min-w-0">
        <div className="truncate font-mono text-xs text-th-body">{name}</div>
        <div className="font-mono text-[10px] text-th-dim">{value || "—"}</div>
      </div>
    </div>
  );
}

function TextRow({ name, value, bg }: { name: string; value: string; bg: string }) {
  const ratio = value.startsWith("#") && bg.startsWith("#") ? contrast(value, bg) : 0;
  const decorative = name === "--th-faint";
  const pass = ratio >= 4.5;
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-th-line bg-th-panel p-2.5">
      <span style={{ color: value }} className="text-sm font-medium">{name}</span>
      <div className="flex items-center gap-2">
        <span className="font-mono text-[10px] text-th-dim">{ratio ? `${ratio.toFixed(2)}:1` : ""}</span>
        {decorative ? (
          <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold bg-th-muted text-th-dim">decorative</span>
        ) : (
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${pass ? "bg-th-ok-s text-th-ok" : "bg-th-danger-s text-th-danger"}`}>
            {pass ? "AA ✓" : "fails AA"}
          </span>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h2 className="text-xs font-bold uppercase tracking-wider text-th-dim">{title}</h2>
      {children}
    </div>
  );
}

export default function DesignTokens() {
  // Re-read tokens whenever the theme class flips.
  const [, force] = useState(0);
  useEffect(() => {
    const obs = new MutationObserver(() => force((n) => n + 1));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);

  const panel = readVar("--th-panel");

  return (
    <div className="max-w-5xl space-y-8 animate-fade-in pb-16">
      <div>
        <h1 className="text-2xl font-bold text-th-heading">Design Tokens</h1>
        <p className="mt-1 text-sm text-th-dim">
          Live from <code className="rounded bg-th-subtle px-1 text-xs">index.css</code> — reflects the current theme.
          Contrast is measured against the panel surface; the CI test in <code className="rounded bg-th-subtle px-1 text-xs">internal/theme</code> enforces the same floor.
        </p>
      </div>

      <Section title="Text — measured contrast on panel">
        <div className="grid gap-2 sm:grid-cols-2">
          {TEXT.map((t) => <TextRow key={t} name={t} value={readVar(t)} bg={panel} />)}
        </div>
      </Section>

      <Section title="Surfaces">
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {SURFACES.map((s) => <Swatch key={s} name={s} value={readVar(s)} />)}
        </div>
      </Section>

      <Section title="Accents">
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {ACCENTS.map((a) => <Swatch key={a} name={a} value={readVar(a)} />)}
        </div>
      </Section>

      <Section title="Semantic status — single source of truth (lib/status.ts + --status-* tokens)">
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {STATUS_TOKENS.map((s) => <Swatch key={s} name={s} value={readVar(s)} />)}
        </div>
        <div className="flex flex-wrap gap-3 pt-1">
          {(Object.keys(STATUS) as StatusKind[]).map((k) => (
            <div key={k} className="flex items-center gap-2 rounded-lg border border-th-line bg-th-panel px-3 py-2">
              <span className="h-4 w-4 rounded-full" style={{ background: STATUS[k].fill, border: `2px solid ${STATUS[k].ring}` }} />
              <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${STATUS[k].badge}`}>{STATUS[k].label}</span>
              <code className="font-mono text-[10px] text-th-dim">{k}</code>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Components">
        <div className="space-y-4">
          <StatStrip stats={[
            { label: "Total", value: 42, tone: "accent" },
            { label: "Ready", value: 40, tone: "ok" },
            { label: "Warning", value: 1, tone: "warn" },
            { label: "Failed", value: 1, tone: "error" },
            { label: "Info", value: 3, tone: "info" },
            { label: "Unknown", value: 0, tone: "neutral" },
          ]} />
          <div className="rounded-xl border border-th-line bg-th-panel shadow-card">
            <EmptyState title="No resources found" hint="This is the shared EmptyState — an invitation to act, not a dead end." />
          </div>
        </div>
      </Section>
    </div>
  );
}
