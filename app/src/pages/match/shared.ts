// Helpers shared by the match list, match centre and team pages.
import { Row } from "../../db";
import { scoreMatrix, summarise, wpTable, WpParams } from "../../lib/models";

/** Our Dixon-Coles 1X2 from the match's pre-match expected goals (null when not modelled). */
export function dcProbs(m: Row): { h: number; d: number; a: number } | null {
  if (m.lh == null || m.la == null) return null;
  const s = summarise(scoreMatrix(m.lh, m.la, m.rho ?? 0));
  return { h: s.home, d: s.draw, a: s.away };
}

/** −log of the market's probability for the result that happened (higher = bigger shock). */
export function surprise(m: Row): number | null {
  if (m.home_goals == null || m.mkt_h == null) return null;
  const p = m.home_goals > m.away_goals ? m.mkt_h : m.home_goals < m.away_goals ? m.mkt_a : m.mkt_d;
  return p > 0 ? -Math.log(p) : null;
}

/** Total-variation distance between two 1X2 forecasts (0 = identical, 1 = opposite). */
export function tvd(p: { h: number; d: number; a: number } | null, q: { h: number; d: number; a: number } | null) {
  if (!p || !q || q.h == null) return null;
  return (Math.abs(p.h - q.h) + Math.abs(p.d - q.d) + Math.abs(p.a - q.a)) / 2;
}

export const resultLetter = (gf: number, ga: number) => (gf > ga ? "W" : gf < ga ? "L" : "D");

export type WpPoint = { minute: number; gd: number; redD: number; p_home: number; p_draw: number; p_away: number };

/** Minute-by-minute win probability from pre-match rates and the goal / red-card events,
 *  with the same model as the pipeline (forecast/winprob.py). State at the start of minute t
 *  includes events in minutes <= t (Transfermarkt folds added time into 45 and 90). */
export function computeWp(lh: number, la: number, params: WpParams, events: Row[], homeId: string): WpPoint[] {
  const tables = new Map<number, number[][][]>();
  const tab = (r: number) => { if (!tables.has(r)) tables.set(r, wpTable(lh, la, params, r)); return tables.get(r)!; };
  const goals = events.filter((e) => e.type === "goals");
  const reds = events.filter((e) => e.type === "cards" && (e.card === "red" || e.card === "second_yellow"));
  const out: WpPoint[] = [];
  for (let t = 0; t <= 90; t++) {
    let gd = 0;
    for (const g of goals) if (g.minute <= t) gd += g.club_id === homeId ? 1 : -1;
    let hr = 0, ar = 0;
    for (const r of reds) if (r.minute <= t) { if (r.club_id === homeId) hr++; else ar++; }
    const redD = Math.max(-1, Math.min(1, ar - hr));
    const V = tab(redD);
    const k = Math.max(-10, Math.min(10, gd)) + 10;
    const p = t === 90 ? (gd > 0 ? [1, 0, 0] : gd === 0 ? [0, 1, 0] : [0, 0, 1]) : V[t][k];
    out.push({ minute: t, gd, redD, p_home: p[0], p_draw: p[1], p_away: p[2] });
  }
  return out;
}

/** SQL: one row per (match, team) from the matches table, with points and the market's
 *  expected points. ``where`` filters the matches table (alias m). */
export const teamGamesSql = (where: string) => `
  select m.match_id, m.competition_id, m.season, m.match_date, m.kickoff_utc, m.round, 'h' side,
         m.home_club club_id, m.home_team team, m.away_club opp_id, m.away_team opp,
         m.home_goals gf, m.away_goals ga, m.home_goals_ht gf_ht, m.away_goals_ht ga_ht,
         coalesce(m.home_xg, m.proxy_home_xg) xgf, coalesce(m.away_xg, m.proxy_away_xg) xga,
         m.home_manager manager, m.elo_home elo, m.mkt_h p_win, m.mkt_d p_draw, m.mkt_a p_loss
  from matches m where m.played and (${where})
  union all
  select m.match_id, m.competition_id, m.season, m.match_date, m.kickoff_utc, m.round, 'a',
         m.away_club, m.away_team, m.home_club, m.home_team,
         m.away_goals, m.home_goals, m.away_goals_ht, m.home_goals_ht,
         coalesce(m.away_xg, m.proxy_away_xg), coalesce(m.home_xg, m.proxy_home_xg),
         m.away_manager, m.elo_away, m.mkt_a, m.mkt_d, m.mkt_h
  from matches m where m.played and (${where})`;

/** Points from a score. */
export const pts = (gf: number, ga: number) => (gf > ga ? 3 : gf === ga ? 1 : 0);

/** Transfer-season label "24/25" -> league season 2024. */
export const tSeason = (s: string) => 2000 + Number(String(s).slice(0, 2));
export const tLabel = (season: number) => `${String(season % 100).padStart(2, "0")}/${String((season + 1) % 100).padStart(2, "0")}`;
