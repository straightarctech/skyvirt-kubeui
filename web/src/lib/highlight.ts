// Lightweight, dependency-free syntax highlighters for the code-editor views
// (YAML editor + log viewer). They return an HTML string of <span class="tk-…">
// tokens, colored by the .code-editor CSS theme. Highlighting is best-effort and
// purely visual — it never blocks editing and is defensive against odd input.

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function hlValue(v: string): string {
  const lead = v.match(/^\s*/)?.[0] ?? "";
  const t = v.slice(lead.length);
  if (t === "") return esc(v);
  let cls: string;
  if (/^(true|false|yes|no|on|off|null|~)$/i.test(t)) cls = "tk-bool";
  else if (/^-?\d[\d_]*(\.\d+)?([eE][+-]?\d+)?$/.test(t)) cls = "tk-num";
  else if (/^(["']).*\1$/.test(t)) cls = "tk-str";
  else if (/^[&*]/.test(t) || /^[|>][+-]?$/.test(t)) cls = "tk-punct";
  else cls = "tk-val";
  return esc(lead) + `<span class="${cls}">${esc(t)}</span>`;
}

/** Highlight a YAML document to token-span HTML (one line per input line). */
export function highlightYAML(src: string): string {
  return src.split("\n").map((line) => {
    if (line.trim() === "") return "";
    if (/^\s*#/.test(line)) return `<span class="tk-comment">${esc(line)}</span>`;
    if (/^(---|\.\.\.)\s*$/.test(line)) return `<span class="tk-punct">${esc(line)}</span>`;

    // Split a trailing " # comment" (skip when the # is inside a quoted string).
    let code = line;
    let comment = "";
    const ci = line.search(/\s#/);
    if (ci >= 0 && !/["'][^"']*#[^"']*["']/.test(line)) {
      code = line.slice(0, ci);
      comment = line.slice(ci);
    }

    let html: string;
    const m = code.match(/^(\s*)(-\s+)?([^:\s][^:]*?)(:)(\s|$)(.*)$/);
    if (m) {
      const [, indent, dash, key, colon, sp, val] = m;
      html =
        esc(indent) +
        (dash ? `<span class="tk-punct">${esc(dash)}</span>` : "") +
        `<span class="tk-key">${esc(key)}</span>` +
        `<span class="tk-punct">${colon}</span>` +
        esc(sp) +
        hlValue(val);
    } else {
      const lm = code.match(/^(\s*)(-\s+)(.*)$/);
      html = lm
        ? esc(lm[1]) + `<span class="tk-punct">${esc(lm[2])}</span>` + hlValue(lm[3])
        : hlValue(code);
    }
    if (comment) html += `<span class="tk-comment">${esc(comment)}</span>`;
    return html;
  }).join("\n");
}

/** Highlight log output: color whole lines by level, dim leading timestamps. */
export function highlightLog(src: string): string {
  return src.split("\n").map((line) => {
    if (line === "") return "";
    if (/\b(ERROR|ERR|FATAL|FAIL(ED)?|panic|Exception|Traceback)\b/i.test(line))
      return `<span class="lg-error">${esc(line)}</span>`;
    if (/\b(WARN(ING)?)\b/i.test(line))
      return `<span class="lg-warn">${esc(line)}</span>`;
    const ts = line.match(/^\S*(?:\d{4}-\d{2}-\d{2}[T ])?\d{2}:\d{2}:\d{2}\S*/);
    if (ts && ts[0])
      return `<span class="lg-time">${esc(ts[0])}</span>` + esc(line.slice(ts[0].length));
    return esc(line);
  }).join("\n");
}
