"""Stage StatsBomb open data (``hudl/open-data``, pinned commits; non-commercial licence,
never redistributed) into matches, lineups and the unified action table
(``stg.sb_actions``; spec 6.3).

StatsBomb specifics:

* Locations are per event, from the acting team's view (attacking left to right), on
  120 x 80 with y down; mapped with ``coords.to_meters('statsbomb', ...)``.
* Aerial duels won are flags on other events (``aerial_won`` on passes, shots, clearances,
  miscontrols); they become ``aerial_duel`` / success actions. Lost aerials are ``Duel``
  events.
* ``Own Goal Against`` (the scorer's team) becomes a ``touch`` with result ``owngoal``,
  matching the Wyscout convention.
* Shot end location (y, z) is kept in meters for post-shot xG; z is in yards on the
  source (crossbar 2.67) and is converted (x 0.9144).
* ``kick_off`` is local time; ``kickoff_utc`` uses the league's time zone (NWSL clubs span
  four zones, so NWSL keeps local time only until stadium zones are mapped).
"""

from __future__ import annotations

import gzip
import json
from pathlib import Path

import numpy as np
import pandas as pd

from pitchvision.catalog import SB_TIER_A, _sb_commit
from pitchvision.config import Paths
from pitchvision.db import materialize
from pitchvision.stg.coords import to_meters

COMPETITION = {2: "GB1", 11: "ES1", 12: "IT1", 7: "FR1", 9: "L1", 37: "WSL", 135: "FBL",
               182: "LIGAF", 131: "SERIEAW", 49: "NWSL"}  # fmt: skip
TZ = {"GB1": "Europe/London", "ES1": "Europe/Madrid", "IT1": "Europe/Rome",
      "FR1": "Europe/Paris", "L1": "Europe/Berlin", "WSL": "Europe/London",
      "FBL": "Europe/Berlin", "LIGAF": "Europe/Madrid", "SERIEAW": "Europe/Rome"}  # fmt: skip
YD = 0.9144

PASS_FAIL = {"Incomplete": "fail", "Out": "fail", "Unknown": "fail",
             "Injury Clearance": "fail", "Pass Offside": "offside"}  # fmt: skip
WON = {"Won", "Success", "Success In Play", "Success Out"}
GK_SAVE = {"Shot Saved", "Shot Saved Off T", "Shot Saved to Post", "Save", "Penalty Saved",
           "Smother", "Penalty Saved to Post"}  # fmt: skip
GK_CONCEDED = {"Goal Conceded", "Penalty Conceded"}
GK_CLAIM = {"Collected": "keeper_claim", "Claim": "keeper_claim", "Punch": "keeper_punch",
            "Keeper Sweeper": "keeper_sweeper"}  # fmt: skip
DROP = {"Ball Receipt*", "Half Start", "Half End", "Starting XI", "Substitution",
        "Tactical Shift", "Injury Stoppage", "Player On", "Player Off", "Referee Ball-Drop",
        "Offside", "Shield", "Camera On", "Camera off", "Own Goal For",
        "Bad Behaviour"}  # fmt: skip


def _read(p: Path):
    opener = gzip.open if p.suffix == ".gz" else open
    with opener(p, "rt", encoding="utf-8") as f:
        return json.load(f)


def _body(d: dict | None) -> str:
    name = ((d or {}).get("body_part") or {}).get("name", "")
    return "head" if name == "Head" else "foot" if "Foot" in name else "other"


def _event_action(e: dict) -> list[dict]:
    """One StatsBomb event -> 0, 1 or 2 unified actions (dicts without coordinates mapped)."""
    t = e["type"]["name"]
    if t in DROP:
        return []
    loc = e.get("location") or [np.nan, np.nan]
    a = {"event_id": e["id"], "period": e["period"],
         "time_s": e["minute"] * 60 + e["second"] - (45 * 60 if e["period"] == 2 else 0)
         - (90 * 60 if e["period"] == 3 else 0) - (105 * 60 if e["period"] == 4 else 0),
         "team_id": e["team"]["id"], "player_id": (e.get("player") or {}).get("id"),
         "x0": loc[0], "y0": loc[1], "x1": loc[0], "y1": loc[1], "bodypart": "other",
         "result": "success", "under_pressure": bool(e.get("under_pressure")),
         "counter": e["play_pattern"]["name"] == "From Counter",
         "play_pattern": e["play_pattern"]["name"], "possession": e["possession"],
         "key_pass": False, "assist": False, "through_ball": False, "cutback": False,
         "provider_xg": np.nan, "shot_end_y": np.nan, "shot_end_z": np.nan,
         "counterpress": bool(e.get("counterpress"))}  # fmt: skip
    out = []
    aerial_won = False
    if t == "Pass":
        p = e["pass"]
        end = p.get("end_location") or loc
        a["x1"], a["y1"] = end[0], end[1]
        a["bodypart"] = _body(p)
        a["result"] = PASS_FAIL.get((p.get("outcome") or {}).get("name"), "success")
        kind = (p.get("type") or {}).get("name")
        in_box = end[0] >= 102 and 18 <= end[1] <= 62
        if kind == "Corner":
            a["type"] = "corner_crossed" if in_box or p.get("cross") else "corner_short"
        elif kind == "Free Kick":
            a["type"] = "freekick_crossed" if p.get("cross") or in_box else "freekick_short"
        elif kind == "Throw-in":
            a["type"] = "throw_in"
        elif kind == "Goal Kick":
            a["type"] = "goalkick"
        else:
            a["type"] = "cross" if p.get("cross") else "pass"
        a["key_pass"] = bool(p.get("shot_assist") or p.get("goal_assist"))
        a["assist"] = bool(p.get("goal_assist"))
        a["through_ball"] = bool(p.get("through_ball")) or (
            (p.get("technique") or {}).get("name") == "Through Ball"
        )
        a["cutback"] = bool(p.get("cut_back"))
        aerial_won = bool(p.get("aerial_won"))
    elif t == "Carry":
        end = e["carry"]["end_location"]
        a["type"], a["x1"], a["y1"], a["bodypart"] = "dribble", end[0], end[1], "foot"
    elif t == "Dribble":
        a["type"] = "take_on"
        a["result"] = (
            "success" if (e["dribble"].get("outcome") or {}).get("name") == "Complete" else "fail"
        )
    elif t == "Shot":
        s = e["shot"]
        kind = s["type"]["name"]
        a["type"] = {"Penalty": "shot_penalty", "Free Kick": "shot_freekick",
                     "Corner": "shot_freekick"}.get(kind, "shot")  # fmt: skip
        a["result"] = "success" if s["outcome"]["name"] == "Goal" else "fail"
        a["bodypart"] = _body(s)
        a["provider_xg"] = s.get("statsbomb_xg", np.nan)
        end = s.get("end_location") or []
        if len(end) >= 2:
            a["shot_end_y"] = end[1]
        if len(end) >= 3:
            a["shot_end_z"] = end[2] * YD
        aerial_won = bool(s.get("aerial_won"))
    elif t == "Duel":
        d = e["duel"]
        kind = d["type"]["name"]
        outcome = (d.get("outcome") or {}).get("name", "")
        if kind == "Aerial Lost":
            a["type"], a["result"] = "aerial_duel", "fail"
        else:
            a["type"] = "tackle"
            a["result"] = "success" if outcome in WON else "fail"
    elif t == "Interception":
        a["type"] = "interception"
        a["result"] = (
            "success" if (e["interception"].get("outcome") or {}).get("name") in WON else "fail"
        )
    elif t == "Clearance":
        a["type"], a["bodypart"] = "clearance", _body(e.get("clearance"))
        aerial_won = bool((e.get("clearance") or {}).get("aerial_won"))
    elif t == "Ball Recovery":
        a["type"] = "recovery"
        a["result"] = (
            "fail" if (e.get("ball_recovery") or {}).get("recovery_failure") else ("success")
        )
    elif t == "Block":
        a["type"] = "block"
    elif t == "Miscontrol":
        a["type"], a["result"] = "bad_touch", "fail"
        aerial_won = bool((e.get("miscontrol") or {}).get("aerial_won"))
    elif t == "Dispossessed":
        a["type"], a["result"] = "dispossessed", "fail"
    elif t == "Foul Committed":
        a["type"] = "foul"
    elif t == "Foul Won":
        a["type"] = "foul_won"
    elif t == "Goal Keeper":
        kind = e["goalkeeper"]["type"]["name"]
        if kind in GK_SAVE:
            a["type"] = "keeper_save"
        elif kind in GK_CONCEDED:
            a["type"], a["result"] = "keeper_save", "fail"
        elif kind in GK_CLAIM:
            a["type"] = GK_CLAIM[kind]
            outcome = (e["goalkeeper"].get("outcome") or {}).get("name", "")
            a["result"] = "fail" if outcome in ("Fail", "Lost In Play", "Lost Out") else ("success")
        else:  # Shot Faced and other non-actions
            return []
    elif t == "Pressure":
        a["type"] = "pressure"
    elif t == "Dribbled Past":
        a["type"], a["result"] = "dribbled_past", "fail"
    elif t == "50/50":
        a["type"] = "ground_duel"
        a["result"] = (
            "success"
            if ((e.get("50_50") or {}).get("outcome") or {}).get("name", "") in WON
            else "fail"
        )
    elif t == "Error":
        a["type"] = "error"
    elif t == "Own Goal Against":
        a["type"], a["result"] = "touch", "owngoal"
    else:
        return []
    out.append(a)
    if aerial_won:
        out.insert(0, {**a, "event_id": e["id"] + "a", "type": "aerial_duel",
                       "result": "success", "x1": a["x0"], "y1": a["y0"], "key_pass": False,
                       "assist": False, "provider_xg": np.nan, "shot_end_y": np.nan,
                       "shot_end_z": np.nan, "time_s": a["time_s"] - 1e-3})  # fmt: skip
    return out


def _season_files(paths: Paths) -> list[tuple[int, int, Path]]:
    root = paths.source("statsbomb")
    out = []
    for comp, season in SB_TIER_A:
        commit = _sb_commit(comp, season)
        p = root / commit[:10] / "matches" / str(comp) / f"{season}.json"
        if p.exists():
            out.append((comp, season, p))
    return out


def _event_files(paths: Paths, kind: str) -> dict[int, Path]:
    """match id -> file, listing each folder once: the full pull (gzipped) wins over the
    Phase 0 sample copies."""
    root = paths.source("statsbomb")
    out = {int(p.name.split(".")[0]): p for p in root.glob(f"*/{kind}/*.json")}
    out.update({int(p.name.split(".")[0]): p for p in (root / "full" / kind).glob("*.json.gz")})
    return out


def _actions_frame(rows: list[dict]) -> pd.DataFrame:
    a = pd.DataFrame(rows)
    sx, sy = to_meters("statsbomb", a.x0, a.y0)
    ex, ey = to_meters("statsbomb", a.x1, a.y1)
    _, end_y = to_meters("statsbomb", np.full(len(a), 120.0), a.shot_end_y)
    shot = a.type.isin(["shot", "shot_freekick", "shot_penalty"])
    a = a.assign(provider="statsbomb", start_x=sx, start_y=sy,
                 end_x=np.where(shot, np.nan, ex), end_y=np.where(shot, np.nan, ey),
                 shot_end_y=np.where(a.shot_end_y.notna(), end_y, np.nan),
                 goal_zone=None)  # fmt: skip
    a = a.drop(columns=["x0", "y0", "x1", "y1"])
    for c in ("type", "result", "bodypart", "play_pattern", "provider"):
        a[c] = a[c].astype("category")
    a = a.sort_values(["match_id", "period", "time_s"], kind="stable").reset_index(drop=True)
    a["seq"] = a.groupby("match_id").cumcount()
    return a


def _stage_season(args: tuple) -> tuple[list[dict], list[dict], int]:
    """Worker: one competition-season -> its actions Parquet file; returns (matches,
    lineups, action count). Runs in a separate process."""
    comp, season, idx, ev_files, lu_files, dest = args
    code = COMPETITION[comp]
    matches, lineups, rows = [], [], []
    for m in _read(idx):
        mid = m["match_id"]
        ev_path, lu_path = ev_files.get(mid), lu_files.get(mid)
        local = pd.Timestamp(f"{m['match_date']} {m.get('kick_off') or '00:00:00'}")
        tz = TZ.get(code)
        matches.append({
            "match_id": mid, "competition_id": code, "sb_competition_id": comp,
            "sb_season_id": season, "season": int(m["season"]["season_name"][:4]),
            "season_label": m["season"]["season_name"].replace("/20", "-"),
            "match_date": local.date(), "kickoff_local": local,
            "kickoff_utc": (local.tz_localize(tz).tz_convert("UTC").tz_localize(None)
                            if tz else pd.NaT),  # naive UTC
            "home_team_id": m["home_team"]["home_team_id"],
            "home_team_name": m["home_team"]["home_team_name"],
            "away_team_id": m["away_team"]["away_team_id"],
            "away_team_name": m["away_team"]["away_team_name"],
            "home_goals": m["home_score"], "away_goals": m["away_score"],
            "referee": (m.get("referee") or {}).get("name"),
            "stadium": (m.get("stadium") or {}).get("name"),
            "has_events": ev_path is not None,
        })  # fmt: skip
        if lu_path:
            for team in _read(lu_path):
                for pl in team["lineup"]:
                    for pos in pl["positions"] or [{}]:
                        lineups.append({
                            "match_id": mid, "team_id": team["team_id"],
                            "player_id": pl["player_id"], "player_name": pl["player_name"],
                            "nickname": pl.get("player_nickname"),
                            "jersey": pl.get("jersey_number"),
                            "country": (pl.get("country") or {}).get("name"),
                            "position": pos.get("position"),
                            "from_time": pos.get("from"), "to_time": pos.get("to"),
                            "from_period": pos.get("from_period"),
                            "to_period": pos.get("to_period"),
                            "start_reason": pos.get("start_reason"),
                            "end_reason": pos.get("end_reason"),
                        })  # fmt: skip
        if ev_path:
            for e in _read(ev_path):
                for act in _event_action(e):
                    act["match_id"] = mid
                    rows.append(act)
    n = 0
    if rows:
        df = _actions_frame(rows)
        n = len(df)
        df.to_parquet(dest, compression="zstd", index=False)
    return matches, lineups, n


def build(con, paths: Paths, workers: int | None = None) -> dict[str, int]:
    """Each competition-season is staged by its own worker process into a Parquet file
    under ``stg/sb_actions/``: memory holds a season per worker, never all of them, and
    seasons run in parallel."""
    from concurrent.futures import ProcessPoolExecutor

    ev_files, lu_files = _event_files(paths, "events"), _event_files(paths, "lineups")
    out_dir = paths.parquet / "stg" / "sb_actions"
    out_dir.mkdir(parents=True, exist_ok=True)
    for old in out_dir.glob("*.parquet"):
        old.unlink()
    jobs = [(comp, season, idx, ev_files, lu_files, out_dir / f"{comp}_{season}.parquet")
            for comp, season, idx in _season_files(paths)]  # fmt: skip
    matches, lineups, n_actions = [], [], 0
    with ProcessPoolExecutor(max_workers=workers or min(len(jobs), 12)) as pool:
        for m, lu, n in pool.map(_stage_season, jobs):
            matches += m
            lineups += lu
            n_actions += n
    con.execute("create schema if not exists stg")
    con.execute("create or replace view stg.sb_actions as select * from read_parquet("
                f"'{(out_dir / '*.parquet').as_posix()}', union_by_name = true)")  # fmt: skip
    n = {"sb_actions": n_actions}
    for name, df in (("sb_matches", pd.DataFrame(matches)), ("sb_lineups", pd.DataFrame(lineups))):
        con.register("tmp_df", df)
        n[name] = materialize(con, paths, "stg", name, "select * from tmp_df")
        con.unregister("tmp_df")
    return n
