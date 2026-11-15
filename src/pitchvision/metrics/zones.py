"""Pitch value maps (spec 12.1): what every team and player does in every part of the pitch.

The pitch is cut into a 12 x 8 grid of 8.75 m x 8.5 m zones (105 x 68 m frame). Every
on-ball event of the event-data seasons is placed in the zone it starts in (receptions: the
zone a completed pass ends in), from the acting team's view, attacking left to right.

* ``zones_team`` - per team-season and zone, ``side = 'for'`` is the team's own actions;
  ``side = 'against'`` is its opponents' actions in the same matches, mirrored into the
  team's view (its own goal on the left), so "for" and "against" maps line up and a matchup
  can be read zone by zone: where A creates against where B concedes.
* ``zones_player`` - per player-season and zone, the player's own actions.

Measures (sums; the app divides by matches or 90s): touches (on-ball events), passes and
completed passes started in the zone, receptions, xT added (successful moves, valued by the
16 x 12 xT grid), VAEP offensive and defensive value, shots, xG and goals by shot origin,
defensive actions (tackles, interceptions, recoveries, blocks, clearances, duels and
goalkeeper claims), pressures, and turnovers (failed passes, crosses and take-ons,
dispossessions, bad touches, errors).
"""

from __future__ import annotations

from pitchvision.config import Paths
from pitchvision.db import has_table, materialize

NX, NY = 12, 8

DEFENSIVE = ("tackle", "interception", "recovery", "block", "clearance", "aerial_duel",
             "ground_duel", "keeper_claim", "keeper_punch", "keeper_sweeper")  # fmt: skip
OFF_BALL = ("pressure", "foul", "dribbled_past", "foul_won")


def _zone(x: str, y: str) -> str:
    """``zx, zy`` select items for a location (no trailing alias)."""
    return (f"least({NX - 1}, greatest(0, floor({x} / (105.0 / {NX}))))::tinyint zx, "
            f"least({NY - 1}, greatest(0, floor({y} / (68.0 / {NY}))))::tinyint")  # fmt: skip


def events_sql() -> str:
    """One row per event with its zone and every measure as a column."""
    dfn = ", ".join(f"'{t}'" for t in DEFENSIVE)
    off = ", ".join(f"'{t}'" for t in OFF_BALL)
    return f"""
        with mt as (
            select 'wyscout' provider, match_id, home_team_id, away_team_id from stg.wy_matches
            union all
            select 'statsbomb', match_id, home_team_id, away_team_id from stg.sb_matches),
        ev as (
            select a.provider, a.match_id, a.competition_id, a.season, a.team_id, a.player_id,
                   case when a.team_id = mt.home_team_id then mt.away_team_id
                        else mt.home_team_id end opp_id,
                   {_zone("a.start_x", "a.start_y")} zy,
                   (a.type not in ({off}))::int touches,
                   (a.type in ('pass', 'cross'))::int passes,
                   (a.type in ('pass', 'cross') and a.result = 'success')::int passes_ok,
                   coalesce(x.xt_added, 0) xt_added,
                   coalesce(v.offensive, 0) vaep_off,
                   coalesce(v.defensive, 0) vaep_def,
                   (a.type in ({dfn}))::int def_actions,
                   (a.type = 'pressure')::int pressures,
                   (a.type in ('dispossessed', 'bad_touch', 'error')
                    or (a.type in ('pass', 'cross', 'take_on') and a.result = 'fail'))::int
                       turnovers
            from (select a.*, m.competition_id, m.season
                  from stg.actions a join (
                      select 'wyscout' provider, match_id, competition_id, season
                      from stg.wy_matches
                      union all
                      select 'statsbomb', match_id, competition_id, season
                      from stg.sb_matches) m using (provider, match_id)
                  where a.start_x is not null) a
            join mt using (provider, match_id)
            left join metrics.xt_actions x using (provider, match_id, event_id)
            left join metrics.vaep_actions v using (provider, match_id, event_id)),
        rec as (  -- receptions: where completed passes end
            select a.provider, a.match_id, m.competition_id, m.season, a.team_id,
                   null::varchar player_id,
                   case when a.team_id = mt.home_team_id then mt.away_team_id
                        else mt.home_team_id end opp_id,
                   {_zone("a.end_x", "a.end_y")} zy
            from stg.actions a
            join (select 'wyscout' provider, match_id, competition_id, season
                  from stg.wy_matches
                  union all
                  select 'statsbomb', match_id, competition_id, season
                  from stg.sb_matches) m using (provider, match_id)
            join mt using (provider, match_id)
            where a.type in ('pass', 'cross') and a.result = 'success'
              and a.end_x is not null),
        sh as (
            select s.provider, s.match_id, s.competition_id, s.season, s.team_id,
                   s.player_id::varchar player_id,
                   case when s.team_id = mt.home_team_id then mt.away_team_id
                        else mt.home_team_id end opp_id,
                   {_zone("s.start_x", "s.start_y")} zy,
                   s.xg, s.goal::int goal
            from metrics.shots s join mt using (provider, match_id))
        select provider, match_id, competition_id, season, team_id, player_id::varchar
                   player_id, opp_id, zx, zy, touches, passes, passes_ok, 0 receptions,
               xt_added, vaep_off, vaep_def, 0 shots, 0.0 xg, 0 goals, def_actions,
               pressures, turnovers
        from ev
        union all
        select provider, match_id, competition_id, season, team_id, null, opp_id, zx, zy,
               0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0
        from rec
        union all
        select provider, match_id, competition_id, season, team_id, player_id, opp_id, zx, zy,
               0, 0, 0, 0, 0, 0, 0, 1, xg, goal, 0, 0, 0
        from sh"""


MEASURES = ("touches", "passes", "passes_ok", "receptions", "xt_added", "vaep_off",
            "vaep_def", "shots", "xg", "goals", "def_actions", "pressures",
            "turnovers")  # fmt: skip


def build(con, paths: Paths) -> dict[str, int]:
    if not (has_table(con, "stg", "actions") and has_table(con, "metrics", "xt_actions")):
        return {}
    con.execute(f"create or replace temp table zone_events as {events_sql()}")
    sums = ", ".join(f"sum({m}) {m}" for m in MEASURES)
    n = {}
    n["zones_team"] = materialize(
        con,
        paths,
        "metrics",
        "zones_team",
        f"""
        with games as (select provider, competition_id, season, team_id,
                              count(distinct match_id) matches
                       from zone_events group by all)
        select provider, competition_id, season, team_id, 'for' side, zx, zy, {sums}
        from zone_events group by all
        union all
        select provider, competition_id, season, opp_id, 'against',
               ({NX - 1} - zx)::tinyint, ({NY - 1} - zy)::tinyint, {sums}
        from zone_events group by provider, competition_id, season, opp_id,
                                  ({NX - 1} - zx)::tinyint, ({NY - 1} - zy)::tinyint""",
    )
    n["zones_team_games"] = materialize(
        con,
        paths,
        "metrics",
        "zones_team_games",
        """
        select provider, competition_id, season, team_id, count(distinct match_id) matches
        from zone_events group by all""",
    )
    n["zones_player"] = materialize(
        con,
        paths,
        "metrics",
        "zones_player",
        f"""
        select provider, competition_id, season, player_id, zx, zy, {sums}
        from zone_events where player_id is not null group by all""",
    )
    con.execute("drop table zone_events")
    return n
