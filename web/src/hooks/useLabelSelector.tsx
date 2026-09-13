import { useMemo } from "react";
import { useMaybeUrlState } from "@/hooks/useUrlState";

type Term =
  | { op: "eq"; key: string; val: string }
  | { op: "neq"; key: string; val: string }
  | { op: "exists"; key: string }
  | { op: "nexists"; key: string }
  | { op: "in"; key: string; set: string[] }
  | { op: "notin"; key: string; set: string[] };

/** Split on top-level commas, ignoring commas inside (…). */
function splitTerms(q: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = "";
  for (const ch of q) {
    if (ch === "(") depth++;
    if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) { out.push(cur); cur = ""; } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out.map((t) => t.trim()).filter(Boolean);
}

function parseSet(s: string): string[] {
  return s.replace(/^\(|\)$/g, "").split(",").map((x) => x.trim()).filter(Boolean);
}

/** Parse a kubectl-style label selector. Returns null on empty (match-all). */
function parseSelector(query: string): Term[] | null {
  const q = query.trim();
  if (!q) return null;
  const terms: Term[] = [];
  for (const raw of splitTerms(q)) {
    const t = raw.trim();
    let m: RegExpMatchArray | null;
    if ((m = t.match(/^(.+?)\s+notin\s+(\(.*\))$/i))) terms.push({ op: "notin", key: m[1].trim(), set: parseSet(m[2]) });
    else if ((m = t.match(/^(.+?)\s+in\s+(\(.*\))$/i))) terms.push({ op: "in", key: m[1].trim(), set: parseSet(m[2]) });
    else if ((m = t.match(/^(.+?)\s*!=\s*(.*)$/))) terms.push({ op: "neq", key: m[1].trim(), val: m[2].trim() });
    else if ((m = t.match(/^(.+?)\s*==?\s*(.*)$/))) terms.push({ op: "eq", key: m[1].trim(), val: m[2].trim() });
    else if (t.startsWith("!")) terms.push({ op: "nexists", key: t.slice(1).trim() });
    else terms.push({ op: "exists", key: t });
  }
  return terms;
}

function matchTerms(terms: Term[] | null, labels: Record<string, string> | undefined): boolean {
  if (!terms) return true;
  const l = labels || {};
  return terms.every((t) => {
    switch (t.op) {
      case "eq": return l[t.key] === t.val;
      case "neq": return l[t.key] !== t.val;
      case "exists": return t.key in l;
      case "nexists": return !(t.key in l);
      case "in": return t.key in l && t.set.includes(l[t.key]);
      case "notin": return !(t.key in l) || !t.set.includes(l[t.key]);
    }
  });
}

export interface LabelSelectorResult {
  query: string;
  setQuery: (q: string) => void;
  /** True when `labels` satisfies the current selector (always true when empty). */
  match: (labels: Record<string, string> | undefined) => boolean;
  /** True when a non-empty query fails to parse into any term. */
  invalid: boolean;
  active: boolean;
}

/**
 * kubectl-style client-side label filtering. Supports `key=value`, `key!=value`,
 * bare `key` (exists), `!key` (not exists), `key in (a,b)`, `key notin (a,b)`,
 * comma-separated (AND).
 */
export function useLabelSelector(opts?: { urlKey?: string }): LabelSelectorResult {
  const [query, setQuery] = useMaybeUrlState<string>(opts?.urlKey, "labels", "", (s) => s, (v) => v);
  const terms = useMemo(() => parseSelector(query), [query]);
  const match = useMemo(() => (labels: Record<string, string> | undefined) => matchTerms(terms, labels), [terms]);
  return {
    query,
    setQuery,
    match,
    invalid: query.trim().length > 0 && (terms === null || terms.length === 0),
    active: query.trim().length > 0,
  };
}

/** Compact label-selector input with a tag glyph and a live match count. */
export function LabelSelectorInput({
  value,
  onChange,
  matched,
  total,
  invalid,
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  matched?: number;
  total?: number;
  invalid?: boolean;
  className?: string;
}) {
  return (
    <div className={`relative ${className}`}>
      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-th-ghost pointer-events-none" aria-hidden>
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M7 7h.01M7 3h5a2 2 0 011.414.586l7 7a2 2 0 010 2.828l-5 5a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z" />
        </svg>
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Label selector — app=nginx,tier=frontend"
        spellCheck={false}
        className={`w-full pl-8 pr-16 py-2 bg-th-subtle border rounded-lg text-sm text-th-body placeholder:text-th-ghost focus:outline-none focus:ring-1 ${invalid ? "border-th-danger focus:ring-th-danger" : "border-th-line focus:ring-th-accent"}`}
      />
      {value.trim() && (
        <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] tabular-nums text-th-dim pointer-events-none">
          {invalid ? <span className="text-th-danger">invalid</span> : <>{matched ?? 0}/{total ?? 0}</>}
        </span>
      )}
    </div>
  );
}
