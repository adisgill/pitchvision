"""Expected threat solver and grid, and tier-A minute intervals."""

import numpy as np
import pandas as pd
import pytest

from pitchvision.metrics.minutes_a import statsbomb_intervals, union_seconds
from pitchvision.models.xt import NX, NY, cell, solve


def test_two_cell_chain_matches_the_closed_form():
    # cell 0 never shoots and always moves (successfully) to cell 1; cell 1 shoots half the
    # time (xG 0.3) and otherwise moves back to 0 successfully:
    # x1 = .5*.3 + .5*x0, x0 = x1  ->  x0 = x1 = 0.3
    shots = np.array([0.0, 10.0])
    goal = np.array([0.0, 0.3])
    moves = np.array([10.0, 10.0])
    trans = np.array([[0.0, 10.0], [10.0, 0.0]])
    xt, it = solve(shots, goal, moves, trans, tol=1e-10, max_iter=10_000)
    assert xt == pytest.approx([0.3, 0.3], abs=1e-6)
    assert it < 10_000


def test_failed_moves_end_the_chain():
    # cell 0 moves 10 times, only 5 succeed (to cell 1, worth 0.2 per shot, always shoots)
    shots = np.array([0.0, 4.0])
    goal = np.array([0.0, 0.2])
    moves = np.array([10.0, 0.0])
    trans = np.array([[0.0, 5.0], [0.0, 0.0]])
    xt, _ = solve(shots, goal, moves, trans)
    assert xt[1] == pytest.approx(0.2) and xt[0] == pytest.approx(0.5 * 0.2)


def test_cell_index_corners_and_clipping():
    assert cell([0.0], [0.0])[0] == 0
    assert cell([105.0], [68.0])[0] == NX * NY - 1  # the far corner clips into the last cell
    assert cell([104.9], [34.0])[0] == (NX - 1) * NY + NY // 2


def test_union_counts_overlap_once():
    iv = pd.DataFrame({"t0": [0, 100, 50], "t1": [60, 200, 120]})
    assert union_seconds(iv) == 200.0


def test_statsbomb_spells_drop_backwards_and_use_real_period_lengths():
    lengths = {(1, 1): 46 * 60.0, (1, 2): 49 * 60.0}
    spells = pd.DataFrame([
        # starter, subbed at 70:00 in the second half
        {"match_id": 1, "from_time": "00:00", "to_time": "70:00", "from_period": 1,
         "to_period": 2},
        # came on at 70:00, to the end
        {"match_id": 1, "from_time": "70:00", "to_time": None, "from_period": 2,
         "to_period": None},
        # a backwards spell (StatsBomb glitch)
        {"match_id": 1, "from_time": "80:00", "to_time": "60:00", "from_period": 2,
         "to_period": 2},
    ])  # fmt: skip
    iv = statsbomb_intervals(spells, lengths)
    first = iv.iloc[0].t1 - iv.iloc[0].t0
    second = iv.iloc[1].t1 - iv.iloc[1].t0
    assert first == pytest.approx((46 + 25) * 60)  # all of half 1 (46 real) + 25 of half 2
    assert second == pytest.approx((49 - 25) * 60)  # the rest of a 49-minute second half
    assert not iv.iloc[2].valid
