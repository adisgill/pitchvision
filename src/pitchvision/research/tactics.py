"""Formations, team style profiles, tendencies and managers (spec 12.8).

* ``team_shape``: one row per team per league match since 2013-14: formation, its family
  (back three / back four), manager, result and the closing line's expected points.
  Formations come from one provider per era so labels don't flip mid-season: Transfermarkt
  through 2023-24, FotMob from 2024-25 (the two agree on the exact label only about two
  times in three on the matches both cover; the family agrees far more often). Managers
  come from Transfermarkt where it has the match, else FotMob, with FotMob's spellings
  mapped to Transfermarkt's where the two name different strings for the same match.
* ``manager_spells`` / ``manager_formations``: every unbroken run of league matches by one
  manager at one club, scored against the odds, and the shapes used in it.
* ``team_style_fm`` / ``style_reliability``: FotMob-era style profile per team-season.
  Every trait's split-half reliability (odd v even matches inside a team-season, league
  mean removed) says how much of the spread between teams is a stable trait at a given
  number of matches. Labels (strengths, weaknesses, tendencies) are only drawn from
  traits whose reliability at the team's matches is at least 0.7.
* ``team_gamestate``: xG for and against per 90 when level, ahead and behind, and by
  15-minute block, shrunk toward the league-season rate (prior weight: 450 minutes).
* ``formation_trends``: formation and family shares per league-season.
* ``formation_matchups``: results beyond the closing line by formation pairing, with a
  permutation test of whether pairings matter at all.
* ``manager_shape`` / ``manager_shape_moves``: does a manager's shape move with the manager
  to a new club? Back-three share at the new club regressed on the manager's share at the previous
  club and the new club's share under its previous manager.
"""

from __future__ import annotations

import re

import numpy as np
import pandas as pd

from pitchvision.config import Paths
from pitchvision.db import has_table, materialize

FM_ERA = 2024  # first season whose formations come from FotMob
MIN_SPLIT = 16  # matches a team-season needs to enter the reliability estimate
STATE_PRIOR_MIN = 450.0
MATCH_MIN = 97.0  # minutes in an average league match, stoppage included

# trait -> (label, kind, higher-is-better or None for style, high phrase, low phrase, unit)
TRAITS = {
    "possession": ("Possession", "style", None, "Keeps the ball", "Happy without the ball", "%"),
    "passes": ("Passes per match", "style", None, "Passes a lot", "Passes little", ""),
    "long_share": ("Long-ball share", "style", None, "Goes long", "Plays it short", "%"),
    "territory": ("Passes in the opposition half", "style", None,
                  "Lives in the opposition half", "Builds from deep", "%"),
    "press": ("Pressing (opponent passes allowed per defensive action)", "style", None,
              "Presses hard", "Sits off", ""),
    "crosses": ("Accurate crosses per match", "style", None, "Crosses a lot", "Rarely crosses", ""),
    "dribbles": ("Dribbles per match", "style", None, "Takes players on", "Rarely dribbles", ""),
    "aerials": ("Aerial duels won per match", "style", None, "Fights in the air",
                "Stays on the ground", ""),
    "long_shots": ("Shots from outside the box", "style", None, "Shoots from distance",
                   "Works it into the box", "%"),
    "counter_share": ("Open-play xG from fast breaks", "style", None, "Lethal on the break",
                      "Rarely counters", "%"),
    "fouls": ("Fouls per match", "style", None, "Fouls a lot", "Rarely fouls", ""),
    "op_xg_for": ("Open-play xG created", "output", True, "Creates in open play",
                  "Struggles to create", ""),
    "op_xg_against": ("Open-play xG conceded", "output", False, "Hard to open up",
                      "Open in open play", ""),
    "sp_xg_for": ("Set-piece xG created", "output", True, "Set-piece threat",
                  "Little from set pieces", ""),
    "sp_xg_against": ("Set-piece xG conceded", "output", False, "Solid at set pieces",
                      "Leaky at set pieces", ""),
    "box_for": ("Touches in the opposition box", "output", True, "Gets into the box",
                "Rarely in the box", ""),
    "box_against": ("Opposition touches in your box", "output", False, "Keeps them out of the box",
                    "Lets them into the box", ""),
    "big_for": ("Big chances created", "output", True, "Makes big chances", "Few big chances", ""),
    "big_against": ("Big chances conceded", "output", False, "Concedes few big chances",
                    "Concedes big chances", ""),
    "xg_shot_for": ("xG per shot taken", "output", True, "Shoots from good positions",
                    "Settles for poor shots", ""),
    "xg_shot_against": ("xG per shot faced", "output", False, "Forces poor shots",
                        "Gives up clean looks", ""),
}  # fmt: skip

KEYS = ["ballpossesion", "passes", "accurate_passes", "long_balls_accurate", "own_half_passes",
        "opposition_half_passes", "accurate_crosses", "touches_opp_box", "expected_goals",
        "expected_goals_open_play", "expected_goals_set_play", "total_shots", "big_chance",
        "fouls", "interceptions", "matchstats_headers_tackles", "aerials_won",
        "dribbles_succeeded", "shots_outside_box"]  # fmt: skip


def norm_formation(f) -> str | None:
    """'4-3-3 Attacking' -> '4-3-3'; '4-4-2 double 6' -> '4-4-2'."""
    if not isinstance(f, str):
        return None
    m = re.match(r"^\s*(\d(?:-\d){2,4})", f)
    return m.group(1) if m else None


def family(f: str | None) -> str | None:
    if not isinstance(f, str) or not f:
        return None
    return {"3": "Back three", "5": "Back three", "4": "Back four"}.get(f[0], "Other")


# letters NFKD doesn't decompose into ASCII (keep in step with managerSlug in the app)
TRANSLIT = str.maketrans({"æ": "ae", "Æ": "Ae", "ø": "o", "Ø": "O", "ß": "ss", "ł": "l", "Ł": "L",
                          "đ": "d", "Đ": "D", "œ": "oe", "Œ": "Oe", "ı": "i", "þ": "th",
                          "ð": "d"})  # fmt: skip


def norm_name(s: pd.Series) -> pd.Series:
    import unicodedata

    def one(v):
        if not isinstance(v, str) or not v.strip():
            return None
        v = unicodedata.normalize("NFKD", v.translate(TRANSLIT)).encode("ascii", "ignore").decode()
        return re.sub(r"[^a-z]+", " ", v.lower()).strip() or None

    return s.map(one)


# ---------------------------------------------------------------- formations and managers


def shape_frame(con) -> pd.DataFrame:
    """One row per team per played league match, with formation, manager and expected points."""
    fm = has_table(con, "core", "fm_matches_xw")
    fm_cols = ("fmm.home_formation fm_hf, fmm.away_formation fm_af, fmm.home_coach fm_hm, "
               "fmm.away_coach fm_am") if fm else (
               "null fm_hf, null fm_af, null fm_hm, null fm_am")  # fmt: skip
    fm_join = (
        (
            "left join core.fm_matches_xw fx on fx.match_id = t.match_id "
            "left join stg.fm_matches fmm on fmm.fm_match_id = fx.fm_match_id"
        )
        if fm
        else ""
    )
    m = con.execute(f"""
        select t.match_id, t.competition_id, t.season, t.match_date, t.home_club, t.away_club,
               t.home_team, t.away_team, t.home_goals, t.away_goals,
               g.home_formation tm_hf, g.away_formation tm_af, g.home_manager tm_hm,
               g.away_manager tm_am, {fm_cols}, p.mkt_h, p.mkt_d, p.mkt_a,
               t.close_home, t.close_draw, t.close_away
        from core.team_matches t
        left join stg.tm_games g on t.match_id = 'tm-' || g.game_id
        left join forecast.wf_predictions p using (match_id)
        {fm_join}
        where t.played and t.home_goals is not null""").df()
    # market probabilities: the model's de-vigged closing line, else proportional de-vig
    inv = 1 / m[["close_home", "close_draw", "close_away"]]
    tot = inv.sum(axis=1)
    for a, b in (("mkt_h", "close_home"), ("mkt_d", "close_draw"), ("mkt_a", "close_away")):
        m[a] = m[a].fillna(inv[b] / tot)
    # FotMob coach spellings -> Transfermarkt's, from matches both cover
    pairs = pd.concat(
        [
            pd.DataFrame({"fm": norm_name(m.fm_hm), "tm": norm_name(m.tm_hm)}),
            pd.DataFrame({"fm": norm_name(m.fm_am), "tm": norm_name(m.tm_am)}),
        ]
    ).dropna()
    pairs = pairs[pairs.fm != pairs.tm]
    cnt = pairs.value_counts().reset_index(name="n")
    cnt = cnt[cnt.n >= 5].sort_values("n", ascending=False).drop_duplicates("fm")
    alias = dict(zip(cnt.fm, cnt.tm, strict=True))
    rows = []
    for side in ("h", "a"):
        home = side == "h"
        tm_f = m[f"tm_{side}f"].map(norm_formation)
        fm_f = m[f"fm_{side}f"].map(norm_formation)
        form = pd.Series(
            np.where(m.season >= FM_ERA, fm_f.fillna(tm_f), tm_f.fillna(fm_f)), index=m.index
        ).where(lambda x: x.notna(), None)
        tm_key, fm_key = norm_name(m[f"tm_{side}m"]), norm_name(m[f"fm_{side}m"])
        fm_key = fm_key.map(lambda k: alias.get(k, k) if k else None)
        d = pd.DataFrame({
            "club_id": m.home_club if home else m.away_club,
            "match_id": m.match_id, "competition_id": m.competition_id, "season": m.season,
            "match_date": m.match_date, "home": home,
            "team": m.home_team if home else m.away_team,
            "opp_id": m.away_club if home else m.home_club,
            "opp": m.away_team if home else m.home_team,
            "gf": m.home_goals if home else m.away_goals,
            "ga": m.away_goals if home else m.home_goals,
            "formation": form, "opp_formation": None,
            "manager_key": tm_key.fillna(fm_key),
            "manager_raw": m[f"tm_{side}m"].fillna(m[f"fm_{side}m"]),
            "xpts": 3 * (m.mkt_h if home else m.mkt_a) + m.mkt_d,
            "p_win": m.mkt_h if home else m.mkt_a,
        })  # fmt: skip
        rows.append(d)
    d = pd.concat(rows, ignore_index=True)
    opp = d.set_index(["match_id", "club_id"]).formation
    d["opp_formation"] = pd.MultiIndex.from_arrays([d.match_id, d.opp_id]).map(opp)
    d["family"] = d.formation.map(family)
    d["pts"] = np.select([d.gf > d.ga, d.gf == d.ga], [3, 1], 0)
    d["source"] = np.where(d.season >= FM_ERA, "fotmob", "transfermarkt")
    # display name: the most common raw spelling per key
    names = (d.dropna(subset=["manager_key", "manager_raw"])
             .groupby("manager_key")
             .manager_raw.agg(lambda s: s.value_counts().index[0]))  # fmt: skip
    d["manager"] = d.manager_key.map(names)
    d["manager_slug"] = d.manager_key.str.replace(" ", "-", regex=False)
    return d.sort_values(["club_id", "match_date", "match_id"]).reset_index(drop=True)


def number_spells(d: pd.DataFrame) -> pd.DataFrame:
    """Spell number per club: a new spell starts whenever the manager differs from the
    previous match with a known manager, except that a caretaker run of up to three matches
    between two runs of the same manager (illness, a touchline ban) doesn't end the spell."""
    k = d[d.manager_key.notna()]
    chg = (k.manager_key != k.groupby("club_id").manager_key.shift()).astype(int)
    run = chg.groupby(k.club_id).cumsum()
    runs = (pd.DataFrame({"club_id": k.club_id, "run": run, "mgr": k.manager_key})
            .groupby(["club_id", "run"]).agg(mgr=("mgr", "first"), n=("mgr", "size"))
            .reset_index())  # fmt: skip
    spell_of: dict[tuple, int] = {}
    for club, g in runs.groupby("club_id", sort=False):
        ids: list[int] = []
        rs = g.to_dict("records")
        for i, r in enumerate(rs):
            if i >= 2 and rs[i - 1]["n"] <= 3 and rs[i - 2]["mgr"] == r["mgr"]:
                ids.append(ids[i - 2])
            else:
                ids.append(max(ids, default=0) + 1)
            spell_of[(club, r["run"])] = ids[-1]
    d = d.copy()
    ids_ = [spell_of[x] for x in zip(k.club_id, run, strict=True)]
    d["spell"] = pd.Series(ids_, index=k.index).reindex(d.index)
    return d


def spells(d: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    d = d[d.manager_key.notna()].copy()
    d["res"] = d.pts - d.xpts
    g = d.groupby(["club_id", "spell"])
    s = g.agg(manager_key=("manager_key", "first"), manager=("manager", "first"),
              manager_slug=("manager_slug", "first"), team=("team", "last"),
              competition_id=("competition_id", "last"), start_date=("match_date", "min"),
              end_date=("match_date", "max"), n=("match_id", "size"),
              w=("pts", lambda x: int((x == 3).sum())), d=("pts", lambda x: int((x == 1).sum())),
              l=("pts", lambda x: int((x == 0).sum())), ppg=("pts", "mean"),
              n_odds=("xpts", "count"), xppg=("xpts", "mean"), over_pm=("res", "mean"),
              res_sd=("res", "std"), back3=("family", lambda x: (x == "Back three").mean()
                                             if x.notna().any() else np.nan),
              top_formation=("formation", lambda x: x.value_counts().index[0]
                             if x.notna().any() else None)).reset_index()  # fmt: skip
    s["se"] = s.res_sd.fillna(1.2).clip(lower=0.5) / np.sqrt(s.n_odds.clip(lower=1))
    s.loc[s.n_odds == 0, ["xppg", "over_pm", "se"]] = np.nan
    s = s.drop(columns="res_sd")
    f = (d.dropna(subset=["formation"]).groupby(["manager_key", "club_id", "spell", "formation"])
         .agg(n=("match_id", "size"), ppg=("pts", "mean"), over_pm=("res", "mean"))
         .reset_index())  # fmt: skip
    return s, f


def shape_study(d: pd.DataFrame, s: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Back-three share at a manager's new club against (a) the manager's share at the previous club
    and (b) the new club's share under its previous manager. Both windows from the same
    provider era, at least 15 matches each, first 38 matches of the new spell."""
    d = d[d.formation.notna() & d.manager_key.notna()].copy()
    d["b3"] = (d.family == "Back three").astype(float)
    d["era"] = d.season >= FM_ERA
    rows = []
    sp = s[s.n >= 15].sort_values("start_date")
    for key, g in sp.groupby("manager_key"):
        g = g.reset_index(drop=True)
        for i in range(1, len(g)):
            prev, new = g.iloc[i - 1], g.iloc[i]
            if prev.club_id == new.club_id:
                continue
            a = d[(d.club_id == prev.club_id) & (d.spell == prev.spell)]
            b = d[(d.club_id == new.club_id) & (d.spell == new.spell)].head(38)
            c = d[(d.club_id == new.club_id) & (d.match_date < new.start_date)
                  & (d.manager_key != key)].tail(38)  # fmt: skip
            if min(len(a), len(b), len(c)) < 15:
                continue
            if a.era.iloc[-1] != b.era.iloc[0] or c.era.iloc[-1] != b.era.iloc[0]:
                continue
            mode = lambda x: x.formation.value_counts().index[0]  # noqa: E731
            rows.append({
                "manager_key": key, "manager": new.manager, "manager_slug": new.manager_slug,
                "from_club": prev.club_id, "from_team": prev.team, "to_club": new.club_id,
                "to_team": new.team, "start_date": new.start_date, "season": b.season.iloc[0],
                "mgr_prev_b3": a.b3.mean(), "club_prev_b3": c.b3.mean(), "new_b3": b.b3.mean(),
                "mgr_prev_mode": mode(a), "club_prev_mode": mode(c), "new_mode": mode(b),
                "n_prev": len(a), "n_club": len(c), "n_new": len(b),
            })  # fmt: skip
    mv = pd.DataFrame(rows)
    if len(mv) < 20:
        return pd.DataFrame(), mv
    mv["informative"] = (mv.mgr_prev_b3 > 0.5) != (mv.club_prev_b3 > 0.5)
    X = np.column_stack([np.ones(len(mv)), mv.mgr_prev_b3, mv.club_prev_b3])
    y = mv.new_b3.to_numpy()
    b = np.linalg.lstsq(X, y, rcond=None)[0]
    rng = np.random.default_rng(7)
    boot = []
    for _ in range(2000):
        ix = rng.integers(0, len(mv), len(mv))
        boot.append(np.linalg.lstsq(X[ix], y[ix], rcond=None)[0])
    boot = np.array(boot)
    inf = mv[mv.informative]
    follows_mgr = ((inf.new_b3 > 0.5) == (inf.mgr_prev_b3 > 0.5)).mean() if len(inf) else np.nan
    # base rate: how often two unrelated spells of the same era share a modal formation
    same_mode_mgr = (mv.new_mode == mv.mgr_prev_mode).mean()
    same_mode_club = (mv.new_mode == mv.club_prev_mode).mean()
    perm = []
    for _ in range(2000):
        perm.append((mv.new_mode.to_numpy() == rng.permutation(mv.mgr_prev_mode.to_numpy())).mean())
    res = pd.DataFrame([{
        "moves": len(mv), "informative_moves": len(inf),
        "b_manager": b[1], "b_manager_lo": np.quantile(boot[:, 1], 0.025),
        "b_manager_hi": np.quantile(boot[:, 1], 0.975),
        "b_club": b[2], "b_club_lo": np.quantile(boot[:, 2], 0.025),
        "b_club_hi": np.quantile(boot[:, 2], 0.975), "intercept": b[0],
        "follows_manager_share": follows_mgr, "same_mode_manager": same_mode_mgr,
        "same_mode_club": same_mode_club, "same_mode_chance": float(np.mean(perm)),
        "same_mode_chance_hi": float(np.quantile(perm, 0.975)),
    }])  # fmt: skip
    return res, mv


def trends(d: pd.DataFrame) -> pd.DataFrame:
    d = d[d.formation.notna()]
    tot = d.groupby(["competition_id", "season"]).size().rename("total")
    f = d.groupby(["competition_id", "season", "formation"]).size().rename("n").reset_index()
    f["kind"] = "formation"
    fam = d.groupby(["competition_id", "season", "family"]).size().rename("n").reset_index()
    fam = fam.rename(columns={"family": "formation"})
    fam["kind"] = "family"
    out = pd.concat([f, fam]).merge(tot.reset_index(), on=["competition_id", "season"])
    out["share"] = out.n / out.total
    out["source"] = np.where(out.season >= FM_ERA, "fotmob", "transfermarkt")
    return out


def matchups(d: pd.DataFrame, top: int = 8, perms: int = 500) -> tuple[pd.DataFrame, pd.DataFrame]:
    d = d[d.formation.notna() & d.opp_formation.notna() & d.xpts.notna()].copy()
    common = d.formation.value_counts().index[:top]
    d = d[d.formation.isin(common) & d.opp_formation.isin(common)]
    d["res"] = d.pts - d.xpts
    cells = (d.groupby(["formation", "opp_formation"])
             .agg(n=("res", "size"), res=("res", "mean"), sd=("res", "std"), ppg=("pts", "mean"),
                  xppg=("xpts", "mean")).reset_index())  # fmt: skip
    cells["se"] = cells.sd / np.sqrt(cells.n)
    cells = cells.drop(columns="sd")
    # joint test on one row per match (home view): does the pairing explain residuals?
    h = d[d.home].copy()
    code = pd.factorize(h.formation + "|" + h.opp_formation)[0]
    k = code.max() + 1
    grp = pd.factorize(h.competition_id + "|" + h.season.astype(str))[0]
    r = h.res.to_numpy()

    def stat(v):
        s, n = np.bincount(code, v, k), np.bincount(code, minlength=k)
        ok = n >= 50
        return float((s[ok] ** 2 / n[ok]).sum() / r.var())

    obs = stat(r - r.mean())
    rng = np.random.default_rng(11)
    order = np.argsort(grp, kind="stable")
    null = []
    for _ in range(perms):  # shuffle residuals within league-season
        v = np.empty_like(r)
        v[order] = r[np.lexsort((rng.random(len(r)), grp))]
        null.append(stat(v - v.mean()))
    test = pd.DataFrame([{"matches": len(h), "cells": int((np.bincount(code) >= 50).sum()),
                          "stat": obs, "null_mean": float(np.mean(null)),
                          "null_hi": float(np.quantile(null, 0.95)),
                          "p": float((np.sum(np.array(null) >= obs) + 1) / (perms + 1)),
                          "formations": ", ".join(common)}])  # fmt: skip
    return cells, test


# ---------------------------------------------------------------- FotMob style profiles


def style_frame(con) -> pd.DataFrame:
    keys = ", ".join(f"'{k}'" for k in KEYS)
    t = con.execute(f"""
        select x.match_id, s.key, try_cast(s.home as double) home, try_cast(s.away as double) away
        from stg.fm_team_stats s join core.fm_matches_xw x using (fm_match_id)
        where x.match_id is not null and s.key in ({keys})""").df()
    wh = t.pivot_table(index="match_id", columns="key", values="home", aggfunc="max")
    wa = t.pivot_table(index="match_id", columns="key", values="away", aggfunc="max")
    sh = con.execute("""
        select x.match_id, s.team_fm_id = m.home_fm_id is_home,
               sum(s.xg) filter (where s.situation = 'FastBreak') fb,
               sum(s.xg) filter (where s.situation in ('RegularPlay', 'FastBreak',
                                                        'IndividualPlay')) op
        from stg.fm_shots s join stg.fm_matches m using (fm_match_id)
        join core.fm_matches_xw x using (fm_match_id)
        where not s.own_goal and s.period <> 'PenaltyShootout' and x.match_id is not null
        group by all""").df()  # fmt: skip
    m = con.execute("""
        select t.match_id, t.competition_id, t.season, t.match_date, t.home_club, t.away_club
        from core.team_matches t where t.played""").df()
    m = m[m.match_id.isin(wh.index)]
    rows = []
    for home in (True, False):
        own, opp = (wh, wa) if home else (wa, wh)
        g = lambda w, k: m.match_id.map(w[k]).to_numpy() if k in w.columns else np.nan  # noqa: E731
        d = pd.DataFrame(
            {
                "match_id": m.match_id.to_numpy(),
                "competition_id": m.competition_id.to_numpy(),
                "season": m.season.to_numpy(),
                "match_date": m.match_date.to_numpy(),
                "club_id": (m.home_club if home else m.away_club).to_numpy(),
            }
        )
        with np.errstate(divide="ignore", invalid="ignore"):
            d["possession"] = g(own, "ballpossesion")
            d["passes"] = g(own, "passes")
            d["long_share"] = 100 * g(own, "long_balls_accurate") / g(own, "accurate_passes")
            oh, ow = g(own, "opposition_half_passes"), g(own, "own_half_passes")
            d["territory"] = 100 * oh / (oh + ow)
            defa = g(own, "interceptions") + g(own, "matchstats_headers_tackles") + g(own, "fouls")
            d["press"] = g(opp, "own_half_passes") / defa
            d["crosses"] = g(own, "accurate_crosses")
            d["dribbles"] = g(own, "dribbles_succeeded")
            d["aerials"] = g(own, "aerials_won")
            d["long_shots"] = 100 * g(own, "shots_outside_box") / g(own, "total_shots")
            d["fouls"] = g(own, "fouls")
            d["op_xg_for"], d["op_xg_against"] = (
                g(own, "expected_goals_open_play"),
                g(opp, "expected_goals_open_play"),
            )
            d["sp_xg_for"], d["sp_xg_against"] = (
                g(own, "expected_goals_set_play"),
                g(opp, "expected_goals_set_play"),
            )
            d["box_for"], d["box_against"] = g(own, "touches_opp_box"), g(opp, "touches_opp_box")
            d["big_for"], d["big_against"] = g(own, "big_chance"), g(opp, "big_chance")
            d["xg_shot_for"] = g(own, "expected_goals") / g(own, "total_shots")
            d["xg_shot_against"] = g(opp, "expected_goals") / g(opp, "total_shots")
        s = sh[sh.is_home == home].set_index("match_id")
        fb, op = d.match_id.map(s.fb).fillna(0), d.match_id.map(s.op)
        d["counter_share"] = np.where(op > 0.05, 100 * fb / op, np.nan)
        rows.append(d)
    d = pd.concat(rows, ignore_index=True).replace([np.inf, -np.inf], np.nan)
    return d.sort_values(["club_id", "match_date"]).reset_index(drop=True)


def reliability(d: pd.DataFrame) -> pd.DataFrame:
    d = d.copy()
    d["i"] = d.groupby(["competition_id", "season", "club_id"]).cumcount()
    size = d.groupby(["competition_id", "season", "club_id"]).size()
    out = []
    for k, (label, kind, good, hi, lo, unit) in TRAITS.items():
        g = d.groupby(["competition_id", "season", "club_id", d.i % 2])[k].mean().unstack()
        g = g[size.reindex(g.index) >= MIN_SPLIT].dropna()
        g = g - g.groupby(level=[0, 1]).transform("mean")
        r = float(g[0].corr(g[1]))
        rel = 2 * r / (1 + r) if r > 0 else 0.0
        nbar = float(size.reindex(g.index).mean())
        r1 = rel / (nbar - (nbar - 1) * rel) if rel > 0 else 0.0  # one match's reliability
        n70 = 0.7 * (1 - r1) / (r1 * 0.3) if r1 > 0 else np.inf
        out.append({"trait": k, "label": label, "kind": kind,
                    "higher_better": None if good is None else bool(good), "high": hi, "low": lo,
                    "unit": unit, "split_half_r": r, "season_rel": rel, "per_match_rel": r1,
                    "matches_for_07": n70, "team_seasons": len(g),
                    "avg_matches": nbar})  # fmt: skip
    return pd.DataFrame(out)


def team_style(d: pd.DataFrame, rel: pd.DataFrame) -> pd.DataFrame:
    """Long table: one row per team-season-trait with value, league percentile, z-score, the
    reliability at the team's number of matches and the z shrunk by it."""
    traits = list(TRAITS)
    ts = d.groupby(["competition_id", "season", "club_id"])[traits].mean()
    n = d.groupby(["competition_id", "season", "club_id"]).size().rename("n")
    long = ts.reset_index().melt(id_vars=["competition_id", "season", "club_id"], var_name="trait")
    long = long.merge(n.reset_index(), on=["competition_id", "season", "club_id"])
    grp = long.groupby(["competition_id", "season", "trait"]).value
    long["league_mean"] = grp.transform("mean")
    long["z"] = (long.value - long.league_mean) / grp.transform("std")
    long["pct"] = 100 * grp.rank(pct=True, method="average")
    long = long.merge(rel[["trait", "per_match_rel"]], on="trait")
    r1 = long.per_match_rel
    long["rel"] = long.n * r1 / (1 + (long.n - 1) * r1)
    long["z_shrunk"] = long.z * long.rel
    # pressing: fewer opponent passes per action = harder press, so flip the sign of the
    # z-scores and percentiles so "high" means presses hard
    p = long.trait == "press"
    long.loc[p, ["z", "z_shrunk"]] *= -1
    long.loc[p, "pct"] = 100 - long.loc[p, "pct"] + 100 / grp.transform("count")[p]
    return long.drop(columns="per_match_rel")


def gamestate(con) -> pd.DataFrame:
    """xG per 90 by game state and by 15-minute block, per team-season, on matches whose
    goals the shot list reproduces exactly."""
    s = con.execute("""
        select x.match_id, m.competition_id, m.season, m.home_fm_id,
               s.team_fm_id = m.home_fm_id is_home,
               s.minute, coalesce(s.minute_added, 0) added, s.period, s.xg, s.goal, s.own_goal,
               m.home_goals hg, m.away_goals ag
        from stg.fm_shots s join stg.fm_matches m using (fm_match_id)
        join core.fm_matches_xw x using (fm_match_id)
        where x.match_id is not null and m.finished
          and s.period in ('FirstHalf', 'SecondHalf')""").df()  # fmt: skip
    clubs = con.execute("select match_id, home_club, away_club from core.team_matches").df()
    s = s.merge(clubs, on="match_id")
    s["half"] = (s.period == "SecondHalf").astype(int)
    s = s.sort_values(["match_id", "half", "minute", "added"]).reset_index(drop=True)
    # clock on 0-90: stoppage events sit at 45 or 90
    s["t"] = np.where(s.half == 0, s.minute.clip(upper=45), s.minute.clip(lower=45, upper=90))
    s["scorer_home"] = np.where(s.goal, s.is_home != s.own_goal, np.nan)
    hg = s.goal & (s.scorer_home == 1)
    ag = s.goal & (s.scorer_home == 0)
    s["h_after"] = hg.astype(int).groupby(s.match_id).cumsum()
    s["a_after"] = ag.astype(int).groupby(s.match_id).cumsum()
    chk = s.groupby("match_id").agg(h=("h_after", "max"), a=("a_after", "max"), hg=("hg", "first"),
                                    ag=("ag", "first"))  # fmt: skip
    ok = chk.index[(chk.h == chk.hg) & (chk.a == chk.ag)]
    s = s[s.match_id.isin(ok)]
    # the state a shot is taken in is the score before it
    s["h_before"] = s.h_after - hg.astype(int).reindex(s.index)
    s["a_before"] = s.a_after - ag.astype(int).reindex(s.index)
    # minutes in each state, from goal times on the 0-90 clock, scaled to a 97-minute match
    gl = s[s.goal].copy()
    rows = []
    meta = s.groupby("match_id").first()
    by = {k: v for k, v in gl.groupby("match_id")}
    empty = gl.iloc[:0]
    for mid in meta.index:
        gs = by.get(mid, empty)
        t0, h, a = 0.0, 0, 0
        for r in gs.itertuples():
            rows.append((mid, t0, r.t, h - a))
            t0 = r.t
            h, a = r.h_after, r.a_after
        rows.append((mid, t0, 90.0, h - a))
    seg = pd.DataFrame(rows, columns=["match_id", "t0", "t1", "diff"])
    seg["min"] = (seg.t1 - seg.t0) * MATCH_MIN / 90
    # a random half of the matches for the split-half check (same half for both teams)
    par = pd.Series(pd.util.hash_array(meta.index.to_numpy().astype(str)) % 2, index=meta.index)
    K = ["competition_id", "season", "club_id", "par", "state"]
    out = []
    for home in (True, False):
        g = seg.merge(meta[["competition_id", "season", "home_club", "away_club"]],
                      left_on="match_id",
                      right_index=True)  # fmt: skip
        g["club_id"] = g.home_club if home else g.away_club
        g["par"] = g.match_id.map(par)
        sign = 1 if home else -1
        g["state"] = np.select(
            [g["diff"] * sign > 0, g["diff"] * sign < 0], ["ahead", "behind"], "level"
        )
        mins = g.groupby(K)["min"].sum()
        x = s.copy()
        x["club_id"] = x.home_club if home else x.away_club
        x["par"] = x.match_id.map(par)
        x["d"] = (x.h_before - x.a_before) * sign
        x["state"] = np.select([x.d > 0, x.d < 0], ["ahead", "behind"], "level")
        x["mine"] = x.is_home == home
        xf = x[x.mine & ~x.own_goal].groupby(K).xg.sum()
        xa = x[~x.mine & ~x.own_goal].groupby(K).xg.sum()
        o = pd.concat(
            [mins.rename("minutes"), xf.rename("xg_for"), xa.rename("xg_against")], axis=1
        )
        out.append(o.fillna(0).reset_index())
        # 15-minute blocks; stoppage time counts in the block it ends, so the comparison that
        # means something is against the league in the same block, not between blocks
        x["state"] = "block" + np.minimum((x.t // 15).astype(int), 5).astype(str)
        bf = x[x.mine & ~x.own_goal].groupby(K).xg.sum()
        ba = x[~x.mine & ~x.own_goal].groupby(K).xg.sum()
        nm = x.groupby(K[:-1]).match_id.nunique()
        b = (
            pd.concat([bf.rename("xg_for"), ba.rename("xg_against")], axis=1)
            .fillna(0)
            .reset_index()
        )
        b = b.merge(nm.rename("matches").reset_index(), on=K[:-1])
        b["minutes"] = b.matches * 15.0
        out.append(b.drop(columns=["matches"]))
    o = pd.concat(out).groupby(K).sum().reset_index()
    return o


def gamestate_tables(o: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Per team-season rates (shrunk toward the league-season) and the split-half
    reliability of each tendency: a team's rate in a state minus its rate when level (or
    its share of xG in a block), league mean removed."""
    K = ["competition_id", "season", "club_id", "state"]
    t = o.groupby(K)[["minutes", "xg_for", "xg_against"]].sum().reset_index()
    lg = t.groupby(["competition_id", "season", "state"])[["minutes", "xg_for", "xg_against"]].sum()
    lg["lg_rate"] = 90 * (lg.xg_for + lg.xg_against) / 2 / lg.minutes
    t = t.merge(lg.lg_rate.reset_index(), on=["competition_id", "season", "state"])
    k = STATE_PRIOR_MIN
    t["for_p90"] = 90 * (t.xg_for + t.lg_rate * k / 90) / (t.minutes + k)
    t["against_p90"] = 90 * (t.xg_against + t.lg_rate * k / 90) / (t.minutes + k)
    t["raw_for_p90"] = 90 * t.xg_for / t.minutes.where(t.minutes > 0)
    t["raw_against_p90"] = 90 * t.xg_against / t.minutes.where(t.minutes > 0)

    def tendencies(df: pd.DataFrame, keys: list[str]) -> pd.DataFrame:
        w = df.pivot_table(index=keys, columns="state", values=["xg_for", "xg_against", "minutes"],
                           aggfunc="sum").fillna(0)  # fmt: skip
        r = lambda c, st: 90 * w[(c, st)] / w[("minutes", st)].where(w[("minutes", st)] >= 90)  # noqa: E731
        tot_f = sum(w[("xg_for", f"block{i}")] for i in range(6))
        tot_a = sum(w[("xg_against", f"block{i}")] for i in range(6))
        return pd.DataFrame({
            "ahead_for": r("xg_for", "ahead") - r("xg_for", "level"),
            "ahead_against": r("xg_against", "ahead") - r("xg_against", "level"),
            "behind_for": r("xg_for", "behind") - r("xg_for", "level"),
            "behind_against": r("xg_against", "behind") - r("xg_against", "level"),
            "late_for": 100 * w[("xg_for", "block5")] / tot_f,
            "late_against": 100 * w[("xg_against", "block5")] / tot_a,
            "early_for": 100 * w[("xg_for", "block0")] / tot_f,
            "early_against": 100 * w[("xg_against", "block0")] / tot_a,
        })  # fmt: skip

    h = tendencies(o, ["competition_id", "season", "club_id", "par"])
    rel = []
    for c in h.columns:
        g = h[c].unstack("par").dropna()
        g = g - g.groupby(level=[0, 1]).transform("mean")
        rr = float(g[0].corr(g[1]))
        rel.append({"tendency": c, "split_half_r": rr,
                    "season_rel": 2 * rr / (1 + rr) if rr > 0 else 0.0,
                    "team_seasons": len(g)})  # fmt: skip
    return t, pd.DataFrame(rel)


def spell_style(style: pd.DataFrame, shape: pd.DataFrame) -> pd.DataFrame:
    """Each FotMob-era spell's style: mean of the trait over the spell's matches, as a z-score
    against the league-season spread of team-season means."""
    sp = shape[["match_id", "club_id", "manager_key", "spell"]].dropna()
    d = style.merge(sp[["match_id", "club_id", "manager_key", "spell"]], on=["match_id", "club_id"])
    traits = [
        "possession",
        "long_share",
        "territory",
        "press",
        "crosses",
        "counter_share",
        "op_xg_for",
        "op_xg_against",
    ]
    ts = style.groupby(["competition_id", "season", "club_id"])[traits].mean()
    ls = ["competition_id", "season"]
    mu = ts.groupby(level=[0, 1]).mean().add_suffix("_mu").reset_index()
    sd = ts.groupby(level=[0, 1]).std().add_suffix("_sd").reset_index()
    d = d.merge(mu, on=ls).merge(sd, on=ls)
    for t in traits:
        d[t] = (d[t] - d[f"{t}_mu"]) / d[f"{t}_sd"] * (-1 if t == "press" else 1)
    g = d.groupby(["manager_key", "club_id", "spell"])
    out = g[traits].mean().join(g.size().rename("n")).reset_index()
    return out[out.n >= 8]


STUDY_TRAITS = [
    "possession",
    "long_share",
    "territory",
    "press",
    "crosses",
    "op_xg_for",
    "op_xg_against",
]


def style_study(ss: pd.DataFrame, s: pd.DataFrame) -> pd.DataFrame:
    """FotMob era: a manager's new club's style (league z-score) regressed on the manager's previous
    club's style under that manager and the new club's style under its previous manager."""
    sp = ss.merge(s[["club_id", "spell", "start_date"]], on=["club_id", "spell"])
    rows = []
    for key, g in sp.sort_values("start_date").groupby("manager_key"):
        g = g.reset_index(drop=True)
        for i in range(1, len(g)):
            prev, new = g.iloc[i - 1], g.iloc[i]
            if prev.club_id == new.club_id:
                continue
            before = sp[(sp.club_id == new.club_id) & (sp.start_date < new.start_date)
                        & (sp.manager_key != key)].sort_values("start_date")  # fmt: skip
            if not len(before):
                continue
            c = before.iloc[-1]
            for t in STUDY_TRAITS:
                rows.append({"trait": t, "mgr": prev[t], "club": c[t], "new": new[t]})
    d = pd.DataFrame(rows)
    out = []
    rng = np.random.default_rng(5)
    for t, g in d.groupby("trait"):
        g = g.dropna()
        if len(g) < 15:
            continue
        X = np.column_stack([np.ones(len(g)), g.mgr, g.club])
        y = g.new.to_numpy()
        b = np.linalg.lstsq(X, y, rcond=None)[0]
        boot = np.array([np.linalg.lstsq(X[ix], y[ix], rcond=None)[0]
                         for ix in (rng.integers(0, len(g), len(g))
                                    for _ in range(2000))])  # fmt: skip
        out.append({"trait": t, "label": TRAITS[t][0], "moves": len(g),
                    "b_manager": b[1], "b_manager_lo": np.quantile(boot[:, 1], 0.025),
                    "b_manager_hi": np.quantile(boot[:, 1], 0.975), "b_club": b[2],
                    "b_club_lo": np.quantile(boot[:, 2], 0.025),
                    "b_club_hi": np.quantile(boot[:, 2], 0.975)})  # fmt: skip
    return pd.DataFrame(out)


def build(con, paths: Paths) -> dict[str, int]:
    shape = number_spells(shape_frame(con))
    s, f = spells(shape)
    study, moves = shape_study(shape, s)
    cells, test = matchups(shape)
    out: dict[str, pd.DataFrame] = {
        "team_shape": shape.drop(columns=["manager_raw"]),
        "manager_spells": s,
        "manager_formations": f,
        "manager_shape": study,
        "manager_shape_moves": moves,
        "formation_trends": trends(shape),
        "formation_matchups": cells,
        "formation_matchup_test": test,
    }
    if has_table(con, "core", "fm_matches_xw"):
        style = style_frame(con)
        rel = reliability(style)
        out["style_reliability"] = rel
        out["team_style_fm"] = team_style(style, rel)
        out["team_gamestate"], out["gamestate_reliability"] = gamestate_tables(gamestate(con))
        out["spell_style"] = spell_style(style, shape)
        out["manager_style_study"] = style_study(out["spell_style"], s)
    n = {}
    for name, df in out.items():
        if df is None or not len(df):
            n[name] = 0
            continue
        con.register("tmp_df", df)
        n[name] = materialize(con, paths, "research", name, "select * from tmp_df")
        con.unregister("tmp_df")
    return n
