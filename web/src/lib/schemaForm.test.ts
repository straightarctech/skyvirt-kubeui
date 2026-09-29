// Tests for the values-schema walker.
//
// These exist because of a specific miss. The walker originally treated $ref as an
// unsupported construct, which type-checks perfectly and renders ZERO fields for a
// real chart — cert-manager's values.schema.json is {"$ref": "#/$defs/helm-values"}
// over 278 definitions, and $ref is how real charts are structured. tsc cannot see
// that class of bug; only running the code against a realistic schema can.
//
// Run with `npm test` (Node's built-in runner — no test-framework dependency).

import test from "node:test";
import assert from "node:assert/strict";

import {
  flattenSchema,
  getAtPath,
  setAtPath,
  deleteAtPath,
  validateField,
  overlayToYAML,
  previewPair,
  type SchemaField,
} from "./schemaForm";

const field = (f: SchemaField[], key: string): SchemaField => {
  const found = f.find((x) => x.key === key);
  assert.ok(found, `expected a field at ${key}, got: ${f.map((x) => x.key).join(", ")}`);
  return found;
};

// ── $ref: the regression these tests exist for ──────────────────────────────

test("$ref is followed — a chart whose schema is entirely $defs still renders", () => {
  // The exact shape cert-manager uses: a root that is nothing but a pointer.
  const schema = {
    $schema: "http://json-schema.org/draft-07/schema#",
    $ref: "#/$defs/helm-values",
    $defs: {
      "helm-values": {
        type: "object",
        properties: {
          replicaCount: { $ref: "#/$defs/helm-values.replicaCount" },
          image: { $ref: "#/$defs/helm-values.image" },
        },
        required: ["replicaCount"],
      },
      "helm-values.replicaCount": { type: "integer", default: 1, description: "How many" },
      "helm-values.image": {
        type: "object",
        properties: { tag: { type: "string", default: "latest" } },
      },
    },
  };

  const { fields } = flattenSchema(schema);
  assert.equal(fields.length, 2, "both leaves should render through their $refs");

  const rc = field(fields, "replicaCount");
  assert.equal(rc.type, "number");
  assert.equal(rc.default, 1);
  assert.equal(rc.required, true, "required is declared on the object that holds the $ref");
  assert.equal(rc.description, "How many", "metadata comes from the ref target");

  assert.equal(field(fields, "image.tag").type, "string");
});

test("a $ref cycle terminates instead of hanging", () => {
  const schema = {
    $ref: "#/$defs/a",
    $defs: {
      a: { type: "object", properties: { loop: { $ref: "#/$defs/a" }, name: { type: "string" } } },
    },
  };
  const { fields, unsupported } = flattenSchema(schema);
  assert.equal(field(fields, "name").type, "string", "the non-cyclic sibling still renders");
  assert.ok(unsupported.includes("loop"), "the cycle is reported, not silently dropped");
});

test("an unresolvable or external $ref is reported, not followed", () => {
  const schema = {
    type: "object",
    properties: {
      gone: { $ref: "#/$defs/missing" },
      remote: { $ref: "https://example.com/schema.json" },
      ok: { type: "string" },
    },
  };
  const { fields, unsupported } = flattenSchema(schema);
  assert.equal(fields.length, 1);
  assert.deepEqual(unsupported.sort(), ["gone", "remote"]);
});

// ── type mapping ────────────────────────────────────────────────────────────

test("scalar types, enums and scalar arrays map to controls", () => {
  const schema = {
    type: "object",
    required: ["name"],
    properties: {
      name: { type: "string", pattern: "^[a-z]+$", title: "Name" },
      count: { type: "integer", minimum: 1, maximum: 9 },
      ratio: { type: "number" },
      on: { type: "boolean" },
      mode: { type: "string", enum: ["a", "b"] },
      hosts: { type: "array", items: { type: "string" } },
      ports: { type: "array", items: { type: "integer" } },
    },
  };
  const { fields, unsupported } = flattenSchema(schema);
  assert.equal(unsupported.length, 0);

  assert.equal(field(fields, "name").type, "string");
  assert.equal(field(fields, "name").title, "Name", "title wins over the property name");
  assert.equal(field(fields, "name").required, true);
  assert.equal(field(fields, "name").pattern, "^[a-z]+$");

  assert.equal(field(fields, "count").type, "number");
  assert.equal(field(fields, "count").minimum, 1);
  assert.equal(field(fields, "count").maximum, 9);

  assert.equal(field(fields, "ratio").type, "number");
  assert.equal(field(fields, "on").type, "boolean");

  // enum beats the declared type — it renders as a choice, not a free text box.
  assert.equal(field(fields, "mode").type, "enum");
  assert.deepEqual(field(fields, "mode").enum, ["a", "b"]);

  assert.equal(field(fields, "hosts").itemType, "string");
  assert.equal(field(fields, "ports").itemType, "number");
});

test("constructs the walker does not model are reported for the YAML tab", () => {
  const schema = {
    type: "object",
    properties: {
      tolerations: { type: "array", items: { type: "object" } }, // array of objects
      either: { oneOf: [{ type: "string" }, { type: "integer" }] },
      any: { anyOf: [{ type: "string" }] },
      all: { allOf: [{ type: "string" }] },
      untyped: { description: "no type at all" },
      fine: { type: "string" },
    },
  };
  const { fields, unsupported } = flattenSchema(schema);
  assert.deepEqual(fields.map((f) => f.key), ["fine"]);
  assert.deepEqual(unsupported.sort(), ["all", "any", "either", "tolerations", "untyped"]);
});

test("nested objects become dotted paths, and required is scoped to its own object", () => {
  const schema = {
    type: "object",
    required: ["outer"],
    properties: {
      outer: {
        type: "object",
        required: ["inner"],
        properties: { inner: { type: "string" }, other: { type: "string" } },
      },
    },
  };
  const { fields } = flattenSchema(schema);
  assert.deepEqual(fields.map((f) => f.key), ["outer.inner", "outer.other"]);
  assert.equal(field(fields, "outer.inner").required, true);
  assert.equal(field(fields, "outer.other").required, false, "required must not leak across siblings");
  assert.deepEqual(field(fields, "outer.inner").path, ["outer", "inner"]);
});

test("a schema that is not an object yields nothing rather than throwing", () => {
  for (const input of [null, undefined, 42, "nope", []]) {
    const { fields } = flattenSchema(input);
    assert.equal(fields.length, 0);
  }
});

// ── overlay manipulation ────────────────────────────────────────────────────

test("setAtPath creates intermediates and never mutates its input", () => {
  const before = { keep: 1 };
  const after = setAtPath(before, ["a", "b", "c"], 7);
  assert.deepEqual(before, { keep: 1 }, "React state would not re-render on a mutation");
  assert.equal(getAtPath(after, ["a", "b", "c"]), 7);
  assert.equal(getAtPath(after, ["keep"]), 1);
});

test("getAtPath returns undefined rather than throwing on a missing branch", () => {
  assert.equal(getAtPath({}, ["a", "b"]), undefined);
  assert.equal(getAtPath({ a: 5 }, ["a", "b"]), undefined, "scalar mid-path");
});

test("deleteAtPath prunes containers it empties", () => {
  // Clearing a field must remove it entirely. Leaving {a:{}} behind would serialise
  // as an empty map in the overlay and pin a default the chart may later change.
  const overlay = setAtPath({}, ["a", "b"], 1);
  const pruned = deleteAtPath(overlay, ["a", "b"]);
  assert.deepEqual(pruned, {}, "the now-empty parent goes too");

  const two = setAtPath(setAtPath({}, ["a", "b"], 1), ["a", "c"], 2);
  assert.deepEqual(deleteAtPath(two, ["a", "b"]), { a: { c: 2 } }, "a parent with siblings stays");

  assert.deepEqual(deleteAtPath({ x: 1 }, ["nope"]), { x: 1 }, "deleting a missing path is a no-op");
});

// ── validation ──────────────────────────────────────────────────────────────

test("validateField enforces required, bounds and pattern", () => {
  const num: SchemaField = { path: ["n"], key: "n", title: "N", type: "number", required: false, minimum: 2, maximum: 5 };
  assert.equal(validateField(num, 3), undefined);
  assert.match(String(validateField(num, 1)), /at least 2/);
  assert.match(String(validateField(num, 9)), /at most 5/);
  assert.match(String(validateField(num, "abc")), /must be a number/i);

  const req: SchemaField = { path: ["r"], key: "r", title: "R", type: "string", required: true };
  assert.match(String(validateField(req, "")), /required/);
  assert.equal(validateField(req, "x"), undefined);

  const opt: SchemaField = { path: ["o"], key: "o", title: "O", type: "string", required: false };
  assert.equal(validateField(opt, ""), undefined, "empty is fine when not required");

  const pat: SchemaField = { path: ["p"], key: "p", title: "P", type: "string", required: false, pattern: "^[a-z]+$" };
  assert.equal(validateField(pat, "abc"), undefined);
  assert.match(String(validateField(pat, "ABC")), /must match/i);

  // A chart shipping an invalid regex is the chart's problem — do not block the user.
  const bad: SchemaField = { ...pat, pattern: "([unclosed" };
  assert.equal(validateField(bad, "anything"), undefined);
});

// ── serialisation and preview ───────────────────────────────────────────────

test("an empty overlay serialises to nothing, so no second -f is sent", () => {
  assert.equal(overlayToYAML({}), "");
});

test("overlayToYAML emits only what was set", () => {
  const yaml = overlayToYAML(setAtPath({}, ["image", "tag"], "1.2.3"));
  assert.match(yaml, /image:/);
  assert.match(yaml, /tag: 1\.2\.3/);
  assert.doesNotMatch(yaml, /replicaCount/, "untouched keys must not appear");
});

test("previewPair reports no change when nothing was edited", () => {
  const base = "# a comment\nreplicaCount: 1\nimage:\n  tag: old\n";
  const { before, after } = previewPair(base, {});
  assert.equal(before, after);
});

test("previewPair merges the overlay over the base", () => {
  const base = "replicaCount: 1\nimage:\n  tag: old\n";
  const { before, after } = previewPair(base, setAtPath({}, ["image", "tag"], "new"));
  assert.match(before, /tag: old/);
  assert.match(after, /tag: new/);
  assert.match(after, /replicaCount: 1/, "untouched keys survive the merge");
});

test("previewPair degrades to no-change on an unparseable base", () => {
  const broken = "this: [is: not: valid";
  const { before, after } = previewPair(broken, setAtPath({}, ["x"], 1));
  assert.equal(before, after, "a broken document must not render as a wholesale rewrite");
});
