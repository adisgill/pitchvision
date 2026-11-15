"""Referee tendencies (spec 4.11), every domestic league-season 2012-13 -> 2025-26.

From Transfermarkt (referee per match, cards with minute and club, penalty goals) and
football-data.co.uk where it maps to the same match (fouls; English referees too):

* per match: yellow cards, red cards (straight + second yellow), penalty goals (TM records
  penalties only when scored), fouls (football-data.co.uk);
* **home bias:** home minus away yellow cards per match.

Each rate is shrunk toward its league-season mean with ``k`` matches, where ``k`` comes from a
split-half (odd vs even matches) reliability fit across referees: ``r(n) = n / (n + k)``.
Rates and biases are shown with the number of matches; a referee with few matches is mostly
the league average, by construction.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from scipy.optimize import minimize_scalar

from pitchvision.config import Paths
from pitchvision.db import materialize

DOMESTIC = ("GB1", "ES1", "L1", "IT1", "FR1", "NL1", "PO1")
METRICS = ("yellows", "reds", "pen_goals", "fouls", "home_bias")


def load(con) -> pd.DataFrame:
    lg = "(" + ",".join(f"'{c}'" for c in DOMESTIC) + ")"
    return con.execute(f"""
        with e as (select game_id,
                          count(*) filter (where card = 'yellow') yellows,
                          count(*) filter (where card in ('red', 'second_yellow')) reds,
                          count(*) filter (where type = 'goals' and is_penalty) pen_goals,
                          count(*) filter (where card = 'yellow' and club_id = home_club_id)
                              - count(*) filter (where card = 'yellow'
                                                 and club_id = away_club_id) home_bias
                   from stg.tm_events join stg.tm_games using (game_id) group by 1),
        f as (select x.canonical_id, t.home_fouls + t.away_fouls fouls
              from stg.fd_matches t join core.crosswalk x
                on x.entity = 'match' and x.source = 'footballdata'
               and x.source_id = t.fd_match_id)
        select g.game_id, g.competition_id, g.season, g.match_date, g.referee,
               coalesce(e.yellows, 0) yellows, coalesce(e.reds, 0) reds,
               coalesce(e.pen_goals, 0) pen_goals, coalesce(e.home_bias, 0) home_bias,
               f.fouls
        from stg.tm_games g left join e using (game_id)
        left join f on f.canonical_id = 'tm-' || g.game_id
        where g.competition_id in {lg} and g.referee is not null""").df()  # fmt: skip


def fit_k(d: pd.DataFrame, metric: str) -> float:
    d = d.dropna(subset=[metric]).sort_values(["referee", "match_date"])
    d = d.assign(half=d.groupby(["competition_id", "season", "referee"]).cumcount() % 2)
    h = d.groupby(["competition_id", "season", "referee", "half"])[metric].agg(["mean", "size"])
    w = h.unstack("half").dropna()
    w = w[(w[("size", 0)] >= 5) & (w[("size", 1)] >= 5)]
    if len(w) < 30:
        return np.nan
    n = (w[("size", 0)] + w[("size", 1)]).to_numpy() / 2
    a, b = w[("mean", 0)].to_numpy(), w[("mean", 1)].to_numpy()
    bins = pd.qcut(n, 4, duplicates="drop")
    tab = pd.DataFrame({"n": n, "a": a, "b": b, "bin": bins}).groupby(
        "bin", observed=True).apply(lambda g: pd.Series({"n": g.n.mean(),
                                                         "r": g.a.corr(g.b), "m": len(g)}),
                                    include_groups=False)  # fmt: skip

    def loss(k):
        return float(((tab.n / (tab.n + k) - tab.r.clip(lower=0)) ** 2 * tab.m).sum())

    return float(minimize_scalar(loss, bounds=(0.1, 5000), method="bounded").x)


def build(con, paths: Paths) -> dict[str, int]:
    d = load(con)
    ks = {m: fit_k(d, m) for m in METRICS}
    g = d.groupby(["competition_id", "season", "referee"])
    out = g.size().rename("matches").reset_index()
    lg = d.groupby(["competition_id", "season"])[list(METRICS)].mean()
    for m in METRICS:
        raw = g[m].mean().to_numpy()
        n = g[m].count().to_numpy()
        mu = lg.loc[list(zip(out.competition_id, out.season, strict=True)), m].to_numpy()
        k = ks[m] if np.isfinite(ks[m]) else 50.0
        out[f"{m}_pm"] = raw
        out[f"{m}_pm_shrunk"] = (n * raw + k * mu) / (n + k)
        out[f"{m}_league_pm"] = mu
    rel = pd.DataFrame([{"metric": m, "k_matches": ks[m]} for m in METRICS])
    n = {}
    for name, df in (("referees", out), ("referee_reliability", rel)):
        con.register("tmp_df", df)
        n[name] = materialize(con, paths, "metrics", name, "select * from tmp_df")
        con.unregister("tmp_df")
    return n
