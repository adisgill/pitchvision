"""Landmark tests for the coordinate transforms (spec 2.3)."""

import duckdb
import numpy as np
import pytest

from pitchvision.stg.coords import sql_case, to_meters

# (name, statsbomb (x, y), wyscout (x, y), expected meters (x, y) in the pitchvision frame)
LANDMARKS = [
    ("centre spot", (60, 40), (50, 50), (52.5, 34)),
    ("penalty spot", (108, 40), (90, 50), (94, 34)),
    ("box corner (attacker's left)", (102, 18), (84, 19), (88.5, 54.16)),
    ("box corner (attacker's right)", (102, 62), (84, 81), (88.5, 13.84)),
    ("six-yard corner (left)", (114, 30), (94, 37), (99.5, 43.16)),
    ("six-yard corner (right)", (114, 50), (94, 63), (99.5, 24.84)),
    ("corner flag, own right", (0, 80), (0, 100), (0, 0)),
    ("corner flag, opponent left", (120, 0), (100, 0), (105, 68)),
    ("goalpost (left)", (120, 36), (100, 45), (105, 37.66)),
    ("goalpost (right)", (120, 44), (100, 55), (105, 30.34)),
]


@pytest.mark.parametrize("name,sb,wy,expected", LANDMARKS)
def test_landmarks(name, sb, wy, expected):
    for provider, pt, tol in (("statsbomb", sb, 0.5), ("wyscout", wy, 1.1)):
        x, y = to_meters(provider, *pt)
        assert abs(float(x) - expected[0]) <= tol, (provider, name, float(x))
        assert abs(float(y) - expected[1]) <= tol, (provider, name, float(y))


def test_out_of_frame_values_are_clipped_and_nan_passes():
    x, y = to_meters("wyscout", [-1, 101, np.nan], [101, -1, 50])
    assert x[0] == 0 and x[1] == 105 and np.isnan(x[2])
    assert y[0] == 0 and y[1] == 68 and y[2] == 34


@pytest.mark.parametrize("provider", ["statsbomb", "wyscout"])
def test_sql_matches_numpy(provider):
    rng = np.random.default_rng(0)
    hi = (120, 80) if provider == "statsbomb" else (100, 100)
    pts = rng.uniform(0, 1, size=(200, 2)) * hi
    con = duckdb.connect()
    con.execute("create table t (x double, y double)")
    con.executemany("insert into t values (?, ?)", pts.tolist())
    got = np.array(con.execute(f"select {sql_case(provider, 'x', 'x')}, "
                               f"{sql_case(provider, 'y', 'y')} from t").fetchall())  # fmt: skip
    xm, ym = to_meters(provider, pts[:, 0], pts[:, 1])
    assert np.allclose(got[:, 0], xm) and np.allclose(got[:, 1], ym)
