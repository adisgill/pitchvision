// Pitch graphics: the one pitch renderer, zone heatmaps (12 x 8 grid, 8.75 x 8.5 m), shot
// maps and line-ups on a pitch. Coordinates in metres, 105 x 68, attacking left to right.
import { ReactNode } from "react";
import { fmt, inkOn, seq, div } from "../lib/format";
import { useTip } from "./kit";

export const L = 105, W = 68, NX = 12, NY = 8;
export const ZW = L / NX, ZH = W / NY;

/** The pitch, with children drawn in pitch metres (y measured from the bottom touchline). */
export function Pitch({ children, overlay, vertical, half, label }: {
  children?: ReactNode; overlay?: ReactNode; vertical?: boolean; half?: boolean; label?: string;
}) {
  const line = { stroke: "var(--pitch-line)", strokeWidth: 0.35, fill: "none" };
  const x0 = half ? L / 2 - 2 : -2;
  const vb = vertical ? `-2 ${x0} ${W + 4} ${L - x0 + 2}` : `${x0} -2 ${L - x0 + 2} ${W + 4}`;
  const tr = vertical ? `translate(0 ${L}) rotate(-90) translate(0 0)` : `translate(0 ${W}) scale(1 -1)`;
  return (
    <div className="pitch-wrap">
      <svg viewBox={vb} role="img" aria-label={label ?? "Football pitch"}>
        <rect x={-2} y={-2} width={(vertical ? W : L) + 4} height={(vertical ? L : W) + 4} fill="var(--pitch)" />
        <g transform={vertical ? `translate(0 ${L}) rotate(-90)` : tr}>
          {children}
          <g {...line} pointerEvents="none">
            <rect x={0} y={0} width={L} height={W} />
            <line x1={L / 2} y1={0} x2={L / 2} y2={W} />
            <circle cx={L / 2} cy={W / 2} r={9.15} />
            <circle cx={L / 2} cy={W / 2} r={0.4} fill="var(--pitch-line)" />
            {[0, L].map((x) => {
              const s = x === 0 ? 1 : -1;
              return (
                <g key={x}>
                  <rect x={x === 0 ? 0 : L - 16.5} y={W / 2 - 20.16} width={16.5} height={40.32} />
                  <rect x={x === 0 ? 0 : L - 5.5} y={W / 2 - 9.16} width={5.5} height={18.32} />
                  <circle cx={x + s * 11} cy={W / 2} r={0.4} fill="var(--pitch-line)" />
                  <rect x={x === 0 ? -1.2 : L} y={W / 2 - 3.66} width={1.2} height={7.32} />
                </g>
              );
            })}
          </g>
          {overlay}
        </g>
      </svg>
    </div>
  );
}

export type ZoneCell = { zx: number; zy: number; v: number; label?: ReactNode };

/** A 12 x 8 zone heatmap. ``mode``: "seq" (magnitude, 0..max) or "div" (signed, around 0).
 *  Every cell has a hover tooltip; the strongest cells are labelled. */
export function ZoneHeat({ cells, mode = "seq", max, fmtV = (v) => fmt.n(v, 2), labelTop = 0, title, children }: {
  cells: ZoneCell[]; mode?: "seq" | "div"; max?: number; fmtV?: (v: number) => string; labelTop?: number;
  title?: (c: ZoneCell) => ReactNode; children?: ReactNode;
}) {
  const tip = useTip();
  const m = max ?? Math.max(1e-9, ...cells.map((c) => Math.abs(c.v)));
  const top = new Set([...cells].sort((a, b) => Math.abs(b.v) - Math.abs(a.v)).slice(0, labelTop).map((c) => `${c.zx},${c.zy}`));
  return (
    <>
      <Pitch>
        {cells.map((c) => {
          const t = c.v / m;
          const fill = mode === "seq" ? seq(Math.max(0, t)) : div(t);
          const op = mode === "seq" ? Math.min(1, 0.15 + 0.85 * Math.max(0, t)) : 0.92;
          return (
            <g key={`${c.zx},${c.zy}`}>
              <rect className="zone" x={c.zx * ZW + 0.15} y={c.zy * ZH + 0.15} width={ZW - 0.3} height={ZH - 0.3} rx={0.6}
                    fill={fill} fillOpacity={op}
                    onPointerMove={(e) => tip.show(e, title ? title(c) : <><b>{fmtV(c.v)}</b><div className="muted">zone {c.zx + 1}, {c.zy + 1}</div></>)}
                    onPointerLeave={tip.hide} />
              {top.has(`${c.zx},${c.zy}`) && (
                <text x={c.zx * ZW + ZW / 2} y={-(c.zy * ZH + ZH / 2) + 1} transform="scale(1 -1)" textAnchor="middle"
                      fontSize={2.6} fontWeight={650} fill={inkOn(fill)} pointerEvents="none">{fmtV(c.v)}</text>
              )}
            </g>
          );
        })}
        {children}
      </Pitch>
      {tip.node}
    </>
  );
}

/** Colour scale legend for a heatmap. */
export function HeatLegend({ mode, lo, hi, label }: { mode: "seq" | "div"; lo: string; hi: string; label: string }) {
  const stops = Array.from({ length: 9 }, (_, i) => (mode === "seq" ? seq(i / 8) : div(-1 + (2 * i) / 8)));
  return (
    <div className="row small muted" style={{ gap: 8, marginTop: 6 }}>
      <span>{lo}</span>
      <span style={{ display: "inline-flex", height: 8, width: 140, borderRadius: 4, overflow: "hidden" }}>
        {stops.map((c, i) => <span key={i} style={{ flex: 1, background: c }} />)}
      </span>
      <span>{hi}</span>
      <span style={{ marginLeft: 6 }}>{label}</span>
    </div>
  );
}

export type Shot = { x: number; y: number; xg: number; goal: boolean | number; side?: 0 | 1; label?: ReactNode };

/** Shots as circles sized by xG (area), filled when scored. */
export function ShotLayer({ shots, colors = ["var(--s1)", "var(--s2)"], tipFn }: {
  shots: Shot[]; colors?: [string, string] | string[]; tipFn?: (s: Shot) => ReactNode;
}) {
  const tip = useTip();
  return (
    <>
      {shots.map((s, i) => {
        const c = colors[s.side ?? 0];
        return (
          <circle key={i} cx={s.x} cy={s.y} r={0.9 + 3.4 * Math.sqrt(s.xg)} fill={s.goal ? c : "var(--surface)"} fillOpacity={s.goal ? 0.9 : 0.6}
                  stroke={c} strokeWidth={0.45}
                  onPointerMove={(e) => tip.show(e, tipFn ? tipFn(s) : <><b>{s.xg.toFixed(2)} xG</b>{s.goal ? " · goal" : ""}</>)}
                  onPointerLeave={tip.hide} />
        );
      })}
      {tip.node}
    </>
  );
}

const ROWS: Record<string, number> = { GK: 0, CB: 1, FB: 1, DM: 2, CM: 3, AM: 4, W: 4, ST: 5 };

/** A starting XI on a pitch, rows by position group (approximate: Transfermarkt gives
 *  position groups, not exact positions). Home attacks right, away attacks left. */
export function LineupPitch({ home, away, onPick }: {
  home: { name: string; group: string; shirt?: number; id: string }[];
  away: { name: string; group: string; shirt?: number; id: string }[];
  onPick?: (id: string) => void;
}) {
  const place = (xi: typeof home, side: 0 | 1) => {
    const rows: Record<number, typeof home> = {};
    xi.forEach((p) => { const r = ROWS[p.group] ?? 3; (rows[r] ??= []).push(p); });
    const used = Object.keys(rows).map(Number).sort((a, b) => a - b);
    return used.flatMap((r, ri) => rows[r].map((p, i, arr) => {
      const depth = used.length > 1 ? ri / (used.length - 1) : 0.5;
      const x = 4 + depth * (L / 2 - 9);
      const y = ((i + 1) / (arr.length + 1)) * W;
      return { ...p, x: side === 0 ? x : L - x, y: side === 0 ? y : W - y, side };
    }));
  };
  const pts = [...place(home, 0), ...place(away, 1)];
  return (
    <Pitch label="Starting line-ups">
      {pts.map((p) => (
        <g key={p.side + p.id} style={{ cursor: onPick ? "pointer" : undefined }} onClick={() => onPick?.(p.id)}>
          <circle cx={p.x} cy={p.y} r={2.6} fill={p.side === 0 ? "var(--s1)" : "var(--s2)"} stroke="var(--surface)" strokeWidth={0.5} />
          <text x={p.x} y={-p.y + 0.9} transform="scale(1 -1)" textAnchor="middle" fontSize={2.3} fontWeight={700} fill="#fff" pointerEvents="none">
            {p.shirt ?? ""}
          </text>
          <text x={p.x} y={-p.y + 5.6} transform="scale(1 -1)" textAnchor="middle" fontSize={2.1} fill="var(--text)" pointerEvents="none">
            {p.name.split(" ").slice(-1)[0]}
          </text>
        </g>
      ))}
    </Pitch>
  );
}
