"""``core.team_matches``: one row per league match, 2012-13 -> today, the input to team
ratings and forecasts (spec 5.8, 6.5).

* **Clubs and matches** are canonical (``core.crosswalk``). The score is the one **as
  played** (Transfermarkt, corrected by ``overrides/match_scores.csv``, where the match is
  in TM; otherwise football-data.co.uk); ``*_official`` is the result for the table.
* **Kick-off** is football-data.co.uk's UK time converted to UTC (from 2019-20; earlier
  seasons have dates only).
* **Closing line** (D15): Pinnacle closing 1X2 up to 2018-19, the market-average closing
  line from 2019-20, falling back to the other where one is missing; ``close_source`` says
  which. The margin is removed later (``models/market.py``).
* **Team xG proxy** (D14): football-data.co.uk has real team xG only from 2026-27, so
  ``proxy_xg`` = a Poisson regression of goals on shots on target and off target, per
  league, fitted on **earlier seasons only** (the first season with shots uses itself,
  flagged ``proxy_fit = 'same season'``). Eredivisie and Primeira have shots from 2017-18;
  MLS has none.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.linear_model import PoissonRegressor

from pitchvision.config import Paths
from pitchvision.db import materialize


def _clubs(con) -> tuple[dict, dict]:
    x = con.execute("""
        select source_id, canonical_id from core.crosswalk
        where entity = 'club' and source = 'footballdata'""").df()  # fmt: skip
    by_season = {s: c for s, c in zip(x.source_id, x.canonical_id, strict=True) if "|" in s}
    latest: dict[str, str] = {}
    for s in sorted(by_season, key=lambda v: int(v.rsplit("|", 1)[1])):
        latest[s.rsplit("|", 1)[0]] = by_season[s]
    for s, c in zip(x.source_id, x.canonical_id, strict=True):
        if "|" not in s:
            latest.setdefault(s, c)
    return by_season, latest


def proxy_xg(df: pd.DataFrame) -> pd.DataFrame:
    """Add proxy xG per side from shots, fitted per league on earlier seasons."""
    out = df.copy()
    out["proxy_home_xg"] = np.nan
    out["proxy_away_xg"] = np.nan
    out["proxy_fit"] = None
    for _, g in df.groupby("competition_id"):
        long = pd.concat([
            pd.DataFrame({"idx": g.index, "season": g.season, "goals": g.home_goals,
                          "sot": g.home_sot, "off": g.home_shots - g.home_sot}),
            pd.DataFrame({"idx": g.index, "season": g.season, "goals": g.away_goals,
                          "sot": g.away_sot, "off": g.away_shots - g.away_sot}),
        ], keys=["home", "away"]).reset_index(level=0, names="side")  # fmt: skip
        ok = long.sot.notna() & long.off.notna() & long.goals.notna()
        seasons = sorted(long[ok].season.unique())
        for s in seasons:
            prior = long[ok & (long.season < s)]
            how = "prior seasons"
            if len(prior) < 500:
                prior, how = long[ok & (long.season == s)], "same season"
            m = PoissonRegressor(alpha=0.0, max_iter=300).fit(prior[["sot", "off"]].clip(lower=0),
                                                             prior.goals)  # fmt: skip
            cur = long[ok & (long.season == s)]
            pred = m.predict(cur[["sot", "off"]].clip(lower=0))
            for side in ("home", "away"):
                sel = (cur.side == side).to_numpy()
                out.loc[cur.idx[sel], f"proxy_{side}_xg"] = pred[sel]
            out.loc[g.index[g.season == s], "proxy_fit"] = how
    return out


def build(con, paths: Paths) -> dict[str, int]:
    fd = con.execute("""
        select f.*, x.canonical_id match_id
        from stg.fd_matches f join core.crosswalk x
          on x.entity = 'match' and x.source = 'footballdata' and x.source_id = f.fd_match_id
        """).df()  # fmt: skip
    by_season, latest = _clubs(con)

    def club(name: str, season: int) -> str:
        return by_season.get(f"{name}|{season}", latest.get(name))

    fd["home_club"] = [club(n, s) for n, s in zip(fd.home_team, fd.season, strict=True)]
    fd["away_club"] = [club(n, s) for n, s in zip(fd.away_team, fd.season, strict=True)]
    tm = con.execute("""
        select 'tm-' || game_id match_id, home_goals tm_home, away_goals tm_away,
               home_goals_official tm_home_off, away_goals_official tm_away_off
        from stg.tm_games""").df()  # fmt: skip
    fd = fd.merge(tm, on="match_id", how="left")
    fd["home_goals_official"] = fd.home_goals
    fd["away_goals_official"] = fd.away_goals
    has_tm = fd.tm_home.notna()
    fd.loc[has_tm, "home_goals"] = fd.loc[has_tm, "tm_home"]
    fd.loc[has_tm, "away_goals"] = fd.loc[has_tm, "tm_away"]
    fd.loc[has_tm, "home_goals_official"] = fd.loc[has_tm, "tm_home_off"]
    fd.loc[has_tm, "away_goals_official"] = fd.loc[has_tm, "tm_away_off"]
    # kick-off: UK local -> UTC
    hhmm = fd.kickoff_uk.where(fd.kickoff_uk.astype(str).str.match(r"^\d{1,2}:\d{2}$"))
    t = pd.to_datetime(fd.match_date.astype(str) + " " + hhmm, format="%Y-%m-%d %H:%M",
                       errors="coerce")  # fmt: skip
    fd["kickoff_utc"] = (
        t.dt.tz_localize("Europe/London", ambiguous="NaT", nonexistent="shift_forward")
        .dt.tz_convert("UTC")
        .dt.tz_localize(None)
    )  # naive UTC; fmt: skip
    # closing line (D15)
    pin_first = fd.season <= 2018
    for side in ("home", "draw", "away"):
        a, b = fd[f"ps_close_{side}"], fd[f"avg_close_{side}"]
        fd[f"close_{side}"] = np.where(pin_first, a.fillna(b), b.fillna(a))
    fd["close_source"] = np.where(
        fd.close_home.isna(),
        None,
        np.where(
            pin_first & fd.ps_close_home.notna(),
            "pinnacle",
            np.where(
                ~pin_first & fd.avg_close_home.notna(),
                "market average",
                np.where(fd.ps_close_home.notna(), "pinnacle", "market average"),
            ),
        ),
    )
    fd["close_over25"] = fd.avg_close_over25.fillna(fd.ps_close_over25)
    fd["close_under25"] = fd.avg_close_under25.fillna(fd.ps_close_under25)
    fd = proxy_xg(fd)
    keep = ["match_id", "fd_match_id", "competition_id", "season", "season_label",
            "match_date", "kickoff_utc", "home_club", "away_club", "home_team", "away_team",
            "played", "home_goals", "away_goals", "home_goals_official", "away_goals_official",
            "home_shots", "away_shots", "home_sot", "away_sot", "home_corners",
            "away_corners", "home_reds", "away_reds", "home_xg", "away_xg", "proxy_home_xg",
            "proxy_away_xg", "proxy_fit", "close_home", "close_draw", "close_away",
            "close_source", "close_over25", "close_under25", "ps_open_home", "ps_open_draw",
            "ps_open_away", "avg_open_home", "avg_open_draw", "avg_open_away",
            "referee"]  # fmt: skip
    con.register("tmp_df", fd[keep])
    n = {
        "team_matches": materialize(
            con, paths, "core", "team_matches", "select * from tmp_df order by match_date, match_id"
        )
    }
    con.unregister("tmp_df")
    return n
