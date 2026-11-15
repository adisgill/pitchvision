import duckdb
import numpy as np
import pandas as pd

from pitchvision.ingest.sources import current_season
from pitchvision.metrics.zones import NX, NY, _zone
from pitchvision.research.matchup_factors import _back3, _bh, _ols, team_schedule


def test_zone_edges_clamp_to_grid():
    con = duckdb.connect()
    got = con.execute(f"""select {_zone('x', 'y')} zy from (values (0.0, 0.0), (105.0, 68.0),
                          (-3.0, 70.0), (52.4, 33.9)) t(x, y)""").fetchall()  # fmt: skip
    assert got[0] == (0, 0)
    assert got[1] == (NX - 1, NY - 1)
    assert got[2] == (0, NY - 1)
    assert got[3] == (5, 3)


def test_ols_recovers_slope_and_hc1_errors_are_positive():
    rng = np.random.default_rng(1)
    x = rng.normal(size=5000)
    y = 0.3 * x + rng.normal(size=5000)
    b, se = _ols(y, np.column_stack([np.ones_like(x), x]))
    assert abs(b[1] - 0.3) < 0.05
    assert 0.005 < se[1] < 0.03


def test_bh_q_values_are_monotone_and_bounded():
    p = np.array([0.001, 0.01, 0.02, 0.5, 0.9])
    q = _bh(p)
    assert np.all(q >= p - 1e-12)
    assert np.all(q <= 1)
    assert np.all(np.diff(q[np.argsort(p)]) >= -1e-12)
    assert abs(q[0] - 0.005) < 1e-12  # 0.001 * 5 / 1


def test_back_three_parsing():
    assert _back3("3-4-2-1") == 1.0
    assert _back3("5-3-2") == 1.0
    assert _back3("4-2-3-1") == 0.0
    assert np.isnan(_back3(None))
    assert np.isnan(_back3("unknown"))


def test_schedule_rest_congestion_and_europe():
    games = pd.DataFrame({
        "game_id": [1, 2, 3, 4],
        "d": pd.to_datetime(["2024-01-01", "2024-01-04", "2024-01-07", "2024-01-20"]),
        "competition_type": ["domestic_league", "international_cup", "domestic_league",
                             "domestic_league"],
        "h": [10, 10, 10, 10],
        "a": [20, 30, 20, 20],
    })  # fmt: skip
    s = team_schedule(games).set_index(["game_id", "club"])
    assert np.isnan(s.loc[(1, 10), "rest"])
    assert s.loc[(3, 10), "rest"] == 3
    assert s.loc[(3, 10), "congestion"] == 2  # games 1 and 2 in the previous 14 days
    assert s.loc[(3, 10), "euro_prev"] == 1  # European match 3 days earlier
    assert s.loc[(1, 10), "euro_next"] == 1  # European match 3 days later
    assert s.loc[(4, 10), "euro_prev"] == 0


def test_current_season_turns_over_on_1_july():
    from datetime import date

    assert current_season(date(2026, 6, 30)) == 2025
    assert current_season(date(2026, 7, 1)) == 2026
