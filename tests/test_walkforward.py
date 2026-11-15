"""The walk-forward never looks ahead: changing a later result can't move an earlier
prediction (the kickoff guard of spec 7.4, for the backtest)."""

import numpy as np
import pandas as pd

from pitchvision.forecast.walkforward import HALF_LIVES, league


def _league(seed: int = 0) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    clubs = [f"c{i}" for i in range(10)]
    strength = dict(zip(clubs, rng.normal(0, 0.3, len(clubs)), strict=True))
    rows, mid = [], 0
    for season in range(2013, 2018):  # four seasons of history, then 2017-18 evaluated
        day = pd.Timestamp(f"{season}-08-10")
        for leg in range(2):
            for i, h in enumerate(clubs):
                for a in clubs[i + 1 :]:
                    hh, aa = (h, a) if leg == 0 else (a, h)
                    lh = np.exp(0.25 + strength[hh] - strength[aa])
                    la = np.exp(strength[aa] - strength[hh])
                    mid += 1
                    rows.append({"match_id": f"m{mid}", "competition_id": "XX",
                                 "season": season, "match_date": day,
                                 "home_club": hh, "away_club": aa, "played": True,
                                 "home_goals": rng.poisson(lh), "away_goals": rng.poisson(la),
                                 "proxy_home_xg": np.nan, "proxy_away_xg": np.nan,
                                 "close_home": np.nan, "close_draw": np.nan,
                                 "close_away": np.nan})  # fmt: skip
                    day += pd.Timedelta(days=2)
    return pd.DataFrame(rows)


def test_changing_a_late_result_leaves_earlier_predictions_unchanged():
    m = _league()
    base = league(m.copy())
    late = m[m.season == 2017].match_id.iloc[-1]
    changed = m.copy()
    changed.loc[changed.match_id == late, ["home_goals", "away_goals"]] = [9, 0]
    alt = league(changed)
    cols = [f"lh_g_{hl}" for hl in HALF_LIVES] + ["elo_h", "elo_d", "elo_a"]
    b = base.set_index("match_id")
    c = alt.set_index("match_id")
    late_date = m.loc[m.match_id == late, "match_date"].iloc[0]
    before = b.index[b.match_date < late_date - pd.Timedelta(days=7)]
    assert len(before) > 50
    pd.testing.assert_frame_equal(b.loc[before, cols], c.loc[before, cols])
    assert b.loc[late, "outcome"] != c.loc[late, "outcome"] or b.loc[late, "home_goals"] != 9
