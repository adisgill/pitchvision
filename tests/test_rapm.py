"""RAPM: recovers simulated player impacts, decays old seasons, falls back to the prior."""

import numpy as np
import pandas as pd

from pitchvision.ratings.rapm import Design


def _stints(seed=0, n_players=60, n_stints=6000):
    rng = np.random.default_rng(seed)
    beta = rng.normal(0, 0.08, n_players)
    rows = []
    for k in range(n_stints):
        ps = rng.choice(n_players, 22, replace=False)
        hp, ap = sorted(ps[:11].tolist()), sorted(ps[11:].tolist())
        minutes = int(rng.integers(10, 91))
        rate_h = np.exp(np.log(1.4) + (beta[hp].sum() - beta[ap].sum()) / 2)
        rate_a = np.exp(np.log(1.1) - (beta[hp].sum() - beta[ap].sum()) / 2)
        rows.append({"home_players": hp, "away_players": ap, "minutes": minutes,
                     "home_goals": rng.poisson(rate_h * minutes / 90),
                     "away_goals": rng.poisson(rate_a * minutes / 90),
                     "competition_id": "XX", "season": 2015 + k % 4})  # fmt: skip
    return pd.DataFrame(rows), beta


def test_recovers_simulated_impacts():
    st, beta = _stints()
    d = Design(st)
    sol = d.solve(2018, 1.0, 5.0)
    est = pd.Series(sol[: d.n_p], index=d.players)
    assert np.corrcoef(est.loc[range(len(beta))], beta)[0, 1] > 0.6


def test_strong_ridge_returns_the_prior():
    st, _ = _stints(1)
    d = Design(st)
    prior = np.linspace(-0.1, 0.1, d.n_p)
    sol = d.solve(2018, 1.0, 1e7, beta0=prior)
    assert np.allclose(sol[: d.n_p], prior, atol=1e-3)


def test_later_seasons_get_no_weight():
    st, _ = _stints(2)
    d = Design(st)
    a = d.solve(2016, 0.5, 5.0)
    st2 = st.copy()
    st2.loc[st2.season > 2016, "home_goals"] += 5  # change only later seasons
    b = Design(st2).solve(2016, 0.5, 5.0)
    assert np.allclose(a, b, atol=1e-8)
    assert d.exposure(2016, 0.5).sum() < d.exposure(2018, 0.5).sum()
