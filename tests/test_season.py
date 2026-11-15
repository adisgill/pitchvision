"""Season simulator: fixtures left, tiebreak orders, and a finished season's table."""

import numpy as np
import pandas as pd

from pitchvision.forecast.season import _rank, remaining_fixtures, simulate


def _m(h, a, hg, ag, played=True, day=1):
    return {"match_id": f"{h}{a}", "season": 2020, "home_club": h, "away_club": a,
            "home_goals": hg, "away_goals": ag, "played": played,
            "match_date": pd.Timestamp("2020-08-01") + pd.Timedelta(days=day),
            "proxy_home_xg": np.nan, "proxy_away_xg": np.nan}  # fmt: skip


def test_remaining_fixtures_are_the_unplayed_ordered_pairs():
    sm = pd.DataFrame([_m("A", "B", 1, 0), _m("B", "C", 2, 2)])
    clubs, rem = remaining_fixtures(sm)
    assert clubs == ["A", "B", "C"]
    assert len(rem) == 6 - 2
    assert ("A", "B") not in set(zip(rem.home_club, rem.away_club, strict=True))


def test_head_to_head_first_vs_goal_difference_first():
    # clubs 0 and 1 level on points; 1 has the better goal difference, 0 won their meeting
    pts = np.array([10.0, 10.0, 3.0])
    gd = np.array([2.0, 6.0, -8.0])
    gf = np.array([8.0, 9.0, 2.0])
    home, away = np.array([0, 1]), np.array([1, 0])
    hg, ag = np.array([2, 0]), np.array([0, 0])  # 0 beat 1 at home, drew away
    rng = np.random.default_rng(0)
    assert list(_rank(pts, gd, gf, hg, ag, home, away, ["gd", "gf"], 3, rng))[:2] == [1, 0]
    order = _rank(pts, gd, gf, hg, ag, home, away, ["h2h_points", "gd"], 3, rng)
    assert list(order)[:2] == [0, 1]


def test_finished_season_reproduces_its_table():
    rows = []
    clubs = ["A", "B", "C", "D"]
    results = {
        ("A", "B"): (2, 0),
        ("B", "A"): (1, 1),
        ("A", "C"): (3, 0),
        ("C", "A"): (0, 1),
        ("A", "D"): (1, 0),
        ("D", "A"): (0, 0),
        ("B", "C"): (2, 1),
        ("C", "B"): (0, 0),
        ("B", "D"): (1, 0),
        ("D", "B"): (2, 2),
        ("C", "D"): (1, 1),
        ("D", "C"): (0, 1),
    }
    for k, ((h, a), (x, y)) in enumerate(results.items(), 1):
        rows.append(_m(h, a, x, y, day=k))
    sm = pd.DataFrame(rows).assign(competition_id="XX")
    rule = {"name": "toy", "size": 4, "tiebreak": ["gd", "gf"],
            "zones": {"title": [1, 1], "relegation": [4, 4]}}  # fmt: skip
    out = simulate(sm, sm, rule, sm.match_date.max(), 365, 1.0, runs=10, b=1,
                   equal_strength=True).set_index("club_id")  # fmt: skip
    assert out.loc["A", "p_title"] == 1.0
    assert out.loc["A", "points_now"] == 4 * 3 + 2  # A: four wins, two draws
    assert np.allclose(out[[f"p_pos_{i}" for i in range(1, 5)]].sum(axis=1), 1.0)
    assert set(clubs) == set(out.index)
