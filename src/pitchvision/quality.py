"""Data-quality tests run on every build (spec section 9). Each check returns one row per
(check, scope) with the observed value, the threshold and pass/fail; the build writes them
to ``qa.checks`` and fails if any blocking check fails."""

from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

from pitchvision.config import OVERRIDES
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


_EVENT_GOALS = """
    with g as (select match_id, team_id,
                      count(*) filter (where type in ('shot', 'shot_freekick', 'shot_penalty')
                                       and result = 'success') g,
                      count(*) filter (where result = 'owngoal') og
               from stg.{p}_actions group by all)
    select m.competition_id || ' ' || m.season scope,
           avg(((coalesce(h.g, 0) + coalesce(a.og, 0)) = m.home_goals
                and (coalesce(a.g, 0) + coalesce(h.og, 0)) = m.away_goals)::int) value
    from stg.{p}_matches m
    left join g h on h.match_id = m.match_id and h.team_id = m.home_team_id
    left join g a on a.match_id = m.match_id and a.team_id = m.away_team_id
    where m.match_id not in (select match_id::bigint from read_csv('{issues}', header = true,
                             all_varchar = true) where provider = '{provider}')
    group by 1"""

_IN_FRAME = """
    select '{provider}' scope,
           avg((start_x between 0 and 105 and start_y between 0 and 68
                and coalesce(end_x, 0) between 0 and 105
                and coalesce(end_y, 0) between 0 and 68)::int) value
    from stg.{p}_actions where start_x is not null"""


FD_CHECKS = [
    Check("footballdata: matches mapped to TM, seasons TM covers (share)", """
        select f.competition_id || ' ' || f.season scope,
               avg((x.canonical_id like 'tm-%')::int) value
        from stg.fd_matches f join core.crosswalk x
             on x.entity = 'match' and x.source = 'footballdata'
             and x.source_id = f.fd_match_id
        where f.competition_id in ('GB1', 'ES1', 'L1', 'IT1', 'FR1', 'NL1', 'PO1')
          and f.season <= 2025
        group by 1""", 0.995),
    Check("footballdata: scores that disagree with TM after overrides (count)", """
        select 'all' scope, count(*) value from core.crosswalk_qa
        where source = 'footballdata' and reason = 'score differs from Transfermarkt'""",
          0, higher_is_better=False),
]  # fmt: skip

CROSSWALK_CHECKS = [
    Check("crosswalk: men's event matches mapped to a TM match (share)", """
        select source scope, avg((canonical_id like 'tm-%')::int) value from core.crosswalk
        where entity = 'match' and method <> 'own' group by 1""", 0.995),
    Check("crosswalk: men's event players mapped to TM (share of players)", """
        select source scope, avg((canonical_id like 'tm-%')::int) value from core.crosswalk
        where entity = 'player' and method <> 'own' group by 1""", 0.98),
    Check("crosswalk: ambiguous rows (share of all rows)", """
        select 'all' scope, (select count(*) from core.crosswalk_qa
                             where reason = 'ambiguous votes')
                            / (select count(*) from core.crosswalk) value""", 0.005,
          higher_is_better=False),
]  # fmt: skip


_SCALE = """
    with s as (select competition_id, season, position_group, {col} x, minutes w
               from ratings.player_season_c where qualified and {col} is not null),
    m as (select competition_id, season, position_group, sum(x * w) / sum(w) mu, count(*) n
          from s group by all),
    d as (select m.competition_id, m.season, m.position_group, m.mu,
                 sqrt(sum(s.w * power(s.x - m.mu, 2)) / sum(s.w)) sd
          from s join m using (competition_id, season, position_group)
          where m.n >= 10
          group by m.competition_id, m.season, m.position_group, m.mu)
    select '{col}' scope, max(greatest(abs(mu - 50) / 0.5, abs(sd - 10) / 0.5)) value
    from d"""

# spec 3.1 acceptance: per (league-season, group), minute-weighted mean 50 +- 0.5 and SD
# 10 +- 0.5 over qualified players, on the unclipped scale (value = worst deviation in
# units of the tolerance); the share clipped to 0 or 100 is reported, not blocking
_DIMS = ("scoring", "creation", "availability", "discipline")
RATING_CHECKS = [
    Check(f"ratings: tier-C mean 50 / SD 10 per league-season-group ({d})",
          _SCALE.format(col=f"{d}_score"), 1.0, higher_is_better=False)
    for d in _DIMS
] + [
    Check(f"ratings: tier-C share clipped at 0 or 100 ({d}, info)", f"""
        select '{d}' scope, avg(({d}_score < 0 or {d}_score > 100)::int) value
        from ratings.player_season_c where {d}_score is not null""", 0.01,
          higher_is_better=False, blocking=False)
    for d in _DIMS
]  # fmt: skip


XG_CHECKS = [
    Check("xg: values in [0, 1] (share)", """
        select 'all' scope, avg((xg between 0 and 1 and xg_oof between 0 and 1)::int) value
        from metrics.shots""", 1.0),
    Check("xg: out-of-fold xG total within 5% of goals, per provider (abs. rel. error)", """
        select provider scope, abs(sum(xg_oof) - sum(goal)) / sum(goal) value
        from metrics.shots where situation <> 'penalty' group by 1""", 0.05,
          higher_is_better=False),
    Check("xg: chosen model beats the base rate out of fold (log-loss gain)", """
        select 'all' scope,
               (select logloss from metrics.xg_eval where model = 'base_rate'
                and "group" = 'all')
               - (select min(logloss) from metrics.xg_eval where model in ('logit', 'gbm')
                  and "group" = 'all') value""", 0.0),
]  # fmt: skip


XT_CHECKS = [
    Check("xt: value iteration converged (iterations, max over subsets)", """
        select 'all' scope, max(iterations) value from metrics.xt_fit""", 499,
          higher_is_better=False),
    Check("xt: surface values in [0, 1] and highest in front of goal", """
        select 'pooled' scope,
               (min(xt) >= 0 and max(xt) <= 1
                and arg_max(cx, xt) = 15 and arg_max(cy, xt) in (5, 6))::int value
        from metrics.xt_grid where subset = 'pooled'""", 1),
    Check("minutes: StatsBomb team-match minutes within 2% of 11 x real length (share)", """
        with len as (select match_id, sum(mx) / 60 l
                     from (select match_id, period, max(time_s) mx from stg.sb_actions
                           where period between 1 and 4 group by all) group by 1),
        t as (select match_id, team_id, sum(minutes) m from metrics.player_minutes_a
              where provider = 'statsbomb' group by all)
        select 'statsbomb' scope, avg((abs(m / (11 * l) - 1) <= 0.02)::int) value
        from t join len using (match_id)""", 0.98),
    Check("minutes: Wyscout team-match minutes within 30 of 990 (share)", """
        select 'wyscout' scope, avg((abs(m - 990) <= 30)::int) value
        from (select match_id, team_id, sum(minutes) m from metrics.player_minutes_a
              where provider = 'wyscout' group by all)""", 0.99),
]  # fmt: skip


VAEP_CHECKS = [
    Check("vaep: out-of-fold log-loss gain over the base rate, per label", """
        select label scope, logloss_base - logloss value from metrics.vaep_eval
        where "group" = 'all'""", 0.0),
    Check("vaep: probabilities in [0, 1] and values finite (share of actions)", """
        select 'all' scope,
               avg((p_score between 0 and 1 and p_concede between 0 and 1
                    and isfinite(vaep))::int) value
        from metrics.vaep_actions""", 1.0),
    Check("vaep: predicted vs actual scoring labels per season, worst relative error (info)", """
        select 'all' scope, max(abs(pred_sum / positives - 1)) value from metrics.vaep_eval
        where label = 'scores' and "group" <> 'all'""", 0.10, higher_is_better=False,
          blocking=False),
]  # fmt: skip


TEAM_CHECKS = [
    Check("team matches: both clubs canonical (share)", """
        select competition_id scope,
               avg((home_club is not null and away_club is not null)::int) value
        from core.team_matches group by 1""", 1.0),
    Check("team matches: closing line present, 2012-13 to 2025-26 (share)", """
        select competition_id scope, avg((close_home is not null)::int) value
        from core.team_matches where season between 2012 and 2025 group by 1""", 0.99),
    Check("walk-forward: every model beats base rates on the test seasons (RPS gain)", """
        select m.model scope, b.rps - m.rps value
        from forecast.wf_eval m join forecast.wf_eval b
          on b.split = m.split and b.league = m.league and b.model = 'base rates'
        where m.league = 'all' and m.split like 'test%' and m.model <> 'base rates'""",
          0.0),
    Check("walk-forward: closing line vs our best model, test RPS gap (info)", """
        select 'all' scope,
               (select min(rps) from forecast.wf_eval where league = 'all'
                and split like 'test%' and model not in ('closing line', 'base rates'))
               - (select rps from forecast.wf_eval where league = 'all'
                  and split like 'test%' and model = 'closing line') value""", 0.0,
          higher_is_better=False, blocking=False),
    Check("team ratings: three systems agree (Dixon-Coles vs market r, worst league)", """
        select competition_id scope, corr(dc_gd, mkt_gd) value from ratings.team_season
        group by 1""", 0.8),
]  # fmt: skip


SIM_CHECKS = [
    Check("season sim: each club's position probabilities sum to 1 (worst error)", """
        with u as (unpivot (select competition_id, club_id, columns('^p_pos_')
                            from forecast.season_sim)
                   on columns('^p_pos_') into name pos value p)
        select competition_id scope, max(abs(s - 1)) value
        from (select competition_id, club_id, sum(p) s from u group by all)
        group by 1""", 1e-9, higher_is_better=False),
    Check("season sim: title probabilities sum to 1 per league (worst error)", """
        select competition_id scope, abs(sum(p_title) - 1) value
        from forecast.season_sim group by 1""", 1e-6, higher_is_better=False),
    Check("season backtest: strengths beat equal strength at halfway (Brier gain, zone)", """
        select e.zone scope,
               sum(q.brier * q.n) / sum(q.n) - sum(e.brier * e.n) / sum(e.n) value
        from forecast.season_backtest_eval e join forecast.season_backtest_eval q
          on q.league = e.league and q.zone = e.zone and q.variant = 'equal strength'
        where e.variant = 'model' and e.zone in ('title', 'top4', 'relegation')
        group by 1""", 0.0),
]  # fmt: skip


RAPM_CHECKS = [
    Check("rapm: ratings finite (share)", """
        select 'all' scope, avg((isfinite(rapm) and isfinite(prior))::int) value
        from ratings.player_rapm""", 1.0),
    Check("rapm: chosen model beats raw on/off predicting next-season team GD (r gain)", """
        with c as (select * from metrics.rapm_chosen)
        select 'test' scope,
               (select r from metrics.rapm_eval e, c where e.variant = 'rapm + prior'
                  and e.split = 'test' and e.decay = c.decay and e.lam = c.lam)
               - (select r from metrics.rapm_eval e, c where e.variant = 'raw on/off'
                  and e.split = 'test' and e.decay = c.decay and e.lam = c.lam) value""",
          0.0),
    Check("rapm: gain over the prior alone, test seasons (r; info)", """
        with c as (select * from metrics.rapm_chosen)
        select 'test' scope,
               (select r from metrics.rapm_eval e, c where e.variant = 'rapm + prior'
                  and e.split = 'test' and e.decay = c.decay and e.lam = c.lam)
               - (select r from metrics.rapm_eval e, c where e.variant = 'prior only'
                  and e.split = 'test' and e.decay = c.decay and e.lam = c.lam) value""",
          0.02, blocking=False),
]  # fmt: skip


CAREER_CHECKS = [
    Check("age curves: Impact peaks between 23 and 30 for every group (worst distance)", """
        select 'rapm' scope, max(greatest(23 - peak_age, peak_age - 30, 0)) value
        from ratings.age_curves where kind = 'summary' and metric = 'rapm'
          and dropout_pct = 0.2""", 0, higher_is_better=False),
    Check("league strength: European offsets and translation factors agree in order (r)", """
        with e as (select league, avg(offset_gd) e from ratings.league_strength_europe
                   group by 1),
        t as (select league, -log_factor t from ratings.league_translation)
        select 'all' scope, corr(e, t) value from e join t using (league)""", 0.5),
    Check("market value: out-of-fold R^2 on log value", """
        select 'all' scope, r2_log value from ratings.market_value_eval
        where scope = 'all'""", 0.7),
    Check("market value: 80% range coverage out of fold (distance from 0.80)", """
        select 'all' scope, abs(inside_80 - 0.8) value from ratings.market_value_eval
        where scope = 'all'""", 0.03, higher_is_better=False),
]  # fmt: skip


_SCALE_A = """
    with s as (select provider, competition_id, season, position_group, {col} x, minutes w
               from ratings.player_season_a where qualified and {col} is not null),
    m as (select provider, competition_id, season, position_group, sum(x * w) / sum(w) mu,
                 count(*) n
          from s group by all),
    d as (select m.provider, m.competition_id, m.season, m.position_group, m.mu,
                 sqrt(sum(s.w * power(s.x - m.mu, 2)) / sum(s.w)) sd
          from s join m using (provider, competition_id, season, position_group)
          where m.n >= 10
          group by m.provider, m.competition_id, m.season, m.position_group, m.mu)
    select '{col}' scope, max(greatest(abs(mu - 50) / 0.5, abs(sd - 10) / 0.5)) value
    from d"""

TIER_A_CHECKS = [
    Check(f"ratings: tier-A mean 50 / SD 10 per league-season-group ({d})",
          _SCALE_A.format(col=f"{d}_score"), 1.0, higher_is_better=False)
    for d in ("finishing", "creation", "progression", "ball_security", "defending",
              "duels", "shot_stopping", "distribution")
] + [
    Check("roles: rated player-seasons with a role (share)", """
        select 'all' scope, (select count(*) from ratings.roles)
               / (select count(*) from metrics.player_season_a where minutes >= 450
                  and position_group is not null) value""", 0.95),
    Check("similar players: never the same player (count)", """
        select 'all' scope, count(*) value from ratings.similar_players
        where player_id = similar_player_id""", 0, higher_is_better=False),
    Check("tier A: share of non-penalty xG assisted by a completed pass, per provider", """
        select provider scope, sum(xa) / sum(npxg) value from metrics.player_season_a
        group by 1""", 0.5),
]  # fmt: skip


MATCH_CHECKS = [
    Check("win probability: in-play beats pre-match log loss in every 15-minute bucket", """
        select minutes scope, logloss_prematch - logloss_state value from forecast.wp_eval""",
          0.0),
    Check("win probability: mean home-win probability vs actual rate, worst bucket gap", """
        select 'all' scope, max(abs(mean_p_home - home_win_rate)) value
        from forecast.wp_eval""", 0.02, higher_is_better=False),
    Check("xPoints table: league-season xPoints total within 3% of points", """
        select competition_id || ' ' || season scope,
               abs(sum(xpoints) / sum(points) - 1) value
        from metrics.xpoints_table group by 1""", 0.03, higher_is_better=False,
          blocking=False),
]  # fmt: skip


ZONE_CHECKS = [
    Check("pitch zones: 'for' and 'against' totals agree per measure (relative gap)", """
        select 'touches' scope,
               abs(sum(touches) filter (where side = 'for')
                   - sum(touches) filter (where side = 'against'))
               / nullif(sum(touches) filter (where side = 'for'), 0) value
        from metrics.zones_team
        union all
        select 'xg', abs(sum(xg) filter (where side = 'for')
                         - sum(xg) filter (where side = 'against'))
                     / nullif(sum(xg) filter (where side = 'for'), 0)
        from metrics.zones_team""", 1e-9, higher_is_better=False),
    Check("pitch zones: shot xG within 2% of goals (all event seasons)", """
        select 'all' scope, abs(sum(xg) / sum(goals) - 1) value
        from metrics.zones_team where side = 'for'""", 0.02, higher_is_better=False),
    Check("pitch zones: xG per shot higher in the final zone column than midfield", """
        select 'all' scope,
               (sum(xg) filter (where zx = 11) / sum(shots) filter (where zx = 11))
               - (sum(xg) filter (where zx between 4 and 7)
                  / sum(shots) filter (where zx between 4 and 7)) value
        from metrics.zones_team where side = 'for'""", 0.1),
]  # fmt: skip


FOTMOB_CHECKS = [
    Check("fotmob: linked matches agree with our score (share of finished matches)", """
        select x.competition_id || ' ' || x.season scope,
               avg((f.home_goals = t.home_goals and f.away_goals = t.away_goals)::int) value
        from core.fm_matches_xw x join stg.fm_fixtures f using (fm_match_id)
        join core.team_matches t using (match_id)
        where x.finished and t.played group by 1""", 0.99),
    Check("fotmob: finished matches linked to ours (share, seasons football-data covers)", """
        select x.competition_id || ' ' || x.season scope,
               avg((x.match_id is not null)::int) value
        from core.fm_matches_xw x
        where x.finished and x.kickoff_utc <= (select max(match_date) from core.team_matches
                                               where played)
        group by 1""", 0.98),
]  # fmt: skip


def event_checks(prefix: str, provider: str) -> list[Check]:
    issues = (OVERRIDES / "event_known_issues.csv").as_posix()
    return [
        Check(f"{provider}: event goals = final score (share of matches)",
              _EVENT_GOALS.format(p=prefix, provider=provider, issues=issues), 0.995),
        Check(f"{provider}: action coordinates inside 105 x 68 (share)",
              _IN_FRAME.format(p=prefix, provider=provider), 1.0),
    ]  # fmt: skip


def run(con, checks: list[Check] | None = None) -> pd.DataFrame:
    if checks is None:
        checks = []
        if has_table(con, "stg", "tm_games"):
            checks += TM_CHECKS
        if has_table(con, "metrics", "stints"):
            checks += STINT_CHECKS
        if has_table(con, "stg", "wy_actions"):
            checks += event_checks("wy", "wyscout")
        if has_table(con, "stg", "sb_actions"):
            checks += event_checks("sb", "statsbomb")
        if has_table(con, "core", "crosswalk"):
            checks += CROSSWALK_CHECKS
        if has_table(con, "stg", "fd_matches") and has_table(con, "core", "crosswalk"):
            checks += FD_CHECKS
        if has_table(con, "ratings", "player_season_c"):
            checks += RATING_CHECKS
        if has_table(con, "ratings", "player_rapm"):
            checks += RAPM_CHECKS
        if has_table(con, "metrics", "shots"):
            checks += XG_CHECKS
        if has_table(con, "metrics", "xt_fit") and has_table(con, "metrics", "player_minutes_a"):
            checks += XT_CHECKS
        if has_table(con, "metrics", "vaep_eval"):
            checks += VAEP_CHECKS
        if has_table(con, "forecast", "wf_eval") and has_table(con, "ratings", "team_season"):
            checks += TEAM_CHECKS
        if has_table(con, "forecast", "season_backtest_eval"):
            checks += SIM_CHECKS
        if has_table(con, "forecast", "wp_eval") and has_table(con, "metrics", "xpoints_table"):
            checks += MATCH_CHECKS
        if has_table(con, "ratings", "market_value_eval"):
            checks += CAREER_CHECKS
        if has_table(con, "ratings", "player_season_a") and has_table(con, "ratings", "roles"):
            checks += TIER_A_CHECKS
        if has_table(con, "metrics", "zones_team"):
            checks += ZONE_CHECKS
        if has_table(con, "core", "fm_matches_xw"):
            checks += FOTMOB_CHECKS
    rows = []
    for c in checks:
        df = con.execute(c.sql).df()
        for r in df.itertuples():
            ok = r.value >= c.threshold if c.higher_is_better else r.value <= c.threshold
            rows.append({"check": c.name, "scope": r.scope, "value": float(r.value),
                         "threshold": c.threshold, "passed": bool(ok),
                         "blocking": c.blocking})  # fmt: skip
    return pd.DataFrame(rows)
