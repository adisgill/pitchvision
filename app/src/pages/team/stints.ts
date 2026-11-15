// Manager stints: contiguous runs of league matches with the same manager at a club, scored
// against the closing market's expected points (2017-18 onward, where odds are modelled).
import { Row } from "../../db";
import { teamGamesSql } from "../match/shared";

export const stintsSql = (where: string) => `
  with g as (${teamGamesSql(where)}),
  g2 as (select *, case when gf > ga then 3 when gf = ga then 1 else 0 end pts,
                3 * p_win + p_draw xpts
         from g where manager is not null and p_win is not null),
  g3 as (select *, case when manager = lag(manager) over (partition by club_id order by match_date, match_id)
                        then 0 else 1 end chg from g2),
  g4 as (select *, sum(chg) over (partition by club_id order by match_date, match_id rows unbounded preceding) stint from g3)
  select club_id, arg_max(team, match_date) team, manager, stint, arg_max(competition_id, match_date) league,
         min(match_date) start_date, max(match_date) end_date, count(*) n,
         avg(pts) ppg, avg(xpts) xppg, avg(pts - xpts) over_pm,
         coalesce(stddev_samp(pts - xpts), 1.2) / sqrt(count(*)) se,
         sum(case when pts = 3 then 1 else 0 end) w, sum(case when pts = 1 then 1 else 0 end) d,
         sum(case when pts = 0 then 1 else 0 end) l
  from g4 group by club_id, manager, stint`;

/** Empirical-Bayes shrinkage of each stint's over-performance toward zero:
 *  tau^2 = var(over) - mean(se^2) across stints with enough matches. */
export function shrink(rows: Row[], minN = 38) {
  const big = rows.filter((r) => r.n >= minN);
  if (big.length < 5) return { tau2: 0, rows: rows.map((r): Row => ({ ...r, shrunk: 0 })) };
  const mean = big.reduce((a, r) => a + r.over_pm, 0) / big.length;
  const v = big.reduce((a, r) => a + (r.over_pm - mean) ** 2, 0) / (big.length - 1);
  const noise = big.reduce((a, r) => a + r.se ** 2, 0) / big.length;
  const tau2 = Math.max(0, v - noise);
  return { tau2, rows: rows.map((r): Row => ({ ...r, shrunk: r.over_pm * (tau2 / (tau2 + r.se ** 2 || 1)) })) };
}

/** Does over-performance persist? For each stint, results vs the odds in its first and
 *  second halves (by match order). */
export const stintHalvesSql = (where: string) => `
  with g as (${teamGamesSql(where)}),
  g2 as (select *, case when gf > ga then 3 when gf = ga then 1 else 0 end - (3 * p_win + p_draw) res
         from g where manager is not null and p_win is not null),
  g3 as (select *, case when manager = lag(manager) over (partition by club_id order by match_date, match_id)
                        then 0 else 1 end chg from g2),
  g4 as (select *, sum(chg) over (partition by club_id order by match_date, match_id rows unbounded preceding) stint from g3),
  g5 as (select *, row_number() over (partition by club_id, stint order by match_date, match_id) rn,
                count(*) over (partition by club_id, stint) n from g4)
  select club_id, manager, stint, any_value(n) n, avg(res) filter (where rn <= n / 2) first_half,
         avg(res) filter (where rn > n / 2) second_half
  from g5 group by club_id, manager, stint`;
