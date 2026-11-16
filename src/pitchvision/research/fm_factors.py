"""Recent-era matchup factors from FotMob (spec 12.6): travel, weather and absences.

The same test as the hidden-factors study (``matchup_factors.analyse``): each factor
against our model and the closing line, with a false-discovery correction on the discovery
season (2024-25) and replication on 2025-26 onward. All factors are known before kickoff:

* **Away travel:** great-circle km from the away side's home stadium (its most common home
  venue that season) to the venue.
* **Weather at kickoff:** temperature, rain, wind; their effect on home advantage, and
  separately on total goals against the market's over/under 2.5 line.
* **Absences:** the market value of each side's injured and of its suspended players
  (FotMob's pre-match unavailability list), as a share of the value of its likely XI plus
  absentees, home minus away; and counts.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from pitchvision.config import Paths
from pitchvision.db import materialize
from pitchvision.forecast.walkforward import blend_probs
from pitchvision.research.matchup_factors import _bh, _ols, analyse

FACTORS = {
    "away_travel_km": ("Away travel distance", "Schedule & fatigue", "pre-match", "match",
                       "Kilometres from the away side's home stadium to the venue (log scale "
                       "in the test); effect on the home side."),
    "injured_value_share_diff": ("Injured players' value", "Selection & squad", "pre-match",
                                 "diff", "Market value of injured players as a share of the "
                                 "squad's available value plus the injured; home minus away."),
    "injured_count_diff": ("Injured players", "Selection & squad", "pre-match", "diff",
                           "Number of injured players on the pre-match list; home minus away."),
    "suspended_count_diff": ("Suspended players", "Selection & squad", "pre-match", "diff",
                             "Number of suspended players; home minus away."),
    "temperature": ("Temperature", "Weather", "pre-match", "match",
                    "Temperature at kickoff (C); effect on the home side."),
    "rain": ("Rain", "Weather", "pre-match", "match",
             "Precipitation at kickoff (1/0); effect on the home side."),
    "wind": ("Wind", "Weather", "pre-match", "match",
             "Wind speed at kickoff; effect on the home side."),
}  # fmt: skip


def _haversine(lat1, lon1, lat2, lon2):
    p = np.pi / 180
    a = (np.sin((lat2 - lat1) * p / 2) ** 2
         + np.cos(lat1 * p) * np.cos(lat2 * p) * np.sin((lon2 - lon1) * p / 2) ** 2)  # fmt: skip
    return 12742 * np.arcsin(np.sqrt(a))


def frame(con) -> pd.DataFrame:
    m = con.execute("""
        select x.match_id, f.fm_match_id, f.competition_id, f.season, f.home_fm_id, f.away_fm_id,
               f.lat, f.lon, t.home_goals, t.away_goals,
               fd.avg_close_over25, fd.avg_close_under25, fd.ps_close_over25, fd.ps_close_under25
        from stg.fm_matches f join core.fm_matches_xw x using (fm_match_id)
        join core.team_matches t on t.match_id = x.match_id
        left join stg.fd_matches fd on fd.fd_match_id = t.fd_match_id
        where t.played""").df()  # fmt: skip
    pred = con.execute("select * from forecast.wf_predictions").df()
    ch = con.execute("select * from forecast.wf_chosen").df()
    p = blend_probs(pred, int(ch.half_life[0]), float(ch.w_goals[0]))
    pred = pred.assign(p_h=p[:, 0], p_d=p[:, 1], p_a=p[:, 2])
    m = m.merge(pred[["match_id", "p_h", "p_d", "p_a", "mkt_h", "mkt_d", "mkt_a"]], on="match_id")
    m = m.dropna(subset=["p_h", "mkt_h"])
    pts = lambda a, b: np.select([a > b, a == b], [3, 1], 0)  # noqa: E731
    margin = pts(m.home_goals, m.away_goals) - pts(m.away_goals, m.home_goals)
    f = pd.DataFrame(
        {"match_id": m.match_id, "season": m.season, "competition_id": m.competition_id}
    )
    f["res_model"] = margin - 3 * (m.p_h - m.p_a)
    f["res_market"] = margin - 3 * (m.mkt_h - m.mkt_a)
    f["line_model"] = 3 * (m.p_h - m.p_a)
    f["line_market"] = 3 * (m.mkt_h - m.mkt_a)

    # travel: each club-season's home stadium = its most common home venue
    venues = con.execute("""
        select competition_id, season, home_fm_id club, lat, lon, count(*) n
        from stg.fm_matches where lat is not null group by all""").df()
    home = venues.sort_values("n", ascending=False).drop_duplicates(
        ["competition_id", "season", "club"]
    )
    hk = home.set_index(["competition_id", "season", "club"])
    keys = list(zip(m.competition_id, m.season, m.away_fm_id, strict=True))
    alat = np.array([hk.lat.get(k, np.nan) for k in keys])
    alon = np.array([hk.lon.get(k, np.nan) for k in keys])
    km = _haversine(alat, alon, m.lat.to_numpy(), m.lon.to_numpy())
    f["away_travel_km"] = np.log1p(km)
    f["away_travel_km_raw"] = km

    # weather
    w = con.execute(
        "select fm_match_id, temperature, precipitation, wind_speed from stg.fm_weather"
    ).df()
    wm = m[["fm_match_id"]].merge(w, on="fm_match_id", how="left")
    f["temperature"] = wm.temperature.to_numpy()
    f["rain"] = (wm.precipitation > 0.2).astype(float).where(wm.precipitation.notna()).to_numpy()
    f["wind"] = wm.wind_speed.to_numpy()

    # absences: injured / suspended value and counts per side, vs the side's available value
    u = con.execute("""select fm_match_id, team_fm_id, type, coalesce(market_value, 0) v
                       from stg.fm_unavailable""").df()  # fmt: skip
    avail = con.execute("""select fm_match_id, team_fm_id, sum(coalesce(market_value, 0)) v
                           from stg.fm_player_match where starter group by all""").df()  # fmt: skip
    listed = set(
        con.execute("select distinct fm_match_id from stg.fm_unavailable").df().fm_match_id
    )
    agg = u.groupby(["fm_match_id", "team_fm_id", "type"]).agg(v=("v", "sum"), n=("v", "size"))
    for side, col in (("h", "home_fm_id"), ("a", "away_fm_id")):
        k = list(zip(m.fm_match_id, m[col], strict=True))
        inj_v = np.array([agg.v.get((a, b, "injury"), 0.0) for a, b in k])
        inj_n = np.array([agg.n.get((a, b, "injury"), 0) for a, b in k], dtype=float)
        sus_n = np.array([agg.n.get((a, b, "suspension"), 0) for a, b in k], dtype=float)
        av = avail.set_index(["fm_match_id", "team_fm_id"]).v
        xi = np.array([av.get((a, b), np.nan) for a, b in k])
        has = np.array([a in listed for a in m.fm_match_id])
        with np.errstate(invalid="ignore", divide="ignore"):
            share = inj_v / (xi + inj_v)
        f[f"inj_share_{side}"] = np.where(has, share, np.nan)
        f[f"inj_n_{side}"] = np.where(has, inj_n, np.nan)
        f[f"sus_n_{side}"] = np.where(has, sus_n, np.nan)
    f["injured_value_share_diff"] = f.inj_share_h - f.inj_share_a
    f["injured_count_diff"] = f.inj_n_h - f.inj_n_a
    f["suspended_count_diff"] = f.sus_n_h - f.sus_n_a

    # total goals vs the market's over/under 2.5
    over = m.avg_close_over25.fillna(m.ps_close_over25)
    under = m.avg_close_under25.fillna(m.ps_close_under25)
    q_over = (1 / over) / (1 / over + 1 / under)
    f["res_over25"] = ((m.home_goals + m.away_goals) > 2.5).astype(float) - q_over
    return f.reset_index(drop=True)


def goals_effects(f: pd.DataFrame) -> pd.DataFrame:
    """Weather and travel against total goals beyond the market's over/under line."""
    rows = []
    for fac in ("temperature", "rain", "wind", "away_travel_km"):
        d = f.dropna(subset=[fac, "res_over25"])
        if len(d) < 300:
            continue
        binary = set(np.unique(d[fac])) <= {0.0, 1.0}
        scale = 1.0 if binary else float(d[fac].std())
        b, se = _ols(d.res_over25.to_numpy(), np.column_stack([np.ones(len(d)), d[fac] / scale]))
        from scipy import stats

        rows.append({"factor": fac, "label": FACTORS[fac][0], "n": len(d),
                     "unit": "per unit (0/1)" if binary else "per SD", "scale": scale,
                     "b": b[1], "se": se[1],
                     "p": 2 * stats.norm.sf(abs(b[1] / se[1]))})  # fmt: skip
    out = pd.DataFrame(rows)
    if len(out):
        out["q"] = _bh(out.p.to_numpy())
    return out


def build(con, paths: Paths) -> dict[str, int]:
    f = frame(con)
    res, bins = analyse(f, FACTORS, discovery=(2024, 2024), holdout_from=2025)
    res["study"] = "FotMob era 2024-25 onward"
    goals = goals_effects(f)
    n = {}
    for name, df in (("fm_factors", res), ("fm_factor_bins", bins), ("fm_weather_goals", goals)):
        con.register("tmp_df", df)
        n[name] = materialize(con, paths, "research", name, "select * from tmp_df")
        con.unregister("tmp_df")
    n["matches"] = len(f)
    return n
