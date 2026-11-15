"""League strength (spec 5.6): three estimates, each with an interval, shown next to (never
instead of) within-league ratings.

1. **European results.** For every CL / EL / UECL match (Transfermarkt, main stages):
   ``GD = home + (s_i + L_a) - (s_j + L_b)``, where ``s`` is each club's within-league
   strength (Dixon-Coles expected goal difference vs its league average at season end;
   0 for clubs of leagues we don't rate) and ``L`` is a league offset in goals per match,
   Premier League = 0. Weighted least squares per season with a light ridge; 80% band
   from a bootstrap over matches. Shoot-out matches are skipped (TM's score includes the
   shoot-out).
2. **Player translation factors.** Players who move between two of the seven domestic
   leagues from one season to the next, 900+ minutes in both: the change in log
   non-penalty goals per 90 (attacking players) after removing the age effect (fixed-effects
   curves, ``ratings.age_curves``). All league pairs are chained into one factor per
   league by weighted least squares, Premier League = 0, bootstrap over players.
3. **A UEFA-style coefficient.** Each association's points per club in the three European
   competitions' main stages (2 a win, 1 a draw), summed over five seasons. UEFA also
   awards bonus points and halves qualifying-round points; those are omitted, so this is
   an approximation, labelled as such.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from pitchvision.config import Paths
from pitchvision.db import has_table, materialize

DOMESTIC = ("GB1", "ES1", "L1", "IT1", "FR1", "NL1", "PO1")
EUROPE = ("CL", "EL", "UCOL")
REF = "GB1"
BOOT = 200
ATTACK = ("AM", "W", "ST")


def _club_league(con) -> pd.DataFrame:
    """Each club-season's domestic first-tier league (the TM league it played most games in)."""
    return con.execute("""
        with c as (select g.season, g.competition_id, x.club_id, count(*) n
                   from stg.tm_games g
                   join stg.tm_competitions k on k.competition_id = g.competition_id
                   cross join lateral (select unnest([g.home_club_id, g.away_club_id])
                                       as club_id) x
                   where k.type = 'domestic_league' group by all)
        select season, club_id, arg_max(competition_id, n) league from c group by all
        """).df()  # fmt: skip


def _solve_offsets(d: pd.DataFrame, idx: dict[str, int]) -> np.ndarray:
    """League offsets (and home advantage, last) for one season's European matches."""
    x = np.zeros((len(d), len(idx) + 1))
    for r, (a, b) in enumerate(zip(d.lh, d.la, strict=True)):
        if a in idx:
            x[r, idx[a]] += 1
        if b in idx:
            x[r, idx[b]] -= 1
    x[:, -1] = 1  # home advantage
    y = (d.home_goals - d.away_goals - d.sh + d.sa).to_numpy(float)
    reg = np.eye(x.shape[1])
    reg[-1, -1] = 0
    return np.linalg.solve(x.T @ x + reg, x.T @ y)


def european_offsets(con, rng: np.random.Generator) -> pd.DataFrame:
    eu = "(" + ",".join(f"'{c}'" for c in EUROPE) + ")"
    m = con.execute(f"""
        select game_id, season, competition_id, home_club_id, away_club_id, home_goals,
               away_goals
        from stg.tm_games where competition_id in {eu} and not shootout""").df()  # fmt: skip
    cl = _club_league(con)
    m = m.merge(cl.rename(columns={"club_id": "home_club_id", "league": "lh"}),
                on=["season", "home_club_id"], how="left").merge(
        cl.rename(columns={"club_id": "away_club_id", "league": "la"}),
        on=["season", "away_club_id"], how="left")  # fmt: skip
    s = con.execute("""select season, club_id, dc_gd from ratings.team_season""").df()
    s["tm"] = s.club_id.str.replace("tm-", "", regex=False)
    s = s[s.tm.str.isnumeric()].assign(tm=lambda d: d.tm.astype("int64"))
    sh = dict(zip(zip(s.season, s.tm, strict=True), s.dc_gd, strict=True))
    m["sh"] = [sh.get((a, b), 0.0) for a, b in zip(m.season, m.home_club_id, strict=True)]
    m["sa"] = [sh.get((a, b), 0.0) for a, b in zip(m.season, m.away_club_id, strict=True)]
    m = m.dropna(subset=["lh", "la"])
    m = m[m.lh != m.la]
    rows = []
    for season, g in m.groupby("season"):
        leagues = sorted(set(g.lh) | set(g.la))
        others = [lg for lg in leagues if lg != REF]
        idx = {lg: i for i, lg in enumerate(others)}

        est = _solve_offsets(g, idx)
        bs = np.array([_solve_offsets(g.iloc[rng.integers(0, len(g), len(g))], idx)
                       for _ in range(BOOT)])  # fmt: skip
        games = pd.concat([g.lh, g.la]).value_counts()
        rows.append({"season": season, "league": REF, "offset_gd": 0.0, "lo": 0.0, "hi": 0.0,
                     "matches": int(games.get(REF, 0))})  # fmt: skip
        for lg, i in idx.items():
            rows.append({"season": season, "league": lg, "offset_gd": est[i],
                         "lo": np.percentile(bs[:, i], 10), "hi": np.percentile(bs[:, i], 90),
                         "matches": int(games.get(lg, 0))})  # fmt: skip
    return pd.DataFrame(rows)


def translation_factors(con, rng: np.random.Generator) -> tuple[pd.DataFrame, pd.DataFrame]:
    lg = "(" + ",".join(f"'{c}'" for c in DOMESTIC) + ")"
    ps = con.execute(f"""
        select s.player_id, s.season, s.competition_id league, sum(s.minutes) minutes_,
               90 * sum(s.np_goals) / sum(s.minutes) np90,
               arg_max(s.position_group, s.minutes) grp,
               date_diff('year', p.date_of_birth, make_date(s.season, 7, 1)) age
        from metrics.player_season s join stg.tm_players p using (player_id)
        where s.competition_id in {lg} and p.date_of_birth is not null
        group by s.player_id, s.season, s.competition_id, p.date_of_birth""").df()  # fmt: skip
    ps = ps[ps.minutes_ >= 900]
    nxt = ps.assign(season=ps.season - 1).rename(columns={
        "league": "league_to", "np90": "np90_to", "minutes_": "min_to", "age": "age_to",
        "grp": "grp_to"})  # fmt: skip
    mv = ps.merge(nxt, on=["player_id", "season"])
    mv = mv[(mv.league != mv.league_to) & mv.grp.isin(ATTACK)]
    curve = {}
    if has_table(con, "ratings", "age_curves"):
        c = con.execute("""select "group" grp, age, level from ratings.age_curves
                           where kind = 'curve' and metric = 'np90'""").df()  # fmt: skip
        curve = {(g, a): v for g, a, v in zip(c.grp, c.age, c.level, strict=True)}
    age_d = np.array([curve.get((g, a + 1), 0.0) - curve.get((g, a), 0.0)
                      for g, a in zip(mv.grp, mv.age, strict=True)])  # fmt: skip
    eps = 0.05  # goals per 90, so a scoreless season doesn't send the log to -inf
    # remove the age effect on the goals-per-90 scale, then take the log ratio
    mv["y"] = np.log(mv.np90_to - age_d + eps) - np.log(mv.np90 + eps)
    mv["w"] = 2 / (1 / mv.minutes_ + 1 / mv.min_to)
    others = [lg for lg in DOMESTIC if lg != REF]
    idx = {lg: i for i, lg in enumerate(others)}

    def solve(d: pd.DataFrame) -> np.ndarray:
        x = np.zeros((len(d), len(others)))
        for r, (a, b) in enumerate(zip(d.league, d.league_to, strict=True)):
            if b in idx:
                x[r, idx[b]] += 1
            if a in idx:
                x[r, idx[a]] -= 1
        w = d.w.to_numpy()
        return np.linalg.solve((x * w[:, None]).T @ x + 0.5 * np.eye(len(others)),
                               (x * w[:, None]).T @ d.y.to_numpy())  # fmt: skip

    est = solve(mv)
    players = mv.player_id.unique()
    by = dict(tuple(mv.groupby("player_id")))
    bs = []
    for _ in range(BOOT):
        pick = rng.choice(players, len(players))
        bs.append(solve(pd.concat([by[p] for p in pick])))
    bs = np.array(bs)
    pair_n = mv.groupby(["league", "league_to"]).size().rename("movers").reset_index()
    rows = [{"league": REF, "log_factor": 0.0, "lo": 0.0, "hi": 0.0}]
    rows += [{"league": lg, "log_factor": est[i], "lo": np.percentile(bs[:, i], 10),
              "hi": np.percentile(bs[:, i], 90)} for lg, i in idx.items()]  # fmt: skip
    f = pd.DataFrame(rows)
    # a positive factor means scoring goes UP moving into that league (it's weaker)
    f["goals_multiplier_vs_pl"] = np.exp(f.log_factor)
    f["movers"] = [int(((mv.league == lg) | (mv.league_to == lg)).sum()) for lg in f.league]
    return f, pair_n


def uefa_style(con) -> pd.DataFrame:
    eu = "(" + ",".join(f"'{c}'" for c in EUROPE) + ")"
    m = con.execute(f"""
        select season, home_club_id, away_club_id, home_goals, away_goals, shootout
        from stg.tm_games where competition_id in {eu}""").df()  # fmt: skip
    cl = _club_league(con)
    long = pd.concat([
        pd.DataFrame({"season": m.season, "club_id": m.home_club_id,
                      "pts": np.where(m.shootout, 1, np.where(m.home_goals > m.away_goals, 2,
                                      np.where(m.home_goals == m.away_goals, 1, 0)))}),
        pd.DataFrame({"season": m.season, "club_id": m.away_club_id,
                      "pts": np.where(m.shootout, 1, np.where(m.away_goals > m.home_goals, 2,
                                      np.where(m.home_goals == m.away_goals, 1, 0)))}),
    ]).merge(cl, on=["season", "club_id"], how="left").dropna(subset=["league"])  # fmt: skip
    a = (
        long.groupby(["season", "league"])
        .agg(points=("pts", "sum"), clubs=("club_id", "nunique"))
        .reset_index()
    )
    a["season_coef"] = a.points / a.clubs
    a = a.sort_values(["league", "season"])
    a["five_year"] = a.groupby("league").season_coef.transform(
        lambda s: s.rolling(5, min_periods=5).sum())  # fmt: skip
    a["rank"] = a.groupby("season").five_year.rank(ascending=False, method="min")
    return a


def build(con, paths: Paths) -> dict[str, int]:
    rng = np.random.default_rng(0)
    eu = european_offsets(con, rng)
    tf, pairs = translation_factors(con, rng)
    uefa = uefa_style(con)
    n = {}
    tables = (
        ("league_strength_europe", eu),
        ("league_translation", tf),
        ("league_translation_pairs", pairs),
        ("uefa_style_coefficient", uefa),
    )
    for name, df in tables:
        con.register("tmp_df", df)
        n[name] = materialize(con, paths, "ratings", name, "select * from tmp_df")
        con.unregister("tmp_df")
    return n
