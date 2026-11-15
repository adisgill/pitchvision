"""VAEP value formula: deltas, possession swaps, resets after goals and at period starts."""

import numpy as np
import pandas as pd
import pytest

from pitchvision.models.vaep import features, values


def _a(rows):
    base = {"provider": "statsbomb", "match_id": 1, "period": 1, "goal": False,
            "own_goal": False}  # fmt: skip
    return pd.DataFrame([{**base, **r} for r in rows])


def test_same_team_delta_and_opponent_swap():
    a = _a([{"team_id": 1}, {"team_id": 1}, {"team_id": 2}])
    ps = np.array([0.02, 0.05, 0.01])
    pc = np.array([0.01, 0.01, 0.03])
    v = values(a, ps, pc)
    # first action: a period start, previous probabilities are 0
    assert v.offensive[0] == pytest.approx(0.02) and v.defensive[0] == pytest.approx(-0.01)
    # same team: plain deltas
    assert v.offensive[1] == pytest.approx(0.03) and v.defensive[1] == pytest.approx(0.0)
    # opponent wins the ball: team 1's 0.05 scoring chance is team 2's conceding chance
    assert v.offensive[2] == pytest.approx(0.01 - 0.01)
    assert v.defensive[2] == pytest.approx(-(0.03 - 0.05))
    assert np.allclose(v.vaep, v.offensive + v.defensive)


def test_reset_after_goal_and_new_period():
    a = _a([{"team_id": 1, "goal": True}, {"team_id": 2}, {"team_id": 2, "period": 2}])
    ps = np.array([0.6, 0.03, 0.02])
    pc = np.array([0.0, 0.01, 0.01])
    v = values(a, ps, pc)
    assert v.offensive[1] == pytest.approx(0.03)  # kick-off after the goal: from zero
    assert v.offensive[2] == pytest.approx(0.02)  # second half: from zero


def test_features_mirror_opponent_actions():
    row = {"team_id": 1, "time_s": 10.0, "period": 1, "goal_diff": 0, "provider": "wyscout",
           "women": False, "type": "pass", "result": "success", "bodypart": "foot",
           "start_x": 50.0, "start_y": 30.0, "end_x": 60.0, "end_y": 30.0,
           "type_1": "pass", "result_1": "success", "bodypart_1": "foot",
           "start_x_1": 20.0, "start_y_1": 10.0, "end_x_1": 30.0, "end_y_1": 10.0,
           "team_id_1": 2, "time_s_1": 8.0,
           "type_2": None, "result_2": None, "bodypart_2": None, "start_x_2": np.nan,
           "start_y_2": np.nan, "end_x_2": np.nan, "end_y_2": np.nan, "team_id_2": None,
           "time_s_2": np.nan}  # fmt: skip
    x = features(pd.DataFrame([row]))
    assert x.sx_1[0] == pytest.approx(85.0) and x.sy_1[0] == pytest.approx(58.0)
    assert x.same_team_1[0] == 0 and x.same_team_2[0] == 0
    assert x.dt_1[0] == pytest.approx(2.0)
