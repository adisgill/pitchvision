"""Market value model (spec 6.7): what a player's season says he's worth, against what
Transfermarkt says.

* **Target:** log of the player's last Transfermarkt valuation on or before 1 July after
  the season.
* **Features** (all as of that season, so nothing leaks from later years): age, minutes
  share, non-penalty goals and assists per 90, Impact (goal-RAPM), his club's strength
  (Dixon-Coles expected goal difference), league, position group.
  * Not used: contract length and caps, which the mirror has only as a 2026 snapshot
    (they would leak the future into earlier seasons), and the previous valuation (the
    point is to price the performance, not to echo the market).
* **Model:** gradient boosting for the 10th, 50th and 90th percentiles of log value; every
  value is **out of fold** (5 folds grouped by player), so a player is never priced by a
  model that saw him.
* **Output:** model value with an 80% range (quantile band widened by conformalised quantile
  regression on the out-of-fold scores: the raw band held ~75%), and
  ``gap = log(actual / model)`` (positive: the market values him above what his numbers
  say).

The model learns Transfermarkt's own pricing. It doesn't price transfer fees.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.model_selection import GroupKFold

from pitchvision.config import Paths
from pitchvision.db import has_table, materialize

DOMESTIC = ("GB1", "ES1", "L1", "IT1", "FR1", "NL1", "PO1")
QUANTILES = (0.1, 0.5, 0.9)
GROUPS = ("GK", "CB", "FB", "DM", "CM", "AM", "W", "ST")
THREADS = 4


def load(con) -> pd.DataFrame:
    lg = "(" + ",".join(f"'{c}'" for c in DOMESTIC) + ")"
    rapm = has_table(con, "ratings", "player_rapm")
    return con.execute(f"""
        with ps as (select player_id, season, arg_max(competition_id, minutes) league,
                           arg_max(club_id, minutes) club_id, sum(minutes) minutes_,
                           sum(minutes) / sum(team_minutes) share,
                           90 * sum(np_goals) / sum(minutes) np90,
                           90 * sum(assists) / sum(minutes) a90,
                           arg_max(position_group, minutes) grp
                    from metrics.player_season where competition_id in {lg}
                    group by all),
        v as (select ps.player_id, ps.season,
                     (select arg_max(value_eur, value_date) from stg.tm_valuations x
                      where x.player_id = ps.player_id
                        and x.value_date <= make_date(ps.season + 1, 7, 1)
                        and x.value_date > make_date(ps.season, 7, 1)) value_eur
              from ps)
        select ps.*, v.value_eur, p.name,
               date_diff('day', p.date_of_birth, make_date(ps.season, 7, 1)) / 365.25 age,
               {"r.rapm" if rapm else "null::double"} rapm,
               t.dc_gd club_strength
        from ps join v using (player_id, season)
        join stg.tm_players p using (player_id)
        {"left join ratings.player_rapm r using (player_id, season)" if rapm else ""}
        left join ratings.team_season t on t.club_id = 'tm-' || ps.club_id
             and t.season = ps.season
        where v.value_eur > 0 and p.date_of_birth is not null and ps.minutes_ >= 270
        """).df()  # fmt: skip


def features(d: pd.DataFrame) -> pd.DataFrame:
    x = pd.DataFrame({
        "age": d.age, "share": d.share, "np90": d.np90.clip(0, 2), "a90": d.a90.clip(0, 1.5),
        "rapm": d.rapm, "club_strength": d.club_strength,
        "minutes": d.minutes_, "season": d.season,
        "league": d.league.map({c: i for i, c in enumerate(DOMESTIC)}),
        "grp": d.grp.map({g: i for i, g in enumerate(GROUPS)}),
    })  # fmt: skip
    return x.astype(float)


def fit(d: pd.DataFrame) -> pd.DataFrame:
    from threadpoolctl import threadpool_limits

    x, y = features(d), np.log(d.value_eur.to_numpy())
    cat = [x.columns.get_loc("league"), x.columns.get_loc("grp")]
    out = {q: np.full(len(d), np.nan) for q in QUANTILES}
    with threadpool_limits(limits=THREADS):
        for tr, te in GroupKFold(n_splits=5).split(x, y, d.player_id):
            for q in QUANTILES:
                m = HistGradientBoostingRegressor(loss="quantile", quantile=q, max_iter=400,
                                                  learning_rate=0.05, max_leaf_nodes=31,
                                                  min_samples_leaf=40, random_state=0,
                                                  categorical_features=cat)  # fmt: skip
                m.fit(x.iloc[tr], y[tr])
                out[q][te] = m.predict(x.iloc[te])
    lo, med, hi = (np.minimum.reduce([out[0.1], out[0.5]]), out[0.5],
                   np.maximum.reduce([out[0.9], out[0.5]]))  # fmt: skip
    # conformalised quantile regression: the raw 10th-90th band held ~75% out of fold,
    # so both ends are widened by the 80th percentile of the out-of-fold conformity score
    score = np.maximum(lo - y, y - hi)
    widen = float(np.quantile(score, 0.8))
    lo, hi = lo - widen, hi + widen
    return d.assign(model_value=np.exp(med), model_lo=np.exp(lo), model_hi=np.exp(hi),
                    gap=y - med, inside_80=(y >= lo) & (y <= hi))  # fmt: skip


def evaluate(r: pd.DataFrame) -> pd.DataFrame:
    y = np.log(r.value_eur)
    p = np.log(r.model_value)
    rows = [{"scope": "all", "n": len(r),
             "r2_log": 1 - ((y - p) ** 2).sum() / ((y - y.mean()) ** 2).sum(),
             "mae_log": float((y - p).abs().mean()),
             "median_abs_pct_error": float(np.median(np.abs(r.model_value / r.value_eur - 1))),
             "inside_80": float(r.inside_80.mean())}]  # fmt: skip
    for s, g in r.groupby("season"):
        yy, pp = np.log(g.value_eur), np.log(g.model_value)
        rows.append({"scope": str(s), "n": len(g),
                     "r2_log": 1 - ((yy - pp) ** 2).sum() / ((yy - yy.mean()) ** 2).sum(),
                     "mae_log": float((yy - pp).abs().mean()),
                     "median_abs_pct_error": float(np.median(np.abs(g.model_value
                                                                    / g.value_eur - 1))),
                     "inside_80": float(g.inside_80.mean())})  # fmt: skip
    return pd.DataFrame(rows)


def build(con, paths: Paths) -> dict[str, int]:
    r = fit(load(con))
    n = {}
    for name, df in (("market_value", r), ("market_value_eval", evaluate(r))):
        con.register("tmp_df", df)
        n[name] = materialize(con, paths, "ratings", name, "select * from tmp_df")
        con.unregister("tmp_df")
    return n
