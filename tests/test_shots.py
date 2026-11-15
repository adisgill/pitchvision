"""Shot geometry and the provider-agnostic xG feature rules."""

import numpy as np
import pandas as pd
import pytest

from pitchvision.metrics.shots import features, geometry


def test_geometry_landmarks():
    d, a = geometry([94.0], [34.0])  # penalty spot
    assert d[0] == pytest.approx(11.0)
    assert a[0] == pytest.approx(2 * np.arctan(3.66 / 11.0), rel=1e-6)
    d, a = geometry([105.0], [34.0])  # on the goal line, centre: the whole mouth
    assert a[0] == pytest.approx(np.pi)
    d, a = geometry([105.0], [0.0])  # corner flag: no angle
    assert a[0] == pytest.approx(0.0, abs=1e-9)
    # symmetric about the centre line, and the angle shrinks with distance
    assert geometry([90], [30])[1][0] == pytest.approx(geometry([90], [38])[1][0])
    assert geometry([80], [34])[1][0] < geometry([95], [34])[1][0]


def _a(rows):
    cols = [
        "provider",
        "match_id",
        "competition_id",
        "season",
        "home_team_id",
        "away_team_id",
        "event_id",
        "seq",
        "period",
        "time_s",
        "team_id",
        "player_id",
        "type",
        "result",
        "bodypart",
        "start_x",
        "start_y",
        "end_x",
        "end_y",
        "counter",
        "through_ball",
        "under_pressure",
        "provider_xg",
        "shot_end_y",
        "shot_end_z",
    ]
    full = []
    for i, r in enumerate(rows):
        base = {"provider": "statsbomb", "match_id": 1, "competition_id": "GB1",
                "season": 2015, "home_team_id": 1, "away_team_id": 2, "event_id": str(i),
                "seq": i, "period": 1, "player_id": 9, "bodypart": "foot", "end_x": 0.0,
                "end_y": 0.0, "counter": False, "through_ball": False,
                "under_pressure": False, "provider_xg": 0.1, "shot_end_y": np.nan,
                "shot_end_z": np.nan, "result": "success"}  # fmt: skip
        full.append({**base, **r})
    return pd.DataFrame(full)[cols]


def test_corner_assist_cross_and_game_state():
    s = features(_a([
        {"time_s": 10, "team_id": 1, "type": "shot", "start_x": 95, "start_y": 34},  # 1-0
        {"time_s": 100, "team_id": 2, "type": "corner_crossed", "start_x": 105,
         "start_y": 0, "end_x": 99, "end_y": 34},
        {"time_s": 102, "team_id": 2, "type": "shot", "start_x": 99, "start_y": 34,
         "result": "fail", "bodypart": "head"},
    ]))  # fmt: skip
    last = s.iloc[-1]
    assert last.situation == "corner" and last.assist == "cross" and last.body == "head"
    assert last.state == -1  # team 2 trailing 0-1 when it shot
    assert s.iloc[0].state == 0 and s.goal.tolist() == [1, 0]


def test_carries_are_skipped_when_finding_the_assist_and_rebounds():
    s = features(_a([
        {"time_s": 10, "team_id": 1, "type": "pass", "start_x": 70, "start_y": 34,
         "end_x": 85, "end_y": 34, "through_ball": True},
        {"time_s": 12, "team_id": 1, "type": "dribble", "start_x": 85, "start_y": 34},
        {"time_s": 14, "team_id": 1, "type": "shot", "start_x": 92, "start_y": 34,
         "result": "fail"},
        {"time_s": 15, "team_id": 2, "type": "keeper_save", "start_x": 1, "start_y": 34},
        {"time_s": 16, "team_id": 1, "type": "shot", "start_x": 99, "start_y": 30},
    ]))  # fmt: skip
    assert s.assist.tolist() == ["through_ball", "rebound"]


def test_penalty_own_goal_counts_for_opponent_in_state():
    s = features(_a([
        {"time_s": 5, "team_id": 2, "type": "touch", "start_x": 3, "start_y": 34,
         "result": "owngoal"},  # team 2 own goal: 1-0 to team 1
        {"time_s": 50, "team_id": 2, "type": "shot_penalty", "start_x": 94, "start_y": 34},
    ]))  # fmt: skip
    assert s.iloc[0].situation == "penalty" and s.iloc[0].state == -1
