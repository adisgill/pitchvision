// Match-centre building blocks: score grid with the actual result marked, event timeline,
// stat comparison bars.
import { ReactNode } from "react";
import { Row } from "../../db";
import { fmt, inkOn, seq } from "../../lib/format";
import { useTip } from "../../ui/kit";

/** P(score) grid with the actual score outlined. */
export function ScoreGrid({ m, home, away, actual, max = 5 }: { m: number[][]; home: string; away: string; actual?: [number, number]; max?: number }) {
  const tip = useTip();
  const size = 36, pad = 38;
  const top = Math.max(...m.slice(0, max + 1).flatMap((r) => r.slice(0, max + 1)));
  const n = max + 1;
  return (
    <div>
      <svg viewBox={`0 0 ${pad + n * size + 6} ${pad + n * size + 6}`} style={{ width: "100%", maxWidth: 330, height: "auto", display: "block" }}
           role="img" aria-label={`Score probabilities: ${home} goals down the side, ${away} goals across the top`}>
        <text x={pad + (n * size) / 2} y={12} textAnchor="middle" fontSize={11} fill="var(--text-2)">{away} →</text>
        <text x={12} y={pad + (n * size) / 2} textAnchor="middle" fontSize={11} fill="var(--text-2)" transform={`rotate(-90 12 ${pad + (n * size) / 2})`}>{home} →</text>
        {Array.from({ length: n }, (_, i) => (
          <g key={i}>
            <text x={pad + i * size + size / 2} y={pad - 7} textAnchor="middle" fontSize={11} fill="var(--muted)">{i === max ? `${i}+` : i}</text>
            <text x={pad - 8} y={pad + i * size + size / 2 + 4} textAnchor="end" fontSize={11} fill="var(--muted)">{i === max ? `${i}+` : i}</text>
          </g>
        ))}
        {Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => {
          // fold the tail into the last row / column
          let p = 0;
          for (let a = i; a < (i === max ? m.length : i + 1); a++) for (let b = j; b < (j === max ? m.length : j + 1); b++) p += m[a][b];
          const t = Math.min(1, p / top);
          const fill = seq(t);
          const isActual = actual && Math.min(actual[0], max) === i && Math.min(actual[1], max) === j;
          return (
            <g key={`${i}-${j}`}>
              <rect x={pad + j * size + 1} y={pad + i * size + 1} width={size - 2} height={size - 2} rx={5} fill={fill} fillOpacity={0.12 + 0.88 * t}
                    stroke={isActual ? "var(--text)" : "none"} strokeWidth={isActual ? 2.5 : 0}
                    onPointerMove={(e) => tip.show(e, <><b>{fmt.pct(p, 1)}</b><div className="muted">{home} {i}{i === max ? "+" : ""}–{j}{j === max ? "+" : ""} {away}{isActual ? " · the actual score" : ""}</div></>)}
                    onPointerLeave={tip.hide} />
              {p >= 0.015 && <text x={pad + j * size + size / 2} y={pad + i * size + size / 2 + 4} textAnchor="middle" fontSize={11} fontWeight={600}
                                   fill={t > 0.55 ? inkOn(fill) : "var(--text)"} pointerEvents="none">{Math.round(p * 100)}</text>}
            </g>
          );
        }))}
      </svg>
      {tip.node}
    </div>
  );
}

export type Ev = Row & { name?: string; in_name?: string; assist_name?: string };

const evLabel = (e: Ev) => {
  if (e.type === "goals") return `${e.is_own_goal ? "Own goal" : e.is_penalty ? "Penalty" : "Goal"}: ${e.name ?? "?"}${e.assist_name ? ` (assist ${e.assist_name})` : ""}`;
  if (e.type === "cards") return `${e.card === "yellow" ? "Yellow card" : e.card === "second_yellow" ? "Second yellow" : "Red card"}: ${e.name ?? "?"}`;
  if (e.type === "substitutions") return `On ${e.in_name ?? "?"}, off ${e.name ?? "?"}`;
  return e.type;
};

function Glyph({ e, x, y }: { e: Ev; x: number; y: number }) {
  if (e.type === "goals") return <circle cx={x} cy={y} r={9} fill={e.is_own_goal ? "var(--muted)" : "var(--text)"} stroke="var(--surface)" strokeWidth={2} />;
  if (e.type === "cards") return <rect x={x - 5} y={y - 7} width={10} height={14} rx={2} fill={e.card === "yellow" ? "var(--warning)" : "var(--critical)"} stroke="var(--surface)" strokeWidth={1.5} />;
  return <path d={`M${x - 6},${y + 4} L${x},${y - 6} L${x + 6},${y + 4}`} fill="none" stroke="var(--muted)" strokeWidth={2.5} strokeLinecap="round" />;
}

/** Events on a 0-90 minute axis: home above the line, away below. */
export function Timeline({ events, homeId, homeName, awayName }: { events: Ev[]; homeId: string; homeName: string; awayName: string }) {
  const tip = useTip();
  const W = 1000, H = 190, padL = 24, padR = 24, mid = H / 2;
  const x = (m: number) => padL + (Math.min(Math.max(m, 0), 90) / 90) * (W - padL - padR);
  // stack events that share a minute
  const slots = new Map<string, number>();
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label="Match events by minute">
        <text x={padL} y={18} fontSize={16} fontWeight={600} fill="var(--text-2)">{homeName}</text>
        <text x={padL} y={H - 6} fontSize={16} fontWeight={600} fill="var(--text-2)">{awayName}</text>
        <line x1={x(0)} x2={x(90)} y1={mid} y2={mid} stroke="var(--axis)" />
        {[0, 15, 30, 45, 60, 75, 90].map((m) => (
          <g key={m}>
            <line x1={x(m)} x2={x(m)} y1={mid - 4} y2={mid + 4} stroke="var(--axis)" />
            <text x={x(m)} y={mid + 3.5} dy={m === 45 ? 0 : 0} textAnchor="middle" fontSize={14} fill="var(--muted)" style={{ paintOrder: "stroke" }} stroke="var(--surface)" strokeWidth={5}>{m === 45 ? "HT" : `${m}'`}</text>
          </g>
        ))}
        {events.map((e, i) => {
          const home = e.club_id === homeId;
          const key = `${home}-${e.minute}`;
          const k = slots.get(key) ?? 0;
          slots.set(key, k + 1);
          const y = home ? mid - 30 - k * 22 : mid + 30 + k * 22;
          return (
            <g key={i} onPointerMove={(ev) => tip.show(ev, <><b>{e.minute}'</b> <span>{evLabel(e)}</span></>)} onPointerLeave={tip.hide}>
              <line x1={x(e.minute)} x2={x(e.minute)} y1={mid} y2={y} stroke="var(--grid)" />
              <rect x={x(e.minute) - 12} y={y - 12} width={24} height={24} fill="transparent" />
              <Glyph e={e} x={x(e.minute)} y={y} />
            </g>
          );
        })}
      </svg>
      <div className="legend xs">
        <span><svg width="12" height="12"><circle cx="6" cy="6" r="5" fill="var(--text)" /></svg>Goal</span>
        <span><svg width="12" height="12"><circle cx="6" cy="6" r="5" fill="var(--muted)" /></svg>Own goal</span>
        <span><svg width="10" height="12"><rect x="1" y="1" width="7" height="10" rx="1.5" fill="var(--warning)" /></svg>Yellow</span>
        <span><svg width="10" height="12"><rect x="1" y="1" width="7" height="10" rx="1.5" fill="var(--critical)" /></svg>Red</span>
        <span><svg width="12" height="12"><path d="M2,9 L6,2 L10,9" fill="none" stroke="var(--muted)" strokeWidth="1.8" /></svg>Substitution</span>
      </div>
      {tip.node}
    </div>
  );
}

/** Side-by-side stat bars: home share of the total in blue, away in orange. */
export function StatBars({ rows }: { rows: { label: string; h: number | null; a: number | null; d?: number; note?: ReactNode }[] }) {
  return (
    <div className="stack" style={{ gap: 10 }}>
      {rows.filter((r) => r.h != null && r.a != null).map((r) => {
        const tot = (r.h ?? 0) + (r.a ?? 0);
        const hs = tot > 0 ? (r.h ?? 0) / tot : 0.5;
        const d = r.d ?? 0;
        return (
          <div key={r.label}>
            <div className="row between small" style={{ marginBottom: 3 }}>
              <b className="num">{fmt.n(r.h, d)}</b><span className="muted">{r.label}</span><b className="num">{fmt.n(r.a, d)}</b>
            </div>
            <div style={{ display: "flex", gap: 2, height: 8 }} role="img" aria-label={`${r.label}: ${fmt.n(r.h, d)} to ${fmt.n(r.a, d)}`}>
              <div style={{ flex: tot > 0 ? hs : 1, background: "var(--s1)", borderRadius: 4, opacity: hs >= 0.5 ? 1 : 0.55 }} />
              <div style={{ flex: tot > 0 ? 1 - hs : 1, background: "var(--s2)", borderRadius: 4, opacity: hs <= 0.5 ? 1 : 0.55 }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
