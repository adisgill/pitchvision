"""Team strength models (spec 5.8, 6.5): Dixon-Coles, our own Elo, and the market.

* **Dixon-Coles:** ``log lambda_home = home + att_h + dfn_a``, ``log lambda_away = att_a +
  dfn_h`` (``dfn`` is defensive *weakness*: higher concedes more). Fitted by weighted
  Poisson likelihood (time decay ``exp(-xi * age)``, ``xi = ln 2 / half_life``) with a
  ridge pull toward each team's prior (0, or the relegated teams' average for a promoted
  team), which also identifies the model. Works on goals and, as a Poisson
  pseudo-likelihood, on (proxy) xG. The low-score correction ``rho`` is applied when
  turning rates into scoreline probabilities.
* **Elo:** goal-difference multiplier, home advantage, a third of the way back to the
  league mean between seasons, promoted teams start at the mean of last season's
  relegated teams; 1X2 from an ordered logit on the rating difference.
* **Market:** closing odds with the margin removed by the power method; implied scoring
  rates by inverting a Poisson scoreline model; strengths by ridge least squares on the
  log rates.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from scipy.optimize import minimize
from scipy.spatial import cKDTree
from scipy.special import expit, gammaln

MAXG = 10


# ---- scoreline probabilities ---------------------------------------------------------------


def score_matrix(lh: float, la: float, rho: float = 0.0, maxg: int = MAXG) -> np.ndarray:
    """P(home = i, away = j), i, j = 0..maxg, Poisson with the Dixon-Coles correction."""
    g = np.arange(maxg + 1)
    ph = np.exp(g * np.log(lh) - lh - gammaln(g + 1))
    pa = np.exp(g * np.log(la) - la - gammaln(g + 1))
    m = np.outer(ph, pa)
    m[0, 0] *= 1 - lh * la * rho
    m[0, 1] *= 1 + lh * rho
    m[1, 0] *= 1 + la * rho
    m[1, 1] *= 1 - rho
    return m / m.sum()


def outcome_probs(lh, la, rho: float = 0.0) -> np.ndarray:
    """Vectorised P(home win, draw, away win) for arrays of rates."""
    lh, la = np.atleast_1d(lh).astype(float), np.atleast_1d(la).astype(float)
    g = np.arange(MAXG + 1)
    ph = np.exp(g[None, :] * np.log(lh[:, None]) - lh[:, None] - gammaln(g + 1)[None, :])
    pa = np.exp(g[None, :] * np.log(la[:, None]) - la[:, None] - gammaln(g + 1)[None, :])
    m = ph[:, :, None] * pa[:, None, :]
    m[:, 0, 0] *= 1 - lh * la * rho
    m[:, 0, 1] *= 1 + lh * rho
    m[:, 1, 0] *= 1 + la * rho
    m[:, 1, 1] *= 1 - rho
    m /= m.sum(axis=(1, 2), keepdims=True)
    home = np.tril(np.ones((MAXG + 1, MAXG + 1)), -1)
    p_h = (m * home[None]).sum(axis=(1, 2))
    p_d = np.trace(m, axis1=1, axis2=2)
    return np.column_stack([p_h, p_d, 1 - p_h - p_d])


def rps(p: np.ndarray, outcome: np.ndarray) -> np.ndarray:
    """Ranked probability score for ordered outcomes (0 home, 1 draw, 2 away)."""
    o = np.zeros_like(p)
    o[np.arange(len(p)), outcome] = 1
    cp, co = np.cumsum(p, axis=1)[:, :2], np.cumsum(o, axis=1)[:, :2]
    return 0.5 * ((cp - co) ** 2).sum(axis=1)


# ---- Dixon-Coles ---------------------------------------------------------------------------


def fit_dc(home: np.ndarray, away: np.ndarray, hg: np.ndarray, ag: np.ndarray,
           w: np.ndarray, n_teams: int, prior_att: np.ndarray | None = None,
           prior_dfn: np.ndarray | None = None, ridge: float = 2.0) -> dict:  # fmt: skip
    """Weighted Poisson fit. ``home``/``away``: team indices; ``hg``/``ag``: goals (or xG);
    ``w``: weights. Returns {'att', 'dfn', 'home'}."""
    pa = np.zeros(n_teams) if prior_att is None else prior_att
    pd_ = np.zeros(n_teams) if prior_dfn is None else prior_dfn

    def nll(theta):
        att, dfn, h = theta[:n_teams], theta[n_teams : 2 * n_teams], theta[-1]
        eh = h + att[home] + dfn[away]
        ea = att[away] + dfn[home]
        lh, la = np.exp(eh), np.exp(ea)
        f = -(w * (hg * eh - lh + ag * ea - la)).sum()
        f += 0.5 * ridge * (((att - pa) ** 2).sum() + ((dfn - pd_) ** 2).sum())
        rh, ra = w * (hg - lh), w * (ag - la)  # d(loglik)/d(eta)
        g_att = -(np.bincount(home, rh, n_teams) + np.bincount(away, ra, n_teams))
        g_dfn = -(np.bincount(away, rh, n_teams) + np.bincount(home, ra, n_teams))
        g_att += ridge * (att - pa)
        g_dfn += ridge * (dfn - pd_)
        return f, np.concatenate([g_att, g_dfn, [-rh.sum()]])

    x0 = np.concatenate([pa, pd_, [0.25]])
    r = minimize(nll, x0, jac=True, method="L-BFGS-B")
    return {"att": r.x[:n_teams], "dfn": r.x[n_teams : 2 * n_teams], "home": float(r.x[-1])}


def fit_rho(lh: np.ndarray, la: np.ndarray, hg: np.ndarray, ag: np.ndarray) -> float:
    """Dixon-Coles low-score correction from fitted rates and actual (integer) goals."""
    hg, ag = hg.astype(int), ag.astype(int)

    def nll(rho):
        t = np.ones(len(lh))
        t = np.where((hg == 0) & (ag == 0), 1 - lh * la * rho, t)
        t = np.where((hg == 0) & (ag == 1), 1 + lh * rho, t)
        t = np.where((hg == 1) & (ag == 0), 1 + la * rho, t)
        t = np.where((hg == 1) & (ag == 1), 1 - rho, t)
        return -np.log(np.clip(t, 1e-9, None)).sum()

    grid = np.linspace(-0.25, 0.1, 71)
    return float(grid[np.argmin([nll(r) for r in grid])])


# ---- Elo -----------------------------------------------------------------------------------


def run_elo(m: pd.DataFrame, k: float = 20.0, hfa: float = 60.0,
            carry: float = 2 / 3) -> pd.DataFrame:  # fmt: skip
    """Sequential Elo over one league's matches (sorted by date). Returns each match's
    pre-match and post-match ratings. ``carry``: share of a rating's distance from the league mean
    kept between seasons."""
    m = m.sort_values(["match_date", "match_id"]).reset_index(drop=True)
    r: dict[str, float] = {}
    pre_h, pre_a = np.zeros(len(m)), np.zeros(len(m))
    post_h, post_a = np.zeros(len(m)), np.zeros(len(m))
    season_teams: dict[int, set] = {}
    for s, g in m.groupby("season"):
        season_teams[s] = set(g.home_club) | set(g.away_club)
    current = None
    for i, row in enumerate(m.itertuples(index=False)):
        if row.season != current:
            prev = season_teams.get(current, set())
            now = season_teams[row.season]
            if r:
                mean = np.mean([r[t] for t in prev if t in r]) if prev else 1500.0
                for t in list(r):
                    r[t] = mean + carry * (r[t] - mean)
                relegated = [r[t] for t in prev - now if t in r]
                start = float(np.mean(relegated)) if relegated else mean - 50
                for t in now - prev:
                    r[t] = start
            current = row.season
        h, a = row.home_club, row.away_club
        rh, ra = r.setdefault(h, 1500.0), r.setdefault(a, 1500.0)
        pre_h[i], pre_a[i] = rh, ra
        post_h[i], post_a[i] = rh, ra
        if not row.played:
            continue
        e = 1 / (1 + 10 ** (-(rh + hfa - ra) / 400))
        gd = row.home_goals - row.away_goals
        s_ = 1.0 if gd > 0 else 0.5 if gd == 0 else 0.0
        mult = 1.0 if abs(gd) <= 1 else 1.5 if abs(gd) == 2 else (11 + abs(gd)) / 8
        d = k * mult * (s_ - e)
        r[h], r[a] = rh + d, ra - d
        post_h[i], post_a[i] = rh + d, ra - d
    return m.assign(
        elo_home=pre_h,
        elo_away=pre_a,
        elo_diff=pre_h + hfa - pre_a,
        elo_home_post=post_h,
        elo_away_post=post_a,
    )


def fit_ordered_logit(d: np.ndarray, outcome: np.ndarray) -> np.ndarray:
    """P(away) = s(c1 - b d), P(away or draw) = s(c2 - b d); outcome 0/1/2 = H/D/A.
    Returns (b, c1, c2)."""
    y = outcome

    def nll(t):
        b, c1, gap = t
        c2 = c1 + np.exp(gap)
        p_a = expit(c1 - b * d)
        p_ad = expit(c2 - b * d)
        p = np.where(y == 2, p_a, np.where(y == 1, p_ad - p_a, 1 - p_ad))
        return -np.log(np.clip(p, 1e-12, None)).sum()

    r = minimize(nll, [0.005, -1.0, 0.0], method="Nelder-Mead",
                 options={"maxiter": 4000, "xatol": 1e-7, "fatol": 1e-7})  # fmt: skip
    b, c1, gap = r.x
    return np.array([b, c1, c1 + np.exp(gap)])


def ordered_probs(d: np.ndarray, t: np.ndarray) -> np.ndarray:
    b, c1, c2 = t
    p_a, p_ad = expit(c1 - b * d), expit(c2 - b * d)
    return np.column_stack([1 - p_ad, p_ad - p_a, p_a])


# ---- market --------------------------------------------------------------------------------


def devig_power(odds: np.ndarray, iters: int = 60) -> np.ndarray:
    """Remove the bookmaker margin: p_i = (1/o_i)^k with k solving sum p_i = 1 (rows)."""
    inv = 1.0 / np.asarray(odds, dtype=float)
    lo, hi = np.full(len(inv), 0.5), np.full(len(inv), 3.0)
    for _ in range(iters):
        k = (lo + hi) / 2
        s = (inv ** k[:, None]).sum(axis=1)
        lo = np.where(s > 1, k, lo)  # sum too big -> raise k
        hi = np.where(s > 1, hi, k)
    k = (lo + hi) / 2
    p = inv ** k[:, None]
    return p / p.sum(axis=1, keepdims=True)


class RateInverter:
    """Implied (lambda_home, lambda_away) from 1X2 probabilities: nearest point on a grid
    of Poisson outcome probabilities."""

    def __init__(self, lo: float = 0.15, hi: float = 5.0, step: float = 0.02):
        g = np.arange(lo, hi + 1e-9, step)
        lh, la = np.meshgrid(g, g, indexing="ij")
        self.lh, self.la = lh.ravel(), la.ravel()
        p = outcome_probs(self.lh, self.la)
        self.tree = cKDTree(p[:, [0, 2]])

    def __call__(self, probs: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        _, idx = self.tree.query(np.asarray(probs)[:, [0, 2]])
        return self.lh[idx], self.la[idx]
