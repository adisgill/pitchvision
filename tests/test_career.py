"""Age curves (fixed effects) recover a known peak; league offsets recover known values."""

import numpy as np
import pandas as pd

from pitchvision.ratings.aging import fe_curve
from pitchvision.ratings.league import _solve_offsets


def test_fixed_effects_age_curve_finds_the_peak_despite_selection():
    rng = np.random.default_rng(0)
    rows = []
    for pid in range(1500):
        talent = rng.normal(0, 1)
        start = int(rng.integers(18, 30))
        for k in range(int(rng.integers(2, 9))):
            age = start + k
            true = talent - 0.02 * (age - 27) ** 2  # peak at 27
            rows.append({"player_id": pid, "competition_id": "XX", "season": 2010 + k,
                         "age": age, "minutes_": 2000.0,
                         "m": true + rng.normal(0, 0.3)})  # fmt: skip
    d = pd.DataFrame(rows)
    # selection: keep a season only if the previous one was good (regulars), the bias that
    # broke the delta method
    d = d[(d.groupby("player_id").m.shift(1).fillna(1) > -0.5)]
    c = fe_curve(d, "m")
    assert 25 <= c.idxmax() <= 29


def test_league_offsets_recover_simulated_values():
    rng = np.random.default_rng(1)
    true = {"GB1": 0.0, "ES1": -0.1, "NL1": -1.0}
    rows = []
    leagues = list(true)
    for _ in range(3000):
        a, b = rng.choice(leagues, 2, replace=False)
        gd = 0.3 + true[a] - true[b] + rng.normal(0, 1.5)
        rows.append({"lh": a, "la": b, "home_goals": gd, "away_goals": 0.0, "sh": 0.0,
                     "sa": 0.0})  # fmt: skip
    est = _solve_offsets(pd.DataFrame(rows), {"ES1": 0, "NL1": 1})
    assert abs(est[0] + 0.1) < 0.15 and abs(est[1] + 1.0) < 0.15
    assert abs(est[2] - 0.3) < 0.1  # home advantage
