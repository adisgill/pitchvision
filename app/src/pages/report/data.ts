// Data helpers for the opposition report: per-team-match rows from FotMob/Opta team
// stats, league baselines, the style fingerprint, zone naming and situation groups.
import { lit, Row } from "../../db";

/** fm_team_match stat keys (without the home_/away_ prefix). */
export const TM_KEYS = [
  "expected_goals", "expected_goals_open_play", "expected_goals_set_play", "expected_goals_non_penalty",
  "expected_goals_on_target", "ballpossesion", "total_shots", "shotsontarget", "big_chance",
  "big_chance_missed_title", "touches_opp_box", "passes", "accurate_passes", "corners", "fouls", "offsides",
  "interceptions", "matchstats_headers_tackles", "clearances", "keeper_saves", "duel_won", "aerials_won",
  "dribbles_succeeded", "physical_metrics_distance_covered", "physical_metrics_number_of_sprints",
];

/** One row per team per FotMob-covered league match of a league-season, own and opponent
 *  values of every stat (`<key>` and `<key>_opp`). */
export function teamMatchSql(comp: string, season: number) {
  const side = (s: "home" | "away") => {
    const o = s === "home" ? "away" : "home";
    const cols = TM_KEYS.map((k) => `${s}_${k} as ${k}, ${o}_${k} as ${k}_opp`).join(", ");
    return `select match_id, match_date, kickoff_utc, '${s[0]}' as side, ${s}_club as club_id, ${o}_club as opp_id,
      ${s}_team as team, ${o}_team as opp, ${s}_goals as gf, ${o}_goals as ga, ${s}_goals_ht as gf_ht,
      ${o}_goals_ht as ga_ht, coalesce(${s}_shape, ${s}_formation) as formation, ${s}_manager as manager,
      ${s === "home" ? "mkt_h" : "mkt_a"} as p_win, mkt_d as p_draw, ${cols} from x`;
  };
  return `with x as (
      select t.*, m.match_date, m.kickoff_utc, m.home_club, m.away_club, m.home_team, m.away_team,
             m.home_goals, m.away_goals, m.home_goals_ht, m.away_goals_ht, m.home_formation, m.away_formation,
             m.home_manager, m.away_manager, m.mkt_h, m.mkt_d, m.mkt_a,
             hs.formation as home_shape, aw.formation as away_shape
      from fm_team_match t join matches m using (match_id)
      left join team_shape hs on hs.match_id = m.match_id and hs.club_id = m.home_club
      left join team_shape aw on aw.match_id = m.match_id and aw.club_id = m.away_club
      where m.played and m.competition_id = ${lit(comp)} and m.season = ${season})
    ${side("home")} union all ${side("away")}`;
}

export type Metric = { key: string; label: string; f: (r: Row) => number | null; agg?: (m: Record<string, number>) => number | null; fmt: (v: number) => string; note?: string };

const n = (v: any) => (v == null || Number.isNaN(Number(v)) ? null : Number(v));
const f1 = (v: number) => v.toFixed(1);
const f2 = (v: number) => v.toFixed(2);
const f0 = (v: number) => v.toFixed(0);

/** The style fingerprint: per-match averages compared with the league's team averages. */
export const FINGERPRINT: Metric[] = [
  { key: "poss", label: "Possession %", f: (r) => n(r.ballpossesion), fmt: f1 },
  { key: "passes", label: "Passes", f: (r) => n(r.passes), fmt: f0 },
  { key: "pass_acc", label: "Pass accuracy %", f: (r) => (n(r.passes) ? (100 * n(r.accurate_passes)!) / n(r.passes)! : null), fmt: f1 },
  { key: "box", label: "Touches in the opposition box", f: (r) => n(r.touches_opp_box), fmt: f1, note: "predictive" },
  { key: "shots", label: "Shots", f: (r) => n(r.total_shots), fmt: f1 },
  { key: "xg", label: "xG", f: (r) => n(r.expected_goals), fmt: f2, note: "predictive" },
  { key: "xg_shot", label: "xG per shot", f: () => null, agg: (m) => (m.shots ? m.xg / m.shots : null), fmt: (v) => v.toFixed(3) },
  { key: "big", label: "Big chances", f: (r) => n(r.big_chance), fmt: f2 },
  { key: "sp_xg", label: "Set-piece xG", f: (r) => n(r.expected_goals_set_play), fmt: f2 },
  { key: "corners", label: "Corners", f: (r) => n(r.corners), fmt: f1 },
  { key: "xga", label: "xG conceded", f: (r) => n(r.expected_goals_opp), fmt: f2, note: "predictive" },
  { key: "shots_a", label: "Shots conceded", f: (r) => n(r.total_shots_opp), fmt: f1 },
  { key: "box_a", label: "Box touches conceded", f: (r) => n(r.touches_opp_box_opp), fmt: f1, note: "predictive" },
  { key: "sp_xga", label: "Set-piece xG conceded", f: (r) => n(r.expected_goals_set_play_opp), fmt: f2 },
  { key: "duels", label: "Duels won", f: (r) => n(r.duel_won), fmt: f1 },
  { key: "aerials", label: "Aerial duels won", f: (r) => n(r.aerials_won), fmt: f1 },
  { key: "dribbles", label: "Successful dribbles", f: (r) => n(r.dribbles_succeeded), fmt: f1 },
  { key: "tackles", label: "Tackles", f: (r) => n(r.matchstats_headers_tackles), fmt: f1, note: "dominated" },
  { key: "ints", label: "Interceptions", f: (r) => n(r.interceptions), fmt: f1, note: "dominated" },
  { key: "clear", label: "Clearances", f: (r) => n(r.clearances), fmt: f1, note: "dominated" },
  { key: "fouls", label: "Fouls committed", f: (r) => n(r.fouls), fmt: f1 },
  { key: "dist", label: "Distance covered (km)", f: (r) => (n(r.physical_metrics_distance_covered) ? n(r.physical_metrics_distance_covered)! / 1000 : null), fmt: f1 },
  { key: "sprints", label: "Sprints", f: (r) => n(r.physical_metrics_number_of_sprints), fmt: f0 },
];

export type FpRow = { key: string; label: string; v: number | null; lg: number | null; z: number | null; rank: number | null; teams: number; fmt: (v: number) => string; note?: string };

/** Per-team means for every fingerprint metric, then z-scores against the league's teams. */
export function fingerprint(rows: Row[], team: string): FpRow[] {
  const byTeam = new Map<string, Row[]>();
  rows.forEach((r) => { if (!byTeam.has(r.club_id)) byTeam.set(r.club_id, []); byTeam.get(r.club_id)!.push(r); });
  const means = new Map<string, Record<string, number>>();
  byTeam.forEach((rs, club) => {
    const m: Record<string, number> = {};
    FINGERPRINT.forEach((mt) => {
      const vals = rs.map(mt.f).filter((x): x is number => x != null && Number.isFinite(x));
      if (vals.length >= Math.max(3, rs.length / 3)) m[mt.key] = vals.reduce((a, b) => a + b, 0) / vals.length;
    });
    FINGERPRINT.filter((mt) => mt.agg).forEach((mt) => { const v = mt.agg!(m); if (v != null && Number.isFinite(v)) m[mt.key] = v; });
    means.set(club, m);
  });
  const me = means.get(team) ?? {};
  return FINGERPRINT.map((mt) => {
    const vals = [...means.entries()].map(([c, m]) => [c, m[mt.key]] as const).filter(([, v]) => v != null && Number.isFinite(v));
    const v = me[mt.key] ?? null;
    if (vals.length < 6 || v == null) return { key: mt.key, label: mt.label, v, lg: null, z: null, rank: null, teams: vals.length, fmt: mt.fmt, note: mt.note };
    const xs = vals.map(([, x]) => x as number);
    const mu = xs.reduce((a, b) => a + b, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mu) ** 2, 0) / xs.length) || 1;
    const rank = 1 + xs.filter((x) => x > v).length;
    return { key: mt.key, label: mt.label, v, lg: mu, z: (v - mu) / sd, rank, teams: xs.length, fmt: mt.fmt, note: mt.note };
  });
}

/** Plain-English traits from the most extreme parts of the fingerprint. */
export function traits(fp: FpRow[]): string[] {
  const z = Object.fromEntries(fp.map((r) => [r.key, r.z]));
  const out: [number, string][] = [];
  const add = (cond: boolean, strength: number, text: string) => { if (cond) out.push([Math.abs(strength), text]); };
  add((z.poss ?? 0) > 1, z.poss!, "Ball-dominant: keeps the ball well above the league norm");
  add((z.poss ?? 0) < -1, z.poss!, "Comfortable without the ball: cedes possession");
  add((z.pass_acc ?? 0) < -1 && (z.poss ?? 0) < 0, z.pass_acc!, "Direct: lower pass completion, plays forward quickly");
  add((z.box ?? 0) > 1, z.box!, "Lives in the opposition box (the most predictive territory stat)");
  add((z.box ?? 0) < -1, z.box!, "Rarely gets into the box");
  add((z.xg ?? 0) > 1, z.xg!, "Creates a lot: high xG per match");
  add((z.xg_shot ?? 0) > 1, z.xg_shot!, "Patient shooters: high-quality chances");
  add((z.xg_shot ?? 0) < -1, z.xg_shot!, "Shoots from distance: low xG per shot");
  add((z.sp_xg ?? 0) > 1, z.sp_xg!, "Dangerous from set pieces");
  add((z.sp_xga ?? 0) > 1, z.sp_xga!, "Vulnerable at set pieces");
  add((z.xga ?? 0) < -1, z.xga!, "Mean defence: concedes few chances");
  add((z.xga ?? 0) > 1, z.xga!, "Leaky: concedes a lot of chances");
  add((z.box_a ?? 0) > 1, z.box_a!, "Lets opponents into the box often");
  add((z.dribbles ?? 0) > 1, z.dribbles!, "Takes players on: lots of successful dribbles");
  add((z.aerials ?? 0) > 1, z.aerials!, "Strong in the air");
  add((z.fouls ?? 0) > 1, z.fouls!, "Physical: commits a lot of fouls");
  add(((z.tackles ?? 0) + (z.ints ?? 0) + (z.clear ?? 0)) / 3 > 0.9, ((z.tackles ?? 0) + (z.ints ?? 0) + (z.clear ?? 0)) / 3,
      "Does a lot of defending (usually a sign of being under pressure)");
  add((z.dist ?? 0) > 1, z.dist!, "Out-runs opponents: high distance covered");
  add((z.sprints ?? 0) > 1, z.sprints!, "High sprint count");
  return out.sort((a, b) => b[0] - a[0]).slice(0, 6).map(([, t]) => t);
}

/** Zone names (12 x 8 grid, team attacking right; for "against" maps the team's own goal is
 *  on the left). The data's y orientation is not confirmed, so flanks aren't named left/right. */
export function zoneName(zx: number, zy: number, against = false) {
  const lane = zy <= 1 || zy >= 6 ? "a flank" : zy === 2 || zy === 5 ? "a half-space" : "the centre";
  if (!against) {
    if (zx >= 10 && zy >= 2 && zy <= 5) return zx === 11 && zy >= 3 && zy <= 4 ? "the six-yard area / central box" : "inside the box";
    return `${lane}, ${zx >= 8 ? "final third" : zx >= 4 ? "middle third" : "own third"}`;
  }
  if (zx <= 1 && zy >= 2 && zy <= 5) return zx === 0 && zy >= 3 && zy <= 4 ? "the six-yard area / central box" : "inside their own box";
  return `${lane}, ${zx <= 3 ? "own third" : zx <= 7 ? "middle third" : "opposition half"}`;
}

export const SITUATIONS: [string, string, string[]][] = [
  ["open", "Open play", ["RegularPlay", "IndividualPlay"]],
  ["counter", "Counter-attacks", ["FastBreak"]],
  ["setpiece", "Set pieces", ["FromCorner", "SetPiece", "FreeKick", "ThrowInSetPiece"]],
  ["corner", "· of which corners", ["FromCorner"]],
  ["pen", "Penalties", ["Penalty"]],
];

export const bin15 = (minute: number) => (minute <= 15 ? 0 : minute <= 30 ? 1 : minute <= 45 ? 2 : minute <= 60 ? 3 : minute <= 75 ? 4 : 5);
export const BIN_LABELS = ["1–15", "16–30", "31–45+", "46–60", "61–75", "76–90+"];

export const result = (gf: number, ga: number) => (gf > ga ? "W" : gf < ga ? "L" : "D");
export const pts = (gf: number, ga: number) => (gf > ga ? 3 : gf === ga ? 1 : 0);
