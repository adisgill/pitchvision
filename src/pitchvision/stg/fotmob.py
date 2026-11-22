"""Stage FotMob pages (2024-25 onward; approved Nov 15; raw pages never re-hosted).

Tables (schema ``stg``):

* ``fm_fixtures``: every league fixture from the league pages, played or not, with the
  kick-off (UTC) and FotMob team ids. Unplayed rows are the upcoming schedule.
* ``fm_matches``: one row per staged match page: teams, score, kick-off, stadium (with
  coordinates and capacity), referee, formations, coaches.
* ``fm_shots``: every shot: team, player, minute, x/y on a 105 x 68 frame attacking left to
  right, xG, xGOT, situation, body part, outcome.
* ``fm_player_match``: one row per player per match: team, starter, minutes, position id,
  shirt, layout x/y, rating, market value, age; ``fm_player_stats`` holds every stat FotMob
  shows for that player in long form (key, value, total).
* ``fm_team_stats``: every team stat in long form (key, home, away).
* ``fm_events``: goals, cards and substitutions with minute and players.
"""

from __future__ import annotations

import re
from pathlib import Path

import pandas as pd

from pitchvision.config import Paths
from pitchvision.db import materialize
from pitchvision.ingest.fotmob import LEAGUES, page_props

COMP = {v: k for k, v in LEAGUES.items()}


def _key(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", s.lower()).strip("_")


def fixtures(root: Path) -> pd.DataFrame:
    rows = []
    for p in sorted((root / "leagues").glob("*/*.html.gz")):
        comp, season = p.parent.name, int(p.name.split(".")[0])
        try:
            ms = page_props(p)["fixtures"]["allMatches"]
        except (KeyError, ValueError):
            continue
        for m in ms:
            st = m.get("status", {})
            score = st.get("scoreStr")
            hg = ag = None
            if score and "-" in score:
                a, b = (x.strip() for x in score.split("-", 1))
                hg, ag = (int(a), int(b)) if a.isdigit() and b.isdigit() else (None, None)
            rows.append({
                "fm_match_id": int(m["id"]), "competition_id": comp, "season": season,
                "round": str(m.get("round")), "kickoff_utc": st.get("utcTime"),
                "home_fm_id": int(m["home"]["id"]), "home_name": m["home"]["name"],
                "away_fm_id": int(m["away"]["id"]), "away_name": m["away"]["name"],
                "finished": bool(st.get("finished")), "started": bool(st.get("started")),
                "cancelled": bool(st.get("cancelled")), "home_goals": hg, "away_goals": ag,
            })  # fmt: skip
    d = pd.DataFrame(rows)
    if len(d):
        # FotMob mixes "...:00Z" and "...:00.000Z"; ISO8601 parses both
        d["kickoff_utc"] = pd.to_datetime(d.kickoff_utc, utc=True, format="ISO8601").dt.tz_localize(
            None
        )
    return d


def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def match_tables(root: Path) -> dict[str, pd.DataFrame]:
    out: dict[str, list] = {k: [] for k in ("matches", "shots", "players", "pstats", "tstats",
                                             "events", "weather", "unavailable")}  # fmt: skip
    for p in sorted((root / "matches").glob("*/*/*.html.gz")):
        comp, season = p.parent.parent.name, int(p.parent.name)
        try:
            pp = page_props(p)
        except ValueError:
            continue
        g, c = pp.get("general", {}), pp.get("content", {})
        mid = int(g.get("matchId") or p.name.split(".")[0])
        hdr = pp.get("header", {}).get("teams", [{}, {}])
        home_id, away_id = int(g["homeTeam"]["id"]), int(g["awayTeam"]["id"])
        info = (c.get("matchFacts") or {}).get("infoBox") or {}
        stad = info.get("Stadium") or {}
        ref = info.get("Referee") or {}
        lu = c.get("lineup") or {}
        ht, at = lu.get("homeTeam") or {}, lu.get("awayTeam") or {}
        out["matches"].append({
            "fm_match_id": mid, "competition_id": comp, "season": season,
            "kickoff_utc": g.get("matchTimeUTCDate"), "round": str(g.get("matchRound")),
            "home_fm_id": home_id, "home_name": g["homeTeam"]["name"],
            "away_fm_id": away_id, "away_name": g["awayTeam"]["name"],
            "home_goals": hdr[0].get("score"), "away_goals": hdr[1].get("score"),
            "stadium": stad.get("name"), "city": stad.get("city"), "lat": _num(stad.get("lat")),
            "lon": _num(stad.get("long")), "capacity": _num(stad.get("capacity")),
            "referee": ref.get("text"), "home_formation": ht.get("formation"),
            "away_formation": at.get("formation"),
            "home_coach": (ht.get("coach") or {}).get("name"),
            "away_coach": (at.get("coach") or {}).get("name"),
            "finished": bool(g.get("finished")),
        })  # fmt: skip
        w = c.get("weather") or {}
        if w:
            out["weather"].append({
                "fm_match_id": mid, "temperature": _num(w.get("temperature")),
                "wind_speed": _num(w.get("windSpeed")), "humidity": _num(w.get("relativeHumidity")),
                "precipitation": _num(w.get("precipitation")), "snow": _num(w.get("snow")),
                "cloud_cover": _num(w.get("cloudCover")), "description": w.get("description"),
            })  # fmt: skip
        for side_key, team_id in (("homeTeam", home_id), ("awayTeam", away_id)):
            for u in (lu.get(side_key) or {}).get("unavailable") or []:
                ua = u.get("unavailability") or {}
                out["unavailable"].append({
                    "fm_match_id": mid, "competition_id": comp, "season": season,
                    "team_fm_id": team_id, "player_fm_id": u.get("id"), "name": u.get("name"),
                    "type": ua.get("type"), "injury_id": ua.get("injuryId"),
                    "expected_return": ua.get("expectedReturn"),
                    "market_value": _num(u.get("marketValue")), "age": u.get("age"),
                })  # fmt: skip
        for s in (c.get("shotmap") or {}).get("shots") or []:
            out["shots"].append({
                "fm_match_id": mid, "competition_id": comp, "season": season,
                "team_fm_id": s.get("teamId"), "player_fm_id": s.get("playerId"),
                "player_name": s.get("playerName"), "minute": s.get("min"),
                "minute_added": s.get("minAdded"), "period": s.get("period"),
                "x": _num(s.get("x")), "y": _num(s.get("y")), "xg": _num(s.get("expectedGoals")),
                "xgot": _num(s.get("expectedGoalsOnTarget")), "event_type": s.get("eventType"),
                "situation": s.get("situation"), "shot_type": s.get("shotType"),
                "on_target": bool(s.get("isOnTarget")), "blocked": bool(s.get("isBlocked")),
                "own_goal": bool(s.get("isOwnGoal")), "inside_box": bool(s.get("isFromInsideBox")),
                "goal": s.get("eventType") == "Goal",
            })  # fmt: skip
        for side, team in (("home", ht), ("away", at)):
            tid = team.get("id") or (home_id if side == "home" else away_id)
            groups = ((True, team.get("starters") or []), (False, team.get("subs") or []))
            for starter, group in groups:
                for pl in group:
                    perf = pl.get("performance") or {}
                    subs = perf.get("substitutionEvents") or []
                    sub_in = next((e.get("time") for e in subs if e.get("type") == "subIn"), None)
                    sub_out = next((e.get("time") for e in subs if e.get("type") == "subOut"), None)
                    lay = pl.get("horizontalLayout") or {}
                    out["players"].append({
                        "fm_match_id": mid, "competition_id": comp, "season": season,
                        "team_fm_id": int(tid), "player_fm_id": int(pl["id"]),
                        "name": pl.get("name"),
                        "starter": starter, "position_id": pl.get("positionId"),
                        "usual_position_id": pl.get("usualPlayingPositionId"),
                        "shirt": pl.get("shirtNumber"), "age": pl.get("age"),
                        "country": pl.get("countryName"), "market_value": pl.get("marketValue"),
                        "rating": _num(perf.get("rating")), "sub_in": sub_in, "sub_out": sub_out,
                        "layout_x": _num(lay.get("x")), "layout_y": _num(lay.get("y")),
                    })  # fmt: skip
        for pid, ps in (c.get("playerStats") or {}).items():
            for grp in ps.get("stats") or []:
                for title, v in (grp.get("stats") or {}).items():
                    st = v.get("stat") or {}
                    val = _num(st.get("value"))
                    if val is None:
                        continue
                    out["pstats"].append({
                        "fm_match_id": mid, "player_fm_id": int(pid),
                        "team_fm_id": ps.get("teamId"), "key": _key(title),
                        "value": val, "total": _num(st.get("total")),
                    })  # fmt: skip
        periods = ((c.get("stats") or {}).get("Periods") or {}).get("All") or {}
        for grp in periods.get("stats") or []:
            for s in grp.get("stats") or []:
                raw = s.get("rawStats") or s.get("stats")
                if not isinstance(raw, list) or len(raw) != 2 or not s.get("key"):
                    continue
                h, a = (r.get("value") if isinstance(r, dict) else r for r in raw)
                out["tstats"].append({"fm_match_id": mid, "key": _key(s["key"]),
                                      "home": _num(h), "away": _num(a)})  # fmt: skip
        for e in ((c.get("matchFacts") or {}).get("events") or {}).get("events") or []:
            t = e.get("type")
            if t not in ("Goal", "Card", "Substitution"):
                continue
            sw = e.get("swap") or [{}, {}]
            out["events"].append({
                "fm_match_id": mid, "type": t.lower(), "minute": e.get("time"),
                "minute_added": e.get("overloadTime"), "is_home": e.get("isHome"),
                "player_fm_id": (e.get("player") or {}).get("id") or e.get("playerId"),
                "player_name": (e.get("player") or {}).get("name") or e.get("nameStr"),
                "card": e.get("card"), "own_goal": bool(e.get("ownGoal")),
                "penalty": e.get("goalDescriptionKey") == "penalty",
                "sub_in": (sw[0] or {}).get("name") if t == "Substitution" else None,
                "sub_out": ((sw[1] or {}).get("name")
                            if t == "Substitution" and len(sw) > 1 else None),
            })  # fmt: skip
    frames = {k: pd.DataFrame(v) for k, v in out.items()}
    if len(frames["matches"]):
        frames["matches"]["kickoff_utc"] = pd.to_datetime(
            frames["matches"].kickoff_utc, utc=True, format="ISO8601"
        ).dt.tz_localize(None)
    return frames


def build(con, paths: Paths) -> dict[str, int]:
    root = paths.source("fotmob")
    n: dict[str, int] = {}
    fx = fixtures(root)
    tables = {"fm_fixtures": fx, **{f"fm_{k}": v for k, v in {
        "matches": None, "shots": None, "player_match": None, "player_stats": None,
        "team_stats": None, "events": None}.items()}}  # fmt: skip
    mt = match_tables(root)
    tables.update({"fm_matches": mt["matches"], "fm_shots": mt["shots"],
                   "fm_player_match": mt["players"], "fm_player_stats": mt["pstats"],
                   "fm_team_stats": mt["tstats"], "fm_events": mt["events"],
                   "fm_weather": mt["weather"], "fm_unavailable": mt["unavailable"]})  # fmt: skip
    for name, df in tables.items():
        if df is None or not len(df):
            continue
        con.register("tmp_df", df)
        n[name] = materialize(con, paths, "stg", name, "select * from tmp_df")
        con.unregister("tmp_df")
    return n
