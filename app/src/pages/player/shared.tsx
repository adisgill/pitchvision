// Shared definitions for the player pages: the metric catalogue (with direction and
// formatting), zone naming for narratives, role-trait translation and small SQL helpers.
import { fmt } from "../../lib/format";

export type Metric = {
  key: string; label: string; short?: string; group: string;
  /** false = lower is better (percentiles are inverted) */
  higher?: boolean; f: (v: any) => string; tier: "c" | "a";
  /** SQL expression (default: the column of the same name) */
  sql?: string;
};

const d2 = (v: any) => fmt.n(v, 2), d1 = (v: any) => fmt.n(v, 1), d0 = (v: any) => fmt.n(v, 0), pc = (v: any) => fmt.pct(v);

export const C_METRICS: Metric[] = [
  { key: "minutes", label: "Minutes", group: "Volume", f: d0, tier: "c" },
  { key: "minutes_share", label: "Share of team minutes", short: "Min share", group: "Volume", f: pc, tier: "c" },
  { key: "np_goals_p90", label: "Non-penalty goals / 90", short: "npG/90", group: "Output", f: d2, tier: "c" },
  { key: "assists_p90", label: "Assists / 90", short: "A/90", group: "Output", f: d2, tier: "c" },
  { key: "cards_p90", label: "Card points / 90", short: "Cards/90", group: "Discipline", higher: false, f: d2, tier: "c" },
  { key: "scoring_rating", label: "Scoring rating", short: "Scoring", group: "Ratings", f: d0, tier: "c" },
  { key: "creation_rating", label: "Creation rating", short: "Creation", group: "Ratings", f: d0, tier: "c" },
  { key: "availability_rating", label: "Availability rating", short: "Availability", group: "Ratings", f: d0, tier: "c" },
  { key: "discipline_rating", label: "Discipline rating", short: "Discipline", group: "Ratings", f: d0, tier: "c" },
  { key: "rapm", label: "RAPM (GD impact / 90)", short: "RAPM", group: "Impact", f: (v) => fmt.signed(v, 2), tier: "c" },
  { key: "age", label: "Age", group: "Profile", f: d1, tier: "c", higher: false },
  { key: "value_eur", label: "Market value (€)", short: "Value", group: "Profile", f: fmt.eur, tier: "c" },
];

export const A_METRICS: Metric[] = [
  { key: "minutes", label: "Minutes", group: "Volume", f: d0, tier: "a" },
  { key: "npxg_p90", label: "Non-penalty xG / 90", short: "npxG/90", group: "Shooting", f: d2, tier: "a" },
  { key: "xa_p90", label: "Expected assists / 90", short: "xA/90", group: "Creation", f: d2, tier: "a" },
  { key: "key_passes_p90", label: "Key passes / 90", short: "KP/90", group: "Creation", f: d2, tier: "a" },
  { key: "prog_passes_p90", label: "Progressive passes / 90", short: "ProgP/90", group: "Progression", f: d1, tier: "a" },
  { key: "prog_carries_p90", label: "Progressive carries / 90", short: "ProgC/90", group: "Progression", f: d1, tier: "a" },
  { key: "box_entries_p90", label: "Box entries / 90", short: "Box/90", group: "Progression", f: d2, tier: "a" },
  { key: "xt_p90", label: "Expected threat added / 90", short: "xT/90", group: "Value", f: (v) => fmt.n(v, 3), tier: "a" },
  { key: "vaep_p90", label: "VAEP / 90", short: "VAEP/90", group: "Value", f: d2, tier: "a" },
  { key: "vaep_off_p90", label: "VAEP offensive / 90", short: "VAEP off", group: "Value", f: d2, tier: "a" },
  { key: "vaep_def_p90", label: "VAEP defensive / 90", short: "VAEP def", group: "Value", f: (v) => fmt.n(v, 3), tier: "a" },
  { key: "pass_completion", label: "Pass completion", short: "Pass %", group: "Security", f: pc, tier: "a" },
  { key: "turnovers_p90", label: "Turnovers / 90", short: "TO/90", group: "Security", higher: false, f: d1, tier: "a" },
  { key: "tkl_int_padj_p90", label: "Tackles + interceptions / 90 (possession-adj.)", short: "Tkl+Int", group: "Defending", f: d1, tier: "a" },
  { key: "aerial_win_rate", label: "Aerial win rate", short: "Aerial %", group: "Duels", f: pc, tier: "a" },
  { key: "take_on_success", label: "Take-on success", short: "Take-on %", group: "Duels", f: pc, tier: "a" },
  { key: "goals_prevented_p90", label: "Goals prevented / 90 (GK)", short: "GP/90", group: "Goalkeeping", f: d2, tier: "a" },
  { key: "finishing_rating", label: "Finishing rating", short: "Finishing", group: "Ratings", f: d0, tier: "a" },
  { key: "creation_rating", label: "Creation rating", short: "Creation", group: "Ratings", f: d0, tier: "a" },
  { key: "progression_rating", label: "Progression rating", short: "Progression", group: "Ratings", f: d0, tier: "a" },
  { key: "ball_security_rating", label: "Ball security rating", short: "Security", group: "Ratings", f: d0, tier: "a" },
  { key: "defending_rating", label: "Defending rating", short: "Defending", group: "Ratings", f: d0, tier: "a" },
  { key: "duels_rating", label: "Duels rating", short: "Duels", group: "Ratings", f: d0, tier: "a" },
  { key: "shot_stopping_rating", label: "Shot stopping rating (GK)", short: "Shot stop", group: "Ratings", f: d0, tier: "a" },
  { key: "distribution_rating", label: "Distribution rating (GK)", short: "Distrib.", group: "Ratings", f: d0, tier: "a" },
];

export const metricOf = (tier: string, key: string) =>
  (tier === "a" ? A_METRICS : C_METRICS).find((m) => m.key === key);

/** Radar axes per tier and position group (only metrics meaningful for the role). */
export function radarAxes(tier: "c" | "a", pos: string): Metric[] {
  if (tier === "c") {
    const keys = pos === "GK"
      ? ["minutes_share", "availability_rating", "discipline_rating", "rapm", "value_eur"]
      : ["np_goals_p90", "assists_p90", "minutes_share", "availability_rating", "discipline_rating", "rapm", "value_eur"];
    return keys.map((k) => metricOf("c", k)!);
  }
  const keys = pos === "GK"
    ? ["goals_prevented_p90", "shot_stopping_rating", "distribution_rating", "pass_completion", "prog_passes_p90", "turnovers_p90"]
    : ["npxg_p90", "xa_p90", "key_passes_p90", "box_entries_p90", "prog_passes_p90", "prog_carries_p90", "xt_p90",
       "vaep_def_p90", "tkl_int_padj_p90", "aerial_win_rate", "take_on_success", "pass_completion", "turnovers_p90"];
  return keys.map((k) => metricOf("a", k)!);
}

// ---------- zones ----------

export const MEASURES: [string, string, (v: number) => string][] = [
  ["touches", "Touches", (v) => fmt.n(v, 1)],
  ["xt_added", "xT added", (v) => fmt.n(v, 3)],
  ["vaep_off", "VAEP offensive", (v) => fmt.n(v, 3)],
  ["vaep_def", "VAEP defensive", (v) => fmt.n(v, 3)],
  ["shots", "Shots", (v) => fmt.n(v, 2)],
  ["xg", "xG", (v) => fmt.n(v, 3)],
  ["def_actions", "Defensive actions", (v) => fmt.n(v, 2)],
  ["pressures", "Pressures", (v) => fmt.n(v, 2)],
  ["turnovers", "Turnovers", (v) => fmt.n(v, 2)],
];

/** Channel of a zone row (zy 0 = the attacker's right touchline). */
export const channel = (zy: number) =>
  zy <= 1 ? "right wing" : zy === 2 ? "right half-space" : zy <= 4 ? "centre" : zy === 5 ? "left half-space" : "left wing";
export const third = (zx: number) => (zx <= 3 ? "defensive third" : zx <= 7 ? "middle third" : "final third");
export const zoneName = (zx: number, zy: number) => `${channel(zy)}, ${third(zx)}`;
export const CHANNELS = ["right wing", "right half-space", "centre", "left half-space", "left wing"];
export const THIRDS = ["defensive third", "middle third", "final third"];

/** Shares of a measure by channel and by third, for written takeaways. */
export function zoneShares(cells: { zx: number; zy: number; v: number }[]) {
  const tot = cells.reduce((a, c) => a + Math.max(0, c.v), 0) || 1;
  const byCh = Object.fromEntries(CHANNELS.map((c) => [c, 0]));
  const byTh = Object.fromEntries(THIRDS.map((t) => [t, 0]));
  cells.forEach((c) => { byCh[channel(c.zy)] += Math.max(0, c.v) / tot; byTh[third(c.zx)] += Math.max(0, c.v) / tot; });
  const topCh = Object.entries(byCh).sort((a, b) => b[1] - a[1])[0];
  const topTh = Object.entries(byTh).sort((a, b) => b[1] - a[1])[0];
  return { byCh, byTh, topCh, topTh };
}

// ---------- role traits ----------

const XB = ["own box", "own half, deep", "own half", "opposition half", "attacking third", "final 17.5 m"];
const YB: Record<string, string> = { c: "central", m: "half-space", w: "wide" };
const MIX: Record<string, string> = {
  mix_pass: "passing share", mix_cross: "crossing share", mix_carry: "carrying share", mix_takeon: "dribbling share",
  mix_shot: "shooting share", mix_def: "defensive-action share",
};
/** Human words for a role/similarity feature code (e.g. "z5c" -> "central, final 17.5 m"). */
export function trait(code: string) {
  const c = code.trim();
  const z = c.match(/^z(\d)([cmw])$/);
  if (z) return `${YB[z[2]]} touches, ${XB[Number(z[1])]}`;
  if (MIX[c]) return MIX[c];
  return c.replace(/_p90$/, " / 90").replace(/_padj/, " (adj.)").replace(/_/g, " ");
}
export const traits = (s: string | null | undefined) => (s ?? "").split(",").map((x) => x.trim()).filter(Boolean).map(trait);

// ---------- helpers ----------

/** Age at the middle of a season (1 January of season + 1), as a SQL expression. */
export const ageSql = (dob: string, season: string) =>
  `date_diff('day', ${dob}::date, make_date((${season})::int + 1, 1, 1)) / 365.25`;

export const dsLabel = (provider: string) => (provider === "statsbomb" ? "StatsBomb" : "Wyscout");

/** Legend made of spans, safe inside a <p> subtitle. */
export function InlineLegend({ items }: { items: { label: string; color: string; kind?: "line" | "dot" }[] }) {
  return (
    <span className="legend" style={{ display: "flex", margin: "0.15rem 0 0.35rem" }}>
      {items.map((it) => (
        <span key={it.label}>
          {it.kind === "line" ? <span className="key" style={{ background: it.color }} /> : <span className="dot" style={{ background: it.color }} />}
          {it.label}
        </span>
      ))}
    </span>
  );
}
