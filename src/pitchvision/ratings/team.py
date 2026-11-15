"""Team ratings (spec 5.8): three views of every team, side by side, at the end of every
league-season and as of the latest data, so where they disagree is visible.

* **Dixon-Coles** (goals, the walk-forward's chosen half-life, 3-year window): attack,
  defence, and ``dc_gd`` = expected goal difference per match against a league-average
  opponent at a neutral venue.
* **Elo:** the end-of-period rating (``models.team.run_elo``).
* **Market:** strengths that reproduce the closing line's implied scoring rates (ridge
  least squares on log rates, same decay), ``mkt_gd`` on the same scale as ``dc_gd``.

Each is also ranked within the league-season; ``disagreement`` is the largest rank gap
between the three for a team.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from pitchvision.config import Paths
from pitchvision.db import has_table, materialize
from pitchvision.forecast.walkforward import LEAGUES, WINDOW_DAYS, fit_league
from pitchvision.models.team import RateInverter, devig_power, run_elo


def _gd(att: np.ndarray, dfn: np.ndarray, home: float) -> np.ndarray:
    """Expected goal difference per match vs a league-average opponent, neutral venue."""
    base = home / 2  # neutral: half the home advantage on each side
    att_avg, dfn_avg = att.mean(), dfn.mean()
    scored = np.exp(base + att + dfn_avg)
    conceded = np.exp(base + att_avg + dfn)
    return scored - conceded


def market_strengths(tr: pd.DataFrame, teams: pd.Index, w: np.ndarray,
                     inv: RateInverter, ridge: float = 2.0) -> dict | None:  # fmt: skip
    odds = tr[["close_home", "close_draw", "close_away"]].to_numpy(float)
    ok = np.isfinite(odds).all(axis=1) & (odds > 1).all(axis=1)
    if ok.sum() < 100:
        return None
    lh, la = inv(devig_power(odds[ok]))
    h = teams.get_indexer(tr.home_club[ok])
    a = teams.get_indexer(tr.away_club[ok])
    n, ww = len(teams), w[ok]
    # rows: log lh = home + att_h + dfn_a ; log la = att_a + dfn_h
    m = len(h)
    x = np.zeros((2 * m, 2 * n + 1))
    x[np.arange(m), h] = 1
    x[np.arange(m), n + a] = 1
    x[np.arange(m), 2 * n] = 1
    x[m + np.arange(m), a] = 1
    x[m + np.arange(m), n + h] = 1
    y = np.concatenate([np.log(lh), np.log(la)])
    sw = np.concatenate([ww, ww])
    reg = ridge * np.eye(2 * n + 1)
    reg[-1, -1] = 0.0
    beta = np.linalg.solve(x.T @ (x * sw[:, None]) + reg, x.T @ (sw * y))
    return {"att": beta[:n], "dfn": beta[n : 2 * n], "home": float(beta[-1])}


def snapshot(m: pd.DataFrame, as_of: pd.Timestamp, season: int, half_life: float,
             elo: pd.DataFrame, inv: RateInverter) -> pd.DataFrame | None:  # fmt: skip
    tr = m[m.played & (m.match_date <= as_of)
           & (m.match_date > as_of - pd.Timedelta(days=WINDOW_DAYS))]  # fmt: skip
    cur = m[m.season == season]
    clubs = sorted(set(cur.home_club) | set(cur.away_club))
    if len(tr) < 200 or not clubs:
        return None
    r = fit_league(tr, set(clubs), season, half_life, as_of)
    dc, teams = r["fit"], r["teams"]
    w = np.exp(-np.log(2) / half_life * (as_of - tr.match_date).dt.days.to_numpy())
    mk = market_strengths(tr, teams, w, inv)
    idx = teams.get_indexer(clubs)
    out = pd.DataFrame({"club_id": clubs, "dc_att": dc["att"][idx], "dc_dfn": dc["dfn"][idx],
                        "dc_gd": _gd(dc["att"], dc["dfn"], dc["home"])[idx],
                        "dc_home": dc["home"]})  # fmt: skip
    if mk is not None:
        out["mkt_att"], out["mkt_dfn"] = mk["att"][idx], mk["dfn"][idx]
        out["mkt_gd"] = _gd(mk["att"], mk["dfn"], mk["home"])[idx]
    # Elo: each club's rating after its last match up to as_of
    e = elo[elo.match_date <= as_of]
    last = pd.concat([e[["match_date", "home_club", "elo_home_post"]].set_axis(
                          ["d", "club_id", "elo"], axis=1),
                      e[["match_date", "away_club", "elo_away_post"]].set_axis(
                          ["d", "club_id", "elo"], axis=1)])  # fmt: skip
    last = last.sort_values("d").groupby("club_id").tail(1)[["club_id", "elo"]]
    out = out.merge(last, on="club_id", how="left")
    for c in ("dc_gd", "elo", "mkt_gd"):
        if c in out:
            out[f"{c}_rank"] = out[c].rank(ascending=False, method="min")
    ranks = [c for c in ("dc_gd_rank", "elo_rank", "mkt_gd_rank") if c in out]
    out["disagreement"] = out[ranks].max(axis=1) - out[ranks].min(axis=1)
    return out.assign(as_of=as_of.date(), season=season)


def build(con, paths: Paths) -> dict[str, int]:
    hl = 365.0
    if has_table(con, "forecast", "wf_chosen"):
        hl = float(con.execute("select half_life_goals_only from forecast.wf_chosen")
                   .fetchall()[0][0])  # fmt: skip
    lg = "(" + ",".join(f"'{c}'" for c in LEAGUES) + ")"
    tm = con.execute(f"select * from core.team_matches where competition_id in {lg}").df()
    tm["match_date"] = pd.to_datetime(tm.match_date)
    names = (pd.concat([tm[["match_date", "home_club", "home_team"]].set_axis(
                            ["d", "club_id", "name"], axis=1),
                        tm[["match_date", "away_club", "away_team"]].set_axis(
                            ["d", "club_id", "name"], axis=1)])
             .sort_values("d").groupby("club_id").tail(1)[["club_id", "name"]])  # fmt: skip
    inv = RateInverter()
    snaps = []
    for code, m in tm.groupby("competition_id"):
        m = m.sort_values(["match_date", "match_id"]).reset_index(drop=True)
        elo = run_elo(m)
        for season, g in m.groupby("season"):
            as_of = g[g.played].match_date.max() if g.played.any() else None
            if as_of is None:
                continue
            snap = snapshot(m, as_of, int(season), hl, elo, inv)
            if snap is not None:
                snaps.append(snap.assign(competition_id=code,
                                         current=season == m.season.max()))  # fmt: skip
    df = pd.concat(snaps, ignore_index=True).merge(names, on="club_id", how="left")
    con.register("tmp_df", df)
    n = {"team_season": materialize(con, paths, "ratings", "team_season",
                                    "select * from tmp_df")}  # fmt: skip
    con.unregister("tmp_df")
    return n
