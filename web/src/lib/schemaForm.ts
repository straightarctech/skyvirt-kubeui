// schemaForm — turns a Helm chart's values.schema.json into a flat list of form
// fields, and manages the sparse overlay the form produces.
//
// WHY A SPARSE OVERLAY, NOT AN EDITED DOCUMENT
// A chart's values.yaml is heavily commented, and those comments are most of its
// documentation. Parsing it and dumping it back — which is what "edit the document"
// would mean — destroys every comment and the original key order. So the form never
// touches the chart's values.yaml. It builds a separate object containing only the
// keys the user actually changed, which the backend passes to helm as a second `-f`.
// Helm merges values files left to right, so the overlay wins and the base file
// reaches helm byte-for-byte as the chart shipped it.
//
// Deliberately hand-rolled: this repo runs ten runtime dependencies with no form
// library and no validator, for air-gap reasons. Anything in a schema this does not
// understand is reported in `unsupported` and edited in the YAML tab instead — never
// silently dropped.

import jsYaml from "js-yaml";

export type FieldType = "string" | "number" | "boolean" | "enum" | "array";

export interface SchemaField {
  /** Property path from the schema root, e.g. ["controller", "replicaCount"]. */
  path: string[];
  /** Dotted form of `path`, used as a React key and in messages. */
  key: string;
  /** `title` from the schema, else the last path segment. */
  title: string;
  description?: string;
  type: FieldType;
  required: boolean;
  enum?: (string | number)[];
  default?: unknown;
  minimum?: number;
  maximum?: number;
  pattern?: string;
  /** For `array`: the scalar item type. Arrays of objects are unsupported. */
  itemType?: "string" | "number";
}

export interface FlatSchema {
  fields: SchemaField[];
  /** Dotted paths the walker could not render, for the "edit in YAML" note. */
  unsupported: string[];
}

type JsonObject = Record<string, unknown>;

const isObject = (v: unknown): v is JsonObject =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * resolveRef follows a local JSON Pointer ($ref) such as "#/$defs/helm-values".
 * External refs (anything not starting "#/") are not followed.
 *
 * This is not optional polish: real charts use $ref as their primary structure.
 * cert-manager's values.schema.json is literally {"$ref": "#/$defs/helm-values"}
 * over 278 definitions, so a walker that skipped $ref would render zero fields for
 * it and silently fall back to raw YAML — the exact outcome this form exists to
 * replace.
 */
function resolveRef(root: JsonObject, ref: string): unknown {
  if (!ref.startsWith("#/")) return undefined;
  let cur: unknown = root;
  for (const raw of ref.slice(2).split("/")) {
    // JSON Pointer escapes, per RFC 6901.
    const seg = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    if (!isObject(cur)) return undefined;
    cur = cur[seg];
  }
  return cur;
}

/**
 * flattenSchema walks a JSON Schema into renderable leaf fields.
 *
 * Supported: object (recursed), local $ref, string, number, integer, boolean, enum,
 * and arrays of scalars — plus title, description, default, required, minimum,
 * maximum, pattern. Everything else (oneOf, anyOf, allOf, external $ref, arrays of
 * objects, untyped nodes) lands in `unsupported` and is edited in the YAML tab.
 *
 * Measured against cert-manager's values.schema.json (114KB, 278 $defs): 133 fields
 * rendered, 43 unsupported — the 43 being arrays of objects such as tolerations and
 * volumeMounts. Without $ref resolution the same schema yields ZERO fields.
 */
export function flattenSchema(schema: unknown): FlatSchema {
  const fields: SchemaField[] = [];
  const unsupported: string[] = [];

  const root = isObject(schema) ? schema : {};

  const walk = (node: unknown, path: string[], requiredHere: Set<string>, seen: Set<string>) => {
    if (!isObject(node)) {
      if (path.length) unsupported.push(path.join("."));
      return;
    }

    // Follow local $refs. A ref already being expanded on this branch is a cycle —
    // stop rather than recurse forever.
    if (typeof node.$ref === "string") {
      const target = resolveRef(root, node.$ref);
      if (target === undefined || seen.has(node.$ref)) {
        if (path.length) unsupported.push(path.join("."));
        return;
      }
      walk(target, path, requiredHere, new Set([...seen, node.$ref]));
      return;
    }

    // Constructs this walker deliberately does not model.
    if (node.oneOf || node.anyOf || node.allOf) {
      if (path.length) unsupported.push(path.join("."));
      return;
    }

    const type = typeof node.type === "string" ? node.type : undefined;

    if (type === "object" || (!type && isObject(node.properties))) {
      const props = isObject(node.properties) ? node.properties : {};
      const req = new Set(Array.isArray(node.required) ? (node.required as string[]) : []);
      for (const [name, child] of Object.entries(props)) {
        walk(child, [...path, name], req, seen);
      }
      return;
    }

    if (!path.length) return; // root with no properties — nothing to render

    const name = path[path.length - 1];
    const base = {
      path,
      key: path.join("."),
      title: typeof node.title === "string" ? node.title : name,
      description: typeof node.description === "string" ? node.description : undefined,
      required: requiredHere.has(name),
      default: node.default,
    };

    if (Array.isArray(node.enum) && node.enum.length) {
      fields.push({ ...base, type: "enum", enum: node.enum as (string | number)[] });
      return;
    }

    switch (type) {
      case "string":
        fields.push({
          ...base,
          type: "string",
          pattern: typeof node.pattern === "string" ? node.pattern : undefined,
        });
        return;
      case "integer":
      case "number":
        fields.push({
          ...base,
          type: "number",
          minimum: typeof node.minimum === "number" ? node.minimum : undefined,
          maximum: typeof node.maximum === "number" ? node.maximum : undefined,
        });
        return;
      case "boolean":
        fields.push({ ...base, type: "boolean" });
        return;
      case "array": {
        const items = isObject(node.items) ? node.items : undefined;
        const it = items && typeof items.type === "string" ? items.type : undefined;
        if (it === "string") {
          fields.push({ ...base, type: "array", itemType: "string" });
          return;
        }
        if (it === "integer" || it === "number") {
          fields.push({ ...base, type: "array", itemType: "number" });
          return;
        }
        unsupported.push(base.key); // array of objects, or untyped items
        return;
      }
      default:
        unsupported.push(base.key);
    }
  };

  walk(schema, [], new Set(), new Set());
  return { fields, unsupported };
}

/** Reads a value out of a nested object by path, or undefined. */
export function getAtPath(obj: JsonObject, path: string[]): unknown {
  let cur: unknown = obj;
  for (const seg of path) {
    if (!isObject(cur)) return undefined;
    cur = cur[seg];
  }
  return cur;
}

/**
 * setAtPath returns a copy of `obj` with `value` written at `path`, creating
 * intermediate objects as needed. Returns a new object — callers hold it in React
 * state, so mutating in place would not re-render.
 */
export function setAtPath(obj: JsonObject, path: string[], value: unknown): JsonObject {
  if (!path.length) return obj;
  const [head, ...rest] = path;
  const next: JsonObject = { ...obj };
  if (!rest.length) {
    next[head] = value;
    return next;
  }
  const child = isObject(next[head]) ? (next[head] as JsonObject) : {};
  next[head] = setAtPath(child, rest, value);
  return next;
}

/**
 * deleteAtPath removes a path and any containers it leaves empty. Clearing a field
 * must remove it from the overlay entirely, otherwise the form would pin the chart's
 * own default as an explicit override — which looks identical in the UI but behaves
 * differently when the chart's default changes.
 */
export function deleteAtPath(obj: JsonObject, path: string[]): JsonObject {
  if (!path.length) return obj;
  const [head, ...rest] = path;
  if (!(head in obj)) return obj;
  const next: JsonObject = { ...obj };
  if (!rest.length) {
    delete next[head];
    return next;
  }
  if (isObject(next[head])) {
    const pruned = deleteAtPath(next[head] as JsonObject, rest);
    if (Object.keys(pruned).length === 0) delete next[head];
    else next[head] = pruned;
  }
  return next;
}

/** validateField returns a message for FormField's `error` prop, or undefined. */
export function validateField(field: SchemaField, value: unknown): string | undefined {
  const empty = value === undefined || value === "" || value === null;
  if (empty) return field.required ? `${field.title} is required` : undefined;

  if (field.type === "number") {
    const n = typeof value === "number" ? value : Number(value);
    if (Number.isNaN(n)) return "Must be a number";
    if (field.minimum !== undefined && n < field.minimum) return `Must be at least ${field.minimum}`;
    if (field.maximum !== undefined && n > field.maximum) return `Must be at most ${field.maximum}`;
    return undefined;
  }

  if (field.type === "string" && field.pattern) {
    try {
      if (!new RegExp(field.pattern).test(String(value))) {
        return `Must match ${field.pattern}`;
      }
    } catch {
      return undefined; // an unparseable pattern is the chart's problem, not the user's
    }
  }
  return undefined;
}

const DUMP = { sortKeys: true, lineWidth: -1, noRefs: true } as const;

/** Serialises the overlay for the backend's second `-f`. Empty overlay → "". */
export function overlayToYAML(overlay: JsonObject): string {
  if (!overlay || Object.keys(overlay).length === 0) return "";
  return jsYaml.dump(overlay, DUMP);
}

/** Deep-merges `overlay` over `base`, the way helm merges two values files. */
function deepMerge(base: unknown, overlay: unknown): unknown {
  if (!isObject(base) || !isObject(overlay)) return overlay;
  const out: JsonObject = { ...base };
  for (const [k, v] of Object.entries(overlay)) {
    out[k] = k in out ? deepMerge(out[k], v) : v;
  }
  return out;
}

/**
 * previewPair renders the before/after strings for the install diff.
 *
 * BOTH sides are re-serialised with the same options on purpose. Diffing the raw
 * chart values.yaml against a dumped document would report every comment and every
 * key-order difference as a change, burying the handful of lines the user actually
 * altered. Normalising both sides means the diff shows only real edits — at the cost
 * of not looking byte-identical to the YAML tab, which is the right trade for a
 * preview.
 */
export function previewPair(baseYAML: string, overlay: JsonObject): { before: string; after: string } {
  let base: unknown;
  try {
    base = jsYaml.load(baseYAML) ?? {};
  } catch {
    return { before: baseYAML, after: baseYAML }; // unparseable base: show no change
  }
  const before = jsYaml.dump(base, DUMP);
  if (!overlay || Object.keys(overlay).length === 0) return { before, after: before };
  return { before, after: jsYaml.dump(deepMerge(base, overlay), DUMP) };
}
