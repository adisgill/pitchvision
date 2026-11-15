"""Tier-C player metrics and ratings (spec 3, 4, 5.2): every player-season of the domestic
leagues in scope, 2012-13 -> 2025-26, from Transfermarkt via the stints.

Tables:

* ``metrics.player_match``   one row per player per match: derived minutes, start, slot
                              and position group, goals, non-penalty goals, penalties,
                              assists, cards
* ``metrics.player_season``  per (player, competition, season, club): totals, per-90s,
                              minutes and starts shares, the modal position group
* ``metrics.reliability``    split-half (odd vs even matches) reliability by minutes and
                              the shrinkage constant k (90s at which r = 0.5)
* ``ratings.player_season_c`` shrunk per-90 values, 0-100 ratings per metric and per
                              tier-C dimension, against (league-season, position group)
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from scipy.optimize import minimize_scalar

from pitchvision.config import Paths
from pitchvision.db import materialize

LEAGUES = ("GB1", "ES1", "L1", "IT1", "FR1", "NL1", "PO1")
QUALIFY_MIN = 900  # minutes, reference group for mean and SD (spec 3.1)
RATE_MIN = 270  # minutes, smallest sample that gets a (shrunk) rating
GROUPS = ("GK", "CB", "FB", "DM", "CM", "AM", "W", "ST")

# per-90 metrics: (name, numerator column, higher is better)
RATE_METRICS = [
    ("np_goals_p90", "np_goals", True),
    ("assists_p90", "assists", True),
    ("cards_p90", "card_points", False),  # yellow 1, second yellow or red 3
]
SHARE_METRICS = [("minutes_share", True), ("starts_share", True)]

# tier-C dimensions (spec 5.2) -> components. Weights are provisional equal weights until
# Phase 2 measures each component's out-of-sample validity (D10).
DIMENSIONS = {
    "scoring": ["np_goals_p90"],
    "creation": ["assists_p90"],
    "availability": ["minutes_share", "starts_share"],
    "discipline": ["cards_p90"],
}


# goalkeepers aren't rated on these (their dimensions are shot-stopping, claiming,
# distribution and impact, spec 5.2)
OUTFIELD_ONLY = ("scoring", "creation")


def player_match_sql() -> str:
    lg = "(" + ",".join(f"'{c}'" for c in LEAGUES) + ")"
    return f"""
    with g as (select game_id, competition_id, season, season_label, match_date,
                      home_club_id, away_club_id
               from stg.tm_games where competition_id in {lg}),
    valid as (select game_id, bool_and(valid) valid, max(length) length
              from metrics.stints group by 1),
    goals as (select game_id, player_id, count(*) filter (where not is_own_goal) goals,
                     count(*) filter (where not is_own_goal and not is_penalty) np_goals,
                     count(*) filter (where is_penalty) pens
              from stg.tm_events where type = 'goals' group by all),
    assists as (select game_id, player_assist_id player_id, count(*) assists
                from stg.tm_events where type = 'goals' and player_assist_id is not null
                group by all),
    cards as (select game_id, player_id, count(*) filter (where card = 'yellow') yellows,
                     count(*) filter (where card in ('second_yellow', 'red')) reds
              from stg.tm_events where card is not null group by all),
    lu as (select game_id, player_id, any_value(starter) starter, any_value(slot) slot,
                  any_value(position_group) position_group
           from stg.tm_lineups group by all)
    select g.game_id, g.competition_id, g.season, g.season_label, g.match_date,
           m.club_id, m.player_id, m.minutes, coalesce(lu.starter, false) starter,
           lu.slot, lu.position_group, v.valid, v.length,
           coalesce(go.goals, 0) goals, coalesce(go.np_goals, 0) np_goals,
           coalesce(go.pens, 0) pens, coalesce(a.assists, 0) assists,
           coalesce(c.yellows, 0) yellows, coalesce(c.reds, 0) reds
    from metrics.player_minutes m join g using (game_id)
    left join valid v using (game_id)
    left join lu using (game_id, player_id)
    left join goals go using (game_id, player_id)
    left join assists a using (game_id, player_id)
    left join cards c using (game_id, player_id)"""


def player_season_sql() -> str:
    return """
    with pm as (select * from metrics.player_match),
    club_games as (select competition_id, season, club_id, count(*) as games,
                          sum(length) as team_minutes
                   from (select distinct competition_id, season, club_id, game_id, length
                         from pm) group by all),
    agg as (select player_id, competition_id, season, club_id,
                   any_value(season_label) as season_label, count(*) as apps,
                   count(*) filter (where starter) as starts, sum(minutes) as minutes,
                   sum(goals) as goals, sum(np_goals) as np_goals, sum(pens) as pens,
                   sum(assists) as assists, sum(yellows) as yellows, sum(reds) as reds
            from pm group by all),
    grp0 as (select player_id, competition_id, season, club_id, position_group,
                    sum(minutes) as m
             from pm where position_group is not null
             group by player_id, competition_id, season, club_id, position_group),
    grp as (select *, row_number() over (partition by player_id, competition_id, season,
                                                      club_id
                                         order by m desc, position_group) as rk
            from grp0),
    grp2 as (select g.*, g.rk > 1 and g.m >= 0.25 * a.minutes as secondary
             from grp g join agg a using (player_id, competition_id, season, club_id)),
    groups as (select player_id, competition_id, season, club_id,
                      max(case when rk = 1 then position_group end) as position_group,
                      list(position_group order by m desc) filter (where secondary)
                          as secondary_groups
               from grp2 group by player_id, competition_id, season, club_id)
    select a.*, a.yellows + 3 * a.reds as card_points, cg.games as team_games,
           cg.team_minutes, a.minutes / cg.team_minutes as minutes_share,
           a.starts / cg.games as starts_share, gr.position_group, gr.secondary_groups
    from agg a
    join club_games cg using (competition_id, season, club_id)
    left join groups gr using (player_id, competition_id, season, club_id)"""


# ---- reliability and shrinkage -------------------------------------------------------------


def split_half(pm: pd.DataFrame, num: str, min_half: float = 450) -> pd.DataFrame:
    """Odd vs even matches of each player-season (by date): per-90 rate in each half, for
    halves with at least ``min_half`` minutes. Returns rows (n90 per half, rate_a, rate_b)."""
    d = pm.sort_values(["player_id", "competition_id", "season", "match_date"])
    d = d.assign(half=d.groupby(["player_id", "competition_id", "season"]).cumcount() % 2)
    h = (
        d.groupby(["player_id", "competition_id", "season", "half"])
        .agg(minutes=("minutes", "sum"), x=(num, "sum"))
        .reset_index()
    )
    w = h.pivot_table(index=["player_id", "competition_id", "season"], columns="half",
                      values=["minutes", "x"]).dropna()  # fmt: skip
    w = w[(w[("minutes", 0)] >= min_half) & (w[("minutes", 1)] >= min_half)]
    return pd.DataFrame({
        "n90": (w[("minutes", 0)] + w[("minutes", 1)]) / 2 / 90,
        "a": 90 * w[("x", 0)] / w[("minutes", 0)],
        "b": 90 * w[("x", 1)] / w[("minutes", 1)],
    }).reset_index(drop=True)  # fmt: skip


def fit_k(sh: pd.DataFrame, bins: int = 6) -> tuple[float, pd.DataFrame]:
    """Spearman-Brown fit r(n) = n / (n + k) to split-half correlations in minutes bins.
    Returns (k in 90s, the per-bin table)."""
    sh = sh.assign(bin=pd.qcut(sh.n90, bins, duplicates="drop"))
    tab = sh.groupby("bin", observed=True).apply(
        lambda g: pd.Series({"n90": g.n90.mean(), "r": g.a.corr(g.b), "players": len(g)}),
        include_groups=False).reset_index(drop=True)  # fmt: skip
    tab = tab[tab.r.notna()]

    def loss(k):
        return float((((tab.n90 / (tab.n90 + k)) - tab.r.clip(lower=0)) ** 2
                      * tab.players).sum())  # fmt: skip

    k = minimize_scalar(loss, bounds=(0.1, 1000), method="bounded").x
    return float(k), tab


# ---- ratings -------------------------------------------------------------------------------


def _wstats(x: np.ndarray, w: np.ndarray) -> tuple[float, float]:
    m = np.average(x, weights=w)
    return float(m), float(np.sqrt(np.average((x - m) ** 2, weights=w)))


def rate(ps: pd.DataFrame, k: dict[str, float]) -> pd.DataFrame:
    """Shrunk values and 0-100 ratings per metric and dimension, within (competition,
    season, position group). Players with < RATE_MIN minutes get no rating."""
    ps = ps[(ps.minutes >= RATE_MIN) & ps.position_group.isin(GROUPS)].copy()
    n90 = ps.minutes / 90
    for name, num, _ in RATE_METRICS:
        ps[name] = 90 * ps[num] / ps.minutes
    out = []
    for _, g in ps.groupby(["competition_id", "season", "position_group"]):
        g = g.copy()
        q = (g.minutes >= QUALIFY_MIN).to_numpy()
        if q.sum() < 5:  # too few qualified players to define the group's scale
            continue
        w = g.minutes.to_numpy()
        for name, higher in [(n, h) for n, _, h in RATE_METRICS] + SHARE_METRICS:
            x = g[name].to_numpy(dtype=float)
            if name in k:  # shrink per-90 rates toward the group mean
                mu, _ = _wstats(x[q], w[q])
                x = (n90[g.index] * x + k[name] * mu) / (n90[g.index] + k[name])
                g[f"{name}_shrunk"] = x
            mu, sd = _wstats(np.asarray(x)[q], w[q])
            # no spread (e.g. goalkeepers' goals): the scale is undefined, so blank, not 50
            z = (np.asarray(x) - mu) / sd if sd > 1e-12 else np.full(len(g), np.nan)
            g[f"{name}_z"] = z if higher else -z
            g[f"{name}_rating"] = np.clip(50 + 10 * g[f"{name}_z"], 0, 100)
        for dim, comps in DIMENSIONS.items():
            s = g[[f"{c}_z" for c in comps]].mean(axis=1).to_numpy()
            ok = q & ~np.isnan(s)
            mu, sd = _wstats(s[ok], w[ok]) if ok.sum() >= 5 else (0.0, 0.0)
            score = (s - mu) / sd if sd > 1e-12 else np.full(len(g), np.nan)
            if dim in OUTFIELD_ONLY and g.position_group.iloc[0] == "GK":
                score = np.full(len(g), np.nan)
            g[f"{dim}_score"] = 50 + 10 * score  # unclipped: the exact scale
            g[f"{dim}_rating"] = np.clip(g[f"{dim}_score"], 0, 100)
        g["qualified"] = q
        out.append(g)
    r = pd.concat(out, ignore_index=True)
    r["tier"] = "C"
    return r


def build(con, paths: Paths) -> dict[str, int]:
    n = {"player_match": materialize(con, paths, "metrics", "player_match", player_match_sql())}
    n["player_season"] = materialize(con, paths, "metrics", "player_season",
                                     player_season_sql())  # fmt: skip
    pm = con.execute("select * from metrics.player_match").df()
    pm["card_points"] = pm.yellows + 3 * pm.reds
    rel, k = [], {}
    for name, num, _ in RATE_METRICS:
        sh = split_half(pm, num)
        kk, tab = fit_k(sh)
        k[name] = kk
        rel.append(tab.assign(metric=name, k90=kk))
    rel_df = pd.concat(rel, ignore_index=True)
    ps = con.execute("select * from metrics.player_season").df()
    rated = rate(ps, k)
    for name, df in (("reliability", rel_df), ("player_season_c", rated)):
        schema = "metrics" if name == "reliability" else "ratings"
        con.register("tmp_df", df)
        n[name] = materialize(con, paths, schema, name, "select * from tmp_df")
        con.unregister("tmp_df")
    return n
