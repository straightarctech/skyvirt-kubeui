// Drift detection: compare a live object against its last-applied configuration,
// looking only at the fields the user actually DECLARED — so server-side defaults
// and status don't show up as false drift.

/** Prune `live` down to only the keys present in `shape` (the declared config),
 *  recursively. Scalars return the live value; arrays are pruned element-wise
 *  against the declared array's first element as a template. */
export function pruneToShape(live: unknown, shape: unknown): unknown {
  if (Array.isArray(shape)) {
    if (!Array.isArray(live)) return live;
    const tmpl = shape.find((x) => x && typeof x === "object");
    return live.map((el) => (tmpl && el && typeof el === "object" ? pruneToShape(el, tmpl) : el));
  }
  if (shape && typeof shape === "object") {
    if (!live || typeof live !== "object" || Array.isArray(live)) return live ?? null;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(shape as Record<string, unknown>)) {
      out[k] = pruneToShape((live as Record<string, unknown>)[k], (shape as Record<string, unknown>)[k]);
    }
    return out;
  }
  return live;
}

const LAST_APPLIED = "kubectl.kubernetes.io/last-applied-configuration";

/** Extract the parsed last-applied-configuration from a live object, or null. */
export function lastApplied(live: Record<string, unknown>): Record<string, unknown> | null {
  const meta = live.metadata as Record<string, unknown> | undefined;
  const ann = meta?.annotations as Record<string, string> | undefined;
  const raw = ann?.[LAST_APPLIED];
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Strip fields that are always noise in a declared-vs-live comparison. */
export function stripNoise(o: Record<string, unknown>): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(o)) as Record<string, unknown>;
  const meta = clone.metadata as Record<string, unknown> | undefined;
  if (meta) {
    delete meta.creationTimestamp;
    const ann = meta.annotations as Record<string, string> | undefined;
    if (ann) delete ann[LAST_APPLIED];
  }
  return clone;
}
