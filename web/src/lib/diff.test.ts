// Tests for the unified line diff.
//
// This is what a user reads before approving a change: a Helm upgrade, a GitOps
// sync, a drift revert, an install preview. A diff that under-reports is the
// dangerous direction — it shows "nothing changed" for a change that is about to
// be applied. The line numbers are displayed too, so they are asserted, not
// assumed.

import test from "node:test";
import assert from "node:assert/strict";

import { lineDiff, diffStats, type DiffLine } from "./diff";

const kinds = (lines: DiffLine[]) => lines.map((l) => l.type).join("");
const texts = (lines: DiffLine[], type: DiffLine["type"]) =>
  lines.filter((l) => l.type === type).map((l) => l.text);

test("identical input reports no changes at all", () => {
  const doc = "a\nb\nc\n";
  const lines = lineDiff(doc, doc);
  assert.deepEqual(diffStats(lines), { added: 0, removed: 0 });
  assert.ok(lines.every((l) => l.type === "ctx"), "every line should be context");
});

test("a trailing newline is not a change", () => {
  // Documents come from textareas, editors and helm output; some end with a
  // newline and some do not. Treating that as a diff would make every preview
  // show a spurious final-line change.
  assert.deepEqual(diffStats(lineDiff("a\nb\n", "a\nb")), { added: 0, removed: 0 });
  assert.deepEqual(diffStats(lineDiff("a\nb", "a\nb\n")), { added: 0, removed: 0 });
});

test("a pure addition is reported as additions only", () => {
  const lines = lineDiff("a\nb\n", "a\nnew\nb\n");
  assert.deepEqual(diffStats(lines), { added: 1, removed: 0 });
  assert.deepEqual(texts(lines, "add"), ["new"]);
});

test("a pure deletion is reported as deletions only", () => {
  const lines = lineDiff("a\ngone\nb\n", "a\nb\n");
  assert.deepEqual(diffStats(lines), { added: 0, removed: 1 });
  assert.deepEqual(texts(lines, "del"), ["gone"]);
});

test("a replaced line is one deletion and one addition", () => {
  const lines = lineDiff("a\nold\nb\n", "a\nnew\nb\n");
  assert.deepEqual(diffStats(lines), { added: 1, removed: 1 });
  assert.deepEqual(texts(lines, "del"), ["old"]);
  assert.deepEqual(texts(lines, "add"), ["new"]);
});

test("an edit deep inside a large unchanged file is still found", () => {
  // The head/tail trim exists so the LCS only runs on the changed middle. If the
  // trim were wrong, this is where it would show: a one-line edit buried in a
  // file big enough that the whole-file LCS would hit the size guard.
  const before = Array.from({ length: 3000 }, (_, i) => `line ${i}`);
  const after = [...before];
  after[1500] = "line 1500 CHANGED";

  const lines = lineDiff(before.join("\n"), after.join("\n"));
  assert.deepEqual(diffStats(lines), { added: 1, removed: 1 });
  assert.deepEqual(texts(lines, "del"), ["line 1500"]);
  assert.deepEqual(texts(lines, "add"), ["line 1500 CHANGED"]);
});

test("line numbers point at the right side of the diff", () => {
  // aln is the line in the BEFORE document, bln the line in the AFTER. A
  // deletion has no bln and an addition has no aln; getting these wrong sends a
  // reader to the wrong line of the file they are reviewing.
  const lines = lineDiff("keep\nold\ntail\n", "keep\nnew\nextra\ntail\n");

  const del = lines.find((l) => l.type === "del");
  assert.ok(del, "expected a deletion");
  assert.equal(del.text, "old");
  assert.equal(del.aln, 2, "deleted line was line 2 of the before document");
  assert.equal(del.bln, undefined, "a deleted line has no after-line number");

  const adds = lines.filter((l) => l.type === "add");
  assert.deepEqual(adds.map((l) => l.text), ["new", "extra"]);
  assert.deepEqual(adds.map((l) => l.bln), [2, 3]);
  assert.ok(adds.every((l) => l.aln === undefined), "added lines have no before-line number");

  const first = lines[0];
  assert.equal(first.type, "ctx");
  assert.equal(first.aln, 1);
  assert.equal(first.bln, 1);
});

test("everything replaced reports every line on both sides", () => {
  const lines = lineDiff("a\nb\nc\n", "x\ny\nz\n");
  assert.deepEqual(diffStats(lines), { added: 3, removed: 3 });
});

test("an empty document against content is all additions", () => {
  const lines = lineDiff("", "a\nb\n");
  const { added, removed } = diffStats(lines);
  assert.equal(added, 2, `expected both lines as additions, got ${kinds(lines)}`);
  assert.ok(removed <= 1, "an empty before document has at most the empty line to remove");
});

test("content against an empty document is all deletions", () => {
  const { removed } = diffStats(lineDiff("a\nb\n", ""));
  assert.equal(removed, 2);
});

test("a huge fully-changed region falls back to block replace rather than hanging", () => {
  // The LCS table is O(n·m); above ~4M cells the code deliberately stops building
  // it and reports the block as wholly replaced. Without that guard this input
  // would allocate a 4-million-entry table and freeze the browser tab.
  const n = 2100; // 2100 * 2100 = 4.41M cells, over the guard
  const before = Array.from({ length: n }, (_, i) => `a${i}`).join("\n");
  const after = Array.from({ length: n }, (_, i) => `b${i}`).join("\n");

  const started = Date.now();
  const lines = lineDiff(before, after);
  const elapsed = Date.now() - started;

  assert.deepEqual(diffStats(lines), { added: n, removed: n });
  assert.ok(elapsed < 5000, `fallback took ${elapsed}ms; the size guard is not firing`);
});

test("trimming both ends keeps the LCS under the size guard", () => {
  // The head trim is not decoration. With a big common prefix AND suffix around a
  // partially-changed middle, trimming both ends keeps the LCS region small enough
  // to run properly. Trim only the tail and the region is 4x larger, trips the
  // size guard, and the diff degrades to "everything replaced" — the reader loses
  // every unchanged line in the middle and sees a wall of red and green.
  const head = Array.from({ length: 1500 }, (_, i) => `head ${i}`);
  const tail = Array.from({ length: 1500 }, (_, i) => `tail ${i}`);
  // Middle: every other line is identical, so a real LCS finds 750 context lines.
  const midA = Array.from({ length: 1500 }, (_, i) => (i % 2 === 0 ? `same ${i}` : `a ${i}`));
  const midB = Array.from({ length: 1500 }, (_, i) => (i % 2 === 0 ? `same ${i}` : `b ${i}`));

  const lines = lineDiff([...head, ...midA, ...tail].join("\n"), [...head, ...midB, ...tail].join("\n"));
  const { added, removed } = diffStats(lines);

  assert.equal(added, 750, `expected only the changed half as additions, got ${added} — the size guard tripped`);
  assert.equal(removed, 750, `expected only the changed half as deletions, got ${removed}`);
});

test("diffStats ignores context lines", () => {
  const lines: DiffLine[] = [
    { type: "ctx", text: "a" },
    { type: "add", text: "b" },
    { type: "add", text: "c" },
    { type: "del", text: "d" },
  ];
  assert.deepEqual(diffStats(lines), { added: 2, removed: 1 });
  assert.deepEqual(diffStats([]), { added: 0, removed: 0 });
});
