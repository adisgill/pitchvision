"""``pitchvision demo``: the slim, licence-safe data the web app reads.

Writes ``app/public/data/<table>.<hash8>.parquet`` (immutable, content-addressed names: a new
version never overwrites an old one, the courtvision lesson) and ``manifest.json`` with the
version, build time, data-through date and each table's file.

What's published (D20): derived tables only, never raw files. StatsBomb-derived values only
as aggregates (per player-season, team-season or team-match), credited to StatsBomb;
per-shot rows only for Wyscout 2017-18 (CC BY 4.0, credited). football-data.co.uk and
Transfermarkt appear only through derived numbers.
"""

from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
import tempfile
from datetime import UTC, datetime
from pathlib import Path

from pitchvision.config import REPO_ROOT, get_paths
from pitchvision.db import connect, has_table

OUT = REPO_ROOT / "app" / "public" / "data"

# canonical ids for event-provider players and clubs
XW_PLAYER = """(select source, source_id, canonical_id from core.crosswalk
               where entity = 'player')"""
XW_CLUB = """(select source, source_id, canonical_id from core.crosswalk where entity = 'club')"""

TABLES: dict[str, str] = {
    "clubs": """
        with fd as (select home_club club_id, arg_max(home_team, match_date) name,
                           arg_max(competition_id, match_date) league
                    from core.team_matches group by 1
                    union all
                    select away_club, arg_max(away_team, match_date),
                           arg_max(competition_id, match_date)
                    from core.team_matches group by 1),
        tm as (select 'tm-' || club_id club_id, name, domestic_competition_id league,
                      stadium_name, stadium_seats
               from stg.tm_clubs),
        ev as (select 'st-' || home_team_id club_id, any_value(home_team_name) name,
                      any_value(competition_id) league
               from stg.sb_matches group by 1
               union all
               select 'st-' || away_team_id, any_value(away_team_name), any_value(competition_id)
               from stg.sb_matches group by 1)
        select club_id, coalesce(any_value(fd.name), any_value(tm.name), any_value(ev.name))
                   name, coalesce(any_value(fd.league), any_value(tm.league)) league,
               any_value(tm.stadium_name) stadium, any_value(tm.stadium_seats) capacity
        from (select club_id from fd union select club_id from tm union
              select club_id from ev) ids
        left join fd using (club_id) left join tm using (club_id) left join ev using (club_id)
        group by club_id""",
    "players": """
        select 'tm-' || player_id player_id, name, date_of_birth, country_of_citizenship
               nationality, position, foot, height_in_cm, sub_position,
               contract_expiration_date, international_caps,
               'tm-' || current_club_id current_club_id, market_value_in_eur, last_season
        from stg.tm_players
        union all
        select distinct on (x.canonical_id) x.canonical_id, l.player_name, null, l.country,
               null, null, null, null, null, null, null, null, null
        from core.crosswalk x join stg.sb_lineups l
          on x.source = 'statsbomb' and x.source_id = l.player_id::varchar
        where x.entity = 'player' and x.canonical_id not like 'tm-%'
        union all
        select distinct on (x.canonical_id) x.canonical_id,
               p.first_name || ' ' || p.last_name, p.birth_date, p.citizenship, p.role, p.foot,
               p.height_cm, null, null, null, null, null, null
        from core.crosswalk x join stg.wy_players p
          on x.source = 'wyscout' and x.source_id = p.player_id::varchar
        where x.entity = 'player' and x.canonical_id not like 'tm-%'""",
    "team_ratings": "select * from ratings.team_season",
    "xpoints": "select * from metrics.xpoints_table",
    "season_sim": "select * from forecast.season_sim",
    "season_sim_history": "select * from forecast.season_sim_history",
    "season_backtest_eval": "select * from forecast.season_backtest_eval",
    "wf_eval": "select * from forecast.wf_eval",
    "wf_tuning": "select * from forecast.wf_tuning",
    "xg_eval": "select * from metrics.xg_eval",
    "xg_calibration": "select * from metrics.xg_calibration",
    "vaep_eval": "select * from metrics.vaep_eval",
    "rapm_eval": "select * from metrics.rapm_eval",
    "market_eval": "select * from ratings.market_value_eval",
    "reliability_c": "select * from metrics.reliability",
    "reliability_a": """select metric, any_value(k90_median) k90 from metrics.reliability_a
                        group by 1""",
    "referee_reliability": "select * from metrics.referee_reliability",
    "wp_eval": "select * from forecast.wp_eval",
    "wp_calibration": "select * from forecast.wp_calibration",
    "wp_red_card": "select * from forecast.wp_red_card",
    "wp_params": "select * from forecast.wp_params",
    "league_europe": "select * from ratings.league_strength_europe",
    "league_translation": "select * from ratings.league_translation",
    "uefa_style": "select * from ratings.uefa_style_coefficient",
    "age_curves": "select * from ratings.age_curves",
    "age_projection": """select 'tm-' || player_id player_id, competition_id, season, metric,
                                age, horizon, now, proj, lo, hi
                         from ratings.age_projection""",
    "role_clusters": "select * from ratings.role_clusters",
    "players_c": """
        select 'tm-' || r.player_id player_id, r.competition_id, r.season, r.season_label,
               'tm-' || r.club_id club_id, r.position_group, r.minutes, r.apps, r.starts,
               r.goals, r.np_goals, r.pens, r.assists, r.yellows, r.reds, r.minutes_share,
               r.starts_share, r.np_goals_p90, r.assists_p90, r.cards_p90,
               r.np_goals_p90_shrunk, r.scoring_rating, r.creation_rating,
               r.availability_rating, r.discipline_rating, r.scoring_score,
               r.creation_score, r.availability_score, r.discipline_score, r.qualified
        from ratings.player_season_c r""",
    "rapm": """select 'tm-' || player_id player_id, season, rapm, rapm_noprior, prior,
                      exposure_90s, data_weight, max_overlap, prior_dominated
               from ratings.player_rapm where exposure_90s >= 5""",
    "players_a": """
        select r.canonical_id player_id, r.provider, r.competition_id, r.season,
               coalesce(c.canonical_id, r.provider || '-' || r.team_id) club_id,
               r.position_group, r.minutes, r.apps, r.np_goals, r.npxg, r.np_shots, r.xa,
               r.key_passes, r.npxg_p90, r.xa_p90, r.key_passes_p90, r.prog_passes_p90,
               r.prog_carries_p90, r.box_entries_p90, r.xt_p90, r.vaep_p90, r.vaep_off_p90,
               r.vaep_def_p90, r.pass_completion, r.turnovers_p90, r.tkl_int_padj_p90,
               r.aerial_win_rate, r.take_on_success, r.goals_prevented_p90,
               r.finishing_rating, r.creation_rating, r.progression_rating,
               r.ball_security_rating, r.defending_rating, r.duels_rating,
               r.shot_stopping_rating, r.claiming_sweeping_rating, r.distribution_rating,
               r.rapm, r.data_weight, ro.role, ro.role_probability, r.qualified
        from ratings.player_season_a r
        left join {XW_CLUB} c on c.source = r.provider and c.source_id = r.team_id::varchar
        left join ratings.roles ro on ro.provider = r.provider
             and ro.competition_id = r.competition_id and ro.season = r.season
             and ro.player_id = r.player_id""",
    "similar_players": """
        select coalesce(a.canonical_id, s.provider || '-' || s.player_id) player_id,
               s.competition_id, s.season, s.rank,
               coalesce(b.canonical_id, s.provider || '-' || s.similar_player_id) similar_id,
               s.similar_competition_id, s.similar_season, s.similarity, s.shared_traits
        from ratings.similar_players s
        left join {XW_PLAYER} a on a.source = s.provider
             and a.source_id = s.player_id::varchar
        left join {XW_PLAYER} b on b.source = s.provider
             and b.source_id = s.similar_player_id::varchar""",
    "market": """select 'tm-' || player_id player_id, season, league, grp, age, minutes_,
                        value_eur, model_value, model_lo, model_hi, gap, inside_80
                 from ratings.market_value""",
    "referees": "select * from metrics.referees",
    "matches": """
        select t.match_id, t.competition_id, t.season, t.season_label, t.match_date,
               t.kickoff_utc, t.home_club, t.away_club, t.home_team, t.away_team, t.played,
               t.home_goals, t.away_goals, t.home_goals_official, t.away_goals_official,
               f.home_goals_ht, f.away_goals_ht,
               t.home_shots, t.away_shots, t.home_sot, t.away_sot, t.home_corners,
               t.away_corners, f.home_fouls, f.away_fouls, f.home_yellows, f.away_yellows,
               t.home_reds, t.away_reds, t.home_xg, t.away_xg,
               t.proxy_home_xg, t.proxy_away_xg, t.close_home, t.close_draw, t.close_away,
               t.close_source, coalesce(t.referee, g.referee) referee,
               g.home_manager, g.away_manager, g.home_formation, g.away_formation,
               g.attendance, g.stadium, g.round,
               p.elo_home, p.elo_away, p.elo_h, p.elo_d, p.elo_a, p.mkt_h, p.mkt_d, p.mkt_a,
               {LAMBDAS}
        from core.team_matches t
        left join forecast.wf_predictions p using (match_id)
        left join stg.fd_matches f using (fd_match_id)
        left join stg.tm_games g on t.match_id = 'tm-' || g.game_id""",
    "match_events": """
        select 'tm-' || e.game_id match_id, e.minute, e.added, e.type,
               'tm-' || e.club_id club_id, 'tm-' || e.player_id player_id,
               'tm-' || e.player_in_id player_in_id, 'tm-' || e.player_assist_id assist_id,
               e.is_penalty, e.is_own_goal, e.card
        from stg.tm_events e
        where 'tm-' || e.game_id in (select match_id from core.team_matches)""",
    "match_lineups": """
        select 'tm-' || l.game_id match_id, 'tm-' || l.club_id club_id,
               'tm-' || l.player_id player_id, l.starter, l.slot, l.position_group, l.shirt,
               l.captain
        from stg.tm_lineups l
        where 'tm-' || l.game_id in (select match_id from core.team_matches)""",
    "zones_team": """
        select coalesce(c.canonical_id, z.provider || '-' || z.team_id) club_id, z.provider,
               z.competition_id, z.season, z.side, z.zx, z.zy, z.touches, z.passes,
               z.passes_ok, z.receptions, round(z.xt_added, 4)::float xt_added,
               round(z.vaep_off, 4)::float vaep_off, round(z.vaep_def, 4)::float vaep_def,
               z.shots, round(z.xg, 4)::float xg, z.goals, z.def_actions, z.pressures,
               z.turnovers, g.matches
        from metrics.zones_team z
        join metrics.zones_team_games g using (provider, competition_id, season, team_id)
        left join {XW_CLUB} c on c.source = z.provider and c.source_id = z.team_id::varchar""",
    "zones_player": """
        select coalesce(x.canonical_id, z.provider || '-' || z.player_id) player_id,
               z.provider, z.competition_id, z.season, z.zx, z.zy, z.touches,
               round(z.xt_added, 4)::float xt_added, round(z.vaep_off, 4)::float vaep_off,
               round(z.vaep_def, 4)::float vaep_def, z.shots, round(z.xg, 4)::float xg,
               z.goals, z.def_actions, z.pressures, z.turnovers
        from metrics.zones_player z
        left join {XW_PLAYER} x on x.source = z.provider and x.source_id = z.player_id""",
    "xt_grid": """select cx, cy, x_mid, y_mid, xt from metrics.xt_grid
                  where subset = 'pooled'""",
    "transfers": """
        select 'tm-' || t.player_id player_id, t.transfer_date, t.transfer_season,
               'tm-' || t.from_club_id from_club, 'tm-' || t.to_club_id to_club,
               t.from_club_name, t.to_club_name, t.fee_eur, t.value_eur
        from stg.tm_transfers t
        where t.transfer_date >= '2012-07-01'
          and (t.from_club_id in (select club_id from stg.tm_clubs)
               or t.to_club_id in (select club_id from stg.tm_clubs))""",
    "valuations": """
        select 'tm-' || v.player_id player_id, v.value_date, v.value_eur,
               'tm-' || v.club_id club_id
        from stg.tm_valuations v
        where v.value_date >= '2010-01-01'
          and v.player_id in (select player_id from ratings.player_season_c)""",
    "fm_player_season": "select * exclude (player_fm_id, name) from metrics.fm_player_season",
    "fm_players": """select distinct on (f.player_id) f.player_id, m.name, m.age, m.country
                     from metrics.fm_player_season f join stg.fm_player_match m
                       on m.player_fm_id = f.player_fm_id where f.player_id like 'fm-%'""",
    "fm_zones_team": "select * from metrics.fm_zones_team",
    "fm_zones_player": "select * from metrics.fm_zones_player",
    "fm_team_match": "select * from metrics.fm_team_match",
    "fixtures": """select * exclude (home_name, away_name), home_name, away_name
                   from metrics.fm_fixtures""",
    "fm_events": """select x.match_id, e.type, e.minute, e.minute_added, e.is_home,
                           coalesce(p.player_id, 'fm-' || e.player_fm_id::bigint) player_id,
                           e.player_name, e.card, e.own_goal, e.penalty, e.sub_in, e.sub_out
                    from stg.fm_events e join core.fm_matches_xw x using (fm_match_id)
                    left join (select distinct player_fm_id, player_id from core.fm_players) p
                      on p.player_fm_id = e.player_fm_id::bigint""",
    "fm_lineups": """
        select x.match_id, c.club_id, coalesce(p.player_id, 'fm-' || m.player_fm_id) player_id,
               m.name, m.starter, m.shirt, m.usual_position_id, m.layout_x, m.layout_y,
               m.sub_in, m.sub_out, m.rating
        from stg.fm_player_match m join core.fm_matches_xw x using (fm_match_id)
        left join core.fm_clubs c on c.competition_id = m.competition_id
             and c.season = m.season and c.fm_id = m.team_fm_id
        left join (select distinct player_fm_id, player_id from core.fm_players) p
          on p.player_fm_id = m.player_fm_id
        where x.match_id is not null""",
    "matchup_factors": "select * from research.matchup_factors",
    "matchup_factor_bins": "select * from research.matchup_factor_bins",
    "timelines": """
        select w.match_id, w.minute::tinyint as minute, w.gd::tinyint as gd,
               w.p_home::float p_home, w.p_draw::float p_draw, w.p_away::float p_away
        from forecast.wp_timelines w
        join core.team_matches t using (match_id) where t.season >= 2023""",
    "matches_a": """
        with m as (select 'wyscout' provider, match_id, competition_id, season,
                          kickoff_utc::date match_date, home_team_id, away_team_id,
                          home_goals, away_goals from stg.wy_matches
                   union all
                   select 'statsbomb', match_id, competition_id, season, match_date,
                          home_team_id, away_team_id, home_goals, away_goals
                   from stg.sb_matches)
        select m.*, x.canonical_id canonical_match_id,
               coalesce(h.canonical_id, m.provider || '-' || m.home_team_id) home_club,
               coalesce(a.canonical_id, m.provider || '-' || m.away_team_id) away_club,
               d.xg_home, d.xg_away, d.p_home, d.p_draw, d.p_away
        from m
        left join (select source, source_id, canonical_id from core.crosswalk
                   where entity = 'match') x
               on x.source = m.provider and x.source_id = m.match_id::varchar
        left join {XW_CLUB} h on h.source = m.provider and h.source_id = m.home_team_id::varchar
        left join {XW_CLUB} a on a.source = m.provider and a.source_id = m.away_team_id::varchar
        left join metrics.match_deserved_a d
               on d.provider = m.provider and d.match_id = m.match_id""",
    "shots_wy": """
        select s.match_id, s.period, round(s.time_s)::int time_s,
               coalesce(c.canonical_id, 'wy-' || s.team_id) club_id,
               coalesce(p.canonical_id, 'wy-' || s.player_id) player_id,
               round(s.start_x, 1)::float x, round(s.start_y, 1)::float y,
               round(s.xg, 4)::float xg, s.goal::tinyint goal, s.body, s.situation, s.assist
        from metrics.shots s
        left join {XW_CLUB} c on c.source = 'wyscout' and c.source_id = s.team_id::varchar
        left join {XW_PLAYER} p on p.source = 'wyscout' and p.source_id = s.player_id::varchar
        where s.provider = 'wyscout'""",
    "team_style": """
        select coalesce(c.canonical_id, t.provider || '-' || t.team_id) club_id, t.*
        from metrics.team_style_a t
        left join {XW_CLUB} c on c.source = t.provider and c.source_id = t.team_id::varchar""",
}


def build(publish_dir: Path = OUT) -> dict:
    paths = get_paths()
    if publish_dir.exists():
        shutil.rmtree(publish_dir)
    publish_dir.mkdir(parents=True)
    files, rows = {}, {}
    with connect(paths, read_only=True) as con:
        hl, w = con.execute("select half_life, w_goals from forecast.wf_chosen").fetchall()[0]
        lambdas = (f"exp({w} * ln(p.lh_g_{hl}) + {1 - w} * ln(coalesce(p.lh_x_{hl}, "
                   f"p.lh_g_{hl}))) lh, exp({w} * ln(p.la_g_{hl}) + {1 - w} * "
                   f"ln(coalesce(p.la_x_{hl}, p.la_g_{hl}))) la, p.rho_{hl} rho")  # fmt: skip
        for name, sql in TABLES.items():
            fm = name.startswith("fm_") or name == "fixtures"
            if fm and not has_table(con, "metrics", "fm_player_season"):
                continue
            sql = (sql.replace("{XW_PLAYER}", XW_PLAYER).replace("{XW_CLUB}", XW_CLUB)
                   .replace("{LAMBDAS}", lambdas))  # fmt: skip
            tmp = publish_dir / f"{name}.parquet"
            # sorted rows: unchanged data gives identical bytes, so an unchanged table keeps
            # its file name and the version only moves when something really changed
            con.execute(f"copy (select * from ({sql}) order by all) to '{tmp.as_posix()}' "
                        "(format parquet, compression zstd, row_group_size 50000)")  # fmt: skip
            h = hashlib.sha256(tmp.read_bytes()).hexdigest()[:8]
            final = publish_dir / f"{name}.{h}.parquet"
            tmp.rename(final)
            files[name] = final.name
            rows[name] = con.execute(f"select count(*) from read_parquet('{final.as_posix()}')"
                                     ).fetchall()[0][0]  # fmt: skip
        through = (
            con.execute("select max(match_date) from core.team_matches where played").fetchall()[0][
                0
            ]
            if has_table(con, "core", "team_matches")
            else None
        )
    version = hashlib.sha256(json.dumps(files, sort_keys=True).encode()).hexdigest()[:12]
    manifest = {
        "version": version,
        "built_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "data_through": str(through) if through else None,
        "files": files,
        "rows": rows,
        "attribution": {
            "statsbomb": "Event data: StatsBomb (Hudl) open data, used under the StatsBomb "
                         "Public Data User Agreement (non-commercial).",
            "wyscout": "Event data 2017-18: Pappalardo et al. (2019), Wyscout public dataset, "
                       "CC BY 4.0.",
            "transfermarkt": "Lineups, minutes, events, values: Transfermarkt via the "
                             "dcaribou/transfermarkt-datasets mirror.",
            "footballdata": "Results, match statistics and odds: football-data.co.uk.",
        },
    }  # fmt: skip
    (publish_dir / "manifest.json").write_text(json.dumps(manifest, indent=2),
                                               encoding="utf-8")  # fmt: skip
    size = sum(p.stat().st_size for p in publish_dir.iterdir())
    return {"version": version, "tables": len(files), "mb": round(size / 1e6, 1)}


def _git(*args: str, cwd: Path | None = None) -> str:
    r = subprocess.run(["git", *args], cwd=cwd or REPO_ROOT, check=True, capture_output=True,
                       text=True)  # fmt: skip
    return r.stdout.strip()


def publish(branch: str = "gh-pages") -> str:
    """Build the app and force-push it, with the data, as a single commit on ``branch``.

    One orphan commit per deploy keeps the ~75 MB of DuckDB wasm out of an ever-growing
    history. The previous version's data files are carried over, so a page still running on
    the old manifest keeps working until its visitor refreshes (the banner asks them to).
    Authored by the repo-local git identity; no other metadata is added.
    """
    app = REPO_ROOT / "app"
    npm = shutil.which("npm") or shutil.which("npm.cmd")
    if not npm:
        raise RuntimeError("npm not found")
    subprocess.run([npm, "run", "build"], cwd=app, check=True, shell=False)
    dist = app / "dist"
    manifest = json.loads((dist / "data" / "manifest.json").read_text(encoding="utf-8"))
    url = _git("config", "remote.origin.url")
    name, email = _git("config", "user.name"), _git("config", "user.email")
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
        site = Path(tmp) / "site"
        try:
            _git("clone", "--depth", "1", "--branch", branch, url, str(site))
            old = json.loads((site / "data" / "manifest.json").read_text(encoding="utf-8"))
            keep = {f: (site / "data" / f).read_bytes() for f in old["files"].values()
                    if (site / "data" / f).exists()}  # fmt: skip
        except (subprocess.CalledProcessError, FileNotFoundError, KeyError):
            keep = {}
            if site.exists():
                shutil.rmtree(site, ignore_errors=True)
            site.mkdir(parents=True)
            _git("init", cwd=site)
        for p in site.iterdir():
            if p.name != ".git":
                shutil.rmtree(p) if p.is_dir() else p.unlink()
        shutil.copytree(dist, site, dirs_exist_ok=True)
        for f, b in keep.items():
            if not (site / "data" / f).exists():
                (site / "data" / f).write_bytes(b)
        (site / ".nojekyll").touch()
        _git("checkout", "--orphan", "deploy", cwd=site)
        _git("add", "-A", cwd=site)
        _git("-c", f"user.name={name}", "-c", f"user.email={email}", "commit", "-q", "-m",
             f"Deploy data version {manifest['version']}", cwd=site)  # fmt: skip
        _git("push", "--force", url, f"deploy:{branch}", cwd=site)
    return manifest["version"]
