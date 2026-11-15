"""Team models: scoreline probabilities, RPS, Dixon-Coles recovery, Elo, market devig."""

import numpy as np
import pandas as pd
import pytest

from pitchvision.models.team import (
    RateInverter,
    devig_power,
    fit_dc,
    fit_ordered_logit,
    ordered_probs,  # fmt: skip
    outcome_probs,
    rps,
    run_elo,
    score_matrix,
)


def test_score_matrix_sums_to_one_and_matches_outcomes():
    m = score_matrix(1.6, 1.1, rho=-0.1)
    assert m.sum() == pytest.approx(1.0)
    p = outcome_probs(1.6, 1.1, rho=-0.1)[0]
    assert p[0] == pytest.approx(np.tril(m, -1).sum())
    assert p[1] == pytest.approx(np.trace(m))
    assert p[0] > p[2]  # stronger home side


def test_rps_known_values():
    p = np.array([[1.0, 0.0, 0.0], [0.5, 0.3, 0.2]])
    o = np.array([0, 2])
    r = rps(p, o)
    assert r[0] == 0.0
    assert r[1] == pytest.approx(0.5 * (0.5**2 + 0.8**2))


def test_dixon_coles_recovers_simulated_strengths():
    rng = np.random.default_rng(0)
    n = 12
    att = rng.normal(0, 0.3, n)
    att -= att.mean()
    dfn = rng.normal(0, 0.3, n)
    dfn -= dfn.mean()
    home, away = [], []
    for _ in range(40):  # 40 double round-robins
        for i in range(n):
            for j in range(n):
                if i != j:
                    home.append(i)
                    away.append(j)
    home, away = np.array(home), np.array(away)
    lh = np.exp(0.3 + att[home] + dfn[away])
    la = np.exp(att[away] + dfn[home])
    hg, ag = rng.poisson(lh), rng.poisson(la)
    f = fit_dc(home, away, hg, ag, np.ones(len(home)), n, ridge=0.1)
    assert np.corrcoef(f["att"], att)[0, 1] > 0.95
    assert np.corrcoef(f["dfn"], dfn)[0, 1] > 0.95
    assert f["home"] == pytest.approx(0.3, abs=0.05)


def test_elo_rewards_winner_and_handles_promotion():
    m = pd.DataFrame([
        {"match_id": 1, "match_date": "2020-08-01", "season": 2020, "home_club": "A",
         "away_club": "B", "home_goals": 3, "away_goals": 0, "played": True},
        {"match_id": 2, "match_date": "2020-08-08", "season": 2020, "home_club": "B",
         "away_club": "A", "home_goals": 0, "away_goals": 1, "played": True},
        {"match_id": 3, "match_date": "2021-08-01", "season": 2021, "home_club": "A",
         "away_club": "C", "home_goals": 1, "away_goals": 1, "played": True},
    ])  # fmt: skip
    e = run_elo(m)
    assert e.elo_home[1] < 1500 < e.elo_away[1]  # after round 1, A above B
    # season 2: C replaces relegated B and starts at B's (regressed) rating
    assert e.elo_away[2] < 1500 < e.elo_home[2]


def test_ordered_logit_learns_direction():
    rng = np.random.default_rng(1)
    d = rng.normal(0, 150, 4000)
    p_true = ordered_probs(d, np.array([0.006, -1.2, 0.0]))
    y = np.array([rng.choice(3, p=p) for p in p_true])
    t = fit_ordered_logit(d, y)
    assert t[0] == pytest.approx(0.006, rel=0.15)


def test_power_devig_removes_margin_and_inverter_roundtrips():
    p = devig_power(np.array([[1.9, 3.6, 4.4], [2.5, 3.2, 3.0]]))
    assert np.allclose(p.sum(axis=1), 1.0)
    assert p[0, 0] > p[0, 2]
    inv = RateInverter()
    true = outcome_probs(np.array([1.7, 1.0]), np.array([0.9, 1.3]))
    lh, la = inv(true)
    assert lh == pytest.approx([1.7, 1.0], abs=0.05) and la == pytest.approx([0.9, 1.3], abs=0.05)
