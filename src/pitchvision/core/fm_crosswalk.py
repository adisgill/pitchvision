"""Link FotMob to our canonical ids (spec 12.4).

* **Clubs:** per league-season, FotMob team names are matched one-to-one to the clubs in
  ``core.team_matches`` for that league-season (football-data and Transfermarkt names),
  by normalised-name similarity with an optimal assignment.
* **Matches:** a FotMob match maps to the ``core.team_matches`` row with the same league,
  home club and away club within two days.
* **Players:** within a club, FotMob names are matched to Transfermarkt players who were at
  that club (minutes in ``metrics.player_season`` for the previous seasons, or the club in
  ``stg.tm_players``), requiring a strong name match and a consistent age. Players
  Transfermarkt never saw (new signings after the July 2026 freeze) keep ``fm-<id>``.
"""

from __future__ import annotations

import re
import unicodedata

import numpy as np
import pandas as pd
from rapidfuzz import fuzz
from scipy.optimize import linear_sum_assignment

from pitchvision.config import Paths
from pitchvision.db import materialize

STOP = {"fc", "afc", "cf", "sc", "ac", "as", "ss", "us", "sv", "vfb", "vfl", "tsg", "fk", "cd",
        "ud", "rcd", "sd", "ca", "real", "club", "de", "the", "and", "1", "04", "05", "1899",
        "1846", "1909", "1910", "1913", "1907", "sl", "sporting", "calcio",
        "olympique"}  # fmt: skip
ALIAS = {"wolverhampton wanderers": "wolves", "manchester united": "man united",
         "manchester city": "man city", "nottingham forest": "nott m forest",
         "tottenham hotspur": "tottenham", "brighton hove albion": "brighton",
         "west ham united": "west ham", "newcastle united": "newcastle",
         "sheffield wednesday": "sheffield weds", "queens park rangers": "qpr",
         "paris saint germain": "paris sg", "internazionale": "inter", "inter milan": "inter",
         "athletic club": "ath bilbao", "atletico madrid": "ath madrid",
         "borussia monchengladbach": "m gladbach", "bayer leverkusen": "leverkusen",
         "eintracht frankfurt": "ein frankfurt", "fc koln": "fc koln", "1 fc koln": "fc koln",
         "psv eindhoven": "psv eindhoven", "sporting cp": "sp lisbon",
         "sporting lisbon": "sp lisbon",
         "fc porto": "porto", "vitoria guimaraes": "guimaraes", "sc braga": "sp braga",
         "braga": "sp braga"}  # fmt: skip


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    s = ALIAS.get(s, s)
    toks = [t for t in s.split() if t not in STOP]
    return " ".join(toks) or s


def _sim(a: str, b: str) -> float:
    na, nb = norm(a), norm(b)
    return max(
        fuzz.token_set_ratio(na, nb),
        fuzz.partial_ratio(na, nb) if min(len(na), len(nb)) >= 4 else 0,
    )


def _has(v) -> bool:
    return v is not None and not pd.isna(v) and v != 0


def clubs(con) -> pd.DataFrame:
    fm = con.execute("""
        select distinct competition_id, season, home_fm_id fm_id, home_name name
            from stg.fm_fixtures
        union select distinct competition_id, season, away_fm_id, away_name
            from stg.fm_fixtures""").df()
    ours = con.execute("""
        with t as (select competition_id, season, home_club club_id, home_team name
            from core.team_matches
                   union select competition_id, season, away_club, away_team from core.team_matches)
        select t.*, c.name tm_name
            from t left join stg.tm_clubs c on 'tm-' || c.club_id = t.club_id""").df()
    rows = []
    for (comp, season), g in fm.groupby(["competition_id", "season"]):
        cand = ours[(ours.competition_id == comp) & (ours.season == season)]
        if cand.empty:  # e.g. a season football-data hasn't started: use the previous one
            cand = ours[(ours.competition_id == comp) & (ours.season == season - 1)]
        cand = cand.drop_duplicates("club_id")
        if cand.empty:
            continue
        pairs = list(zip(cand.name, cand.tm_name, strict=True))
        s = np.array([[max(_sim(a, b), _sim(a, t) if isinstance(t, str) else 0)
                       for b, t in pairs] for a in g.name])  # fmt: skip
        r, c = linear_sum_assignment(-s)
        for i, j in zip(r, c, strict=True):
            rows.append({"competition_id": comp, "season": season, "fm_id": int(g.fm_id.iloc[i]),
                         "fm_name": g.name.iloc[i], "club_id": cand.club_id.iloc[j],
                         "our_name": cand.name.iloc[j], "score": float(s[i, j])})  # fmt: skip
    d = pd.DataFrame(rows)
    # promoted clubs not yet in our league-season table match poorly: keep only good links
    return d[d.score >= 70]


def players(con, club_map: pd.DataFrame) -> pd.DataFrame:
    fm = con.execute("""
        select p.player_fm_id, any_value(p.name) name, p.team_fm_id, p.competition_id, p.season,
               max(p.age) age
        from stg.fm_player_match p group by p.player_fm_id, p.team_fm_id, p.competition_id,
            p.season""").df()
    fm = fm.merge(club_map[["competition_id", "season", "fm_id", "club_id"]],
                  left_on=["competition_id", "season", "team_fm_id"],
                  right_on=["competition_id", "season", "fm_id"], how="left")  # fmt: skip
    tm = con.execute("""
        select distinct 'tm-' || s.player_id player_id, 'tm-' || s.club_id club_id, p.name,
               year(p.date_of_birth) yob
        from metrics.player_season s join stg.tm_players p using (player_id)
        where s.season >= 2023
        union
        select 'tm-' || player_id, 'tm-' || current_club_id, name, year(date_of_birth)
        from stg.tm_players where last_season >= 2024""").df()
    by_club = {k: g for k, g in tm.groupby("club_id")}
    # second pass for players who changed club after the Transfermarkt freeze: any recent
    # Transfermarkt player with (almost) the same name and birth year, if unique
    everyone = tm.drop_duplicates("player_id").assign(n=lambda t: t.name.map(norm))
    by_last = {k: g for k, g in everyone.groupby(everyone.n.str.split().str[-1])}
    out = []
    for r in fm.itertuples():
        best, score = None, 0.0
        cand = by_club.get(r.club_id)
        if cand is not None:
            for t in cand.itertuples():
                sc = fuzz.token_sort_ratio(norm(r.name), norm(t.name))
                sc = max(sc, fuzz.partial_ratio(norm(r.name), norm(t.name)) - 5)
                if _has(r.age) and _has(t.yob) and abs((r.season + 1 - r.age) - t.yob) > 2:
                    continue
                if sc > score:
                    best, score = t.player_id, sc
        if score < 85 and isinstance(r.name, str) and norm(r.name):
            pool = by_last.get(norm(r.name).split()[-1])
            hits = []
            if pool is not None:
                for t in pool.itertuples():
                    sc = fuzz.token_sort_ratio(norm(r.name), t.n)
                    yob_ok = (
                        not (_has(r.age) and _has(t.yob))
                        or abs((r.season + 1 - r.age) - t.yob) <= 1
                    )
                    if sc >= 92 and yob_ok:
                        hits.append((sc, t.player_id))
            if len({h[1] for h in hits}) == 1:
                score, best = max(hits)[0], hits[0][1]
        out.append({"player_fm_id": int(r.player_fm_id), "competition_id": r.competition_id,
                    "season": int(r.season), "club_id": r.club_id,
                    "player_id": best if score >= 85 else f"fm-{int(r.player_fm_id)}",
                    "score": score})  # fmt: skip
    d = pd.DataFrame(out)
    # one canonical id per FotMob player: the best-scoring link across seasons
    best = d.sort_values("score", ascending=False).drop_duplicates("player_fm_id")[
        ["player_fm_id", "player_id"]
    ]
    return d.drop(columns="player_id").merge(best, on="player_fm_id")


def matches(con, club_map: pd.DataFrame) -> pd.DataFrame:
    con.register("cm", club_map)
    d = con.execute("""
        with f as (
            select f.*, h.club_id home_club, a.club_id away_club
            from stg.fm_fixtures f
            left join cm h on h.competition_id = f.competition_id and h.season = f.season
                and h.fm_id = f.home_fm_id
            left join cm a on a.competition_id = f.competition_id and a.season = f.season
                and a.fm_id = f.away_fm_id)
        select f.fm_match_id, f.competition_id, f.season, f.kickoff_utc, f.home_club, f.away_club,
               f.finished, t.match_id
        from f left join core.team_matches t
          on t.competition_id = f.competition_id and t.home_club = f.home_club
              and t.away_club = f.away_club
         and abs(date_diff('day', t.match_date::date, f.kickoff_utc::date)) <= 2""").df()
    con.unregister("cm")
    return d.drop_duplicates("fm_match_id")


def build(con, paths: Paths) -> dict[str, int]:
    cm = clubs(con)
    pm = players(con, cm)
    mm = matches(con, cm)
    n = {}
    for name, df in (("fm_clubs", cm), ("fm_players", pm), ("fm_matches_xw", mm)):
        con.register("tmp_df", df)
        n[name] = materialize(con, paths, "core", name, "select * from tmp_df")
        con.unregister("tmp_df")
    return n
