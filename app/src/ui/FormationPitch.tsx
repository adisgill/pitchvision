// A formation on a vertical pitch (attacking up): one marker per slot, placed where FotMob's
// line-up drawing puts it, with the role inside and an optional name and value underneath.
import { ReactNode } from "react";
import { Row } from "../db";

const PL = 105, PW = 68;

export type Slot = { role: string; x: number; y: number; name?: string; value?: string; tone?: "up" | "down" | null; tip?: ReactNode; fill?: string };

export function FormationPitch({ slots, mini, label, onHover, color = "var(--s1)" }: {
  slots: Slot[]; mini?: boolean; label: string; onHover?: (e: React.PointerEvent, s: Slot | null) => void; color?: string;
}) {
  const line = { stroke: "var(--pitch-line)", strokeWidth: mini ? 0.6 : 0.35, fill: "none" };
  const px = (s: Slot) => s.y * PW;
  const py = (s: Slot) => (1 - s.x) * PL;
  const r = mini ? 4.2 : 4;
  return (
    <svg viewBox={`-3 -3 ${PW + 6} ${PL + 6}`} role="img" aria-label={label} style={{ display: "block", width: "100%", height: "auto" }}>
      <rect x={-3} y={-3} width={PW + 6} height={PL + 6} fill="var(--pitch)" rx={1} />
      <g {...line} pointerEvents="none">
        <rect x={0} y={0} width={PW} height={PL} />
        <line x1={0} y1={PL / 2} x2={PW} y2={PL / 2} />
        <circle cx={PW / 2} cy={PL / 2} r={9.15} />
        {!mini && [0, PL].map((y) => (
          <g key={y}>
            <rect x={PW / 2 - 20.16} y={y === 0 ? 0 : PL - 16.5} width={40.32} height={16.5} />
            <rect x={PW / 2 - 9.16} y={y === 0 ? 0 : PL - 5.5} width={18.32} height={5.5} />
          </g>
        ))}
      </g>
      {slots.map((s, i) => (
        <g key={i} transform={`translate(${px(s)},${py(s)})`}
           onPointerMove={onHover ? (e) => onHover(e, s) : undefined} onPointerLeave={onHover ? (e) => onHover(e, null) : undefined}
           style={{ cursor: onHover ? "default" : undefined }}>
          <circle r={r} fill={s.fill ?? (s.role === "GK" ? "var(--surface)" : color)} stroke={s.role === "GK" ? color : "var(--surface)"} strokeWidth={mini ? 1 : 0.6} />
          {!mini && <text y={1.1} textAnchor="middle" fontSize={2.7} fontWeight={700} fill={s.fill === "var(--hi)" ? "var(--on-hi)" : s.role === "GK" && !s.fill ? "var(--text)" : "#fff"} fontFamily="var(--font)">{s.role}</text>}
          {!mini && s.name && (
            <text y={r + 3.6} textAnchor="middle" fontSize={2.9} fontWeight={600} fill="var(--text)" fontFamily="var(--font)"
                  stroke="var(--pitch)" strokeWidth={0.8} paintOrder="stroke">{s.name}</text>
          )}
          {!mini && s.value && (
            <text y={r + 6.9} textAnchor="middle" fontSize={2.5} fill={s.tone === "up" ? "var(--up-text)" : s.tone === "down" ? "var(--critical)" : "var(--text-2)"}
                  fontFamily="var(--font)" stroke="var(--pitch)" strokeWidth={0.8} paintOrder="stroke">{s.value}</text>
          )}
        </g>
      ))}
    </svg>
  );
}

/** Slots from the ``formation_slots`` table for one formation. */
export const slotsOf = (rows: Row[], f: string): Slot[] =>
  rows.filter((r) => r.formation === f).map((r) => ({ role: r.role, x: r.x, y: r.y }));

/** Short display name: "Bukayo Saka" -> "Saka". */
export const surname = (n: string) => {
  const p = String(n ?? "").trim().split(/\s+/);
  return p.length > 1 ? p.slice(1).join(" ").replace(/^(da|de|van|von|del|di) /i, (m) => m).slice(0, 16) : p[0];
};
