import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import jsYaml from "js-yaml";
import { highlightYAML, highlightLog } from "@/lib/highlight";

interface YAMLEditorProps {
  value: string;
  onChange?: (value: string) => void;
  error?: string | null;
  readOnly?: boolean;
  height?: string;
  label?: string;
  language?: "yaml" | "log";
}

const FONT = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace';
const FS = 12.5; // px
const LH = 20; // px line-height
const PT = 10; // px vertical padding
const GUTTER_W = 48; // px

export default function YAMLEditor({
  value,
  onChange,
  error,
  readOnly,
  height = "400px",
  label,
  language = "yaml",
}: YAMLEditorProps) {
  const [parseError, setParseError] = useState<string | null>(null);
  const [wrap, setWrap] = useState(false);
  const [copied, setCopied] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);

  const lines = value.length ? value.split("\n") : [""];
  const highlighted = useMemo(
    () => (language === "log" ? highlightLog(value) : highlightYAML(value)) + "\n",
    [value, language],
  );

  // Validate YAML (editable YAML only).
  useEffect(() => {
    if (language !== "yaml" || readOnly) return;
    try {
      jsYaml.loadAll(value);
      setParseError(null);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : "Invalid YAML");
    }
  }, [value, language, readOnly]);

  const syncScroll = useCallback(() => {
    const ta = taRef.current;
    if (!ta) return;
    if (preRef.current) preRef.current.style.transform = `translate(${-ta.scrollLeft}px, ${-ta.scrollTop}px)`;
    if (gutterRef.current) gutterRef.current.style.transform = `translateY(${-ta.scrollTop}px)`;
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Tab" && !readOnly) {
      e.preventDefault();
      const ta = taRef.current;
      if (!ta) return;
      const s = ta.selectionStart;
      const en = ta.selectionEnd;
      onChange?.(value.slice(0, s) + "  " + value.slice(en));
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = s + 2;
      });
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard may be unavailable (insecure context) — ignore */
    }
  };

  const shared: React.CSSProperties = {
    fontFamily: FONT,
    fontSize: FS,
    lineHeight: `${LH}px`,
    tabSize: 2,
    boxSizing: "border-box",
    padding: `${PT}px 14px ${PT}px ${wrap ? 14 : GUTTER_W + 12}px`,
    whiteSpace: wrap ? "pre-wrap" : "pre",
    wordBreak: wrap ? "break-word" : "normal",
    margin: 0,
    border: 0,
    letterSpacing: 0,
  };

  const displayError = error || parseError;
  const showPill = language === "yaml" && !readOnly && onChange;

  return (
    <div className="code-editor flex flex-col overflow-hidden rounded-lg border" style={{ borderColor: "var(--ce-line)" }}>
      {/* chrome header */}
      <div
        className="flex select-none items-center justify-between px-3 py-1.5 text-[11px]"
        style={{ background: "var(--ce-bg2)", borderBottom: "1px solid var(--ce-line)", color: "var(--ce-gutter)" }}
      >
        <div className="flex items-center gap-2">
          <span className="inline-flex gap-1.5">
            <i className="h-2.5 w-2.5 rounded-full" style={{ background: "#ff5f57" }} />
            <i className="h-2.5 w-2.5 rounded-full" style={{ background: "#febc2e" }} />
            <i className="h-2.5 w-2.5 rounded-full" style={{ background: "#28c840" }} />
          </span>
          <span className="font-mono" style={{ color: "var(--ce-text)" }}>{label ?? (language === "log" ? "logs" : "YAML")}</span>
          <span style={{ color: "var(--ce-gutter)" }}>· {lines.length} lines</span>
        </div>
        <div className="flex items-center gap-2.5">
          {showPill &&
            (displayError ? (
              <span title={displayError} className="rounded px-1.5 py-0.5" style={{ background: "rgba(255,120,120,.14)", color: "#ff9d9d" }}>invalid</span>
            ) : (
              <span className="rounded px-1.5 py-0.5" style={{ background: "rgba(120,220,150,.14)", color: "#a6e3a1" }}>valid</span>
            ))}
          <button type="button" onClick={() => setWrap((w) => !w)} className="transition hover:brightness-150" style={{ color: wrap ? "var(--ce-text)" : "var(--ce-gutter)" }}>
            wrap
          </button>
          <button type="button" onClick={copy} className="transition hover:brightness-150" style={{ color: copied ? "#a6e3a1" : "var(--ce-gutter)" }}>
            {copied ? "copied ✓" : "copy"}
          </button>
        </div>
      </div>

      {/* body: gutter + highlight overlay + transparent textarea */}
      <div className="relative overflow-hidden" style={{ height, background: "var(--ce-bg)" }}>
        {!wrap && (
          <div
            ref={gutterRef}
            aria-hidden
            className="absolute left-0 top-0 select-none text-right"
            style={{ width: GUTTER_W, paddingTop: PT, fontFamily: FONT, fontSize: FS, lineHeight: `${LH}px`, color: "var(--ce-gutter)", background: "var(--ce-bg2)", borderRight: "1px solid var(--ce-line)" }}
          >
            {lines.map((_, i) => (
              <div key={i} style={{ height: LH, paddingRight: 8 }}>{i + 1}</div>
            ))}
          </div>
        )}
        <pre
          ref={preRef}
          aria-hidden
          className="pointer-events-none absolute left-0 top-0 w-full"
          style={{ ...shared, color: "var(--ce-text)" }}
          dangerouslySetInnerHTML={{ __html: highlighted }}
        />
        <textarea
          ref={taRef}
          value={value}
          spellCheck={false}
          readOnly={readOnly}
          onChange={(e) => onChange?.(e.target.value)}
          onKeyDown={handleKeyDown}
          onScroll={syncScroll}
          className="absolute inset-0 h-full w-full resize-none overflow-auto bg-transparent outline-none"
          style={{ ...shared, color: "transparent", caretColor: "var(--ce-caret)" }}
        />
      </div>

      {displayError && showPill && (
        <p className="px-3 py-1.5 text-xs" style={{ color: "#ff9d9d", background: "var(--ce-bg2)", borderTop: "1px solid var(--ce-line)" }}>
          {displayError}
        </p>
      )}
    </div>
  );
}
