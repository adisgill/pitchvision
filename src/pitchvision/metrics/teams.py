"""Team style and quality (spec 4.9) and match "deserved" results (4.10).

Tier A (event seasons), per team-season, from the unified actions (each in the acting
team's frame, attacking left to right):

* **npxG for / against per match**, xG per shot; **set-piece xG** for / against (corners,
  other set pieces, direct free kicks); **counter-attack** shots and xG.
* **Field tilt:** the team's share of final-third ball actions (x >= 70) in its matches.
* **PPDA:** opponent passes in their own 60% of the pitch per defensive action of ours
  (tackles, interceptions, fouls) in that zone (x >= 42 in our frame). Lower = more pressing.
* **High turnovers:** ball wins (tackles won, interceptions, recoveries) at x >= 70 per match.
* **Defensive line height:** mean x of the team's defensive actions.
* **Directness:** forward distance per metre of passing (sum dx / sum length, completed
  passes); **long-ball share:** passes of 30 m or more.
* **Possession share:** from possession time (``metrics.players_a`` definition).
* **Crossing reliance:** crosses per completed pass into the final third; **width:** mean
  distance from the centre line of final-third actions.

All levels, every season (team matches): **xPoints** per match from the two sides' expected
goals (Poisson, real xG on event seasons and 2026-27, the shots proxy otherwise), the
season's **table vs xPoints**, and on event seasons the **deserved result**: P(W/D/L) from
10,000 simulations of each match's shots as independent Bernoulli trials.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from pitchvision.config import Paths
from pitchvision.db import has_table, materialize
from pitchvision.models.team import outcome_probs

SIMS = 10_000


def style_sql() -> str:
    return """
    with m as (select 'wyscout' provider, match_id, competition_id, season, home_team_id,
                      away_team_id from stg.wy_matches
               union all select 'statsbomb', match_id, competition_id, season, home_team_id,
                      away_team_id from stg.sb_matches),
    a as (select a.*, m.competition_id, m.season,
                 case when a.team_id = m.home_team_id then m.away_team_id
                      else m.home_team_id end opp
          from stg.actions a join m using (provider, match_id)),
    ball as (select * from a where type in ('pass', 'cross', 'dribble', 'take_on', 'shot',
                                            'touch', 'bad_touch', 'clearance')),
    tm as (select provider, competition_id, season, match_id, team_id, any_value(opp) opp,
                  count(*) filter (where start_x >= 70) ft_actions,
                  count(*) filter (where type in ('pass', 'cross')) passes,
                  count(*) filter (where type in ('pass', 'cross') and start_x < 63) own60_passes,
                  count(*) filter (where type in ('pass', 'cross') and result = 'success'
                                   and start_x < 70 and end_x >= 70) ft_entries_pass,
                  count(*) filter (where type = 'cross') crosses,
                  count(*) filter (where type in ('pass', 'cross')
                                   and sqrt((end_x - start_x) ^ 2 + (end_y - start_y) ^ 2) >= 30)
                      long_passes,
                  sum(end_x - start_x) filter (where type in ('pass', 'cross')
                                               and result = 'success') pass_dx,
                  sum(sqrt((end_x - start_x) ^ 2 + (end_y - start_y) ^ 2))
                      filter (where type in ('pass', 'cross') and result = 'success') pass_len,
                  avg(abs(start_y - 34)) filter (where start_x >= 70) width
           from ball group by all),
    df as (select provider, match_id, team_id,
                  count(*) filter (where type in ('tackle', 'interception', 'foul')
                                   and start_x >= 42) press_actions,
                  count(*) filter (where type in ('tackle', 'interception', 'recovery')
                                   and result = 'success' and start_x >= 70) high_wins,
                  avg(start_x) filter (where type in ('tackle', 'interception', 'clearance',
                                                      'block', 'recovery', 'foul')) line_height
           from a group by all),
    sh as (select provider, match_id, team_id,
                  sum(xg) filter (where situation <> 'penalty') npxg,
                  count(*) filter (where situation <> 'penalty') np_shots,
                  sum(xg) filter (where situation in ('corner', 'set_piece', 'direct_free_kick'))
                      sp_xg,
                  count(*) filter (where situation = 'counter') counter_shots,
                  sum(xg) filter (where situation = 'counter') counter_xg
           from metrics.shots group by all),
    tmx as (select t.*, o.ft_actions opp_ft_actions, o.own60_passes opp_own60_passes,
                   coalesce(s.npxg, 0) npxg_for, coalesce(so.npxg, 0) npxg_against,
                   coalesce(s.np_shots, 0) shots_for, coalesce(s.sp_xg, 0) sp_xg_for,
                   coalesce(so.sp_xg, 0) sp_xg_against, coalesce(s.counter_shots, 0) counters,
                   coalesce(s.counter_xg, 0) counter_xg, d.press_actions, d.high_wins,
                   d.line_height
            from tm t
            left join tm o on o.provider = t.provider and o.match_id = t.match_id
                          and o.team_id = t.opp
            left join sh s on s.provider = t.provider and s.match_id = t.match_id
                          and s.team_id = t.team_id
            left join sh so on so.provider = t.provider and so.match_id = t.match_id
                           and so.team_id = t.opp
            left join df d on d.provider = t.provider and d.match_id = t.match_id
                          and d.team_id = t.team_id),
    poss as (select provider, match_id, team_id, sum(opp_poss_s) / 11 opp_poss_s
             from metrics.player_match_a group by all)
    select x.provider, x.competition_id, x.season, x.team_id, count(*) matches,
           avg(x.npxg_for) npxg_for_pm, avg(x.npxg_against) npxg_against_pm,
           avg(x.npxg_for - x.npxg_against) npxg_diff_pm,
           sum(x.npxg_for) / nullif(sum(x.shots_for), 0) xg_per_shot,
           sum(x.ft_actions) / nullif(sum(x.ft_actions + x.opp_ft_actions), 0) field_tilt,
           sum(x.opp_own60_passes) / nullif(sum(x.press_actions), 0) ppda,
           avg(x.high_wins) high_turnovers_pm, avg(x.line_height) line_height,
           sum(x.pass_dx) / nullif(sum(x.pass_len), 0) directness,
           sum(x.long_passes) / nullif(sum(x.passes), 0) long_ball_share,
           sum(x.crosses) / nullif(sum(x.ft_entries_pass), 0) crossing_reliance,
           avg(x.width) width, avg(x.sp_xg_for) set_piece_xg_for_pm,
           avg(x.sp_xg_against) set_piece_xg_against_pm, avg(x.counters) counter_shots_pm,
           avg(x.counter_xg) counter_xg_pm,
           1 - sum(p.opp_poss_s) / nullif(sum(p.opp_poss_s) + sum(po.opp_poss_s), 0)
               possession_share
    from tmx x
    left join poss p on p.provider = x.provider and p.match_id = x.match_id
                    and p.team_id = x.team_id
    left join poss po on po.provider = x.provider and po.match_id = x.match_id
                     and po.team_id = x.opp
    group by all"""


def deserved(con, rng: np.random.Generator) -> pd.DataFrame:
    """P(W/D/L) per event-season match from its shots (independent Bernoulli by xG)."""
    s = con.execute("""
        with m as (select 'wyscout' provider, match_id, home_team_id from stg.wy_matches
                   union all select 'statsbomb', match_id, home_team_id from stg.sb_matches)
        select s.provider, s.match_id, s.team_id = m.home_team_id home, s.xg, s.goal
        from metrics.shots s join m using (provider, match_id)""").df()  # fmt: skip
    rows = []
    for (prov, mid), g in s.groupby(["provider", "match_id"]):
        xh, xa = g[g.home].xg.to_numpy(), g[~g.home].xg.to_numpy()
        gh = (rng.random((SIMS, len(xh))) < xh).sum(axis=1)
        ga = (rng.random((SIMS, len(xa))) < xa).sum(axis=1)
        rows.append({"provider": prov, "match_id": mid, "xg_home": xh.sum(),
                     "xg_away": xa.sum(), "goals_home": int(g[g.home].goal.sum()),
                     "goals_away": int(g[~g.home].goal.sum()),
                     "p_home": float((gh > ga).mean()), "p_draw": float((gh == ga).mean()),
                     "p_away": float((gh < ga).mean())})  # fmt: skip
    d = pd.DataFrame(rows)
    d["xpts_home"] = 3 * d.p_home + d.p_draw
    d["xpts_away"] = 3 * d.p_away + d.p_draw
    return d


def xpoints_table(con) -> pd.DataFrame:
    """Every league season: actual points vs expected points from each match's xG (real
    team xG where football-data.co.uk has it, the shots proxy otherwise)."""
    tm = con.execute("""
        select competition_id, season, home_club, away_club, home_team, away_team,
               home_goals_official hg, away_goals_official ag,
               coalesce(home_xg, proxy_home_xg) xh, coalesce(away_xg, proxy_away_xg) xa,
               case when home_xg is not null then 'football-data xG'
                    when proxy_home_xg is not null then 'shots proxy' end xg_source
        from core.team_matches where played""").df()  # fmt: skip
    tm = tm.dropna(subset=["xh", "xa"])
    p = outcome_probs(tm.xh.clip(0.05).to_numpy(), tm.xa.clip(0.05).to_numpy())
    tm["xpts_h"], tm["xpts_a"] = 3 * p[:, 0] + p[:, 1], 3 * p[:, 2] + p[:, 1]
    tm["pts_h"] = np.where(tm.hg > tm.ag, 3, np.where(tm.hg == tm.ag, 1, 0))
    tm["pts_a"] = np.where(tm.ag > tm.hg, 3, np.where(tm.hg == tm.ag, 1, 0))
    long = pd.concat([
        tm[["competition_id", "season", "home_club", "home_team", "pts_h", "xpts_h", "hg",
            "ag", "xh", "xa", "xg_source"]].set_axis(
            ["competition_id", "season", "club_id", "name", "pts", "xpts", "gf", "ga",
             "xgf", "xga", "xg_source"], axis=1),
        tm[["competition_id", "season", "away_club", "away_team", "pts_a", "xpts_a", "ag",
            "hg", "xa", "xh", "xg_source"]].set_axis(
            ["competition_id", "season", "club_id", "name", "pts", "xpts", "gf", "ga",
             "xgf", "xga", "xg_source"], axis=1)])  # fmt: skip
    t = long.groupby(["competition_id", "season", "club_id"]).agg(
        name=("name", "last"), played=("pts", "size"), points=("pts", "sum"),
        xpoints=("xpts", "sum"), gf=("gf", "sum"), ga=("ga", "sum"), xgf=("xgf", "sum"),
        xga=("xga", "sum"), xg_source=("xg_source", "first")).reset_index()  # fmt: skip
    t["points_minus_xpoints"] = t.points - t.xpoints
    t["position"] = t.groupby(["competition_id", "season"]).points.rank(
        ascending=False, method="min"
    )
    t["xposition"] = t.groupby(["competition_id", "season"]).xpoints.rank(
        ascending=False, method="min"
    )
    return t


def build(con, paths: Paths) -> dict[str, int]:
    rng = np.random.default_rng(0)
    n = {"team_style_a": materialize(con, paths, "metrics", "team_style_a", style_sql())}
    tables = {"match_deserved_a": deserved(con, rng)}
    if has_table(con, "core", "team_matches"):
        tables["xpoints_table"] = xpoints_table(con)
    for name, df in tables.items():
        con.register("tmp_df", df)
        n[name] = materialize(con, paths, "metrics", name, "select * from tmp_df")
        con.unregister("tmp_df")
    return n
