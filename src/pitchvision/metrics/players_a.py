"""Tier-A player-season metrics (spec 4), keyed by canonical player id. This first cut
carries the possession-value family from expected threat; the rest of the tier-A catalog
(shooting, creation, progression, defending, duels, goalkeeping) joins it in later steps.

* ``vaep_p90`` (and offensive / defensive parts, and by action family): VAEP value per 90
  (``models/vaep.py``). Wyscout has no carries, so carry VAEP is blank there.

* ``xt_<type>_p90``: xT added per 90 by successful passes, crosses and carries;
* ``xt_p90``: their sum. Wyscout seasons have no carries (spec 4.3), so carry xT and the
  total are blank there and ``xt_nocarry_p90`` (passes + crosses) is the comparable number.
"""

from __future__ import annotations

from pitchvision.config import Paths
from pitchvision.db import materialize

MIN_MINUTES = 450  # smallest sample shown (spec 4: Min 450 for per-90 creation/progression)


def sql() -> str:
    return f"""
    with m as (select 'wyscout' provider, match_id, competition_id, season from stg.wy_matches
               union all
               select 'statsbomb', match_id, competition_id, season from stg.sb_matches),
    xw as (select source, source_id, canonical_id from core.crosswalk where entity = 'player'),
    mins as (select p.provider, m.competition_id, m.season, p.player_id,
                    any_value(p.team_id) team_id, sum(p.minutes) as minutes,
                    count(*) apps, count(*) filter (where p.starter) starts
             from metrics.player_minutes_a p join m using (provider, match_id)
             group by all),
    xt as (select provider, competition_id, season, player_id,
                  sum(xt_added) filter (where type = 'pass') xt_pass,
                  sum(xt_added) filter (where type = 'cross') xt_cross,
                  sum(xt_added) filter (where type = 'dribble') xt_carry,
                  count(*) filter (where type in ('pass', 'cross')) passes,
                  count(*) filter (where type in ('pass', 'cross') and result = 'success')
                      passes_completed
           from metrics.xt_actions group by all),
    va as (select provider, competition_id, season, player_id,
                  sum(vaep) vaep, sum(offensive) vaep_off, sum(defensive) vaep_def,
                  sum(vaep) filter (where type in ('pass', 'cross', 'corner_crossed',
                      'corner_short', 'freekick_crossed', 'freekick_short', 'throw_in',
                      'goalkick')) vaep_pass,
                  sum(vaep) filter (where type = 'dribble') vaep_carry,
                  sum(vaep) filter (where type = 'take_on') vaep_takeon,
                  sum(vaep) filter (where type in ('shot', 'shot_freekick', 'shot_penalty'))
                      vaep_shot,
                  sum(vaep) filter (where type in ('tackle', 'interception', 'recovery',
                      'clearance', 'block', 'aerial_duel', 'ground_duel', 'foul'))
                      vaep_defensive_actions,
                  sum(vaep) filter (where type like 'keeper%') vaep_keeper
           from metrics.vaep_actions group by all)
    select coalesce(xw.canonical_id, mins.provider || '-' || mins.player_id) canonical_id,
           mins.*, coalesce(xt.xt_pass, 0) xt_pass, coalesce(xt.xt_cross, 0) xt_cross,
           case when mins.provider = 'wyscout' then null else coalesce(xt.xt_carry, 0) end
               xt_carry,
           xt.passes, xt.passes_completed,
           90 * coalesce(xt.xt_pass, 0) / mins.minutes xt_pass_p90,
           90 * coalesce(xt.xt_cross, 0) / mins.minutes xt_cross_p90,
           90 * (case when mins.provider = 'wyscout' then null
                      else coalesce(xt.xt_carry, 0) end) / mins.minutes xt_carry_p90,
           90 * (coalesce(xt.xt_pass, 0) + coalesce(xt.xt_cross, 0)) / mins.minutes
               xt_nocarry_p90,
           90 * (coalesce(xt.xt_pass, 0) + coalesce(xt.xt_cross, 0)
                 + case when mins.provider = 'wyscout' then null
                        else coalesce(xt.xt_carry, 0) end) / mins.minutes xt_p90,
           va.vaep, va.vaep_off, va.vaep_def,
           90 * va.vaep / mins.minutes vaep_p90,
           90 * va.vaep_off / mins.minutes vaep_off_p90,
           90 * va.vaep_def / mins.minutes vaep_def_p90,
           90 * va.vaep_pass / mins.minutes vaep_pass_p90,
           case when mins.provider = 'wyscout' then null
                else 90 * coalesce(va.vaep_carry, 0) / mins.minutes end vaep_carry_p90,
           90 * va.vaep_takeon / mins.minutes vaep_takeon_p90,
           90 * va.vaep_shot / mins.minutes vaep_shot_p90,
           90 * va.vaep_defensive_actions / mins.minutes vaep_defensive_actions_p90,
           90 * va.vaep_keeper / mins.minutes vaep_keeper_p90,
           mins.minutes >= {MIN_MINUTES} shown
    from mins
    left join xt using (provider, competition_id, season, player_id)
    left join va using (provider, competition_id, season, player_id)
    left join xw on xw.source = mins.provider and xw.source_id = mins.player_id::varchar"""


def build(con, paths: Paths) -> dict[str, int]:
    return {"player_season_a": materialize(con, paths, "metrics", "player_season_a", sql())}
