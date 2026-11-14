"""Data-quality tests run on every build (spec section 9). Each check returns one row per
(check, scope) with the observed value, the threshold and pass/fail; the build writes them
to ``qa.checks`` and fails if any blocking check fails."""

from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

from pitchvision.db import has_table

TIER1 = ("GB1", "ES1", "L1", "IT1", "FR1")
TIER2 = ("NL1", "PO1", "CL", "EL", "UCOL")


@dataclass
class Check:
    name: str
    sql: str  # returns columns: scope, value
    threshold: float
    higher_is_better: bool = True
    blocking: bool = True


def _in(codes) -> str:
    return "(" + ",".join(f"'{c}'" for c in codes) + ")"


SCOPE = _in(TIER1 + TIER2)

_GOALS_BY_CLUB = """
    with e as (select game_id, club_id, count(*) n from stg.tm_events where type = 'goals'
               group by all)
    select g.competition_id || ' ' || g.season_label scope,
           avg((coalesce(h.n, 0) = g.home_goals and coalesce(a.n, 0) = g.away_goals)::int)
               value
    from stg.tm_games g
    left join e h on h.game_id = g.game_id and h.club_id = g.home_club_id
    left join e a on a.game_id = g.game_id and a.club_id = g.away_club_id
    where g.competition_id in {codes} and not g.shootout
      and g.game_id not in (select game_id from stg.tm_known_issues) group by 1"""

TM_CHECKS = [
    # TM's reported score includes shootout goals, so shootout matches are excluded
    Check("tm: goal events by club = final score, domestic (share of matches)",
          _GOALS_BY_CLUB.format(codes=_in(TIER1 + ("NL1", "PO1"))), 0.995),
    Check("tm: goal events by club = final score, European (share of matches)",
          _GOALS_BY_CLUB.format(codes=_in(("CL", "EL", "UCOL"))), 0.98),
    Check("tm: two starting XIs per match (share, 2013-14 on)", f"""
        with l as (select game_id, count(*) filter (where starter) s from stg.tm_lineups
                   group by 1)
        select g.competition_id || ' ' || g.season_label scope, avg((l.s = 22)::int) value
        from stg.tm_games g left join l using (game_id)
        where g.competition_id in {_in(TIER1)} and g.season >= 2013 group by 1""", 0.99),
    Check("tm: duplicate event ids", """
        select 'all' scope, count(*) - count(distinct event_id) value from stg.tm_events""",
          0, higher_is_better=False),
]  # fmt: skip

STINT_CHECKS = [
    Check("stints: goals over stints = final score (share of valid matches)", """
        with s as (select game_id, sum(home_goals) h, sum(away_goals) a from metrics.stints
                   where valid group by 1)
        select g.competition_id || ' ' || g.season_label scope,
               avg((s.h = g.home_goals and s.a = g.away_goals)::int) value
        from s join stg.tm_games g using (game_id) where not g.shootout
          and g.game_id not in (select game_id from stg.tm_known_issues)
        group by 1""", 0.995),
    Check("stints: derived minutes within 1 of TM minutes (share of appearances)", f"""
        select a.competition_id || ' ' || g.season_label scope,
               avg((abs(a.minutes - coalesce(m.minutes, 0)) <= 1)::int) value
        from stg.tm_appearances a join stg.tm_games g using (game_id)
        left join metrics.player_minutes m using (game_id, player_id)
        where a.competition_id in {_in(TIER1)} group by 1""", 0.995),
    Check("stints: matches with valid stints (share, domestic, lineup seasons)", f"""
        with s as (select game_id, bool_and(valid) v from metrics.stints group by 1)
        select g.competition_id || ' ' || g.season_label scope,
               avg(coalesce(s.v, false)::int) value
        from stg.tm_games g left join s using (game_id)
        where g.competition_id in {_in(TIER1 + ('NL1', 'PO1'))} group by 1""", 0.98),
]  # fmt: skip


def run(con, checks: list[Check] | None = None) -> pd.DataFrame:
    if checks is None:
        checks = []
        if has_table(con, "stg", "tm_games"):
            checks += TM_CHECKS
        if has_table(con, "metrics", "stints"):
            checks += STINT_CHECKS
    rows = []
    for c in checks:
        df = con.execute(c.sql).df()
        for r in df.itertuples():
            ok = r.value >= c.threshold if c.higher_is_better else r.value <= c.threshold
            rows.append({"check": c.name, "scope": r.scope, "value": float(r.value),
                         "threshold": c.threshold, "passed": bool(ok),
                         "blocking": c.blocking})  # fmt: skip
    return pd.DataFrame(rows)
