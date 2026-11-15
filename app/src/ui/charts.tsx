// Custom SVG charts Plot doesn't do well: percentile radar (pizza), score matrix.
import { ReactNode } from "react";
import { fmt, inkOn, seq } from "../lib/format";
import { useTip } from "./kit";

export type RadarAxis = { key: string; label: string; group?: string };
export type RadarSeries = { name: string; color: string; values: Record<string, number | null>; raw?: Record<string, ReactNode> };

/** Percentile radar (0-100 on every axis). Up to 3 series overlaid; hover any axis for values. */
export function Radar({ axes, series, size = 380 }: { axes: RadarAxis[]; series: RadarSeries[]; size?: number }) {
  const tip = useTip();
  const c = size / 2, R = size / 2 - 70, n = axes.length;
  const ang = (i: number) => -Math.PI / 2 + (2 * Math.PI * i) / n;
  const pt = (i: number, v: number) => [c + Math.cos(ang(i)) * R * (v / 100), c + Math.sin(ang(i)) * R * (v / 100)];
  return (
    <div style={{ maxWidth: size, margin: "0 auto" }}>
      <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Percentile radar" style={{ width: "100%", height: "auto", overflow: "visible" }}>
        {[25, 50, 75, 100].map((r) => (
          <polygon key={r} points={axes.map((_, i) => pt(i, r).join(",")).join(" ")} fill="none"
                   stroke={r === 50 ? "var(--axis)" : "var(--grid)"} strokeWidth={1} />
        ))}
        {axes.map((a, i) => {
          const [x, y] = pt(i, 100);
          const [lx, ly] = pt(i, 122);
          return (
            <g key={a.key}>
              <line x1={c} y1={c} x2={x} y2={y} stroke="var(--grid)" />
              <text x={lx} y={ly} textAnchor={Math.abs(lx - c) < 8 ? "middle" : lx > c ? "start" : "end"} dominantBaseline="middle"
                    fontSize={11} fill="var(--text-2)">{a.label}</text>
              <circle cx={x} cy={y} r={14} fill="transparent"
                      onPointerMove={(e) => tip.show(e, <div>
                        <div className="muted xs">{a.label}</div>
                        {series.map((s) => <div key={s.name} className="row" style={{ gap: 6 }}>
                          <span className="key" style={{ background: s.color }} /><b>{s.values[a.key] == null ? "–" : Math.round(s.values[a.key]!)}</b>
                          <span className="muted">{s.name}{s.raw?.[a.key] != null ? <> · {s.raw[a.key]}</> : null}</span></div>)}
                      </div>)} onPointerLeave={tip.hide} />
            </g>
          );
        })}
        {series.map((s) => {
          const ptsS = axes.map((a, i) => pt(i, Math.max(0, Math.min(100, s.values[a.key] ?? 0))));
          return (
            <g key={s.name}>
              <polygon points={ptsS.map((p) => p.join(",")).join(" ")} fill={s.color} fillOpacity={series.length > 1 ? 0.12 : 0.18}
                       stroke={s.color} strokeWidth={2} strokeLinejoin="round" />
              {ptsS.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={3.5} fill={s.color} stroke="var(--surface)" strokeWidth={2} pointerEvents="none" />)}
            </g>
          );
        })}
      </svg>
      {tip.node}
    </div>
  );
}

/** Score matrix: P(home i, away j) as a heat grid with the likeliest scores labelled. */
export function ScoreMatrix({ m, home, away, max = 6 }: { m: number[][]; home: string; away: string; max?: number }) {
  const tip = useTip();
  const size = 34, pad = 34;
  const top = Math.max(...m.slice(0, max + 1).flatMap((r) => r.slice(0, max + 1)));
  return (
    <div style={{ overflowX: "auto" }}>
      <svg viewBox={`0 0 ${pad + (max + 1) * size + 4} ${pad + (max + 1) * size + 4}`} style={{ width: "100%", maxWidth: 360, height: "auto" }}
           role="img" aria-label={`Score probabilities, ${home} goals down, ${away} goals across`}>
        <text x={pad + ((max + 1) * size) / 2} y={11} textAnchor="middle" fontSize={11} fill="var(--text-2)">{away} goals →</text>
        <text x={11} y={pad + ((max + 1) * size) / 2} textAnchor="middle" fontSize={11} fill="var(--text-2)" transform={`rotate(-90 11 ${pad + ((max + 1) * size) / 2})`}>{home} goals →</text>
        {Array.from({ length: max + 1 }, (_, i) => (
          <g key={i}>
            <text x={pad + i * size + size / 2} y={pad - 6} textAnchor="middle" fontSize={11} fill="var(--muted)">{i}</text>
            <text x={pad - 8} y={pad + i * size + size / 2 + 4} textAnchor="end" fontSize={11} fill="var(--muted)">{i}</text>
          </g>
        ))}
        {m.slice(0, max + 1).map((row, i) => row.slice(0, max + 1).map((p, j) => {
          const fill = seq(p / top);
          return (
            <g key={`${i}-${j}`}>
              <rect x={pad + j * size + 1} y={pad + i * size + 1} width={size - 2} height={size - 2} rx={4} fill={fill}
                    fillOpacity={0.15 + 0.85 * (p / top)}
                    onPointerMove={(e) => tip.show(e, <><b>{fmt.pct(p, 1)}</b><div className="muted">{home} {i}–{j} {away} · fair odds {fmt.odds(p)}</div></>)}
                    onPointerLeave={tip.hide} />
              {p >= 0.02 && <text x={pad + j * size + size / 2} y={pad + i * size + size / 2 + 4} textAnchor="middle" fontSize={10.5}
                                  fontWeight={600} fill={p / top > 0.55 ? inkOn(fill) : "var(--text)"} pointerEvents="none">{Math.round(p * 100)}</text>}
            </g>
          );
        }))}
      </svg>
      {tip.node}
    </div>
  );
}

/** Horizontal diverging bars with error whiskers (effect sizes with intervals). */
export function EffectBars({ rows, unit = "", height = 26 }: {
  rows: { label: ReactNode; b: number; se: number; color?: string; note?: ReactNode }[]; unit?: string; height?: number;
}) {
  const tip = useTip();
  const lim = Math.max(0.05, ...rows.map((r) => Math.abs(r.b) + 1.96 * r.se));
  const W = 1000, lab = 330, plotW = W - lab - 20;
  const x = (v: number) => lab + plotW / 2 + (v / lim) * (plotW / 2);
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${rows.length * height + 24}`} style={{ width: "100%", height: "auto" }} role="img" aria-label="Effect sizes with 95% intervals">
        <line x1={x(0)} x2={x(0)} y1={0} y2={rows.length * height} stroke="var(--axis)" />
        {[-lim, -lim / 2, lim / 2, lim].map((t) => (
          <text key={t} x={x(t)} y={rows.length * height + 16} textAnchor="middle" fontSize={11} fill="var(--muted)">{fmt.signed(t, 2)}</text>
        ))}
        {rows.map((r, i) => {
          const y = i * height + height / 2;
          const c = r.color ?? (r.b >= 0 ? "var(--pos)" : "var(--neg)");
          return (
            <g key={i} onPointerMove={(e) => tip.show(e, <><b>{fmt.signed(r.b, 3)}{unit}</b><div className="muted">95% interval {fmt.signed(r.b - 1.96 * r.se, 3)} to {fmt.signed(r.b + 1.96 * r.se, 3)}</div>{r.note}</>)}
               onPointerLeave={tip.hide}>
              <rect x={0} y={y - height / 2} width={W} height={height} fill="transparent" />
              <text x={lab - 10} y={y + 4} textAnchor="end" fontSize={13} fill="var(--text)">{r.label}</text>
              <line x1={x(r.b - 1.96 * r.se)} x2={x(r.b + 1.96 * r.se)} y1={y} y2={y} stroke={c} strokeWidth={2} strokeLinecap="round" />
              <circle cx={x(r.b)} cy={y} r={5.5} fill={c} stroke="var(--surface)" strokeWidth={2} />
            </g>
          );
        })}
      </svg>
      {tip.node}
    </div>
  );
}
