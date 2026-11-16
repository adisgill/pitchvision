"""Hidden matchup factors (spec 12.2): what moves results that ratings and the market miss?

For every domestic league match with a Transfermarkt record, a walk-forward model forecast
and closing odds (2017-18 onward), we compute ~25 factors from information available before
kickoff (or at line-up time, flagged), across schedule and fatigue, squad selection,
coaching, luck and regression, officials and venue, tactics, motivation and the market.

Each factor is tested against two residuals of the home-minus-away points margin:

* **vs our model**: margin - 3 (p_home - p_away), with p from the chosen Dixon-Coles blend;
* **vs the closing line**: margin - 3 (q_home - q_away), with q the de-vigged closing odds.

A factor that moves results beyond our model but not beyond the market is *priced in*: real,
known to bettors, missing from a ratings-only model. A factor that moves results beyond the
closing line is a candidate *edge*: it has to clear a Benjamini-Hochberg false-discovery
threshold on the discovery seasons (2017-18 -> 2021-22) and then replicate, same sign, on
the holdout seasons (2022-23 onward). Everything else is reported as noise, with its
interval: "this doesn't matter" is a result.

Effects are in points of home-minus-away margin per standard deviation of the factor (per
unit for 0/1 factors), by OLS with heteroskedasticity-robust (HC1) standard errors. We also
report how far the market line itself moves with the factor beyond our model, which shows
*how much* of a priced-in factor bettors already account for.
"""

from __future__ import annotations

import math
from collections import defaultdict, deque

import numpy as np
import pandas as pd
from scipy import stats

from pitchvision.config import Paths
from pitchvision.db import materialize
from pitchvision.forecast.walkforward import blend_probs

LEAGUES = ("GB1", "ES1", "L1", "IT1", "FR1", "NL1", "PO1")
DISCOVERY = (2017, 2021)
HOLDOUT_FROM = 2022
COVID = (pd.Timestamp("2020-03-10"), pd.Timestamp("2021-06-30"))
FDR_Q = 0.10

# name -> (label, group, known at, kind, description)
FACTORS: dict[str, tuple[str, str, str, str, str]] = {
    "rest_diff": ("Rest days", "Schedule & fatigue", "pre-match", "diff",
                  "Days since each side's previous competitive match (any competition), "
                  "capped 2-10; home minus away."),
    "congestion_diff": ("Matches in the last 14 days", "Schedule & fatigue", "pre-match",
                        "diff", "Competitive matches in the previous 14 days; home minus "
                        "away."),
    "euro_prev_diff": ("European match in the last 4 days", "Schedule & fatigue",
                       "pre-match", "diff", "Played a UEFA match in the previous 4 days "
                       "(1/0); home minus away."),
    "euro_next_diff": ("European match in the next 4 days", "Schedule & fatigue",
                       "pre-match", "diff", "Has a UEFA match within the next 4 days, so "
                       "an incentive to rotate (1/0); home minus away."),
    "rotation_diff": ("Starting XI changes", "Selection & squad", "line-ups", "diff",
                      "Starters changed from the previous league match; home minus away."),
    "missing_regulars_diff": ("Regulars not starting", "Selection & squad", "line-ups",
                              "diff", "Of the 11 players with most league minutes over the "
                              "previous 10 matches, how many don't start; home minus away."),
    "red_prev_diff": ("Red card in the previous match", "Selection & squad", "pre-match",
                      "diff", "Had a player sent off in its previous league match, so "
                      "likely a suspension (1/0); home minus away."),
    "new_manager_diff": ("New-manager bounce", "Coaching", "pre-match", "diff",
                         "Manager in his first 4 matches in charge (1/0); home minus away."),
    "tenure_diff": ("Manager tenure", "Coaching", "pre-match", "diff",
                    "Log matches the manager has been in charge; home minus away."),
    "finish_luck_diff": ("Recent finishing luck", "Luck & regression", "pre-match", "diff",
                         "Goals minus shot-based expected goals over the previous 10 league "
                         "matches; home minus away. Positive = has been scoring above its "
                         "chances."),
    "keeper_luck_diff": ("Recent conceding luck", "Luck & regression", "pre-match", "diff",
                         "Expected goals against minus goals conceded over the previous 10 "
                         "league matches; home minus away. Positive = has conceded fewer "
                         "than its chances."),
    "vs_market_form_diff": ("Results vs expectations (last 10)", "Luck & regression",
                            "pre-match", "diff", "Points minus the closing line's expected "
                            "points over the previous 10 league matches; home minus away. "
                            "Tests whether bettors over-react to recent results."),
    "form5_diff": ("Points in the last 5", "Luck & regression", "pre-match", "diff",
                   "Raw form: points from the previous 5 league matches; home minus away."),
    "shot_dominance_diff": ("Recent shot dominance", "Tactics & style", "pre-match", "diff",
                            "Share of shots over the previous 10 league matches; home minus "
                            "away."),
    "corner_dominance_diff": ("Recent corner dominance", "Tactics & style", "pre-match",
                              "diff", "Share of corners over the previous 10 league "
                              "matches; home minus away (set-piece pressure)."),
    "aggression_x_ref": ("Aggression x strict referee", "Officials & venue", "pre-match",
                         "diff", "Fouls per match over the previous 10 (home minus away) "
                         "times the referee's prior cards per match (standardised): do "
                         "physical teams pay against strict referees?"),
    "back3_diff": ("Back three", "Tactics & style", "line-ups", "diff",
                   "Starts with three centre-backs (1/0); home minus away."),
    "same_shape": ("Mirrored formations", "Tactics & style", "line-ups", "match",
                   "Both teams line up in the same formation (1/0): effect on the home "
                   "side."),
    "referee_home_lean": ("Referee's home lean", "Officials & venue", "pre-match", "match",
                          "The referee's prior home-minus-away points residual vs the "
                          "market, shrunk toward zero: effect on the home side."),
    "empty_stadium": ("Empty stadium", "Officials & venue", "pre-match", "match",
                      "Played behind closed doors (Covid window, attendance under 1,000): "
                      "effect on home advantage."),
    "home_fill": ("Home crowd fill", "Officials & venue", "pre-match", "match",
                  "Home side's average attendance over its previous 5 home matches as a "
                  "share of capacity: effect on home advantage."),
    "midweek": ("Midweek league match", "Schedule & fatigue", "pre-match", "match",
                "League match on a Tuesday, Wednesday or Thursday: effect on home "
                "advantage."),
    "early_kickoff": ("Early kickoff", "Schedule & fatigue", "pre-match", "match",
                      "Kick-off before 12:30 UK time: effect on home advantage."),
    "promoted_early_diff": ("Promoted side, first 10 matches", "Motivation", "pre-match",
                            "diff", "Newly promoted and within its first 10 league matches "
                            "(1/0); home minus away."),
    "dead_rubber_diff": ("Nothing to play for", "Motivation", "pre-match", "diff",
                         "In the last 8 rounds, can no longer reach 6th and can no longer "
                         "be caught by the relegation places (1/0); home minus away."),
    "line_move": ("Line movement", "Market", "kickoff", "match",
                  "Change in the market's home-win probability from opening to closing "
                  "odds. Information the market gathers that our model lacks; by "
                  "construction it can't beat the closing line."),
}  # fmt: skip


def _load(con) -> dict[str, pd.DataFrame]:
    q = lambda s: con.execute(s).df()  # noqa: E731
    return {
        "games": q("""select game_id, competition_id, competition_type, match_date::date d,
                             home_club_id h, away_club_id a, home_goals hg, away_goals ag,
                             home_manager hm, away_manager am, home_formation hf,
                             away_formation af, attendance, referee
                      from stg.tm_games where match_date is not null"""),
        "lineups": q("""select game_id, club_id, player_id from stg.tm_lineups
                        where starter"""),
        "apps": q("select game_id, club_id, player_id, minutes from stg.tm_appearances"),
        "clubs": q("select club_id, stadium_seats from stg.tm_clubs"),
        "tm": q(f"""select t.match_id, t.competition_id, t.season, t.match_date::date d,
                           t.kickoff_utc, t.home_goals, t.away_goals, t.home_shots,
                           t.away_shots, t.home_corners, t.away_corners, t.home_reds,
                           t.away_reds, t.proxy_home_xg, t.proxy_away_xg,
                           fd.home_fouls, fd.away_fouls, fd.home_yellows, fd.away_yellows,
                           fd.ps_open_home, fd.ps_open_draw, fd.ps_open_away,
                           fd.ps_close_home, fd.ps_close_draw, fd.ps_close_away,
                           fd.avg_open_home, fd.avg_open_draw, fd.avg_open_away,
                           fd.avg_close_home, fd.avg_close_draw, fd.avg_close_away
                    from core.team_matches t join stg.fd_matches fd using (fd_match_id)
                    where t.played and t.match_id like 'tm-%'
                      and t.competition_id in {LEAGUES}"""),
        "pred": q("select * from forecast.wf_predictions"),
        "chosen": q("select * from forecast.wf_chosen"),
    }


def _devig(o: np.ndarray) -> np.ndarray:
    p = 1 / o
    return p / p.sum(axis=1, keepdims=True)


def team_schedule(games: pd.DataFrame) -> pd.DataFrame:
    """Per (game, club): rest days, congestion, European matches before and after."""
    long = pd.concat([
        games[["game_id", "d", "competition_type", "h"]].rename(columns={"h": "club"}),
        games[["game_id", "d", "competition_type", "a"]].rename(columns={"a": "club"}),
    ]).dropna(subset=["club"])  # fmt: skip
    long["d"] = pd.to_datetime(long.d)
    long = long.sort_values(["club", "d", "game_id"]).reset_index(drop=True)
    long["euro"] = (long.competition_type == "international_cup").astype(int)
    g = long.groupby("club", sort=False)
    long["rest"] = (long.d - g.d.shift(1)).dt.days
    out = []
    for _, t in g:
        dd = t.d.to_numpy().astype("datetime64[D]").astype(int)
        eu = t.euro.to_numpy()
        lo14 = np.searchsorted(dd, dd - 14, side="left")
        idx = np.arange(len(dd))
        cong = idx - lo14
        lo4 = np.searchsorted(dd, dd - 4, side="left")
        hi4 = np.searchsorted(dd, dd + 4, side="right")
        ce = np.concatenate([[0], np.cumsum(eu)])
        prev_eu = (ce[idx] - ce[lo4]) > 0
        next_eu = (ce[hi4] - ce[idx + 1]) > 0
        out.append(pd.DataFrame({"game_id": t.game_id.to_numpy(), "club": t.club.to_numpy(),
                                 "rest": t.rest.to_numpy(), "congestion": cong,
                                 "euro_prev": prev_eu.astype(int),
                                 "euro_next": next_eu.astype(int)}))  # fmt: skip
    return pd.concat(out, ignore_index=True)


def managers(games: pd.DataFrame) -> pd.DataFrame:
    """Per (game, club): matches the current manager had been in charge before this one."""
    long = pd.concat([
        games[["game_id", "d", "h", "hm"]].set_axis(["game_id", "d", "club", "mgr"], axis=1),
        games[["game_id", "d", "a", "am"]].set_axis(["game_id", "d", "club", "mgr"], axis=1),
    ]).dropna(subset=["club"]).sort_values(["club", "d", "game_id"])  # fmt: skip
    rows = []
    for club, t in long.groupby("club", sort=False):
        prev, n = None, 0
        for gid, m in zip(t.game_id, t.mgr, strict=True):
            if m is None or (isinstance(m, float) and math.isnan(m)):
                rows.append((gid, club, np.nan))
                continue
            n = n + 1 if m == prev else 0
            rows.append((gid, club, n))
            prev = m
    return pd.DataFrame(rows, columns=["game_id", "club", "mgr_games"])


def selection(games: pd.DataFrame, lineups: pd.DataFrame, apps: pd.DataFrame) -> pd.DataFrame:
    """Per (league game, club): starters changed vs the previous league match; regulars
    (top 11 by minutes over the previous 10 league matches) not starting; back three."""
    lg = games[games.competition_type == "domestic_league"]
    starters = lineups.groupby(["game_id", "club_id"]).player_id.apply(frozenset)
    mins = apps.groupby(["game_id", "club_id"]).apply(
        lambda t: dict(zip(t.player_id, t.minutes, strict=True)), include_groups=False
    )
    long = pd.concat(
        [
            lg[["game_id", "d", "h"]].rename(columns={"h": "club"}),
            lg[["game_id", "d", "a"]].rename(columns={"a": "club"}),
        ]
    )
    long = long.dropna(subset=["club"]).sort_values(["club", "d", "game_id"])
    rows = []
    for club, t in long.groupby("club", sort=False):
        prev_xi = None
        window: deque = deque(maxlen=10)
        for gid in t.game_id:
            xi = starters.get((gid, club))
            full_xis = xi is not None and prev_xi is not None
            full_xis = full_xis and len(xi) == 11 and len(prev_xi) == 11
            rot = len(xi - prev_xi) if full_xis else np.nan
            miss = np.nan
            if xi is not None and len(window) >= 5:
                tot: dict = defaultdict(float)
                for mm in window:
                    for p, v in mm.items():
                        tot[p] += v
                regulars = sorted(tot, key=tot.get, reverse=True)[:11]
                miss = sum(p not in xi for p in regulars)
            rows.append((gid, club, rot, miss))
            if xi is not None:
                prev_xi = xi
            mm = mins.get((gid, club))
            if mm is not None:
                window.append(mm)
    return pd.DataFrame(rows, columns=["game_id", "club", "rotation", "missing_regulars"])


def _back3(f) -> float:
    if not isinstance(f, str) or not f[:1].isdigit():
        return np.nan
    return float(f.startswith(("3", "5")))


def _rolling_team(m: pd.DataFrame) -> pd.DataFrame:
    """Per (match, side) rolling pre-match form from the previous league matches."""
    h = pd.DataFrame({"match_id": m.match_id, "d": m.d, "club": m.home_club, "side": "h",
                      "gf": m.home_goals, "ga": m.away_goals, "xgf": m.proxy_home_xg,
                      "xga": m.proxy_away_xg, "sf": m.home_shots, "sa": m.away_shots,
                      "cf": m.home_corners, "ca": m.away_corners, "fouls": m.home_fouls,
                      "red": m.home_reds, "pts": np.select([m.home_goals > m.away_goals,
                      m.home_goals == m.away_goals], [3, 1], 0),
                      "xpts": 3 * m.q_h + m.q_d})  # fmt: skip
    a = pd.DataFrame({"match_id": m.match_id, "d": m.d, "club": m.away_club, "side": "a",
                      "gf": m.away_goals, "ga": m.home_goals, "xgf": m.proxy_away_xg,
                      "xga": m.proxy_home_xg, "sf": m.away_shots, "sa": m.home_shots,
                      "cf": m.away_corners, "ca": m.home_corners, "fouls": m.away_fouls,
                      "red": m.away_reds, "pts": np.select([m.away_goals > m.home_goals,
                      m.home_goals == m.away_goals], [3, 1], 0),
                      "xpts": 3 * m.q_a + m.q_d})  # fmt: skip
    t = pd.concat([h, a]).sort_values(["club", "d", "match_id"]).reset_index(drop=True)
    g = t.groupby("club", sort=False)

    def roll(col, n=10, minp=5):
        return g[col].transform(lambda s: s.shift(1).rolling(n, min_periods=minp).sum())

    t["finish_luck"] = roll("gf") - roll("xgf")
    t["keeper_luck"] = roll("xga") - roll("ga")
    t["vs_market_form"] = roll("pts") - roll("xpts")
    t["form5"] = g.pts.transform(lambda s: s.shift(1).rolling(5, min_periods=5).sum())
    t["shot_dominance"] = roll("sf") / (roll("sf") + roll("sa"))
    t["corner_dominance"] = roll("cf") / (roll("cf") + roll("ca"))
    t["fouls10"] = roll("fouls") / g.fouls.transform(
        lambda s: s.shift(1).rolling(10, min_periods=5).count()
    )
    t["red_prev"] = g.red.shift(1).clip(upper=1)
    return t


def _stakes(m: pd.DataFrame) -> pd.DataFrame:
    """Dead rubbers: in the last 8 rounds, a side that can neither reach 6th nor be caught
    by the relegation places (third-from-bottom as the line), from the table before the
    match (league points only, deductions ignored)."""
    rows = []
    for (_comp, _season), s in m.sort_values("d").groupby(["competition_id", "season"]):
        clubs = sorted(set(s.home_club) | set(s.away_club))
        n = len(clubs)
        total = 2 * (n - 1)
        pts = dict.fromkeys(clubs, 0)
        played = dict.fromkeys(clubs, 0)
        for d, day in s.groupby("d", sort=True):
            table = sorted(clubs, key=lambda c: -pts[c])
            sixth, rel = table[5], table[n - 3]
            for r in day.itertuples():
                for side, club in (("h", r.home_club), ("a", r.away_club)):
                    rem = total - played[club]
                    dead = np.nan
                    if rem <= 8:
                        cant_reach = pts[club] + 3 * rem < pts[sixth]
                        safe = pts[club] - pts[rel] > 3 * (total - played[rel])
                        dead = float(cant_reach and safe)
                    rows.append((r.match_id, side, dead))
            for r in day.itertuples():
                hp = 3 if r.home_goals > r.away_goals else 1 if r.home_goals == r.away_goals else 0
                ap = 3 if r.away_goals > r.home_goals else 1 if r.home_goals == r.away_goals else 0
                pts[r.home_club] += hp
                pts[r.away_club] += ap
                played[r.home_club] += 1
                played[r.away_club] += 1
            _ = d
    return pd.DataFrame(rows, columns=["match_id", "side", "dead"])


def factor_frame(con) -> pd.DataFrame:
    D = _load(con)
    games, tm, pred = D["games"], D["tm"], D["pred"]
    hl, w = int(D["chosen"].half_life[0]), float(D["chosen"].w_goals[0])
    pred = pred.assign(**dict(zip(["p_h", "p_d", "p_a"], blend_probs(pred, hl, w).T,
                                  strict=True)))  # fmt: skip
    m = tm.merge(pred[["match_id", "home_club", "away_club", "p_h", "p_d", "p_a", "mkt_h",
                       "mkt_d", "mkt_a"]], on="match_id")  # fmt: skip
    m = m.dropna(subset=["p_h", "mkt_h"]).copy()
    m["q_h"], m["q_d"], m["q_a"] = m.mkt_h, m.mkt_d, m.mkt_a
    m["d"] = pd.to_datetime(m.d)
    m["game_id"] = m.match_id.str[3:].astype(int)
    m["margin"] = (np.select([m.home_goals > m.away_goals, m.home_goals == m.away_goals],
                             [3, 1], 0) -
                   np.select([m.away_goals > m.home_goals, m.home_goals == m.away_goals],
                             [3, 1], 0))  # fmt: skip
    m["res_model"] = m.margin - 3 * (m.p_h - m.p_a)
    m["res_market"] = m.margin - 3 * (m.q_h - m.q_a)
    m["line_model"] = 3 * (m.p_h - m.p_a)
    m["line_market"] = 3 * (m.q_h - m.q_a)

    # schedule, managers, selection: per (game, TM club id)
    sched = team_schedule(games)
    mg = managers(games)
    sel = selection(games, D["lineups"], D["apps"])
    side = pd.DataFrame({"game_id": m.game_id,
                         "h": m.home_club.str[3:].astype(int),
                         "a": m.away_club.str[3:].astype(int)})  # fmt: skip
    for s in ("h", "a"):
        k = side[["game_id", s]].rename(columns={s: "club"})
        for t, cols in (
            (sched, ["rest", "congestion", "euro_prev", "euro_next"]),
            (mg, ["mgr_games"]),
            (sel, ["rotation", "missing_regulars"]),
        ):
            j = k.merge(t, on=["game_id", "club"], how="left")
            for c in cols:
                m[f"{c}_{s}"] = j[c].to_numpy()
    g = games.set_index("game_id")
    m["hf"] = m.game_id.map(g.hf)
    m["af"] = m.game_id.map(g.af)
    m["attendance"] = m.game_id.map(g.attendance)
    m["referee"] = m.game_id.map(g.referee)

    f = pd.DataFrame({"match_id": m.match_id, "season": m.season,
                      "competition_id": m.competition_id})  # fmt: skip
    f["rest_diff"] = m.rest_h.clip(2, 10) - m.rest_a.clip(2, 10)
    f["congestion_diff"] = m.congestion_h - m.congestion_a
    f["euro_prev_diff"] = m.euro_prev_h - m.euro_prev_a
    f["euro_next_diff"] = m.euro_next_h - m.euro_next_a
    f["rotation_diff"] = m.rotation_h - m.rotation_a
    f["missing_regulars_diff"] = m.missing_regulars_h - m.missing_regulars_a
    f["new_manager_diff"] = (m.mgr_games_h < 4).astype(float).where(m.mgr_games_h.notna()) - (
        m.mgr_games_a < 4
    ).astype(float).where(m.mgr_games_a.notna())
    f["tenure_diff"] = np.log1p(m.mgr_games_h) - np.log1p(m.mgr_games_a)
    b3h, b3a = m.hf.map(_back3), m.af.map(_back3)
    f["back3_diff"] = b3h - b3a
    f["same_shape"] = (m.hf == m.af).astype(float).where(m.hf.notna() & m.af.notna())
    f["empty_stadium"] = ((m.d >= COVID[0]) & (m.d <= COVID[1])
                          & (m.attendance.fillna(0) < 1000)).astype(float)  # fmt: skip
    hour = pd.to_datetime(m.kickoff_utc).dt.tz_localize("UTC").dt.tz_convert("Europe/London")
    f["early_kickoff"] = (
        (hour.dt.hour * 60 + hour.dt.minute < 12 * 60 + 30).astype(float).where(hour.notna())
    )
    f["midweek"] = m.d.dt.dayofweek.isin([1, 2, 3]).astype(float)
    po = _devig(
        m[["ps_open_home", "ps_open_draw", "ps_open_away"]]
        .fillna(
            m[["avg_open_home", "avg_open_draw", "avg_open_away"]].set_axis(
                ["ps_open_home", "ps_open_draw", "ps_open_away"], axis=1
            )
        )
        .to_numpy()
    )
    f["line_move"] = m.q_h.to_numpy() - po[:, 0]

    # rolling form, luck, style, reds
    t = _rolling_team(m)
    for col in (
        "finish_luck",
        "keeper_luck",
        "vs_market_form",
        "form5",
        "shot_dominance",
        "corner_dominance",
        "red_prev",
    ):
        piv = t.pivot_table(index="match_id", columns="side", values=col, aggfunc="first")
        f[f"{col}_diff"] = f.match_id.map(piv.h) - f.match_id.map(piv.a)
    fouls = t.pivot_table(index="match_id", columns="side", values="fouls10", aggfunc="first")
    fouls_diff = f.match_id.map(fouls.h) - f.match_id.map(fouls.a)

    # referee: prior cards per match and prior home lean vs the market (no look-ahead)
    r = pd.DataFrame(
        {
            "match_id": m.match_id,
            "d": m.d,
            "ref": m.referee,
            "cards": m.home_yellows + m.away_yellows,
            "res": m.res_market,
        }
    )
    r = r.sort_values(["d", "match_id"])
    gr = r.groupby("ref", sort=False)
    prior_n = gr.cumcount()
    prior_res = gr.res.cumsum() - r.res
    prior_cards = gr.cards.cumsum() - r.cards
    r["referee_home_lean"] = prior_res / (prior_n + 130)  # k from the referee reliability
    cards_pm = (prior_cards / prior_n).where(prior_n >= 10)
    r["strict"] = (cards_pm - cards_pm.mean()) / cards_pm.std()
    r = r.set_index("match_id")
    f["referee_home_lean"] = f.match_id.map(r.referee_home_lean).where(
        f.match_id.map(r.ref).notna()
    )
    f["aggression_x_ref"] = fouls_diff * f.match_id.map(r.strict)

    # home crowd fill (previous 5 home league matches, share of capacity)
    seats = D["clubs"].set_index("club_id").stadium_seats
    hm = pd.DataFrame(
        {
            "match_id": m.match_id,
            "d": m.d,
            "club": m.home_club,
            "fill": m.attendance / m.home_club.str[3:].astype(int).map(seats),
        }
    )
    hm = hm.sort_values(["club", "d"])
    hm["prev"] = hm.groupby("club").fill.transform(
        lambda s: s.shift(1).rolling(5, min_periods=3).mean()
    )
    f["home_fill"] = f.match_id.map(hm.set_index("match_id").prev).clip(0, 1.1)

    # promoted sides early in the season
    seen = m.groupby(["competition_id", "season"]).apply(
        lambda s: set(s.home_club) | set(s.away_club), include_groups=False
    )
    prom = {}
    for (comp, season), clubs in seen.items():
        prev = seen.get((comp, season - 1))
        for c in clubs:
            prom[(comp, season, c)] = float(prev is not None and c not in prev)
    cols = ["match_id", "competition_id", "season", "d", "club"]
    order = pd.concat([
        m[["match_id", "competition_id", "season", "d", "home_club"]].set_axis(cols, axis=1)
        .assign(s="h"),
        m[["match_id", "competition_id", "season", "d", "away_club"]].set_axis(cols, axis=1)
        .assign(s="a"),
    ])  # fmt: skip
    order = order.sort_values("d")
    order["k"] = order.groupby(["competition_id", "season", "club"]).cumcount()
    order["pe"] = [prom.get((c, s, cl), np.nan) * (k < 10)
                   for c, s, cl, k in zip(order.competition_id, order.season, order.club,
                                          order.k, strict=True)]  # fmt: skip
    pe = order.pivot_table(index="match_id", columns="s", values="pe", aggfunc="first")
    f["promoted_early_diff"] = f.match_id.map(pe.h) - f.match_id.map(pe.a)

    st = _stakes(m).pivot_table(index="match_id", columns="side", values="dead",
                                aggfunc="first")  # fmt: skip
    f["dead_rubber_diff"] = f.match_id.map(st.h) - f.match_id.map(st.a)

    for c in ("res_model", "res_market", "line_model", "line_market"):
        f[c] = m[c].to_numpy()
    return f


def _ols(y: np.ndarray, X: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """OLS coefficients and HC1 standard errors."""
    n, k = X.shape
    xtx_inv = np.linalg.pinv(X.T @ X)
    b = xtx_inv @ X.T @ y
    e = y - X @ b
    meat = (X * (e**2)[:, None]).T @ X
    v = xtx_inv @ meat @ xtx_inv * n / max(n - k, 1)
    return b, np.sqrt(np.diag(v))


def _effect(d: pd.DataFrame, fac: str, target: str, scale: float) -> dict:
    x = d[fac].to_numpy(float) / scale
    X = np.column_stack([np.ones(len(x)), x])
    b, se = _ols(d[target].to_numpy(float), X)
    t = b[1] / se[1] if se[1] > 0 else 0.0
    return {"b": b[1], "se": se[1], "p": 2 * stats.norm.sf(abs(t)), "n": len(x)}


def _market_shift(d: pd.DataFrame, fac: str, scale: float) -> dict:
    """How far the closing line moves with the factor beyond our model's line."""
    X = np.column_stack([np.ones(len(d)), d.line_model.to_numpy(float),
                         d[fac].to_numpy(float) / scale])  # fmt: skip
    b, se = _ols(d.line_market.to_numpy(float), X)
    return {"b": b[2], "se": se[2]}


def _bh(p: np.ndarray) -> np.ndarray:
    """Benjamini-Hochberg q-values."""
    n = len(p)
    order = np.argsort(p)
    q = np.empty(n)
    prev = 1.0
    for rank, i in enumerate(order[::-1]):
        k = n - rank
        prev = min(prev, p[i] * n / k)
        q[i] = prev
    return q


def analyse(f: pd.DataFrame, factors: dict | None = None, discovery: tuple = DISCOVERY,
            holdout_from: int = HOLDOUT_FROM) -> tuple[pd.DataFrame, pd.DataFrame]:  # fmt: skip
    factors = factors or FACTORS
    rows, bins = [], []
    for fac, (label, group, known, kind, desc) in factors.items():
        d = f.dropna(subset=[fac, "res_model", "res_market"])
        d = d[np.isfinite(d[fac])]
        if len(d) < 300 or d[fac].std() == 0:
            continue
        binary = set(np.unique(d[fac])) <= {-1.0, 0.0, 1.0}
        scale = 1.0 if binary else float(d[fac].std())
        disc = d[d.season.between(*discovery)]
        hold = d[d.season >= holdout_from]
        r = {"factor": fac, "label": label, "group": group, "known_at": known, "kind": kind,
             "description": desc, "unit": "per unit (0/1)" if binary else "per SD",
             "scale": scale, "n": len(d)}  # fmt: skip
        for nm, sub in (("all", d), ("disc", disc), ("hold", hold)):
            if len(sub) < 200 or sub[fac].std() == 0:  # e.g. no empty stadiums after 2021
                continue
            for tgt in ("model", "market"):
                e = _effect(sub, fac, f"res_{tgt}", scale)
                for k2, v in e.items():
                    r[f"{tgt}_{nm}_{k2}"] = v
        ms = _market_shift(d, fac, scale)
        r["market_shift"], r["market_shift_se"] = ms["b"], ms["se"]
        rows.append(r)
        # bins: deciles (or the distinct values of a small discrete factor)
        vals = np.unique(d[fac])
        if len(vals) <= 7:
            key = d[fac]
        else:
            key = pd.qcut(d[fac], 10, duplicates="drop").map(lambda iv: iv.mid).astype(float)
        for v, s in d.groupby(key, observed=True):
            if len(s) < 50:
                continue
            bins.append(
                {
                    "factor": fac,
                    "x": float(v),
                    "n": len(s),
                    "x_mean": float(s[fac].mean()),
                    "res_model": float(s.res_model.mean()),
                    "res_model_se": float(s.res_model.std() / np.sqrt(len(s))),
                    "res_market": float(s.res_market.mean()),
                    "res_market_se": float(s.res_market.std() / np.sqrt(len(s))),
                }
            )
    out = pd.DataFrame(rows)
    out["market_disc_q"] = _bh(out.market_disc_p.fillna(1).to_numpy())
    out["model_disc_q"] = _bh(out.model_disc_p.fillna(1).to_numpy())

    for c in ("market_hold_b", "market_hold_p", "model_hold_b", "model_hold_p"):
        if c not in out:
            out[c] = np.nan

    def verdict(r) -> str:
        if r.factor == "line_move":
            return "market information"
        same = lambda a, b: np.sign(a) == np.sign(b)  # noqa: E731
        if pd.isna(r.model_hold_p):  # nothing to replicate on
            if r.market_disc_q < FDR_Q:
                return "beats the market (no holdout data)"
            if r.model_disc_q < FDR_Q:
                return "real, no holdout data"
            return "no detectable effect"
        if (
            r.market_disc_q < FDR_Q
            and same(r.market_disc_b, r.market_hold_b)
            and r.market_hold_p < 0.10
        ):
            return "beats the market"
        if (
            r.model_disc_q < FDR_Q
            and same(r.model_disc_b, r.model_hold_b)
            and r.model_hold_p < 0.10
        ):
            return "priced in by the market" if r.market_all_p > 0.05 else "partly priced in"
        if r.model_all_p < 0.05 or r.market_all_p < 0.05:
            return "did not replicate"
        return "no detectable effect"

    out["verdict"] = out.apply(verdict, axis=1)
    return out, pd.DataFrame(bins)


def build(con, paths: Paths) -> dict[str, int]:
    f = factor_frame(con)
    res, bins = analyse(f)
    con.register("fac_df", res)
    con.register("bins_df", bins)
    con.register("frame_df", f)
    n = {
        "matchup_factors": materialize(
            con, paths, "research", "matchup_factors", "select * from fac_df"
        ),
        "matchup_factor_bins": materialize(
            con, paths, "research", "matchup_factor_bins", "select * from bins_df"
        ),
        "matchup_factor_frame": materialize(
            con, paths, "research", "matchup_factor_frame", "select * from frame_df"
        ),
    }
    for t in ("fac_df", "bins_df", "frame_df"):
        con.unregister(t)
    return n
