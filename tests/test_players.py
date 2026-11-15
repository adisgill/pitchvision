"""Reliability, shrinkage and the 0-100 scale on synthetic player-seasons."""

import numpy as np
import pandas as pd

from pitchvision.metrics.players import QUALIFY_MIN, fit_k, rate, split_half


def _matches(players=400, games=34, seed=0):
    rng = np.random.default_rng(seed)
    skill = rng.gamma(2.0, 0.15, players)  # true goals per 90
    rows = []
    for p in range(players):
        for g in range(games):
            mins = 90 if rng.random() < 0.8 else int(rng.integers(10, 80))
            rows.append({"player_id": p, "competition_id": "GB1", "season": 2020,
                         "match_date": pd.Timestamp("2020-08-01") + pd.Timedelta(days=7 * g),
                         "minutes": mins,
                         "np_goals": rng.poisson(skill[p] * mins / 90)})  # fmt: skip
    return pd.DataFrame(rows), skill


def test_split_half_and_spearman_brown_k_are_sensible():
    pm, _ = _matches()
    sh = split_half(pm, "np_goals")
    assert len(sh) > 300 and sh.n90.between(5, 17).all()
    k, tab = fit_k(sh)
    # gamma(2, .15) skill with Poisson noise: r at ~15 90s is well below 1, k is a few 90s
    assert 1 < k < 60
    assert (tab.r > 0).all()


def test_ratings_have_mean_50_sd_10_among_qualified():
    rng = np.random.default_rng(1)
    n = 300
    ps = pd.DataFrame({
        "player_id": range(n), "competition_id": "GB1", "season": 2020, "club_id": 1,
        "position_group": "ST", "minutes": rng.integers(300, 3400, n),
        "np_goals": rng.poisson(8, n), "assists": rng.poisson(4, n),
        "card_points": rng.poisson(5, n), "minutes_share": rng.uniform(0.1, 1, n),
        "starts_share": rng.uniform(0.1, 1, n),
    })  # fmt: skip
    r = rate(ps, {"np_goals_p90": 10.0, "assists_p90": 15.0, "cards_p90": 20.0})
    q = r[r.minutes >= QUALIFY_MIN]
    for col in ("np_goals_p90_rating", "scoring_rating", "availability_rating"):
        m = np.average(q[col], weights=q.minutes)
        sd = np.sqrt(np.average((q[col] - m) ** 2, weights=q.minutes))
        assert abs(m - 50) < 0.5 and abs(sd - 10) < 0.5, col
    # shrinkage pulls a small sample toward the group mean
    small = r.loc[r.minutes.idxmin()]
    assert (
        abs(small.np_goals_p90_shrunk - q.np_goals_p90_shrunk.mean())
        < abs(small.np_goals_p90 - q.np_goals_p90_shrunk.mean()) + 1e-9
    )
    # lower-is-better metrics are flipped: more cards, lower rating
    assert np.corrcoef(r.cards_p90, r.cards_p90_rating)[0, 1] < 0
