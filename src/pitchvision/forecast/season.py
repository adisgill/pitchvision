"""Season simulator (spec 7.2): Monte Carlo of a league's remaining matches.

* **Remaining fixtures:** every ordered pair of the season's clubs not yet played (all
  simulated leagues are double round-robins; the club count is checked against
  ``rules/leagues.toml``).
* **Strengths with uncertainty:** the walk-forward's chosen model (Dixon-Coles, goals/xG
  blend, chosen half-life), with ``B`` draws from its Laplace posterior (the fit plus the
  inverse-Hessian covariance, ridge prior included); each run uses one draw, so the odds
  carry parameter uncertainty, not just match randomness. (A bootstrap of the matches was
  tried first and dropped: with ~10 matches a promoted club's resampled strength swung
  from -0.7 to +0.65, far noisier than its real uncertainty.)
* **Matches:** scorelines drawn from each match's Dixon-Coles score matrix.
* **Table:** points, then the league's tiebreakers in order (head-to-head mini-leagues
  computed per run); Serie A's title and last relegation place go to a one-off play-off
  when two clubs are level on points.

``equal_strength=True`` gives every club the league-average strength: the baseline that
shows what the strengths add beyond the points already won.
"""

from __future__ import annotations

import logging
import time
import tomllib
from pathlib import Path

import numpy as np
import pandas as pd

from pitchvision.config import REPO_ROOT
from pitchvision.forecast.walkforward import WINDOW_DAYS, fit_league
from pitchvision.models.team import MAXG, fit_rho, outcome_probs, score_matrix

log = logging.getLogger(__name__)
RULES_FILE = REPO_ROOT / "rules" / "leagues.toml"


def rules(path: Path = RULES_FILE) -> dict:
    with path.open("rb") as f:
        return tomllib.load(f)


def league_size(rule: dict, season: int) -> int:
    if "sizes" in rule:
        firsts = sorted((int(k), v) for k, v in rule["sizes"].items())
        return [v for k, v in firsts if k <= season][-1]
    return rule["size"]


def zone_range(lo: int, hi: int, n: int) -> tuple[int, int]:
    """1-based inclusive positions; negative values count from the bottom (-1 = last)."""
    return (lo if lo > 0 else n + 1 + lo), (hi if hi > 0 else n + 1 + hi)


def remaining_fixtures(season_matches: pd.DataFrame) -> tuple[list[str], pd.DataFrame]:
    clubs = sorted(set(season_matches.home_club) | set(season_matches.away_club))
    played = set(zip(season_matches[season_matches.played].home_club,
                     season_matches[season_matches.played].away_club, strict=True))  # fmt: skip
    rem = [(h, a) for h in clubs for a in clubs if h != a and (h, a) not in played]
    return clubs, pd.DataFrame(rem, columns=["home_club", "away_club"])


def _hessian(r: dict, half_life: float, ref: pd.Timestamp, target: str,
             ridge: float = 2.0) -> np.ndarray:  # fmt: skip
    """Hessian of the penalised Poisson negative log-likelihood at the fit (params: att[n],
    dfn[n], home), i.e. the precision of the Laplace posterior."""
    fit, teams, h, a, tr = r["fit"], r["teams"], r["h"], r["a"], r["train"]
    n = len(teams)
    w = np.exp(-np.log(2) / half_life * (ref - tr.match_date).dt.days.to_numpy())
    lh = np.exp(fit["home"] + fit["att"][h] + fit["dfn"][a])
    la = np.exp(fit["att"][a] + fit["dfn"][h])
    k = 2 * n + 1
    hess = np.zeros((k, k))
    for wi, i_att, i_dfn, home in ((w * lh, h, a, True), (w * la, a, h, False)):
        cols = [i_att, n + i_dfn] + ([np.full(len(h), 2 * n)] if home else [])
        for c1 in cols:
            for c2 in cols:
                np.add.at(hess, (c1, c2), wi)
    hess[np.arange(2 * n), np.arange(2 * n)] += ridge
    return hess


def strength_draws(train: pd.DataFrame, clubs: list[str], season: int, half_life: float,
                   w_goals: float, ref: pd.Timestamp, b: int,
                   rng: np.random.Generator) -> list[dict]:  # fmt: skip
    """``b`` draws of the blended Dixon-Coles strengths from the Laplace posterior (the fit
    plus Gaussian noise with the inverse-Hessian covariance; the first draw is the fit
    itself). One shared standard-normal vector per draw moves the goals and xG fits
    together."""
    fits = {t: fit_league(train, set(clubs), season, half_life, ref, t)
            for t in (("goals", "xg") if w_goals < 1 else ("goals",))}  # fmt: skip
    fits = {t: f for t, f in fits.items() if f is not None}
    if "goals" not in fits:
        return []
    chol = {}
    for t, f in fits.items():
        cov = np.linalg.inv(_hessian(f, half_life, ref, t))
        chol[t] = np.linalg.cholesky((cov + cov.T) / 2 + 1e-10 * np.eye(len(cov)))
    k = len(next(iter(chol.values())))
    draws = []
    for d in range(b):
        z = np.zeros(k) if d == 0 else rng.standard_normal(k)
        one = {}
        for t, f in fits.items():
            n = len(f["teams"])
            theta = np.concatenate([f["fit"]["att"], f["fit"]["dfn"], [f["fit"]["home"]]])
            th = theta + chol[t] @ z[: len(theta)]
            one[t] = {"fit": {"att": th[:n], "dfn": th[n:2 * n], "home": th[-1]},
                      "teams": f["teams"]}  # fmt: skip
        draws.append({"goals": one["goals"], "xg": one.get("xg"), "base": fits["goals"]})
    return draws


def _rate(f: dict, h: np.ndarray, a: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    fit, t = f["fit"], f["teams"]
    hi, ai = t.get_indexer(h), t.get_indexer(a)
    return (np.exp(fit["home"] + fit["att"][hi] + fit["dfn"][ai]),
            np.exp(fit["att"][ai] + fit["dfn"][hi]))  # fmt: skip


def _rates(f: dict, home: np.ndarray, away: np.ndarray, w: float) -> tuple[np.ndarray, ...]:
    gh, ga = _rate(f["goals"], home, away)
    if f["xg"] is None or w >= 1:
        return gh, ga
    xh, xa = _rate(f["xg"], home, away)
    return np.exp(w * np.log(gh) + (1 - w) * np.log(xh)), np.exp(
        w * np.log(ga) + (1 - w) * np.log(xa))  # fmt: skip


def _rank(pts, gd, gf, hg, ag, home_i, away_i, order: list[str], n: int,
          rng: np.random.Generator) -> np.ndarray:  # fmt: skip
    """Final order (array of club indices, best first) for one run."""
    rnd = rng.random(n)

    def h2h(group: list[int]) -> dict[int, tuple[int, int, int]]:
        gs = set(group)
        sel = [k for k in range(len(home_i)) if home_i[k] in gs and away_i[k] in gs]
        p = dict.fromkeys(group, 0)
        d = dict.fromkeys(group, 0)
        f = dict.fromkeys(group, 0)
        for k in sel:
            h, a, x, y = home_i[k], away_i[k], hg[k], ag[k]
            d[h] += x - y
            d[a] += y - x
            f[h] += x
            f[a] += y
            if x > y:
                p[h] += 3
            elif x == y:
                p[h] += 1
                p[a] += 1
            else:
                p[a] += 3
        return {c: (p[c], d[c], f[c]) for c in group}

    def resolve(group: list[int], keys: list[str]) -> list[int]:
        if len(group) <= 1 or not keys:
            return sorted(group, key=lambda c: -rnd[c])
        key, rest = keys[0], keys[1:]
        if key in ("gd", "gf"):
            vals = {c: (gd if key == "gd" else gf)[c] for c in group}
        else:
            hh = h2h(group)
            vals = {c: hh[c][{"h2h_points": 0, "h2h_gd": 1, "h2h_gf": 2}[key]] for c in group}
        out = []
        for v in sorted(set(vals.values()), reverse=True):
            out += resolve([c for c in group if vals[c] == v], rest)
        return out

    final = []
    for v in sorted(set(pts), reverse=True):
        final += resolve([c for c in range(n) if pts[c] == v], order)
    return np.array(final)


def simulate(season_matches: pd.DataFrame, history: pd.DataFrame, rule: dict,
             as_of: pd.Timestamp, half_life: float, w_goals: float, runs: int = 10_000,
             b: int = 200, seed: int = 0,
             equal_strength: bool = False) -> pd.DataFrame | None:  # fmt: skip
    """Position probabilities for the clubs of one league-season, from matches played up to
    ``as_of`` (``season_matches``: the season's matches; ``history``: all the league's
    matches, for fitting)."""
    rng = np.random.default_rng(seed)
    sm = season_matches.copy()
    sm["played"] = sm.played & (sm.match_date <= as_of)
    clubs, rem = remaining_fixtures(sm)
    n = len(clubs)
    season = int(sm.season.iloc[0])
    expected = league_size(rule, season)
    if n != expected:
        log.warning("%s %d: %d clubs, rules say %d; not simulated", rule["name"], season, n,
                    expected)  # fmt: skip
        return None
    idx = {c: i for i, c in enumerate(clubs)}
    done = sm[sm.played]
    pts0, gd0, gf0 = np.zeros(n), np.zeros(n), np.zeros(n)
    for r in done.itertuples(index=False):
        h, a, x, y = idx[r.home_club], idx[r.away_club], r.home_goals, r.away_goals
        gd0[h] += x - y
        gd0[a] += y - x
        gf0[h] += x
        gf0[a] += y
        pts0[h] += 3 if x > y else 1 if x == y else 0
        pts0[a] += 3 if y > x else 1 if x == y else 0
    played_h = np.array([idx[c] for c in done.home_club], dtype=int)
    played_a = np.array([idx[c] for c in done.away_club], dtype=int)
    played_hg, played_ag = done.home_goals.to_numpy(int), done.away_goals.to_numpy(int)
    rh = np.array([idx[c] for c in rem.home_club], dtype=int)
    ra = np.array([idx[c] for c in rem.away_club], dtype=int)
    m = len(rem)
    train = history[history.played & (history.match_date <= as_of)
                    & (history.match_date > as_of - pd.Timedelta(days=WINDOW_DAYS))]  # fmt: skip
    if equal_strength:
        hg_mean, ag_mean = train.home_goals.mean(), train.away_goals.mean()
        lam = [(np.full(m, hg_mean), np.full(m, ag_mean))]
        rho = 0.0
    else:
        fits = strength_draws(train, clubs, season, half_life, w_goals, as_of, b, rng)
        lam = [_rates(f, rem.home_club.to_numpy(), rem.away_club.to_numpy(), w_goals)
               for f in fits]  # fmt: skip
        f0 = fits[0]["base"]
        fit0, h0, a0 = f0["fit"], f0["h"], f0["a"]
        rho = fit_rho(
            np.exp(fit0["home"] + fit0["att"][h0] + fit0["dfn"][a0]),
            np.exp(fit0["att"][a0] + fit0["dfn"][h0]),
            f0["train"].home_goals.to_numpy(),
            f0["train"].away_goals.to_numpy(),
        )
    pos_count = np.zeros((n, n))
    pts_sum, gd_sum = np.zeros(n), np.zeros(n)
    playoff = set(rule.get("playoff_positions", []))
    per = int(np.ceil(runs / len(lam)))
    g = np.arange(MAXG + 1)
    done_runs = 0
    for lh, la in lam:
        k = min(per, runs - done_runs)
        if k <= 0:
            break
        if m:
            mats = np.stack([score_matrix(lh[j], la[j], rho).ravel() for j in range(m)])
            cum = np.cumsum(mats, axis=1)
            u = rng.random((k, m, 1))
            cell = (cum[None, :, :] < u).sum(axis=2).clip(max=cum.shape[1] - 1)
            hg_s, ag_s = g[cell // (MAXG + 1)], g[cell % (MAXG + 1)]
        else:  # season over: every run just ranks the final table
            hg_s = ag_s = np.zeros((k, 0), dtype=int)
        for r in range(k):
            pts, gd, gf = pts0.copy(), gd0.copy(), gf0.copy()
            x, y = hg_s[r], ag_s[r]
            np.add.at(gd, rh, x - y)
            np.add.at(gd, ra, y - x)
            np.add.at(gf, rh, x)
            np.add.at(gf, ra, y)
            np.add.at(pts, rh, np.where(x > y, 3, np.where(x == y, 1, 0)))
            np.add.at(pts, ra, np.where(y > x, 3, np.where(x == y, 1, 0)))
            all_h = np.concatenate([played_h, rh])
            all_a = np.concatenate([played_a, ra])
            all_hg = np.concatenate([played_hg, x])
            all_ag = np.concatenate([played_ag, y])
            order = _rank(pts, gd, gf, all_hg, all_ag, all_h, all_a, rule["tiebreak"], n, rng)
            for p_ in playoff:  # two clubs level on points across position p_ / p_ + 1
                i, j = order[p_ - 1], order[p_]
                if pts[i] == pts[j] and (p_ == n or pts[order[p_ + 1]] != pts[j]) and (
                        p_ == 1 or pts[order[p_ - 2]] != pts[i]):  # fmt: skip
                    lh_n, la_n = _neutral(lam[0], rem, clubs, i, j)
                    pr = outcome_probs(lh_n, la_n)[0]
                    win_i = rng.random() < pr[0] + pr[1] / 2
                    if not win_i:
                        order[p_ - 1], order[p_] = j, i
            pos_count[order, np.arange(n)] += 1
            pts_sum += pts
            gd_sum += gd
        done_runs += k
    total = pos_count.sum(axis=1, keepdims=True)
    probs = pos_count / total
    out = pd.DataFrame(probs, columns=[f"p_pos_{i + 1}" for i in range(n)])
    out.insert(0, "club_id", clubs)
    out["points_now"] = pts0
    out["played"] = [((played_h == i) | (played_a == i)).sum() for i in range(n)]
    out["exp_points"] = pts_sum / done_runs
    out["exp_gd"] = gd_sum / done_runs
    for zone, (lo, hi) in rule["zones"].items():
        za, zb = zone_range(lo, hi, n)
        out[f"p_{zone}"] = probs[:, za - 1 : zb].sum(axis=1)
    out["exp_position"] = probs @ np.arange(1, n + 1)
    out["runs"] = done_runs
    return out


def _neutral(lam, rem, clubs, i, j):
    """Neutral-venue rates for a play-off between clubs i and j (mean of their two
    fixtures' rates in the first fit; equal rates if unavailable)."""
    lh, la = lam
    sel_ij = (rem.home_club == clubs[i]) & (rem.away_club == clubs[j])
    sel_ji = (rem.home_club == clubs[j]) & (rem.away_club == clubs[i])
    if sel_ij.any() and sel_ji.any():
        a, b = lh[sel_ij.to_numpy()][0], la[sel_ij.to_numpy()][0]
        c, d = lh[sel_ji.to_numpy()][0], la[sel_ji.to_numpy()][0]
        return np.sqrt(a * d), np.sqrt(b * c)
    return 1.3, 1.3


def timed(fn, *a, **k):
    t = time.perf_counter()
    r = fn(*a, **k)
    log.info("%s %.1f s", fn.__name__, time.perf_counter() - t)
    return r


# ---- current season and backtest ----------------------------------------------------------

SIM_LEAGUES = ("GB1", "ES1", "IT1", "L1", "FR1", "NL1", "PO1", "GB2")


def _league_frames(con, code: str) -> pd.DataFrame:
    tm = con.execute("select * from core.team_matches where competition_id = ?", [code]).df()
    tm["match_date"] = pd.to_datetime(tm.match_date)
    # tables use the official result (awarded matches); models already use the played one
    tm["home_goals"] = tm.home_goals_official.fillna(tm.home_goals)
    tm["away_goals"] = tm.away_goals_official.fillna(tm.away_goals)
    return tm


def final_positions(season_matches: pd.DataFrame, rule: dict) -> pd.Series:
    """Positions from all results under the league's tiebreakers (points deductions are not
    modelled: a known gap, e.g. the 2023-24 PL deductions)."""
    end = season_matches.match_date.max()
    out = simulate(season_matches, season_matches, rule, end, 365, 1.0, runs=1, b=1,
                   equal_strength=True)  # fmt: skip
    if out is None:
        return pd.Series(dtype=float)
    pos = out[[c for c in out.columns if c.startswith("p_pos_")]].to_numpy().argmax(axis=1) + 1
    return pd.Series(pos, index=out.club_id)


def backtest(con, half_life: float, w_goals: float, seasons=range(2017, 2026),
             runs: int = 4000, b: int = 100) -> tuple[pd.DataFrame, pd.DataFrame]:  # fmt: skip
    """Each completed season simulated from its halfway point (the date by which half its
    matches were played), with our strengths and with equal strengths; zone probabilities
    scored against the final table."""
    rl = rules()
    rows = []
    for code in SIM_LEAGUES:
        tm = _league_frames(con, code)
        for s in seasons:
            sm = tm[tm.season == s]
            n_clubs = len(set(sm.home_club) | set(sm.away_club))
            if not len(sm) or not sm.played.all() or len(sm) != n_clubs * (n_clubs - 1):
                continue  # incomplete (e.g. abandoned 2019-20 seasons): no final table
            dates = sm.sort_values("match_date").match_date.to_numpy()
            as_of = pd.Timestamp(dates[len(dates) // 2])
            final = final_positions(sm, rl[code])
            for label, eq in (("model", False), ("equal strength", True)):
                out = simulate(sm, tm, rl[code], as_of, half_life, w_goals, runs=runs, b=b,
                               seed=s, equal_strength=eq)  # fmt: skip
                if out is None:
                    continue
                out["final_position"] = out.club_id.map(final)
                rows.append(out.assign(competition_id=code, season=s, as_of=as_of.date(),
                                       variant=label))  # fmt: skip
            log.info("backtest %s %d done", code, s)
    bt = pd.concat(rows, ignore_index=True)
    ev = []
    for (variant, code), g in bt.groupby(["variant", "competition_id"]):
        n_by_season = g.groupby("season").club_id.transform("size")
        for zone, (lo, hi) in rl[code]["zones"].items():
            za = np.where(lo > 0, lo, n_by_season + 1 + lo)
            zb = np.where(hi > 0, hi, n_by_season + 1 + hi)
            y = ((g.final_position >= za) & (g.final_position <= zb)).astype(float)
            p = g[f"p_{zone}"]
            ev.append({"variant": variant, "league": code, "zone": zone, "n": len(g),
                       "brier": float(((p - y) ** 2).mean()),
                       "pred_sum": float(p.sum()), "actual": float(y.sum())})  # fmt: skip
    return bt, pd.DataFrame(ev)


def current(con, half_life: float, w_goals: float, runs: int = 10_000,
            b: int = 200) -> pd.DataFrame:  # fmt: skip
    rl = rules()
    out = []
    for code in SIM_LEAGUES:
        tm = _league_frames(con, code)
        s = int(tm.season.max())
        sm = tm[tm.season == s]
        as_of = sm[sm.played].match_date.max()
        r = simulate(sm, tm, rl[code], as_of, half_life, w_goals, runs=runs, b=b, seed=s)
        if r is not None:
            names = dict(zip(sm.home_club, sm.home_team, strict=False))
            out.append(r.assign(competition_id=code, season=s, as_of=as_of.date(),
                                name=r.club_id.map(names)))  # fmt: skip
    return pd.concat(out, ignore_index=True)


def build(con, paths) -> dict[str, int]:
    from pitchvision.db import has_table, materialize

    hl, w = 365.0, 0.75
    if has_table(con, "forecast", "wf_chosen"):
        hl, w = con.execute("select half_life, w_goals from forecast.wf_chosen").fetchall()[0]
    cur = current(con, float(hl), float(w))
    bt, ev = backtest(con, float(hl), float(w))
    n = {}
    for name, df in (("season_sim", cur), ("season_backtest", bt),
                     ("season_backtest_eval", ev)):  # fmt: skip
        con.register("tmp_df", df)
        n[name] = materialize(con, paths, "forecast", name, "select * from tmp_df")
        con.unregister("tmp_df")
    # every run of the current-season simulation is kept, so odds can be tracked over time
    con.register("tmp_df", cur.assign(simulated_at=pd.Timestamp.now(tz="UTC")
                                      .tz_localize(None).floor("s")))  # fmt: skip
    if has_table(con, "forecast", "season_sim_history"):
        con.execute("""insert into forecast.season_sim_history by name
                       select * from tmp_df where (competition_id, as_of) not in
                       (select competition_id, as_of from forecast.season_sim_history)""")
    else:
        con.execute("create table forecast.season_sim_history as select * from tmp_df")
    con.unregister("tmp_df")
    return n
