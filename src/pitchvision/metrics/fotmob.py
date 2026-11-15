"""Current-season metrics from FotMob (spec 12.4), 2024-25 onward.

* ``fm_player_season``: every player's season (league, club, position group, minutes) with
  ~40 per-90 measures (shooting, creation, progression, ball security, defending, duels,
  physical, goalkeeping) and 0-100 ratings on the house scale (50 = position average in the
  league-season, 10 points = one SD) for seven dimensions.
* ``fm_zones_team`` / ``fm_zones_player``: shots, xG and goals by 12 x 8 zone, team "for"
  and mirrored "against" (as in ``metrics.zones``), and per player.
* ``fm_team_match``: team match stats (xG, possession, big chances, touches in the box,
  passes...) keyed to our canonical match ids.
* ``fm_fixtures``: the schedule with our club ids, including every upcoming match.

Position groups come from FotMob's line-up layout: the depth and width a starter is drawn
at, refined by FotMob's broad role; substitutes take their most common starting group.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from pitchvision.config import Paths
from pitchvision.db import has_table, materialize

NX, NY = 12, 8

# stat key -> (our name, which field: "value" or "total")
STATS = {
    "minutes_played": ("minutes", "value"), "goals": ("goals", "value"),
    "assists": ("assists", "value"), "expected_goals_xg": ("xg", "value"),
    "xg_non_penalty": ("npxg", "value"), "expected_assists_xa": ("xa", "value"),
    "total_shots": ("shots", "value"), "shots_on_target": ("sot", "value"),
    "touches": ("touches", "value"), "touches_in_opposition_box": ("box_touches", "value"),
    "accurate_passes": ("passes_ok", "value"),
    "passes_into_final_third": ("final_third_passes", "value"),
    "line_breaking_passes": ("line_breaking", "value"), "chances_created": ("chances", "value"),
    "big_chances_created": ("big_chances", "value"),
    "successful_dribbles": ("dribbles_ok", "value"),
    "accurate_crosses": ("crosses_ok", "value"), "accurate_long_balls": ("long_ok", "value"),
    "dispossessed": ("dispossessed", "value"), "tackles": ("tackles", "value"),
    "interceptions": ("interceptions", "value"), "recoveries": ("recoveries", "value"),
    "clearances": ("clearances", "value"), "blocks": ("blocks", "value"),
    "dribbled_past": ("dribbled_past", "value"), "aerial_duels_won": ("aerials_won", "value"),
    "ground_duels_won": ("ground_won", "value"), "was_fouled": ("fouled", "value"),
    "fouls_committed": ("fouls", "value"), "distance_covered": ("distance_m", "value"),
    "number_of_sprints": ("sprints", "value"), "sprinting": ("sprint_m", "value"),
    "top_speed": ("top_speed", "value"), "fotmob_rating": ("rating", "value"),
    "saves": ("saves", "value"), "goals_conceded": ("conceded", "value"),
    "xgot_faced": ("xgot_faced", "value"), "goals_prevented": ("goals_prevented", "value"),
    "defensive_actions": ("def_actions", "value"), "error_led_to_goal": ("errors_goal", "value"),
    "big_chances_missed": ("big_chances_missed", "value"),
}  # fmt: skip
TOTALS = {"accurate_passes": "passes", "successful_dribbles": "dribbles",
          "accurate_crosses": "crosses", "accurate_long_balls": "long_balls",
          "aerial_duels_won": "aerials", "ground_duels_won": "ground_duels"}  # fmt: skip

# dimension -> [(per-90 or rate column, higher is better)]
DIMENSIONS = {
    "shooting": [("npxg_p90", True), ("shots_p90", True), ("box_touches_p90", True)],
    "creation": [("xa_p90", True), ("chances_p90", True), ("big_chances_p90", True)],
    "progression": [("final_third_passes_p90", True), ("line_breaking_p90", True),
                    ("dribbles_ok_p90", True)],
    "security": [("pass_pct", True), ("dispossessed_p90", False)],
    "defending": [("tackles_p90", True), ("interceptions_p90", True), ("recoveries_p90", True)],
    "duels": [("aerial_pct", True), ("ground_pct", True), ("aerials_won_p90", True)],
    "physical": [("distance_p90", True), ("sprints_p90", True), ("top_speed", True)],
    "goalkeeping": [("goals_prevented_p90", True), ("save_pct", True)],
}  # fmt: skip
OUTFIELD_ONLY = {"shooting", "creation", "progression", "defending", "duels"}


def _group(row) -> str | None:
    u, x, y = row.usual_position_id, row.layout_x, row.layout_y
    if u == 0:
        return "GK"
    if x is None or np.isnan(x):
        return None
    wide = y < 0.22 or y > 0.78
    if u == 1:
        return "FB" if wide else "CB"
    if u == 2:
        if wide:
            return "W"
        return "DM" if x < 0.45 else "AM" if x > 0.65 else "CM"
    if u == 3:
        return "W" if wide else "ST"
    return None


def player_match(con) -> pd.DataFrame:
    keys = ", ".join(f"'{k}'" for k in STATS)
    long = con.execute(f"""select fm_match_id, player_fm_id, key, value, total
                           from stg.fm_player_stats where key in ({keys})""").df()
    names = {k: v[0] for k, v in STATS.items()}
    wide = long.pivot_table(index=["fm_match_id", "player_fm_id"], columns="key", values="value",
                            aggfunc="max").rename(columns=names)  # fmt: skip
    tot = long[long.key.isin(TOTALS)].pivot_table(
        index=["fm_match_id", "player_fm_id"], columns="key", values="total", aggfunc="max"
    ).rename(columns=TOTALS)  # fmt: skip
    pm = con.execute("""select fm_match_id, player_fm_id, team_fm_id, competition_id, season,
                               starter, usual_position_id, layout_x, layout_y, market_value, age,
                               name
                        from stg.fm_player_match""").df()  # fmt: skip
    d = pm.merge(wide.join(tot).reset_index(), on=["fm_match_id", "player_fm_id"], how="left")
    d["group"] = [_group(r) if r.starter else None for r in d.itertuples()]
    return d


def player_season(con) -> pd.DataFrame:
    d = player_match(con)
    d = d[d.minutes.fillna(0) > 0]
    xw = con.execute("""select distinct player_fm_id, player_id from core.fm_players""").df()
    cm = con.execute(
        "select competition_id, season, fm_id team_fm_id, club_id from core.fm_clubs"
    ).df()
    d = d.merge(xw, on="player_fm_id", how="left").merge(
        cm, on=["competition_id", "season", "team_fm_id"], how="left"
    )
    d["player_id"] = d.player_id.fillna("fm-" + d.player_fm_id.astype(str))
    # modal starting group per player-season, weighted by minutes
    g = (d.dropna(subset=["group"]).groupby(["player_id", "competition_id", "season", "group"])
         .minutes.sum().reset_index().sort_values("minutes", ascending=False)
         .drop_duplicates(["player_id", "competition_id", "season"]))  # fmt: skip
    usual = d.groupby(["player_id", "competition_id", "season"]).usual_position_id.agg(
        lambda s: s.mode().iloc[0] if len(s.mode()) else np.nan
    )
    sums = [c for c in [v[0] for v in STATS.values()] + list(TOTALS.values())
            if c in d.columns and c not in ("rating", "top_speed")]  # fmt: skip
    agg = d.groupby(["player_id", "competition_id", "season"]).agg(
        **{c: (c, "sum") for c in sums},
        apps=("fm_match_id", "nunique"), starts=("starter", "sum"),
        rating=("rating", "mean"), top_speed=("top_speed", "max"),
        club_id=("club_id", lambda s: s.mode().iloc[0] if len(s.mode()) else None),
        name=("name", "first"), market_value=("market_value", "last"), age=("age", "max"),
        player_fm_id=("player_fm_id", "first"),
    ).reset_index()  # fmt: skip
    agg = agg.merge(g[["player_id", "competition_id", "season", "group"]],
                    on=["player_id", "competition_id", "season"], how="left")  # fmt: skip
    fallback = {0: "GK", 1: "CB", 2: "CM", 3: "ST"}
    um = usual.to_dict()
    fb = [
        fallback.get(um.get((a, b, c)))
        for a, b, c in zip(agg.player_id, agg.competition_id, agg.season, strict=True)
    ]
    agg["position_group"] = agg.group.where(agg.group.notna(), pd.Series(fb, index=agg.index))
    agg = agg.drop(columns="group").dropna(subset=["position_group"])
    n90 = agg.minutes / 90
    for c in sums:
        if c not in ("minutes", "passes", "dribbles", "crosses", "long_balls", "aerials",
                     "ground_duels"):  # fmt: skip
            agg[f"{c}_p90"] = agg[c] / n90
    agg["distance_p90"] = agg.distance_m / n90
    agg["pass_pct"] = agg.passes_ok / agg.passes
    agg["aerial_pct"] = agg.aerials_won / agg.aerials
    agg["ground_pct"] = agg.ground_won / agg.ground_duels
    agg["save_pct"] = agg.saves / (agg.saves + agg.conceded)
    return rate(agg)


def rate(ps: pd.DataFrame) -> pd.DataFrame:
    """50 + 10 z ratings within (league, season, position group), minutes-weighted, over
    qualified players (at least 270 minutes and a quarter of the most-used player's)."""
    out = []
    for _, g in ps.groupby(["competition_id", "season", "position_group"]):
        g = g.copy()
        top = g.minutes.max()
        q = (g.minutes >= max(270, 0.25 * top)).to_numpy()
        g["qualified"] = q
        w = g.minutes.to_numpy()
        for dim, comps in DIMENSIONS.items():
            if g.position_group.iloc[0] == "GK" and dim in OUTFIELD_ONLY:
                g[f"{dim}_rating"] = np.nan
                continue
            if g.position_group.iloc[0] != "GK" and dim == "goalkeeping":
                g[f"{dim}_rating"] = np.nan
                continue
            zs = []
            for col, higher in comps:
                x = g[col].to_numpy(dtype=float)
                ok = q & np.isfinite(x)
                if ok.sum() < 5:
                    continue
                mu = np.average(x[ok], weights=w[ok])
                sd = np.sqrt(np.average((x[ok] - mu) ** 2, weights=w[ok]))
                if sd <= 1e-12:
                    continue
                zs.append(((x - mu) / sd) * (1 if higher else -1))
            if not zs:
                g[f"{dim}_rating"] = np.nan
                continue
            s = np.nanmean(np.vstack(zs), axis=0)
            ok = q & np.isfinite(s)
            mu = np.average(s[ok], weights=w[ok]) if ok.sum() >= 5 else 0.0
            sd = np.sqrt(np.average((s[ok] - mu) ** 2, weights=w[ok])) if ok.sum() >= 5 else 1.0
            # shrink small samples toward average: half weight at 450 minutes
            k = g.minutes / (g.minutes + 450)
            g[f"{dim}_rating"] = np.clip(50 + 10 * k * (s - mu) / (sd or 1.0), 0, 100)
        out.append(g)
    return pd.concat(out, ignore_index=True)


def _zone(x: str, y: str) -> str:
    return (f"least({NX - 1}, greatest(0, floor({x} / (105.0 / {NX}))))::tinyint zx, "
            f"least({NY - 1}, greatest(0, floor({y} / (68.0 / {NY}))))::tinyint zy")  # fmt: skip


def build(con, paths: Paths) -> dict[str, int]:
    if not has_table(con, "stg", "fm_player_stats") or not has_table(con, "core", "fm_clubs"):
        return {}
    n = {}
    ps = player_season(con)
    con.register("tmp_df", ps)
    n["fm_player_season"] = materialize(con, paths, "metrics", "fm_player_season",
                                        "select * from tmp_df")  # fmt: skip
    con.unregister("tmp_df")
    shots = f"""
        select s.*, {_zone("s.x", "s.y")}, c.club_id,
               case when s.team_fm_id = m.home_fm_id then m.away_fm_id
                    else m.home_fm_id end opp_fm_id
        from stg.fm_shots s join stg.fm_matches m using (fm_match_id)
        left join core.fm_clubs c on c.competition_id = s.competition_id and c.season = s.season
             and c.fm_id = s.team_fm_id
        where s.x is not null and not s.own_goal"""
    n["fm_zones_team"] = materialize(con, paths, "metrics", "fm_zones_team", f"""
        with s as ({shots}),
        g as (select competition_id, season, team_fm_id, count(distinct fm_match_id) matches
              from (select competition_id, season, home_fm_id team_fm_id, fm_match_id
                  from stg.fm_matches
                    union all select competition_id, season, away_fm_id, fm_match_id
                        from stg.fm_matches)
              group by all)
        select c.club_id, s.competition_id, s.season, 'for' side, zx, zy, count(*) shots,
               sum(xg) xg, sum(goal::int) goals, any_value(g.matches) matches
        from s join core.fm_clubs c on c.competition_id = s.competition_id and c.season = s.season
             and c.fm_id = s.team_fm_id
        join g on g.competition_id = s.competition_id and g.season = s.season
            and g.team_fm_id = s.team_fm_id
        group by all
        union all
        select c.club_id, s.competition_id, s.season, 'against', ({NX - 1} - zx)::tinyint,
               ({NY - 1} - zy)::tinyint, count(*), sum(xg), sum(goal::int), any_value(g.matches)
        from s join core.fm_clubs c on c.competition_id = s.competition_id and c.season = s.season
             and c.fm_id = s.opp_fm_id
        join g on g.competition_id = s.competition_id and g.season = s.season
            and g.team_fm_id = s.opp_fm_id
        group by all""")  # fmt: skip
    n["fm_zones_player"] = materialize(con, paths, "metrics", "fm_zones_player", f"""
        with s as ({shots})
        select coalesce(p.player_id, 'fm-' || s.player_fm_id) player_id, s.competition_id,
               s.season, zx, zy, count(*) shots, sum(xg) xg, sum(goal::int) goals,
               sum(coalesce(xgot, 0)) xgot
        from s left join (select distinct player_fm_id, player_id from core.fm_players) p
          on p.player_fm_id = s.player_fm_id
        where s.player_fm_id is not null group by all""")  # fmt: skip
    keys = ["expected_goals", "expected_goals_open_play", "expected_goals_set_play",
            "expected_goals_non_penalty", "expected_goals_on_target", "ballpossesion",
            "total_shots", "shotsontarget", "big_chance", "big_chance_missed_title",
            "touches_opp_box", "passes", "accurate_passes", "corners", "fouls", "offsides",
            "interceptions", "matchstats_headers_tackles", "clearances", "keeper_saves",
            "duel_won", "aerials_won", "dribbles_succeeded", "physical_metrics_distance_covered",
            "physical_metrics_number_of_sprints"]  # fmt: skip
    cols = ", ".join(f"max(home) filter (where key = '{k}') home_{k}, "
                     f"max(away) filter (where key = '{k}') away_{k}" for k in keys)  # fmt: skip
    n["fm_team_match"] = materialize(
        con,
        paths,
        "metrics",
        "fm_team_match",
        f"""
        select x.match_id, x.fm_match_id, {cols}
        from stg.fm_team_stats t join core.fm_matches_xw x using (fm_match_id)
        group by x.match_id, x.fm_match_id""",
    )
    n["fm_fixtures"] = materialize(
        con,
        paths,
        "metrics",
        "fm_fixtures",
        """
        select x.fm_match_id, x.match_id, f.competition_id, f.season, f.round, f.kickoff_utc,
               x.home_club, x.away_club, f.home_name, f.away_name, f.finished, f.cancelled,
               f.home_goals, f.away_goals
        from stg.fm_fixtures f join core.fm_matches_xw x using (fm_match_id)""",
    )
    return n
