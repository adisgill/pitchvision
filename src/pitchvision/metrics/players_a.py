"""Tier-A player metrics (spec 4.1-4.8): every on-ball metric of the catalog from the event
seasons (StatsBomb 2015-16 big five and women's leagues, Wyscout 2017-18), at player-match
grain, then per season, keyed by canonical player id.

* ``metrics.player_match_a``   counts per player per match (+ minutes, position, the
                                opponent's possession time while he was on the pitch)
* ``metrics.player_season_a``  season totals, per-90 rates, success rates, the modal
                                position group, possession-adjusted defending (spec 2.5)

Definitions (spec 4; D9 progressive):

* **xA:** the xG of the shot a completed pass led to: the shooting team's last completed
  pass before a non-penalty shot, within 6 s, with no opponent ball action in between
  (carries ignored). Key passes are those passes.
* **Progressive:** completed pass or carry with ``d_start - d_end >= 0.25 d_start``, or
  ``>= 10 m`` when starting in the attacking 60% (x >= 42 m); ``d`` = distance to the goal
  centre.
* **Final-third / box entries:** completed passes and carries ending in the final third
  (x >= 70) from outside it / ending in the box from outside it.
* **Deep completions:** completed non-cross passes ending within 20 m of the goal centre.
* **Zone-skipping passes:** completed passes moving forward across >= 2 of the bands
  0 / 26.25 / 52.5 / 78.75 / 105 m.
* **Turnovers:** dispossessed + bad touches + failed take-ons.
* **Possession time:** the time from each ball action to the next if the same team keeps
  it (capped at 15 s), summed per team-match; a player's opponent possession time is his
  share of the match's.
* **Goalkeepers:** the opponent's non-penalty shots, xG and goals while he was on the pitch
  (by minutes share of the team's goalkeeper minutes in the match).

Provider gaps stay blank, never zero: carries and xT-by-carry (Wyscout has none, spec 4.3),
recoveries, blocks, pressures, dribbled-past, fouls won and sweeper actions (StatsBomb
only).
"""

from __future__ import annotations

from pitchvision.config import Paths
from pitchvision.db import materialize

MIN_MINUTES = 450
PASS_TYPES = ("pass", "cross", "corner_crossed", "corner_short", "freekick_crossed",
              "freekick_short", "throw_in", "goalkick")  # fmt: skip
BALL_TYPES = ("pass", "cross", "corner_crossed", "corner_short", "freekick_crossed",
              "freekick_short", "throw_in", "goalkick", "dribble", "take_on", "shot",
              "shot_freekick", "shot_penalty", "clearance", "bad_touch", "touch",
              "interception", "recovery", "tackle", "keeper_save", "keeper_claim",
              "keeper_punch", "keeper_sweeper", "aerial_duel", "ground_duel", "block",
              "dispossessed")  # fmt: skip
SB_POSITION = {
    "Goalkeeper": "GK", "Left Center Back": "CB", "Right Center Back": "CB",
    "Center Back": "CB", "Left Back": "FB", "Right Back": "FB", "Left Wing Back": "FB",
    "Right Wing Back": "FB", "Left Defensive Midfield": "DM",
    "Right Defensive Midfield": "DM", "Center Defensive Midfield": "DM",
    "Left Center Midfield": "CM", "Right Center Midfield": "CM", "Center Midfield": "CM",
    "Left Midfield": "CM", "Right Midfield": "CM", "Left Attacking Midfield": "AM",
    "Right Attacking Midfield": "AM", "Center Attacking Midfield": "AM",
    "Secondary Striker": "AM", "Left Wing": "W", "Right Wing": "W",
    "Left Center Forward": "ST", "Right Center Forward": "ST", "Center Forward": "ST",
}  # fmt: skip
# season level
SUM_COLS = ["passes", "passes_ok", "long_passes", "long_passes_ok", "crosses", "crosses_ok",
            "through_balls", "prog_passes", "prog_carries", "final_third_entries",
            "box_entries", "deep_completions", "zone_skips", "turnovers", "tackles",
            "tackles_won", "interceptions", "recoveries", "high_recoveries", "blocks",
            "clearances", "dribbled_past", "pressures", "counterpresses", "aerials",
            "aerials_won", "ground_duels", "ground_duels_won", "take_ons", "take_ons_won",
            "fouls", "fouls_won", "saves", "claims", "sweeper", "np_shots", "npxg",
            "np_goals", "pens", "pen_goals", "headers", "big_chances", "long_shots",
            "shot_dist_sum", "key_passes", "xa", "xt_pass_cross", "xt_carry", "vaep",
            "vaep_off", "vaep_def", "vaep_pass", "gk_shots_faced", "gk_xg_faced",
            "gk_goals_conceded", "opp_poss_s"]  # fmt: skip
# StatsBomb-only: blank (null) for Wyscout seasons
SB_ONLY = ("recoveries", "blocks", "dribbled_past", "pressures", "counterpresses",
           "fouls_won", "sweeper", "prog_carries", "xt_carry")  # fmt: skip
NO_PER90 = ("opp_poss_s", "shot_dist_sum", "gk_shots_faced", "gk_xg_faced",
            "gk_goals_conceded")  # fmt: skip


def _in(xs) -> str:
    return "(" + ",".join(f"'{x}'" for x in xs) + ")"


def player_match_sql() -> str:
    pt, ball = _in(PASS_TYPES), _in(BALL_TYPES)
    sbpos = " ".join(f"when '{k}' then '{v}'" for k, v in SB_POSITION.items())
    sb_null = {c: f"case when provider = 'wyscout' then null else {c} end" for c in SB_ONLY}
    return f"""
    with m as (
        select 'wyscout' provider, match_id, competition_id, season, home_team_id,
               away_team_id from stg.wy_matches
        union all
        select 'statsbomb', match_id, competition_id, season, home_team_id, away_team_id
        from stg.sb_matches),
    a as (select a.*, sqrt((105 - start_x) ^ 2 + (34 - start_y) ^ 2) d0,
                 sqrt((105 - end_x) ^ 2 + (34 - end_y) ^ 2) d1,
                 sqrt((end_x - start_x) ^ 2 + (end_y - start_y) ^ 2) len
          from stg.actions a),
    nb as (select provider, match_id, seq, period, time_s, team_id, player_id, type, result,
                  event_id,
                  lag(team_id) over (partition by provider, match_id order by seq) prev_team
           from a where type in {ball} and type <> 'dribble'),
    lp as (select *,
                  last_value(case when type in {pt} and result = 'success' then player_id
                             end ignore nulls) over w lp_player,
                  last_value(case when type in {pt} and result = 'success' then team_id
                             end ignore nulls) over w lp_team,
                  last_value(case when type in {pt} and result = 'success' then time_s
                             end ignore nulls) over w lp_time
           from nb
           window w as (partition by provider, match_id, period order by seq
                        rows between unbounded preceding and 1 preceding)),
    assists as (select lp.provider, lp.match_id, lp.lp_player player_id,
                       count(*) key_passes, sum(s.xg) xa
                from metrics.shots s
                join lp on lp.provider = s.provider and lp.match_id = s.match_id
                       and lp.event_id = s.event_id
                where s.situation <> 'penalty' and lp.lp_team = lp.team_id
                  and lp.prev_team = lp.team_id and lp.time_s - lp.lp_time <= 6
                  and lp.lp_player <> lp.player_id
                group by all),
    shots as (select provider, match_id, player_id,
                     count(*) filter (where situation <> 'penalty') np_shots,
                     sum(xg) filter (where situation <> 'penalty') npxg,
                     sum(goal) filter (where situation <> 'penalty') np_goals,
                     count(*) filter (where situation = 'penalty') pens,
                     sum(goal) filter (where situation = 'penalty') pen_goals,
                     count(*) filter (where situation <> 'penalty' and body = 'head') headers,
                     count(*) filter (where situation <> 'penalty' and xg >= 0.3) big_chances,
                     count(*) filter (where situation <> 'penalty' and distance > 25)
                         long_shots,
                     sum(distance) filter (where situation <> 'penalty') shot_dist_sum
              from metrics.shots group by all),
    acts as (select provider, match_id, player_id,
        count(*) filter (where type in ('pass', 'cross')) passes,
        count(*) filter (where type in ('pass', 'cross') and result = 'success') passes_ok,
        count(*) filter (where type in ('pass', 'cross') and len >= 30) long_passes,
        count(*) filter (where type in ('pass', 'cross') and result = 'success'
                         and len >= 30) long_passes_ok,
        count(*) filter (where type = 'cross') crosses,
        count(*) filter (where type = 'cross' and result = 'success') crosses_ok,
        count(*) filter (where type = 'pass' and through_ball) through_balls,
        count(*) filter (where type in ('pass', 'cross') and result = 'success'
                         and (d0 - d1 >= 0.25 * d0 or (start_x >= 42 and d0 - d1 >= 10)))
            prog_passes,
        count(*) filter (where type = 'dribble' and result = 'success'
                         and (d0 - d1 >= 0.25 * d0 or (start_x >= 42 and d0 - d1 >= 10)))
            prog_carries,
        count(*) filter (where type in ('pass', 'cross', 'dribble') and result = 'success'
                         and start_x < 70 and end_x >= 70) final_third_entries,
        count(*) filter (where type in ('pass', 'cross', 'dribble') and result = 'success'
                         and end_x >= 88.5 and end_y between 13.84 and 54.16
                         and not (start_x >= 88.5 and start_y between 13.84 and 54.16))
            box_entries,
        count(*) filter (where type = 'pass' and result = 'success' and d1 <= 20)
            deep_completions,
        count(*) filter (where type = 'pass' and result = 'success'
                         and floor(end_x / 26.25) - floor(start_x / 26.25) >= 2) zone_skips,
        count(*) filter (where type in ('dispossessed', 'bad_touch')
                         or (type = 'take_on' and result = 'fail')) turnovers,
        count(*) filter (where type = 'tackle') tackles,
        count(*) filter (where type = 'tackle' and result = 'success') tackles_won,
        count(*) filter (where type = 'interception' and result = 'success') interceptions,
        count(*) filter (where type = 'recovery' and result = 'success') recoveries,
        count(*) filter (where type in ('recovery', 'interception', 'tackle')
                         and result = 'success' and start_x >= 70) high_recoveries,
        count(*) filter (where type = 'block') blocks,
        count(*) filter (where type = 'clearance') clearances,
        count(*) filter (where type = 'dribbled_past') dribbled_past,
        count(*) filter (where type = 'pressure') pressures,
        count(*) filter (where type = 'pressure' and counterpress) counterpresses,
        count(*) filter (where type = 'aerial_duel') aerials,
        count(*) filter (where type = 'aerial_duel' and result = 'success') aerials_won,
        count(*) filter (where type in ('ground_duel', 'tackle')) ground_duels,
        count(*) filter (where type in ('ground_duel', 'tackle') and result = 'success')
            ground_duels_won,
        count(*) filter (where type = 'take_on') take_ons,
        count(*) filter (where type = 'take_on' and result = 'success') take_ons_won,
        count(*) filter (where type = 'foul') fouls,
        count(*) filter (where type = 'foul_won') fouls_won,
        count(*) filter (where type = 'keeper_save' and result = 'success') saves,
        count(*) filter (where type in ('keeper_claim', 'keeper_punch')) claims,
        count(*) filter (where type = 'keeper_sweeper') sweeper
        from a group by all),
    ord as (select provider, match_id, period, team_id, time_s,
                   lead(team_id) over w nt, lead(time_s) over w ntime, lead(period) over w np_
            from a where type in {ball}
            window w as (partition by provider, match_id order by seq)),
    poss as (select provider, match_id, team_id,
                    sum(least(ntime - time_s, 15)) filter (where nt = team_id and np_ = period
                                                            and ntime >= time_s) poss_s
             from ord group by all),
    pm as (select p.provider, p.match_id, p.team_id, p.player_id, p.minutes, p.starter,
                  p.position, m.competition_id, m.season,
                  case when p.team_id = m.home_team_id then m.away_team_id
                       else m.home_team_id end opp_team,
                  sum(p.minutes) over (partition by p.provider, p.match_id, p.team_id) / 11
                      match_len,
                  case when p.provider = 'statsbomb' then case p.position {sbpos} end
                       when p.position = 'GK' then 'GK' end pos_group_sb,
                  p.position in ('Goalkeeper', 'GK') is_gk
           from metrics.player_minutes_a p join m using (provider, match_id)),
    gk_min as (select provider, match_id, team_id, sum(minutes) gk_minutes from pm
               where is_gk group by all),
    opp_shots as (select provider, match_id, team_id shooter_team,
                         count(*) filter (where situation <> 'penalty') opp_np_shots,
                         sum(xg) filter (where situation <> 'penalty') opp_npxg,
                         sum(goal) filter (where situation <> 'penalty') opp_np_goals
                  from metrics.shots group by all),
    xt as (select provider, match_id, player_id,
                  sum(xt_added) filter (where type in ('pass', 'cross')) xt_pass_cross,
                  sum(xt_added) filter (where type = 'dribble') xt_carry
           from metrics.xt_actions group by all),
    va as (select provider, match_id, player_id, sum(vaep) vaep, sum(offensive) vaep_off,
                  sum(defensive) vaep_def, sum(vaep) filter (where type in {pt}) vaep_pass
           from metrics.vaep_actions group by all),
    base as (
        select pm.provider, pm.match_id, pm.competition_id, pm.season, pm.team_id,
               pm.player_id, pm.minutes, pm.starter, pm.position, pm.pos_group_sb, pm.is_gk,
               coalesce(op.poss_s, 0) * pm.minutes / nullif(pm.match_len, 0) opp_poss_s,
               acts.* exclude (provider, match_id, player_id),
               coalesce(shots.np_shots, 0) np_shots, coalesce(shots.npxg, 0) npxg,
               coalesce(shots.np_goals, 0) np_goals, coalesce(shots.pens, 0) pens,
               coalesce(shots.pen_goals, 0) pen_goals, coalesce(shots.headers, 0) headers,
               coalesce(shots.big_chances, 0) big_chances,
               coalesce(shots.long_shots, 0) long_shots,
               coalesce(shots.shot_dist_sum, 0) shot_dist_sum,
               coalesce(assists.key_passes, 0) key_passes, coalesce(assists.xa, 0) xa,
               coalesce(xt.xt_pass_cross, 0) xt_pass_cross, coalesce(xt.xt_carry, 0) xt_carry,
               coalesce(va.vaep, 0) vaep, coalesce(va.vaep_off, 0) vaep_off,
               coalesce(va.vaep_def, 0) vaep_def, coalesce(va.vaep_pass, 0) vaep_pass,
               case when pm.is_gk then os.opp_np_shots * pm.minutes / nullif(g.gk_minutes, 0)
               end gk_shots_faced,
               case when pm.is_gk then os.opp_npxg * pm.minutes / nullif(g.gk_minutes, 0)
               end gk_xg_faced,
               case when pm.is_gk then os.opp_np_goals * pm.minutes / nullif(g.gk_minutes, 0)
               end gk_goals_conceded
        from pm
        left join acts using (provider, match_id, player_id)
        left join shots using (provider, match_id, player_id)
        left join assists using (provider, match_id, player_id)
        left join xt using (provider, match_id, player_id)
        left join va using (provider, match_id, player_id)
        left join poss op on op.provider = pm.provider and op.match_id = pm.match_id
                         and op.team_id = pm.opp_team
        left join gk_min g on g.provider = pm.provider and g.match_id = pm.match_id
                          and g.team_id = pm.team_id
        left join opp_shots os on os.provider = pm.provider and os.match_id = pm.match_id
                              and os.shooter_team = pm.opp_team
        where pm.minutes > 0)
    select * replace ({", ".join(f"{v} as {k}" for k, v in sb_null.items())}) from base"""


def player_season_sql() -> str:
    sums = ",\n           ".join(f"sum({c}) as {c}" for c in SUM_COLS)
    per90 = ",\n           ".join(f"90 * s.{c} / s.minutes {c}_p90" for c in SUM_COLS
                                  if c not in NO_PER90)  # fmt: skip
    return f"""
    with pm as (select * from metrics.player_match_a),
    loc as (select a.player_id, avg(a.start_x) mx, avg(abs(a.start_y - 34)) my
            from stg.wy_actions a
            where a.type in ('pass', 'cross', 'dribble', 'take_on', 'shot', 'tackle',
                             'interception', 'clearance', 'aerial_duel', 'ground_duel')
            group by 1),
    -- the position group with the most minutes over the season (not the longest match's)
    gsb as (select provider, competition_id, season, player_id, pos_group_sb,
                   sum(minutes) gm
            from pm where pos_group_sb is not null group by all),
    gwy as (select provider, competition_id, season, player_id, position, sum(minutes) gm
            from pm group by all),
    grp as (select k.provider, k.competition_id, k.season, k.player_id,
                   (select arg_max(pos_group_sb, gm) from gsb x where x.provider = k.provider
                      and x.competition_id = k.competition_id and x.season = k.season
                      and x.player_id = k.player_id) g_sb,
                   (select arg_max(position, gm) from gwy x where x.provider = k.provider
                      and x.competition_id = k.competition_id and x.season = k.season
                      and x.player_id = k.player_id) wy_role
            from (select distinct provider, competition_id, season, player_id from pm) k),
    s as (select provider, competition_id, season, player_id, arg_max(team_id, minutes) team_id,
                 sum(minutes) as minutes, count(*) apps, count(*) filter (where starter) starts,
           {sums}
          from pm group by all),
    lg as (select provider, competition_id, season,
                  sum(opp_poss_s) / sum(minutes) ref_rate from pm group by all),
    xw as (select source, source_id, canonical_id from core.crosswalk where entity = 'player')
    select coalesce(xw.canonical_id, s.provider || '-' || s.player_id) canonical_id, s.*,
           case when s.provider = 'statsbomb' then grp.g_sb
                when grp.wy_role = 'GK' then 'GK'
                when grp.wy_role = 'DF' then case when loc.my >= 20 then 'FB' else 'CB' end
                when grp.wy_role = 'MD' then case when loc.mx < 45 then 'DM'
                                                  when loc.mx < 60 then 'CM' else 'AM' end
                when grp.wy_role = 'FW' then case when loc.my >= 15 then 'W' else 'ST' end
           end position_group,
           s.minutes >= {MIN_MINUTES} shown,
           {per90},
           s.npxg / nullif(s.np_shots, 0) xg_per_shot,
           s.shot_dist_sum / nullif(s.np_shots, 0) shot_distance,
           s.headers / nullif(s.np_shots, 0) header_share,
           s.big_chances / nullif(s.np_shots, 0) big_chance_share,
           s.long_shots / nullif(s.np_shots, 0) long_range_share,
           90 * (s.np_goals - s.npxg) / s.minutes finishing_p90,
           s.passes_ok / nullif(s.passes, 0) pass_completion,
           s.long_passes_ok / nullif(s.long_passes, 0) long_pass_completion,
           s.crosses_ok / nullif(s.crosses, 0) cross_completion,
           s.tackles_won / nullif(s.tackles, 0) tackle_success,
           s.aerials_won / nullif(s.aerials, 0) aerial_win_rate,
           s.ground_duels_won / nullif(s.ground_duels, 0) ground_win_rate,
           s.take_ons_won / nullif(s.take_ons, 0) take_on_success,
           90 * (s.xt_pass_cross + coalesce(s.xt_carry, 0)) / s.minutes xt_p90,
           90 * (s.tackles_won + s.interceptions) / s.minutes
               * lg.ref_rate / nullif(s.opp_poss_s / s.minutes, 0) tkl_int_padj_p90,
           90 * s.recoveries / s.minutes * lg.ref_rate / nullif(s.opp_poss_s / s.minutes, 0)
               recoveries_padj_p90,
           90 * (s.gk_xg_faced - s.gk_goals_conceded) / s.minutes goals_prevented_p90,
           (s.gk_xg_faced - s.gk_goals_conceded) / nullif(s.gk_shots_faced, 0)
               goals_prevented_per_shot
    from s
    left join grp using (provider, competition_id, season, player_id)
    left join loc on s.provider = 'wyscout' and loc.player_id = s.player_id
    left join lg using (provider, competition_id, season)
    left join xw on xw.source = s.provider and xw.source_id = s.player_id::varchar"""


def build(con, paths: Paths) -> dict[str, int]:
    n = {"player_match_a": materialize(con, paths, "metrics", "player_match_a",
                                       player_match_sql())}  # fmt: skip
    n["player_season_a"] = materialize(con, paths, "metrics", "player_season_a",
                                       player_season_sql())  # fmt: skip
    return n
