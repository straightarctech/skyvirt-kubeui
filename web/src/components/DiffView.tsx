import { useMemo } from "react";
import { lineDiff, diffStats } from "@/lib/diff";

const FONT = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace';

/** A unified line-diff viewer in the code-editor style: +/- gutter, tinted
 *  rows, green/red text. `before`/`after` are full text blobs. */
export default function DiffView({
  before,
  after,
  height = "460px",
  label = "diff",
  loading,
}: {
  before: string;
  after: string;
  height?: string;
  label?: string;
  loading?: boolean;
}) {
  const lines = useMemo(() => lineDiff(before, after), [before, after]);
  const { added, removed } = useMemo(() => diffStats(lines), [lines]);
  const noChange = added === 0 && removed === 0;

  return (
    <div className="code-editor flex flex-col overflow-hidden rounded-lg border" style={{ borderColor: "var(--ce-line)" }}>
      <div
        className="flex select-none items-center justify-between px-3 py-1.5 text-[11px]"
        style={{ background: "var(--ce-bg2)", borderBottom: "1px solid var(--ce-line)", color: "var(--ce-gutter)" }}
      >
        <span className="font-mono" style={{ color: "var(--ce-text)" }}>{label}</span>
        <span className="flex gap-3 font-mono">
          <span style={{ color: "#6ee7a8" }}>+{added}</span>
          <span style={{ color: "#ff9d9d" }}>−{removed}</span>
        </span>
      </div>
      <div className="overflow-auto" style={{ height, background: "var(--ce-bg)", fontFamily: FONT, fontSize: 12.5, lineHeight: "20px" }}>
        {loading ? (
          <div className="px-4 py-6 text-center text-[13px]" style={{ color: "var(--ce-gutter)" }}>Loading diff…</div>
        ) : noChange ? (
          <div className="px-4 py-6 text-center text-[13px]" style={{ color: "var(--ce-gutter)" }}>No changes between these revisions.</div>
        ) : (
          lines.map((l, i) => {
            const bg = l.type === "add" ? "rgba(78,201,126,.13)" : l.type === "del" ? "rgba(240,110,110,.13)" : "transparent";
            const sign = l.type === "add" ? "+" : l.type === "del" ? "−" : "";
            const signColor = l.type === "add" ? "#6ee7a8" : l.type === "del" ? "#ff9d9d" : "var(--ce-gutter)";
            const txtColor = l.type === "add" ? "#cdeeda" : l.type === "del" ? "#f4cccc" : "var(--ce-text)";
            return (
              <div key={i} style={{ display: "flex", background: bg, whiteSpace: "pre" }}>
                <span className="select-none" style={{ width: 24, flex: "0 0 auto", textAlign: "center", color: signColor }}>{sign}</span>
                <span style={{ paddingRight: 14, color: txtColor }}>{l.text || " "}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
