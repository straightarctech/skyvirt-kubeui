import { useEffect, useId, useRef, useState } from "react";

/* ------------------------------------------------------------------ */
/* Shared heat color for utilization %                                 */
/* ------------------------------------------------------------------ */
export function usageColor(pct: number): string {
  if (pct >= 90) return "var(--th-danger)";
  if (pct >= 75) return "var(--th-warn)";
  if (pct >= 50) return "#eab308"; // amber-500
  return "var(--th-ok)";
}

/* ------------------------------------------------------------------ */
/* RingGauge — radial % gauge (KubeSphere-style)                       */
/* ------------------------------------------------------------------ */
export function RingGauge({
  value,
  size = 72,
  stroke = 7,
  label,
  sublabel,
  color,
}: {
  value: number; // 0..100
  size?: number;
  stroke?: number;
  label?: string;
  sublabel?: string;
  color?: string;
}) {
  const v = Math.max(0, Math.min(100, value || 0));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const col = color || usageColor(v);
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--th-muted)" strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={col} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c - (v / 100) * c}
          style={{ transition: "stroke-dashoffset 0.6s ease, stroke 0.3s ease" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-bold text-th-heading leading-none" style={{ fontSize: size * 0.24 }}>{label ?? `${Math.round(v)}%`}</span>
        {sublabel && <span className="text-th-ghost leading-none mt-0.5" style={{ fontSize: size * 0.13 }}>{sublabel}</span>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* BarMeter — inline horizontal utilization bar                        */
/* ------------------------------------------------------------------ */
export function BarMeter({
  value,
  label,
  width = 96,
  color,
  showPct = true,
}: {
  value: number; // 0..100
  label?: string;
  width?: number | string;
  color?: string;
  showPct?: boolean;
}) {
  const v = Math.max(0, Math.min(100, value || 0));
  const col = color || usageColor(v);
  return (
    <div className="flex items-center gap-2">
      <div className="rounded-full bg-th-muted overflow-hidden shrink-0" style={{ width, height: 6 }}>
        <div className="h-full rounded-full" style={{ width: `${v}%`, backgroundColor: col, transition: "width 0.5s ease, background-color 0.3s ease" }} />
      </div>
      {showPct && <span className="text-xs tabular-nums text-th-dim shrink-0" style={{ minWidth: 30 }}>{label ?? `${Math.round(v)}%`}</span>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* RatioMeter — ready/total as a segmented bar (e.g. 3/5 pods ready)   */
/* ------------------------------------------------------------------ */
export function RatioMeter({ ready, total, width = 90 }: { ready: number; total: number; width?: number }) {
  const pct = total > 0 ? (ready / total) * 100 : 0;
  const healthy = ready >= total;
  const col = total === 0 ? "var(--th-ghost)" : healthy ? "var(--th-ok)" : ready === 0 ? "var(--th-danger)" : "var(--th-warn)";
  return (
    <div className="flex items-center gap-2">
      <div className="rounded-full bg-th-muted overflow-hidden shrink-0" style={{ width, height: 6 }}>
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: col, transition: "width 0.5s ease" }} />
      </div>
      <span className="text-xs tabular-nums font-medium shrink-0" style={{ color: col }}>{ready}/{total}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sparkline — tiny trend line from a numeric series                   */
/* ------------------------------------------------------------------ */
export function Sparkline({
  data,
  width = 96,
  height = 28,
  color = "var(--th-accent)",
  fill = true,
}: {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  fill?: boolean;
}) {
  const uid = useId();
  if (!data || data.length < 2) {
    return <div style={{ width, height }} className="flex items-center justify-center text-[10px] text-th-ghost">—</div>;
  }
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const span = max - min || 1;
  const pad = 2;
  const stepX = (width - pad * 2) / (data.length - 1);
  const pts = data.map((d, i) => {
    const x = pad + i * stepX;
    const y = pad + (height - pad * 2) * (1 - (d - min) / span);
    return [x, y];
  });
  const line = pts.map((p) => p.join(",")).join(" ");
  const area = `${pad},${height - pad} ${line} ${width - pad},${height - pad}`;
  const gid = `sp${uid.replace(/:/g, "")}`;
  return (
    <svg width={width} height={height} className="block">
      {fill && (
        <>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.22" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <polygon points={area} fill={`url(#${gid})`} />
        </>
      )}
      <polyline points={line} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r={2} fill={color} />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* LiveTrend — sparkline that samples a live value on a fixed cadence   */
/* (component wrapper so the hook is safe to drop into any render)      */
/* ------------------------------------------------------------------ */
export function LiveTrend({
  value,
  color = "var(--th-accent)",
  width = 260,
  height = 40,
  intervalMs = 3000,
  maxLen = 40,
}: {
  value: number;
  color?: string;
  width?: number;
  height?: number;
  intervalMs?: number;
  maxLen?: number;
}) {
  const hist = useMetricHistory(value, maxLen, intervalMs);
  return <Sparkline data={hist} width={width} height={height} color={color} />;
}

/* ------------------------------------------------------------------ */
/* useMetricHistory — rolling client-side buffer of a live value       */
/* (approximates a trend while the page stays open; no Prometheus)     */
/* ------------------------------------------------------------------ */
export function useMetricHistory(value: number | undefined, maxLen = 30, intervalMs?: number): number[] {
  const [hist, setHist] = useState<number[]>([]);
  const vref = useRef(value);
  vref.current = value;

  // Timer mode: sample the current value on a fixed cadence, so a steady metric
  // renders as a flat line that fills over time (approximates a real trend).
  useEffect(() => {
    if (!intervalMs) return;
    const push = () => {
      const v = vref.current;
      if (v !== undefined && !Number.isNaN(v)) setHist((h) => [...h.slice(-(maxLen - 1)), v]);
    };
    push();
    const id = setInterval(push, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, maxLen]);

  // Change mode (default): append whenever the value changes.
  useEffect(() => {
    if (intervalMs) return;
    if (value === undefined || Number.isNaN(value)) return;
    setHist((h) => (h[h.length - 1] === value ? h : [...h.slice(-(maxLen - 1)), value]));
  }, [value, maxLen, intervalMs]);

  return hist;
}
