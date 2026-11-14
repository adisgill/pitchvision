"""Stage the Wyscout public dataset (Pappalardo et al. 2019, CC BY 4.0): matches, players,
teams, and the 2017-18 big-five events mapped into the unified action table
(``stg.actions``, shared with StatsBomb; spec 6.3).

Wyscout specifics (docs/phase0/data_profile.md):

* Coordinates are per event, from the acting team's view, 0-100 with y down; mapped with
  ``coords.to_meters('wyscout', ...)``. Goal-kick start positions and shot end positions
  are placeholders and become null.
* Duels are logged as pairs (one event per player); both are kept as duel actions.
* **No carries, and none can be inferred** (*Change, Nov 14*): the public files chain
  positions, so every event starts exactly where the previous pass ended. Spec 4.3's
  inference finds nothing real (2,853 "gaps" in 3.1 M events, all after duels or
  stoppages). Wyscout's own ``Acceleration`` events are the only carries, kept as
  ``dribble``. Carry-based metrics are blank for Wyscout seasons.
* A corner carrying the goal tag (a goal direct from a corner) becomes ``shot_freekick``.
* A tag-1401 interception becomes its own ``interception`` action before the event it's on.
* Some names in the public files are double-escaped (``\\u00e9``); they are decoded.
"""

from __future__ import annotations

import json
import re
import zipfile

import numpy as np
import pandas as pd

from pitchvision.config import Paths
from pitchvision.db import materialize
from pitchvision.stg.coords import to_meters

LEAGUES = {"England": "GB1", "Spain": "ES1", "Germany": "L1", "Italy": "IT1", "France": "FR1"}
SEASON = 2017

FREE_KICK = {30: "corner", 31: "freekick_short", 32: "freekick_crossed",
             33: "shot_freekick", 34: "goalkick", 35: "shot_penalty", 36: "throw_in"}  # fmt: skip
GOAL_ZONE = {1201: "gb", 1202: "gbr", 1203: "gc", 1204: "gl", 1205: "glb", 1206: "gr",
             1207: "gt", 1208: "gtl", 1209: "gtr", 1210: "obr", 1211: "ol", 1212: "olb",
             1213: "or", 1214: "ot", 1215: "otl", 1216: "otr", 1217: "pbr", 1218: "pl",
             1219: "plb", 1220: "pr", 1221: "pt", 1222: "ptl", 1223: "ptr"}  # fmt: skip
PERIOD = {"1H": 1, "2H": 2, "E1": 3, "E2": 4, "P": 5}


def _fix(s):
    if isinstance(s, str) and "\\u" in s:
        return re.sub(r"\\u([0-9a-fA-F]{4})", lambda m: chr(int(m.group(1), 16)), s)
    return s


def _zip(paths: Paths, kind: str) -> zipfile.ZipFile:
    return zipfile.ZipFile(paths.source("wyscout") / kind / f"{kind}.zip")


def matches(paths: Paths) -> tuple[pd.DataFrame, pd.DataFrame]:
    """(matches, lineups) for the five leagues."""
    rows, lu = [], []
    z = _zip(paths, "matches")
    for country, comp in LEAGUES.items():
        for m in json.loads(z.read(f"matches_{country}.json")):
            sides = {t["side"]: t for t in m["teamsData"].values()}
            h, a = sides["home"], sides["away"]
            ref = next((r["refereeId"] for r in m["referees"] if r["role"] == "referee"), None)
            rows.append({"match_id": m["wyId"], "competition_id": comp, "season": SEASON,
                         "kickoff_utc": pd.Timestamp(m["dateutc"], tz="UTC"),
                         "gameweek": m["gameweek"], "home_team_id": h["teamId"],
                         "away_team_id": a["teamId"], "home_goals": h["score"],
                         "away_goals": a["score"], "home_goals_ht": h["scoreHT"],
                         "away_goals_ht": a["scoreHT"], "referee_id": ref,
                         "home_coach_id": h["coachId"], "away_coach_id": a["coachId"],
                         "venue": _fix(m["venue"])})  # fmt: skip
            for t in (h, a):
                f = t["formation"]
                for p in f.get("lineup") or []:
                    lu.append((m["wyId"], t["teamId"], p["playerId"], True, None, None))
                for p in f.get("bench") or []:
                    lu.append((m["wyId"], t["teamId"], p["playerId"], False, None, None))
                for s in f.get("substitutions") or []:
                    if isinstance(s, dict):
                        lu.append((m["wyId"], t["teamId"], s["playerIn"], False,
                                   s["minute"], s["playerOut"]))  # fmt: skip
    lineups = pd.DataFrame(lu, columns=["match_id", "team_id", "player_id", "starter",
                                        "sub_minute", "replaced_player_id"])  # fmt: skip
    return pd.DataFrame(rows), lineups


def players(paths: Paths) -> pd.DataFrame:
    raw = json.loads((paths.source("wyscout") / "players" / "players.json").read_text("utf-8"))
    return pd.DataFrame([{
        "player_id": p["wyId"], "first_name": _fix(p["firstName"]),
        "last_name": _fix(p["lastName"]), "short_name": _fix(p["shortName"]),
        "birth_date": pd.to_datetime(p["birthDate"], errors="coerce"),
        "role": p["role"]["code2"], "citizenship": (p.get("passportArea") or {}).get("name"),
        "height_cm": p["height"], "foot": p["foot"] or None,
    } for p in raw])  # fmt: skip


def teams(paths: Paths) -> pd.DataFrame:
    raw = json.loads((paths.source("wyscout") / "teams" / "teams.json").read_text("utf-8"))
    return pd.DataFrame([{"team_id": t["wyId"], "name": _fix(t["name"]),
                          "official_name": _fix(t["officialName"]), "city": _fix(t["city"]),
                          "area": t["area"]["name"], "type": t["type"]} for t in raw])  # fmt: skip


def _events(paths: Paths) -> pd.DataFrame:
    z = _zip(paths, "events")
    rows = []
    for country in LEAGUES:
        for e in json.loads(z.read(f"events_{country}.json")):
            pos = e["positions"]
            tags = {t["id"] for t in e["tags"]}
            rows.append((e["matchId"], e["id"], PERIOD.get(e["matchPeriod"]), e["eventSec"],
                         e["teamId"], e["playerId"], e["eventId"], e["subEventId"] or 0,
                         pos[0]["x"] if pos else np.nan, pos[0]["y"] if pos else np.nan,
                         pos[1]["x"] if len(pos) > 1 else np.nan,
                         pos[1]["y"] if len(pos) > 1 else np.nan, tags))  # fmt: skip
    return pd.DataFrame(rows, columns=["match_id", "event_id", "period", "time_s", "team_id",
                                       "player_id", "type_id", "subtype_id", "x0", "y0",
                                       "x1", "y1", "tags"])  # fmt: skip


def to_actions(ev: pd.DataFrame) -> pd.DataFrame:
    """Map Wyscout events to unified actions (vectorised where it matters)."""
    ev = ev.sort_values(["match_id", "period", "time_s", "event_id"]).reset_index(drop=True)
    t, s, tags = ev.type_id.to_numpy(), ev.subtype_id.to_numpy(), ev.tags.to_numpy()

    def has(tag):
        return np.fromiter((tag in x for x in tags), bool, len(tags))

    accurate, inaccurate = has(1801), has(1802)
    won, lost = has(703), has(701)
    goal, own_goal = has(101), has(102)
    take_on = has(503) | has(504)
    typ = np.full(len(ev), None, dtype=object)
    typ[(t == 8) & (s == 80)] = "cross"
    typ[(t == 8) & (s != 80)] = "pass"
    for sub, name in FREE_KICK.items():
        typ[(t == 3) & (s == sub)] = name
    typ[t == 10] = "shot"
    typ[(t == 1) & (s == 10)] = "aerial_duel"
    typ[(t == 1) & (s == 11)] = np.where(take_on[(t == 1) & (s == 11)], "take_on",
                                          "ground_duel")  # fmt: skip
    typ[(t == 1) & (s == 12)] = "tackle"
    typ[(t == 1) & (s == 13)] = "ground_duel"
    typ[t == 2] = "foul"
    typ[t == 4] = "keeper_claim"
    typ[t == 9] = "keeper_save"
    typ[(t == 7) & (s == 70)] = "dribble"
    typ[(t == 7) & (s == 71)] = "clearance"
    touch = (t == 7) & (s == 72)
    typ[touch] = np.where((lost | has(1302))[touch], "bad_touch", "touch")
    # corners: crossed when they end in the box
    typ[(typ == "corner") & goal] = "shot_freekick"  # goal direct from a corner
    corner = typ == "corner"
    in_box = (ev.x1.to_numpy() >= 84) & (ev.y1.to_numpy() >= 19) & (ev.y1.to_numpy() <= 81)
    typ[corner] = np.where(in_box[corner], "corner_crossed", "corner_short")

    result = np.where(accurate, "success", np.where(inaccurate, "fail", None)).astype(object)
    duel = np.isin(typ, ["aerial_duel", "ground_duel", "take_on", "tackle"])
    result[duel] = np.where(won[duel], "success", np.where(lost[duel], "fail", "neutral"))
    shotlike = np.isin(typ, ["shot", "shot_freekick", "shot_penalty"])
    result[shotlike] = np.where(goal[shotlike], "success", "fail")
    result[typ == "keeper_save"] = np.where(goal[typ == "keeper_save"], "fail", "success")
    result[own_goal] = "owngoal"
    result[pd.isna(result) & pd.notna(typ)] = "success"
    # offside: the preceding pass of that team failed as offside
    off = np.flatnonzero(t == 6)
    for i in off:
        if i > 0 and typ[i - 1] in ("pass", "cross"):
            result[i - 1] = "offside"

    body = np.where(has(403) | (s == 82), "head",
                    np.where(has(401) | has(402), "foot", "other")).astype(object)  # fmt: skip
    x0, y0, x1, y1 = (ev[c].to_numpy(dtype=float) for c in ("x0", "y0", "x1", "y1"))
    x1 = np.where(shotlike | (t == 9), np.nan, x1)  # placeholder end positions
    y1 = np.where(shotlike | (t == 9), np.nan, y1)
    gk = typ == "goalkick"
    x0, y0 = np.where(gk, np.nan, x0), np.where(gk, np.nan, y0)
    sx, sy = to_meters("wyscout", x0, y0)
    ex, ey = to_meters("wyscout", x1, y1)
    zone = [next((GOAL_ZONE[z] for z in x if z in GOAL_ZONE), None) for x in tags]
    out = pd.DataFrame({
        "provider": "wyscout", "match_id": ev.match_id, "event_id": ev.event_id.astype(str),
        "period": ev.period, "time_s": ev.time_s, "team_id": ev.team_id,
        "player_id": ev.player_id, "type": typ, "result": result, "bodypart": body,
        "start_x": sx, "start_y": sy, "end_x": np.where(np.isnan(ex), sx, ex),
        "end_y": np.where(np.isnan(ey), sy, ey), "counter": has(1901), "key_pass": has(302),
        "assist": has(301), "through_ball": (t == 8) & (s == 86), "goal_zone": zone,
        "under_pressure": None, "provider_xg": np.nan, "interception": has(1401),
    })  # fmt: skip
    out.loc[shotlike, ["end_x", "end_y"]] = np.nan
    out = out[out.type.notna()].reset_index(drop=True)
    # interceptions: a separate action just before the event that carries the tag
    icp = out[out.interception].copy()
    icp["type"], icp["result"], icp["time_s"] = "interception", "success", icp.time_s - 1e-3
    icp["end_x"], icp["end_y"] = icp.start_x, icp.start_y
    icp["event_id"] = icp.event_id + "i"
    out = pd.concat([out, icp], ignore_index=True)
    out = out.sort_values(["match_id", "period", "time_s"], kind="stable").reset_index(drop=True)
    out["seq"] = out.groupby("match_id").cumcount()
    return out.drop(columns="interception")


def build(con, paths: Paths) -> dict[str, int]:
    m, lu = matches(paths)
    frames = {"wy_matches": m, "wy_lineups": lu, "wy_players": players(paths),
              "wy_teams": teams(paths), "wy_actions": to_actions(_events(paths))}  # fmt: skip
    n = {}
    for name, df in frames.items():
        con.register("tmp_df", df)
        n[name] = materialize(con, paths, "stg", name, "select * from tmp_df")
        con.unregister("tmp_df")
    return n
