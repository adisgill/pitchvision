"""Stage the Transfermarkt mirror (``data/raw/transfermarkt/*.csv.gz``) into typed tables.

Documented repairs and derivations (see docs/phase0/data_profile.md):

* ``minute = -1`` means unknown: stored as null.
* TM collapses added time into minute 45 / 90, so ``added`` is always null here.
* ``home_goals`` / ``away_goals`` are the score **as played** and ``*_official`` the result
  that counts in the table (they differ only for awarded matches). Both come from TM unless
  ``overrides/match_scores.csv`` corrects them (cross-checked with football-data.co.uk).
  TM's score **includes penalty-shootout goals** for matches decided by a shootout
  (``shootout = true``); the score after 90 / 120 minutes is the goal events.
* Calendar-year leagues (MLS, Brazil, ...) carry their calendar year as ``season``; TM labels
  them by the year before.
* Goals: ``is_penalty`` / ``is_own_goal`` from the description (", Penalty", ", Own-goal").
* Cards: ``card`` in {yellow, second_yellow, red}; ``season_yellow_n`` = the "N." season
  count TM prints before a yellow card, when present.
* Lineup slots map to the 8 position groups of spec 2.2; TM's generic slots ("Attack",
  "Midfield", "Defender", "midfield") are left null for the modal-slot rule downstream.
* ``season_label``: "2025-26" for European seasons, "2025" for calendar-year leagues.
"""

from __future__ import annotations

from pitchvision.config import OVERRIDES, Paths
from pitchvision.db import materialize

CALENDAR_YEAR = ("MLS1", "BRA1", "ARG1", "JAP1", "RSK1", "SE1", "NO1")

# spec 2.2: TM lineup slot -> position group
POSITION_GROUP = {
    "Goalkeeper": "GK", "Centre-Back": "CB", "Sweeper": "CB", "Left-Back": "FB",
    "Right-Back": "FB", "Defensive Midfield": "DM", "Central Midfield": "CM",
    "Left Midfield": "CM", "Right Midfield": "CM", "Attacking Midfield": "AM",
    "Second Striker": "AM", "Left Winger": "W", "Right Winger": "W", "Centre-Forward": "ST",
}  # fmt: skip


def _raw(paths: Paths, table: str) -> str:
    p = (paths.source("transfermarkt") / f"{table}.csv.gz").as_posix()
    return f"read_csv_auto('{p}', sample_size=-1)"


def _season(season: str, comp: str) -> str:
    """TM labels calendar-year leagues by the year before (its MLS "2024" ran Feb-Dec 2025);
    we use the calendar year."""
    return f"case when {comp} in {CALENDAR_YEAR} then {season} + 1 else {season} end"


def _season_label(season: str, comp: str) -> str:
    return (f"case when {comp} in {CALENDAR_YEAR} then ({season} + 1)::varchar "
            f"else {season}::varchar || '-' || lpad((({season} + 1) % 100)::varchar, 2, '0') "
            "end")  # fmt: skip


def build(con, paths: Paths) -> dict[str, int]:
    pg = " ".join(f"when '{k}' then '{v}'" for k, v in POSITION_GROUP.items())
    n = {}
    n["tm_competitions"] = materialize(
        con,
        paths,
        "stg",
        "tm_competitions",
        f"""
        select competition_id, name, type, sub_type, country_name, confederation
        from {_raw(paths, "competitions")}""",
    )
    n["tm_clubs"] = materialize(
        con,
        paths,
        "stg",
        "tm_clubs",
        f"""
        select club_id, name, domestic_competition_id, stadium_name, stadium_seats,
               last_season
        from {_raw(paths, "clubs")}""",
    )
    n["tm_players"] = materialize(
        con,
        paths,
        "stg",
        "tm_players",
        f"""
        select player_id, name, first_name, last_name, date_of_birth::date as date_of_birth,
               country_of_citizenship, position, sub_position, foot, height_in_cm,
               contract_expiration_date::date as contract_expiration_date,
               international_caps, current_club_id, market_value_in_eur, last_season
        from {_raw(paths, "players")}""",
    )
    n["tm_games"] = materialize(
        con,
        paths,
        "stg",
        "tm_games",
        f"""
        select g.game_id, competition_id, competition_type,
               {_season("season", "competition_id")} as season,
               {_season_label("season", "competition_id")} as season_label,
               round, date as match_date, home_club_id, away_club_id,
               coalesce(o.played_home, home_club_goals) as home_goals,
               coalesce(o.played_away, away_club_goals) as away_goals,
               coalesce(o.official_home, home_club_goals) as home_goals_official,
               coalesce(o.official_away, away_club_goals) as away_goals_official,
               home_club_manager_name as home_manager, away_club_manager_name as away_manager,
               referee, stadium, attendance, home_club_formation as home_formation,
               away_club_formation as away_formation, home_club_name, away_club_name,
               g.game_id in (select game_id from {_raw(paths, "game_events")}
                             where type = 'Shootout') as shootout
        from {_raw(paths, "games")} g
        left join read_csv('{(OVERRIDES / "match_scores.csv").as_posix()}', header = true,
                           types = {{'game_id': 'BIGINT'}}) o on o.game_id = g.game_id""",
    )
    n["tm_appearances"] = materialize(
        con,
        paths,
        "stg",
        "tm_appearances",
        f"""
        select a.game_id, a.player_id, a.player_club_id as club_id, a.competition_id,
               g.season, a.minutes_played as minutes, a.goals, a.assists,
               a.yellow_cards, a.red_cards
        from {_raw(paths, "appearances")} a join stg.tm_games g using (game_id)""",
    )
    n["tm_lineups"] = materialize(
        con,
        paths,
        "stg",
        "tm_lineups",
        f"""
        select game_id, club_id, player_id, type = 'starting_lineup' as starter,
               position as slot, case position {pg} else null end as position_group,
               try_cast(number as integer) as shirt, team_captain = 1 as captain
        from {_raw(paths, "game_lineups")}""",
    )
    n["tm_events"] = materialize(
        con,
        paths,
        "stg",
        "tm_events",
        f"""
        select game_event_id as event_id, game_id, nullif(minute, -1) as minute,
               null::integer as added, lower(type) as type, club_id, player_id,
               player_in_id, player_assist_id,
               type = 'Goals' and description ilike '%, Penalty%' as is_penalty,
               type = 'Goals' and description ilike '%Own-goal%' as is_own_goal,
               case when type <> 'Cards' then null
                    when description ilike 'Second yellow%' then 'second_yellow'
                    when description ilike 'Red card%' then 'red'
                    else 'yellow' end as card,
               try_cast(regexp_extract(description, '^(\\d+)\\. Yellow', 1) as integer)
                   as season_yellow_n,
               description
        from {_raw(paths, "game_events")}""",
    )
    issues = (OVERRIDES / "tm_known_issues.csv").as_posix()
    n["tm_known_issues"] = materialize(
        con,
        paths,
        "stg",
        "tm_known_issues",
        f"""
        select game_id::bigint game_id, issue, detail, resolution
        from read_csv('{issues}', header = true, all_varchar = true)""",
    )
    n["tm_valuations"] = materialize(
        con,
        paths,
        "stg",
        "tm_valuations",
        f"""
        select player_id, date as value_date, market_value_in_eur as value_eur,
               current_club_id as club_id
        from {_raw(paths, "player_valuations")}""",
    )
    n["tm_transfers"] = materialize(
        con,
        paths,
        "stg",
        "tm_transfers",
        f"""
        select player_id, transfer_date, transfer_season, from_club_id, to_club_id,
               transfer_fee as fee_eur, market_value_in_eur as value_eur
        from {_raw(paths, "transfers")}""",
    )
    return n
