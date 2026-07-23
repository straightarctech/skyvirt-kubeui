// Dependency-free unified line diff for config/manifest comparison (Helm revision
// diff, dry-run preview, GitOps-lite). Trims the common head/tail first so the
// O(n·m) LCS only runs on the changed middle — fast for "small change in big file".

export type DiffLine = { type: "add" | "del" | "ctx"; text: string; aln?: number; bln?: number };

function lcsDiff(a: string[], b: string[], aOff: number, bOff: number): DiffLine[] {
  const n = a.length;
  const m = b.length;
  // Guard: if the changed region is huge, don't build a giant DP table —
  // fall back to "replace the whole block" (all deletions then additions).
  if (n * m > 4_000_000) {
    return [
      ...a.map((t, i) => ({ type: "del" as const, text: t, aln: aOff + i + 1 })),
      ...b.map((t, j) => ({ type: "add" as const, text: t, bln: bOff + j + 1 })),
    ];
  }
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: "ctx", text: a[i], aln: aOff + i + 1, bln: bOff + j + 1 });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ type: "del", text: a[i], aln: aOff + i + 1 });
      i++;
    } else {
      out.push({ type: "add", text: b[j], bln: bOff + j + 1 });
      j++;
    }
  }
  while (i < n) out.push({ type: "del", text: a[i], aln: aOff + ++i });
  while (j < m) out.push({ type: "add", text: b[j], bln: bOff + ++j });
  return out;
}

export function lineDiff(aText: string, bText: string): DiffLine[] {
  const a = aText.replace(/\n$/, "").split("\n");
  const b = bText.replace(/\n$/, "").split("\n");

  // Common prefix.
  const head: DiffLine[] = [];
  let s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) {
    head.push({ type: "ctx", text: a[s], aln: s + 1, bln: s + 1 });
    s++;
  }
  // Common suffix.
  let ea = a.length;
  let eb = b.length;
  while (ea > s && eb > s && a[ea - 1] === b[eb - 1]) {
    ea--;
    eb--;
  }
  const tail: DiffLine[] = [];
  for (let k = ea; k < a.length; k++) tail.push({ type: "ctx", text: a[k], aln: k + 1, bln: (k - ea) + eb + 1 });

  const mid = lcsDiff(a.slice(s, ea), b.slice(s, eb), s, s);
  return [...head, ...mid, ...tail];
}

export function diffStats(lines: DiffLine[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const l of lines) {
    if (l.type === "add") added++;
    else if (l.type === "del") removed++;
  }
  return { added, removed };
}
