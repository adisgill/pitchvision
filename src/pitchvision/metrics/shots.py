"""Harmonised shots from both event providers, with the xG features of spec 6.1.

Features are derived the same way for StatsBomb and Wyscout from the action sequence, not
from provider-only fields, so the model is provider-agnostic:

* ``distance`` (m) to the goal centre and ``angle`` (radians) subtended by the goal mouth.
* ``body``: foot / head / other.
* ``situation``: penalty, direct_free_kick, corner (a corner by the shooting team among
  its previous 3 ball actions, within 10 s), set_piece (a free kick or throw-in likewise),
  counter (provider counter flag), open_play.
* ``assist``: the shooting team's last ball action before the shot, within 6 s, ignoring
  carries (Wyscout has none, see spec 4.3): cross, through_ball, cutback (from the byline
  zone backwards into the box), pass, dribble (a take-on: self-created), rebound (the
  previous ball action was a shot, save, block or clearance), none.
* ``state``: the shooting team's goal difference before the shot, bucketed -2..+2.
* ``under_pressure``: StatsBomb only (used only by the StatsBomb-only variant).
"""

from __future__ import annotations

import numpy as np
import pandas as pd

GOAL_X, GOAL_Y, GOAL_W = 105.0, 34.0, 7.32
BALL_TYPES = ("pass", "cross", "corner_crossed", "corner_short", "freekick_crossed",
              "freekick_short", "throw_in", "goalkick", "dribble", "take_on", "shot",
              "shot_freekick", "shot_penalty", "clearance", "bad_touch", "touch",
              "interception", "recovery", "tackle", "keeper_save", "keeper_claim",
              "keeper_punch", "keeper_sweeper", "aerial_duel", "ground_duel", "block",
              "dispossessed")  # fmt: skip
SHOT_TYPES = ("shot", "shot_freekick", "shot_penalty")


def geometry(x, y) -> tuple[np.ndarray, np.ndarray]:
    """Distance (m) to the goal centre and the angle (radians) the goal mouth subtends."""
    dx = GOAL_X - np.asarray(x, dtype=float)
    dy = np.abs(GOAL_Y - np.asarray(y, dtype=float))
    dist = np.hypot(dx, dy)
    ang = np.arctan2(GOAL_W * dx, dx**2 + dy**2 - (GOAL_W / 2) ** 2)
    ang = np.where(ang < 0, ang + np.pi, ang)
    return dist, ang


def extract(con) -> pd.DataFrame:
    """One row per shot (own goals excluded) with features and the goal label."""
    types = "(" + ",".join(f"'{t}'" for t in BALL_TYPES) + ")"
    a = con.execute(f"""
        with m as (
            select 'wyscout' provider, match_id, competition_id, season, home_team_id,
                   away_team_id from stg.wy_matches
            union all
            select 'statsbomb', match_id, competition_id, season, home_team_id,
                   away_team_id from stg.sb_matches)
        select a.provider, a.match_id, m.competition_id, m.season, m.home_team_id,
               m.away_team_id, a.event_id, a.seq, a.period, a.time_s, a.team_id,
               a.player_id, a.type, a.result, a.bodypart, a.start_x, a.start_y, a.end_x,
               a.end_y, a.counter, a.through_ball, a.under_pressure, a.provider_xg,
               a.shot_end_y, a.shot_end_z
        from stg.actions a join m using (provider, match_id)
        where a.type in {types} or a.result = 'owngoal'
        order by a.provider, a.match_id, a.seq""").df()  # fmt: skip
    return features(a)


def features(a: pd.DataFrame) -> pd.DataFrame:
    """Shot features from an ordered action table (one provider-match after another)."""
    a = a.reset_index(drop=True)
    key = a.provider + ":" + a.match_id.astype(str)
    shot_idx = np.flatnonzero(a.type.isin(SHOT_TYPES).to_numpy())
    rows = []
    goals: dict[tuple[str, int], int] = {}
    last_match = None
    team = a.team_id.to_numpy()
    typ = a.type.to_numpy()
    res = a.result.to_numpy()
    t = a.time_s.to_numpy(dtype=float)
    per = a.period.to_numpy()
    kk = key.to_numpy()
    sx, sy = a.start_x.to_numpy(dtype=float), a.start_y.to_numpy(dtype=float)
    ex, ey = a.end_x.to_numpy(dtype=float), a.end_y.to_numpy(dtype=float)
    thr = a.through_ball.fillna(False).to_numpy(dtype=bool)
    # running score per match, updated as we sweep forward
    score_i = 0
    for i in shot_idx:
        if kk[i] != last_match:
            last_match, goals, score_i = kk[i], {}, _first(kk, i)
        # goals scored before this shot in the match
        while score_i < i:
            if typ[score_i] in SHOT_TYPES and res[score_i] == "success":
                goals[team[score_i]] = goals.get(team[score_i], 0) + 1
            elif res[score_i] == "owngoal":
                opp = _opponent(a, score_i)
                goals[opp] = goals.get(opp, 0) + 1
            score_i += 1
        me = team[i]
        opp = _opponent(a, i)
        state = goals.get(me, 0) - goals.get(opp, 0)
        # look back over ball actions in the same match and period
        situation, assist = "open_play", "none"
        if typ[i] == "shot_penalty":
            situation = "penalty"
        elif typ[i] == "shot_freekick":
            situation = "direct_free_kick"
        own_seen, j = 0, i - 1
        found_assist = False
        while j >= 0 and kk[j] == kk[i] and per[j] == per[i] and t[i] - t[j] <= 10:
            if team[j] == me:
                own_seen += 1
                if situation == "open_play" and own_seen <= 3:
                    if typ[j] in ("corner_crossed", "corner_short"):
                        situation = "corner"
                    elif typ[j] in ("freekick_crossed", "freekick_short", "throw_in"):
                        situation = "set_piece"
                if not found_assist and typ[j] != "dribble" and t[i] - t[j] <= 6:
                    found_assist = True
                    if typ[j] in SHOT_TYPES:
                        assist = "rebound"
                    elif typ[j] in ("cross", "corner_crossed", "freekick_crossed"):
                        assist = "cross"
                    elif thr[j]:
                        assist = "through_ball"
                    elif (typ[j] == "pass" and sx[j] >= 99.5
                          and (sy[j] < 24.84 or sy[j] > 43.16) and ex[j] < sx[j]
                          and ex[j] >= 88.5 and 13.84 <= ey[j] <= 54.16):  # fmt: skip
                        assist = "cutback"
                    elif typ[j] in ("pass", "corner_short", "freekick_short", "throw_in",
                                    "goalkick"):  # fmt: skip
                        assist = "pass"
                    elif typ[j] == "take_on":
                        assist = "dribble"
            elif not found_assist and typ[j] in ("keeper_save", "block", "clearance",
                                                  "keeper_punch") and t[i] - t[j] <= 6:  # fmt: skip
                found_assist, assist = True, "rebound"
            j -= 1
        if situation == "open_play" and bool(a.counter.iat[i]):
            situation = "counter"
        rows.append((i, situation, assist, int(np.clip(state, -2, 2))))
    idx, sit, ast, st = zip(*rows, strict=True) if rows else ((), (), (), ())
    s = a.iloc[list(idx)].copy()
    s["situation"], s["assist"], s["state"] = sit, ast, st
    s["distance"], s["angle"] = geometry(s.start_x, s.start_y)
    s["body"] = s.bodypart.where(s.bodypart.isin(["foot", "head"]), "other")
    s["goal"] = (s.result == "success").astype(int)
    s["women"] = ~s.competition_id.isin(["GB1", "ES1", "IT1", "FR1", "L1"])
    s["group"] = s.provider + " " + s.competition_id + " " + s.season.astype(str)
    keep = ["provider", "match_id", "competition_id", "season", "group", "women",
            "event_id", "period", "time_s", "team_id", "player_id", "type", "start_x",
            "start_y", "distance", "angle", "body", "situation", "assist", "state",
            "under_pressure", "provider_xg", "shot_end_y", "shot_end_z", "goal"]  # fmt: skip
    return s[keep].reset_index(drop=True)


def _first(keys: np.ndarray, i: int) -> int:
    j = i
    while j > 0 and keys[j - 1] == keys[i]:
        j -= 1
    return j


def _opponent(a: pd.DataFrame, i: int):
    h, w = a.home_team_id.iat[i], a.away_team_id.iat[i]
    return w if a.team_id.iat[i] == h else h
