"""Stints from Transfermarkt lineups, substitutions and red cards (spec 5.5).

A new stint starts at every substitution and every sending-off. Rules for what TM can't
order (its event ids are hashes and added time is collapsed into minute 45 / 90):

* A goal in the same minute as a substitution counts **before** it, unless the scorer is
  a player coming on in that minute (then after).
* Match length is 120 if any event is after minute 90, else 90. Stints of zero length
  (substitutions in the 90th minute) are dropped; their players get 0 minutes here, where
  TM's ``minutes_played`` gives them 1.
* Starters come from the lineup; where a match has no lineup (2012-13), from the
  appearances minus the players brought on.
* A match with any substitution, red card or goal of unknown minute is flagged
  ``complete = false`` and kept out of plus-minus.

Own goals carry the benefiting club in TM's ``club_id``, so goals are credited by club.
"""

from __future__ import annotations

from collections import defaultdict

import pandas as pd

from pitchvision.config import Paths
from pitchvision.db import materialize
from pitchvision.quality import TIER1, TIER2, _in

SCOPE = _in(TIER1 + TIER2)


def _load(con) -> tuple[pd.DataFrame, ...]:
    games = con.execute(f"""
        select game_id, competition_id, season, home_club_id, away_club_id, home_goals,
               away_goals
        from stg.tm_games where competition_id in {SCOPE}""").df()  # fmt: skip
    starters = con.execute(f"""
        with g as (select game_id from stg.tm_games where competition_id in {SCOPE}),
        lu as (select game_id, club_id, player_id from stg.tm_lineups join g using (game_id)
               where starter),
        has as (select distinct game_id from lu),
        subin as (select game_id, club_id, player_in_id player_id from stg.tm_events
                  where type = 'substitutions' and player_in_id is not null),
        app as (select a.game_id, a.club_id, a.player_id from stg.tm_appearances a
                join g using (game_id) anti join has using (game_id)
                anti join subin using (game_id, club_id, player_id))
        select * from lu union all select * from app""").df()  # fmt: skip
    events = con.execute(f"""
        select e.game_id, e.club_id, e.minute, e.type, e.player_id, e.player_in_id,
               e.card, e.is_penalty, e.is_own_goal
        from stg.tm_events e join stg.tm_games g using (game_id)
        where g.competition_id in {SCOPE}
          and (e.type in ('substitutions', 'goals')
               or e.card in ('red', 'second_yellow'))""").df()  # fmt: skip
    return games, starters, events


def _match_stints(g, ev: pd.DataFrame, xi: dict) -> tuple[list[dict], list[tuple]]:
    """Stints and player minutes of one match (``g`` a games row, ``ev`` its events)."""
    home, away = g.home_club_id, g.away_club_id
    complete = not ev.minute.isna().any()
    ev = ev.dropna(subset=["minute"])
    length = 120 if len(ev) and ev.minute.max() > 90 else 90
    on = {home: set(xi.get((g.game_id, home), [])), away: set(xi.get((g.game_id, away), []))}
    ins_at = defaultdict(set)
    for r in ev[ev.type == "substitutions"].itertuples(index=False):
        if pd.notna(r.player_in_id):
            ins_at[int(r.minute)].add(int(r.player_in_id))
    # (minute, order, row): goals first in their minute unless scored by a player who came
    # on in that minute; then changes
    timeline = []
    for r in ev.itertuples(index=False):
        m = int(r.minute)
        if r.type == "goals":
            late = pd.notna(r.player_id) and int(r.player_id) in ins_at[m]
            timeline.append((m, 2 if late else 0, r))
        else:
            timeline.append((m, 1, r))
    timeline.sort(key=lambda t: (t[0], t[1]))

    stints: list[dict] = []
    minutes: list[tuple] = []
    start = 0
    goals = {home: [0, 0], away: [0, 0]}  # [all, non-penalty]

    def close(end: int) -> None:
        nonlocal start, goals
        if end > start:
            stints.append({
                "game_id": g.game_id, "stint": len(stints), "start": start, "end": end,
                "minutes": end - start,
                "home_players": sorted(on[home]), "away_players": sorted(on[away]),
                "home_goals": goals[home][0], "away_goals": goals[away][0],
                "home_np_goals": goals[home][1], "away_np_goals": goals[away][1],
            })  # fmt: skip
            for club in (home, away):
                minutes.extend((g.game_id, club, p, end - start) for p in on[club])
        elif stints:  # zero-length window (90th-minute changes): goals go to the last stint
            s = stints[-1]
            s["home_goals"] += goals[home][0]
            s["away_goals"] += goals[away][0]
            s["home_np_goals"] += goals[home][1]
            s["away_np_goals"] += goals[away][1]
        start = end
        goals = {home: [0, 0], away: [0, 0]}

    for m, _, r in timeline:
        club = r.club_id
        if club not in on:
            complete = False
            continue
        if r.type == "goals":
            goals[club][0] += 1
            goals[club][1] += 0 if r.is_penalty else 1
            continue
        close(min(m, length))
        on[club].discard(int(r.player_id))
        if r.type == "substitutions" and pd.notna(r.player_in_id):
            on[club].add(int(r.player_in_id))
    close(length)
    for s in stints:
        s["complete"] = complete
        s["length"] = length
    return stints, minutes


def reconstruct(games: pd.DataFrame, starters: pd.DataFrame,
                events: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:  # fmt: skip
    """Return (stints, player_minutes)."""
    xi: dict[tuple[int, int], list[int]] = defaultdict(list)
    for r in starters.itertuples(index=False):
        xi[(r.game_id, r.club_id)].append(int(r.player_id))
    ev_by_game = dict(list(events.groupby("game_id")))
    empty = events.iloc[0:0]
    stints, minutes = [], []
    for g in games.itertuples(index=False):
        s, m = _match_stints(g, ev_by_game.get(g.game_id, empty), xi)
        stints += s
        minutes += m
    st = pd.DataFrame(stints)
    pm = pd.DataFrame(minutes, columns=["game_id", "club_id", "player_id", "minutes"])
    pm = pm.groupby(["game_id", "club_id", "player_id"], as_index=False).minutes.sum()
    return st, pm


def build(con, paths: Paths) -> dict[str, int]:
    games, starters, events = _load(con)
    st, pm = reconstruct(games, starters, events)
    con.register("st_df", st)
    con.register("pm_df", pm)
    # a match's stints are valid for plus-minus when complete and every stint has 9-11
    # players a side (UECL 2021-23 and EL 2012-13 have no lineups at all in the mirror)
    n = {
        "stints": materialize(
            con,
            paths,
            "metrics",
            "stints",
            """
            select *, complete and min(least(len(home_players), len(away_players)))
                          over (partition by game_id) >= 9
                      and max(greatest(len(home_players), len(away_players)))
                          over (partition by game_id) <= 11
                      and game_id not in (select game_id from stg.tm_known_issues
                                          where issue in ('missing_goal_events',
                                                          'score_vs_events')) as valid
            from st_df""",
        ),
        "player_minutes": materialize(
            con, paths, "metrics", "player_minutes", "select * from pm_df"
        ),  # fmt: skip
    }
    con.unregister("st_df")
    con.unregister("pm_df")
    return n
