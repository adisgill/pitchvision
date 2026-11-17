"""Formations as first-class objects, players in them, managers with them, and the
reputations people "just know" put to the test (spec 12.9).

* ``formation_slots``: every FotMob formation's slots (position on FotMob's line-up
  drawing, averaged over every start) with a role name (LB, LCB, DM, LW, ST...).
* ``formation_profile``: per formation, usage in each era, results beyond the closing line,
  how strong the teams that pick it are, and the family.
* ``formation_style``: how the same teams play differently in a formation compared with
  their other shapes in the same season (FotMob era). Every stat is first adjusted for the
  match-up (strength gap from the closing line, home or away), so a shape picked for hard
  away games doesn't look "defensive" just because of the fixtures.
* ``team_formation``: the same within-team comparison per club and formation, with results.
* ``player_formation``: per player, formation and role: starts, minutes, FotMob rating,
  output per 90 and the team's results beyond the odds, against the same player in his
  other shapes (FotMob era). ``player_formation_tm`` does starts, minutes, goals and
  assists back to 2013-14 from Transfermarkt line-ups.
* ``manager_formation``: per manager and formation since 2013-14: results beyond the odds
  with an empirical-Bayes shrunk value, so a lucky 12-match run in a 3-5-2 isn't sold as
  mastery.
* ``reputation_checks`` / ``reputation_reliability`` / ``reputation_matches``: claims such as
  "parks the bus", "presses high", "big-game team" tested per club and per manager on
  FotMob-era matches. Style claims use stats adjusted for the match-up; results claims use
  points beyond the closing line. Each claim kind carries its own split-half reliability:
  a claim whose kind never repeats for any team can't be proven for one.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from pitchvision.config import Paths
from pitchvision.db import has_table, materialize
from pitchvision.research.tactics import FM_ERA, family, style_frame

TM_ROLE = {"Goalkeeper": "GK", "Centre-Back": "CB", "Sweeper": "CB", "Left-Back": "LB",
           "Right-Back": "RB", "Defensive Midfield": "DM", "Central Midfield": "CM",
           "Attacking Midfield": "AM", "Left Midfield": "LM", "Right Midfield": "RM",
           "Left Winger": "LW", "Right Winger": "RW", "Centre-Forward": "ST",
           "Second Striker": "SS"}  # fmt: skip

PLAYER_KEYS = {"minutes_played": "minutes", "fotmob_rating": "rating", "goals": "goals",
               "assists": "assists", "expected_goals_xg": "xg", "expected_assists_xa": "xa",
               "xg_non_penalty": "npxg", "chances_created": "chances",
               "touches_in_opposition_box": "box_touches", "successful_dribbles": "dribbles",
               "passes_into_final_third": "final_third", "tackles": "tackles",
               "interceptions": "interceptions", "recoveries": "recoveries",
               "accurate_passes": "passes_ok"}  # fmt: skip

# style stats compared across shapes: (label, higher means)
SHAPE_STATS = {
    "possession": ("Possession %", "more of the ball"),
    "territory": ("Passes in the opposition half %", "higher up the pitch"),
    "long_share": ("Long-ball share %", "more direct"),
    "crosses": ("Accurate crosses", "more crossing"),
    "press": ("Opponent passes per defensive action", "less pressing"),
    "op_xg_for": ("Open-play xG for", "more chances"),
    "op_xg_against": ("Open-play xG against", "more chances conceded"),
    "box_for": ("Touches in the opposition box", "more box presence"),
    "box_against": ("Opposition touches in own box", "more box pressure faced"),
}  # fmt: skip

DEEP_POSS, DEEP_TERR = -10.0, -8.0  # a deep-block match: this far below the expectation


# ---------------------------------------------------------------- slots and roles


def _roles(g: pd.DataFrame) -> pd.Series:
    """Role names for one formation's slots from their depth (x) and width (y; small y is
    the left flank)."""
    g = g.sort_values("x")
    gk = g.x.idxmin()
    rest = g.drop(gk)
    # rows: slots within 0.06 of depth of each other
    rows, cur, last = [], [], None
    for i, r in rest.iterrows():
        if last is not None and r.x - last > 0.06:
            rows.append(cur)
            cur = []
        cur.append(i)
        last = r.x
    rows.append(cur)
    out = {gk: "GK"}
    n_rows = len(rows)
    back3 = len(rows[0]) in (3, 5)
    for k, idx in enumerate(rows):
        row = rest.loc[idx].sort_values("y")
        n = len(row)
        ids = list(row.index)
        if k == 0:
            names = {3: ["LCB", "CB", "RCB"], 4: ["LB", "LCB", "RCB", "RB"],
                     5: ["LWB", "LCB", "CB", "RCB", "RWB"], 2: ["LCB", "RCB"],
                     6: ["LWB", "LCB", "CB", "CB", "RCB", "RWB"]}.get(n, ["DF"] * n)  # fmt: skip
        elif k == n_rows - 1:
            names = {1: ["ST"], 2: ["LST", "RST"], 3: ["LW", "ST", "RW"],
                     4: ["LW", "LST", "RST", "RW"]}.get(n, ["FW"] * n)  # fmt: skip
        else:
            deepest, highest = k == 1, k == n_rows - 2
            names = []
            for _j, (_, r) in enumerate(row.iterrows()):
                wide = r.y < 0.2 or r.y > 0.8
                side = "L" if r.y < 0.5 else "R"
                if wide:
                    if deepest and back3:
                        names.append(f"{side}WB")
                    elif highest and n_rows >= 4 and not deepest:
                        names.append(f"{side}W")
                    else:
                        names.append(f"{side}M")
                else:
                    base = (
                        "DM"
                        if deepest and n_rows >= 4
                        else "AM"
                        if highest and n_rows >= 4
                        else "CM"
                    )
                    centre = [x for x in row.y if 0.2 <= x <= 0.8]
                    if len(centre) > 1:
                        base = ("L" if r.y < 0.5 else "R") + base if abs(r.y - 0.5) > 0.05 else base
                    names.append(base)
        out.update(dict(zip(ids, names, strict=True)))
    return pd.Series(out)


def slots(con) -> pd.DataFrame:
    s = con.execute("""
        select case when p.team_fm_id = m.home_fm_id then m.home_formation else m.away_formation end
               formation, p.position_id, avg(p.layout_x) x, avg(p.layout_y) y, count(*) n
        from stg.fm_player_match p join stg.fm_matches m using (fm_match_id)
        where p.starter and p.position_id is not null and p.layout_x is not null
        group by all""").df()  # fmt: skip
    s = s.dropna(subset=["formation"])
    # keep a formation's eleven most-used slots (a few rare slot ids are drawing noise)
    s = s.sort_values("n", ascending=False).groupby("formation").head(11)
    s["role"] = None
    for _f, g in s.groupby("formation"):
        s.loc[g.index, "role"] = _roles(g)
    return s.sort_values(["formation", "x", "y"]).reset_index(drop=True)


# ---------------------------------------------------------------- team-match frame


def team_frame(con) -> pd.DataFrame:
    """FotMob-era team-matches: style stats, formation, manager, strength gap, results, and
    every style stat adjusted for the match-up (``<stat>_res``)."""
    st = style_frame(con)
    sh = con.execute("""
        select s.match_id, s.club_id, s.formation, s.manager, s.manager_slug, s.home, s.opp_id,
               s.opp, s.pts, s.xpts, s.gf, s.ga,
               case when s.home then p.mkt_h - p.mkt_a else p.mkt_a - p.mkt_h end gap,
               case when s.home then p.mkt_h else p.mkt_a end p_win
        from research.team_shape s left join forecast.wf_predictions p using (match_id)
        where s.season >= ?""", [FM_ERA]).df()  # fmt: skip
    d = st.merge(sh, on=["match_id", "club_id"], how="inner")
    sp = con.execute("""
        select x.match_id, s.team_fm_id = m.home_fm_id is_home,
               sum(s.xg) filter (where s.situation in ('FromCorner', 'SetPiece', 'FreeKick',
                                                       'ThrowInSetPiece')) sp,
               sum(s.xg) filter (where s.situation <> 'Penalty') npxg
        from stg.fm_shots s join stg.fm_matches m using (fm_match_id)
        join core.fm_matches_xw x using (fm_match_id)
        where not s.own_goal and s.period <> 'PenaltyShootout' and x.match_id is not null
        group by all""").df()  # fmt: skip
    key = pd.MultiIndex.from_arrays([d.match_id, d.home])
    spi = sp.set_index(["match_id", "is_home"])
    d["sp_share"] = 100 * key.map(spi.sp).to_numpy() / key.map(spi.npxg).to_numpy()
    d.loc[~np.isfinite(d.sp_share), "sp_share"] = np.nan
    d["gap"] = d.gap.fillna(0.0)
    for c in list(SHAPE_STATS) + ["sp_share", "counter_share"]:
        d[f"{c}_res"] = np.nan
        for _comp, g in d.groupby("competition_id"):
            ok = g[c].notna()
            X = np.column_stack([np.ones(ok.sum()), g.gap[ok], g.gap[ok] ** 2,
                                 g.home[ok].astype(float)])  # fmt: skip
            b = np.linalg.lstsq(X, g[c][ok].to_numpy(), rcond=None)[0]
            d.loc[g.index[ok], f"{c}_res"] = g[c][ok].to_numpy() - X @ b
            d.loc[g.index[ok], f"{c}_exp"] = X @ b
    d["res"] = d.pts - d.xpts
    return d


# ---------------------------------------------------------------- formations


def within_team(d: pd.DataFrame, by: list[str], min_in: int = 3) -> pd.DataFrame:
    """Each stat in a formation minus the same team-season's mean in its other shapes,
    then combined across team-seasons (weight: harmonic mean of the two counts)."""
    rows = []
    stats = [f"{c}_res" for c in SHAPE_STATS]
    for (_comp, _season, club), g in d.dropna(subset=["formation"]).groupby(
        ["competition_id", "season", "club_id"]
    ):
        for f, gi in g.groupby("formation"):
            go = g[g.formation != f]
            if len(gi) < min_in or len(go) < min_in:
                continue
            w = 1 / (1 / len(gi) + 1 / len(go))
            r = {"club_id": club, "formation": f, "w": w, "n_in": len(gi)}
            for s in stats:
                r[s] = gi[s].mean() - go[s].mean()
            rows.append(r)
    t = pd.DataFrame(rows)
    out = []
    for keys, g in t.groupby(by):
        keys = keys if isinstance(keys, tuple) else (keys,)
        for s in stats:
            v = g[[s, "w"]].dropna()
            if not len(v):
                continue
            m = np.average(v[s], weights=v.w)
            se = (np.sqrt(np.average((v[s] - m) ** 2, weights=v.w) / max(len(v) - 1, 1))
                  if len(v) > 1 else np.nan)  # fmt: skip
            base = s.removesuffix("_res")
            out.append({**dict(zip(by, keys, strict=True)), "stat": base,
                        "label": SHAPE_STATS[base][0], "means": SHAPE_STATS[base][1],
                        "diff": m, "se": se, "team_seasons": len(v),
                        "matches": int(g.n_in.sum())})  # fmt: skip
    return pd.DataFrame(out)


def profile(shape: pd.DataFrame) -> pd.DataFrame:
    d = shape[shape.formation.notna()].copy()
    d["res"] = d.pts - d.xpts
    d["era"] = np.where(d.season >= FM_ERA, "fm", "tm")
    g = d.groupby("formation")
    p = g.agg(n=("match_id", "size"), ppg=("pts", "mean"), xppg=("xpts", "mean"),
              over_pm=("res", "mean"), res_sd=("res", "std"), p_win=("p_win", "mean"),
              clubs=("club_id", "nunique"), first=("season", "min"),
              last=("season", "max")).reset_index()  # fmt: skip
    p["se"] = p.res_sd / np.sqrt(g.res.count().to_numpy())
    p = p.drop(columns="res_sd")
    for era in ("fm", "tm"):
        p[f"n_{era}"] = p.formation.map(d[d.era == era].groupby("formation").size()).fillna(0)
    latest = d.season.max()
    cur = d[d.season >= latest - 1]
    p["share_recent"] = p.formation.map(cur.groupby("formation").size() / len(cur)).fillna(0)
    p["family"] = p.formation.map(family)
    return p[p.n >= 10].sort_values("n", ascending=False)


def team_formation(d: pd.DataFrame, shape: pd.DataFrame) -> pd.DataFrame:
    w = within_team(d, ["club_id", "formation"])
    res = (shape[shape.formation.notna() & (shape.season >= FM_ERA)]
           .assign(res=lambda x: x.pts - x.xpts)
           .groupby(["club_id", "formation"])
           .agg(n=("match_id", "size"), ppg=("pts", "mean"), over_pm=("res", "mean"),
                res_sd=("res", "std")).reset_index())  # fmt: skip
    res["se"] = res.res_sd.fillna(1.2) / np.sqrt(res.n)
    wide = w.pivot_table(
        index=["club_id", "formation"], columns="stat", values="diff"
    ).reset_index()
    return res.drop(columns="res_sd").merge(wide, on=["club_id", "formation"], how="left")


def manager_formation(shape: pd.DataFrame) -> pd.DataFrame:
    d = shape[shape.formation.notna() & shape.manager_slug.notna() & shape.xpts.notna()].copy()
    d["res"] = d.pts - d.xpts
    g = d.groupby(["manager_slug", "formation"])
    t = g.agg(manager=("manager", "first"), n=("res", "size"), ppg=("pts", "mean"),
              xppg=("xpts", "mean"), over_pm=("res", "mean"), sd=("res", "std"),
              clubs=("club_id", "nunique"), first=("season", "min"),
              last=("season", "max")).reset_index()  # fmt: skip
    t["se"] = t.sd.fillna(1.2).clip(lower=0.6) / np.sqrt(t.n)
    big = t[t.n >= 20]
    tau2 = max(0.0, float(big.over_pm.var() - (big.se**2).mean())) if len(big) > 10 else 0.0
    t["shrunk"] = t.over_pm * tau2 / (tau2 + t.se**2)
    t["lo"], t["hi"] = t.over_pm - 1.96 * t.se, t.over_pm + 1.96 * t.se
    t["verdict"] = np.select([t.lo > 0, t.hi < 0], ["better than the odds", "worse than the odds"],
                             "no clear edge")  # fmt: skip
    t.attrs["tau2"] = tau2
    return t.drop(columns="sd")


# ---------------------------------------------------------------- players


def player_frame(con, shape: pd.DataFrame, sl: pd.DataFrame) -> pd.DataFrame:
    keys = ", ".join(f"'{k}'" for k in PLAYER_KEYS)
    cols = ", ".join(f"max(value) filter (where key = '{k}') {k}" for k in PLAYER_KEYS)
    p = con.execute(f"""
        with w as (
            select fm_match_id, player_fm_id, {cols} from stg.fm_player_stats
            where key in ({keys}) group by all)
        select x.match_id, c.club_id, p.player_fm_id, p.name, p.position_id,
               coalesce(fp.player_id, 'fm-' || p.player_fm_id) player_id, w.*
               exclude (fm_match_id, player_fm_id)
        from stg.fm_player_match p join stg.fm_matches m using (fm_match_id)
        join core.fm_matches_xw x using (fm_match_id)
        join core.fm_clubs c on c.competition_id = m.competition_id and c.season = m.season
             and c.fm_id = p.team_fm_id
        left join w on w.fm_match_id = p.fm_match_id and w.player_fm_id = p.player_fm_id
        left join (select distinct player_fm_id, player_id from core.fm_players) fp
          on fp.player_fm_id = p.player_fm_id
        where p.starter and x.match_id is not null""").df()  # fmt: skip
    p = p.rename(columns=PLAYER_KEYS)
    s = shape[["match_id", "club_id", "formation", "pts", "xpts", "season"]]
    p = p.merge(s, on=["match_id", "club_id"])
    role = sl.set_index(["formation", "position_id"]).role
    p["role"] = pd.MultiIndex.from_arrays([p.formation, p.position_id]).map(role)
    return p


def player_formation(p: pd.DataFrame) -> pd.DataFrame:
    p = p[p.formation.notna() & (p.minutes > 0)].copy()
    p["res"] = p.pts - p.xpts
    p["def"] = p.tackles.fillna(0) + p.interceptions.fillna(0) + p.recoveries.fillna(0)
    p["xgxa"] = p.xg.fillna(0) + p.xa.fillna(0)
    p["ga"] = p.goals.fillna(0) + p.assists.fillna(0)
    p["rated"] = p.minutes.where(p.rating.notna(), 0)
    p["rmin"] = (p.rating * p.minutes).fillna(0)
    for c in ("chances", "box_touches"):
        p[c] = p[c].fillna(0)
    sums = ["minutes", "rated", "rmin", "ga", "xgxa", "chances", "box_touches", "def", "res"]
    t = p.groupby(["player_id", "formation"])[sums].sum()
    t["starts"] = p.groupby(["player_id", "formation"]).size()
    t["role"] = (
        p.dropna(subset=["role"])
        .groupby(["player_id", "formation"])
        .role.agg(lambda s: s.value_counts().index[0])
    )
    t["club_id"] = p.groupby(["player_id", "formation"]).club_id.last()
    tot = p.groupby("player_id")[sums].sum()
    tot["starts"] = p.groupby("player_id").size()
    t = t.join(tot, on="player_id", rsuffix="_all").reset_index()
    t["name"] = t.player_id.map(
        p.groupby("player_id").name.agg(lambda s: s.value_counts().index[0])
    )
    m = t.minutes.where(t.minutes > 0)
    t["rating"] = t.rmin / t.rated.where(t.rated > 0)
    t["ga_p90"], t["xgxa_p90"] = 90 * t.ga / m, 90 * t.xgxa / m
    t["chances_p90"], t["box_p90"], t["def_p90"] = (90 * t.chances / m, 90 * t.box_touches / m,
                                                     90 * t["def"] / m)  # fmt: skip
    t["res_sum"] = t.res
    t["res"] = t.res_sum / t.starts
    om = (t.minutes_all - t.minutes).where(lambda x: x > 0)
    t["other_starts"] = t.starts_all - t.starts
    t["other_rating"] = (t.rmin_all - t.rmin) / (t.rated_all - t.rated).where(lambda x: x > 0)
    t["other_xgxa_p90"] = 90 * (t.xgxa_all - t.xgxa) / om
    t["other_res"] = (t.res_all - t.res_sum) / t.other_starts.where(t.other_starts > 0)
    t["rating_diff"] = (t.rating - t.other_rating).where(t.other_starts >= 5)
    keep = [
        "player_id",
        "name",
        "club_id",
        "formation",
        "role",
        "starts",
        "minutes",
        "rating",
        "ga_p90",
        "xgxa_p90",
        "chances_p90",
        "box_p90",
        "def_p90",
        "res",
        "other_starts",
        "other_rating",
        "other_xgxa_p90",
        "other_res",
        "rating_diff",
    ]
    return t[keep]


def player_formation_tm(con, shape: pd.DataFrame) -> pd.DataFrame:
    t = con.execute("""
        select 'tm-' || l.game_id match_id, 'tm-' || l.club_id club_id,
               'tm-' || l.player_id player_id, l.slot, a.minutes, a.goals, a.assists
        from stg.tm_lineups l left join stg.tm_appearances a
          on a.game_id = l.game_id and a.player_id = l.player_id
        where l.starter""").df()  # fmt: skip
    s = shape[(shape.season < FM_ERA) & shape.formation.notna()][
        ["match_id", "club_id", "formation", "pts", "xpts", "season"]
    ]
    t = t.merge(s, on=["match_id", "club_id"])
    t["role"] = t.slot.map(TM_ROLE)
    t["res"] = t.pts - t.xpts
    t["ga"] = t.goals.fillna(0) + t.assists.fillna(0)
    g = t.groupby(["player_id", "formation"])
    out = g.agg(starts=("match_id", "size"), minutes=("minutes", "sum"), ga=("ga", "sum"),
                res=("res", "mean"), first=("season", "min"), last=("season", "max"),
                role=("role", lambda x: x.value_counts().index[0] if x.notna().any() else None),
                club_id=("club_id", "last")).reset_index()  # fmt: skip
    out["ga_p90"] = 90 * out.ga / out.minutes.where(out.minutes > 0)
    return out[out.starts >= 3]


# ---------------------------------------------------------------- reputations

# claim -> (label, kind, question, unit, test description)
CLAIMS = {
    "park_bus": ("Parks the bus", "style", "Do they sit deeper and cede the ball more than the "
                 "match-up predicts?", "possession points below expected"),
    "park_bus_big": ("Parks the bus against bigger sides", "style", "As underdogs, do they "
                     "drop deeper than underdogs usually do?", "possession points below expected"),
    "press": ("Presses high", "style", "Do they allow opponents fewer passes per defensive "
              "action than the match-up predicts?", "fewer opponent passes per action"),
    "long_ball": ("Goes long", "style", "Do they play more long balls than the match-up "
                  "predicts?", "points of long-ball share above expected"),
    "wings": ("Lives on the wings", "style", "Do they cross more than the match-up predicts?",
              "accurate crosses per match above expected"),
    "counter": ("Plays on the counter", "style", "Is more of their open-play xG from fast "
                "breaks than the match-up predicts?", "points of fast-break share above expected"),
    "set_pieces": ("Lives off set pieces", "style", "Is more of their xG from set pieces than "
                   "the match-up predicts?", "points of set-piece share above expected"),
    "shape_big": ("Changes shape for big games", "shape", "As underdogs, do they leave their "
                  "usual formation more often than in other matches?", "points more often"),
    "big_game": ("Big-game team", "results", "As underdogs, do they take more points than the "
                 "closing odds expected?", "points per match beyond the odds"),
    "flat_track": ("Flat-track bully", "results", "Do they beat the odds against weaker sides "
                   "more than against stronger ones?", "pts per match, favourite minus underdog"),
    "fortress": ("Fortress at home", "results", "Do they beat the odds more at home than away?",
                 "points per match, home minus away"),
}  # fmt: skip


# smallest effect we'd call the claim "true" (below it, a real but mild lean)
MIN_EFFECT = {"park_bus": 3.0, "park_bus_big": 3.0, "press": 0.5, "long_ball": 1.5, "wings": 0.5,
              "counter": 3.0, "set_pieces": 3.0}  # fmt: skip


def _mean_ci(v: pd.Series) -> tuple[float, float, int]:
    v = v.dropna()
    if len(v) < 2:
        return (float(v.mean()) if len(v) else np.nan, np.nan, len(v))
    return float(v.mean()), float(v.std() / np.sqrt(len(v))), len(v)


def claim_values(g: pd.DataFrame) -> dict[str, tuple[float, float, int]]:
    """Each claim's value (positive = the claim holds), its standard error and n."""
    und = g[g.gap < -0.15]
    fav = g[g.gap > 0.15]
    out = {
        "park_bus": _mean_ci(-g.possession_res),
        "park_bus_big": _mean_ci(-und.possession_res),
        "press": _mean_ci(-g.press_res),
        "long_ball": _mean_ci(g.long_share_res),
        "wings": _mean_ci(g.crosses_res),
        "counter": _mean_ci(g.counter_share_res),
        "set_pieces": _mean_ci(g.sp_share_res),
        "big_game": _mean_ci(und.res),
    }
    mode = g.formation.mode()
    if len(mode) and len(und) >= 3 and len(g) - len(und) >= 3:
        off = (g.formation != mode.iloc[0]).astype(float)
        a, b = off[und.index], off.drop(und.index)
        se = np.sqrt(a.var() / len(a) + b.var() / len(b)) if len(a) > 1 and len(b) > 1 else np.nan
        out["shape_big"] = (100 * (a.mean() - b.mean()), 100 * se, len(a))
    else:
        out["shape_big"] = (np.nan, np.nan, len(und))
    if len(fav) >= 3 and len(und) >= 3:
        out["flat_track"] = (fav.res.mean() - und.res.mean(),
                             np.sqrt(fav.res.var() / len(fav) + und.res.var() / len(und)),
                             len(fav) + len(und))  # fmt: skip
    else:
        out["flat_track"] = (np.nan, np.nan, len(fav) + len(und))
    h, a = g[g.home], g[~g.home]
    if len(h) >= 3 and len(a) >= 3:
        out["fortress"] = (
            h.res.mean() - a.res.mean(),
            np.sqrt(h.res.var() / len(h) + a.res.var() / len(a)),
            len(g),
        )
    else:
        out["fortress"] = (np.nan, np.nan, len(g))
    return out


def reputation(d: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    d = d.copy()
    d["par"] = pd.util.hash_array(d.match_id.to_numpy().astype(str)) % 2
    # reliability of each claim kind: random halves of each team-season
    halves = []
    for (comp, season, club, par), g in d.groupby(["competition_id", "season", "club_id", "par"]):
        if len(g) < 8:
            continue
        v = claim_values(g)
        halves.append({"comp": comp, "season": season, "club": club, "par": par,
                       **{k: x[0] for k, x in v.items()}})  # fmt: skip
    h = pd.DataFrame(halves)
    rel = []
    for c in CLAIMS:
        w = h.pivot_table(index=["comp", "season", "club"], columns="par", values=c).dropna()
        r = float(w[0].corr(w[1])) if len(w) > 10 else np.nan
        rel.append({"claim": c, "split_half_r": r,
                    "season_rel": 2 * r / (1 + r) if r and r > 0 else 0.0,
                    "team_seasons": len(w)})  # fmt: skip
    rel = pd.DataFrame(rel)
    relmap = dict(zip(rel.claim, rel.season_rel, strict=True))
    # club values, pooled over the FotMob era and per season; manager values pooled
    rows = []
    for who, key in (("club", "club_id"), ("manager", "manager_slug")):
        scopes = [(f"{key}", None)] + ([] if who == "manager" else [(key, "season")])
        for _, extra in scopes:
            cols = [key] + ([extra] if extra else [])
            for ids, g in d.dropna(subset=[key]).groupby(cols):
                ids = ids if isinstance(ids, tuple) else (ids,)
                if len(g) < 10:
                    continue
                v = claim_values(g)
                for c, (val, se, n) in v.items():
                    rows.append({"who": who, "id": ids[0], "season": ids[1] if extra else 0,
                                 "claim": c, "value": val, "se": se, "n": n,
                                 "matches": len(g),
                                 "name": g.manager.iloc[-1] if who == "manager" else None,
                                 "competition_id": g.competition_id.iloc[-1]})  # fmt: skip
    t = pd.DataFrame(rows)
    t["lo"], t["hi"] = t.value - 1.96 * t.se, t.value + 1.96 * t.se
    t["kind_rel"] = t.claim.map(relmap)
    t["label"] = t.claim.map(lambda c: CLAIMS[c][0])
    # percentile among clubs in the same league (pooled scope) for context
    t["pct"] = np.nan
    m = t.who == "club"
    t.loc[m, "pct"] = (t[m].groupby(["season", "competition_id", "claim"]).value
                       .rank(pct=True) * 100)  # fmt: skip

    def verdict(r) -> str:
        if not np.isfinite(r.value) or not np.isfinite(r.se) or r.n < 8:
            return "not enough matches"
        if r.kind_rel < 0.3:
            return "not a repeatable trait"
        if r.lo > 0:
            big = r.value >= MIN_EFFECT.get(r.claim, 0) and (not np.isfinite(r.pct) or r.pct >= 80)
            return "true" if big else "leans that way"
        if r.hi < 0:
            return "the opposite"
        return "not proven"

    t["verdict"] = t.apply(verdict, axis=1)
    # the evidence: deep-block matches
    deep = d[(d.possession_res <= DEEP_POSS) & (d.territory_res <= DEEP_TERR)]
    ev = deep[["club_id", "match_id", "match_date", "season", "opp_id", "opp", "home", "gf",
               "ga", "pts", "xpts", "formation", "manager", "manager_slug", "possession",
               "possession_exp", "territory", "territory_exp", "p_win"]].copy()  # fmt: skip
    base = len(deep) / len(d)
    t.attrs["deep_base"] = base
    t["deep_share"] = np.nan
    ds = d.assign(deep=d.index.isin(deep.index)).groupby("club_id").deep.mean()
    mk = (t.who == "club") & (t.season == 0) & t.claim.isin(["park_bus", "park_bus_big"])
    t.loc[mk, "deep_share"] = t.loc[mk, "id"].map(ds)
    t["deep_base"] = base
    return t, rel, ev


# ---------------------------------------------------------------- build


def build(con, paths: Paths) -> dict[str, int]:
    shape = con.execute("""
        select s.*, p.mkt_h, p.mkt_a from research.team_shape s
        left join forecast.wf_predictions p using (match_id)""").df()  # fmt: skip
    out: dict[str, pd.DataFrame] = {
        "formation_profile": profile(shape),
        "manager_formation": manager_formation(shape),
        "player_formation_tm": player_formation_tm(con, shape)
        if has_table(con, "stg", "tm_lineups")
        else pd.DataFrame(),
    }
    if has_table(con, "core", "fm_matches_xw"):
        sl = slots(con)
        d = team_frame(con)
        out["formation_slots"] = sl
        out["formation_style"] = within_team(d, ["formation"])
        out["team_formation"] = team_formation(d, shape)
        out["player_formation"] = player_formation(player_frame(con, shape, sl))
        rep, rel, ev = reputation(d)
        out["reputation_checks"] = rep
        out["reputation_reliability"] = rel.assign(
            label=rel.claim.map(lambda c: CLAIMS[c][0]),
            question=rel.claim.map(lambda c: CLAIMS[c][2]),
            unit=rel.claim.map(lambda c: CLAIMS[c][3]),
            kind=rel.claim.map(lambda c: CLAIMS[c][1]),
        )
        out["reputation_matches"] = ev
    n = {}
    for name, df in out.items():
        if df is None or not len(df):
            n[name] = 0
            continue
        con.register("tmp_df", df)
        n[name] = materialize(con, paths, "research", name, "select * from tmp_df")
        con.unregister("tmp_df")
    return n
