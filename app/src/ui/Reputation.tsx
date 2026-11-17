// Reputation checks (spec 12.9): each claim people "just know" about a team or manager, its
// test, the number with its 95% interval, and a verdict. A claim kind that never repeats for
// any team (split-half reliability under 0.3) can't be proven for one, whatever its number.
import { Row } from "../db";
import { fmt } from "../lib/format";
import { ordinal, VERDICT } from "../lib/tactics";

const ORDER = ["park_bus", "park_bus_big", "press", "long_ball", "wings", "counter", "set_pieces", "shape_big", "big_game", "flat_track", "fortress"];
const DEC: Record<string, number> = { press: 2, wings: 2, big_game: 2, flat_track: 2, fortress: 2 };

export function ReputationCards({ rows, rel, name }: { rows: Row[]; rel: Row[]; name: string }) {
  const relOf = new Map(rel.map((r) => [r.claim, r]));
  const by = new Map(rows.map((r) => [r.claim, r]));
  return (
    <div className="claims">
      {ORDER.filter((c) => by.has(c)).map((c) => {
        const r = by.get(c)!, k = relOf.get(c);
        const v = VERDICT[r.verdict] ?? { cls: "v-np", text: r.verdict };
        const d = DEC[c] ?? 1;
        const lim = Math.max(Math.abs(r.lo ?? 0), Math.abs(r.hi ?? 0), Math.abs(r.value ?? 0), 0.01) * 1.15;
        const x = (t: number) => 50 + (t / lim) * 48;
        const finite = Number.isFinite(r.value) && Number.isFinite(r.lo);
        return (
          <div key={c} className="claim">
            <h3>{r.label}<span className={`verdict-badge ${v.cls}`}>{v.text}</span></h3>
            <p className="q">{k?.question}</p>
            {finite ? (
              <>
                <div className="num-line"><b>{fmt.signed(r.value, d)}</b>{k?.unit} <span className="muted xs">(95%: {fmt.signed(r.lo, d)} to {fmt.signed(r.hi, d)}, {r.n} matches)</span></div>
                <svg viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true">
                  <rect x={0} y={4.5} width={100} height={1} fill="var(--grid)" />
                  <rect x={49.8} y={0} width={0.4} height={10} fill="var(--axis)" />
                  <rect x={x(r.lo)} y={3} width={Math.max(0.5, x(r.hi) - x(r.lo))} height={4} rx={1}
                        fill={r.verdict === "true" || r.verdict === "leans that way" ? "var(--pos)" : r.verdict === "the opposite" ? "var(--neg)" : "var(--muted)"} opacity={0.4} />
                  <rect x={x(r.value) - 0.6} y={0.5} width={1.2} height={9} fill="var(--text)" />
                </svg>
              </>
            ) : <div className="num-line muted">Not enough matches in this scope ({r.n}).</div>}
            {c === "park_bus" && r.deep_share != null && (
              <div className="muted xs">{fmt.pct(r.deep_share, 1)} of {name}'s matches were deep-block games (possession 10+ points and territory 8+ points below expected); league-wide {fmt.pct(r.deep_base, 1)}.</div>
            )}
            {r.verdict === "not a repeatable trait" && k && (
              <div className="muted xs">For no team does this repeat: split-half r = {fmt.n(k.split_half_r, 2)} across {k.team_seasons} team-seasons. The number above is what happened, not a habit.</div>
            )}
            {r.pct != null && Number.isFinite(r.pct) && r.verdict !== "not a repeatable trait" && r.verdict !== "not enough matches" && (
              <div className="muted xs">{ordinal(r.pct)} percentile among the league's teams.</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
