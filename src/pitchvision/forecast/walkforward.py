"""Walk-forward engine (spec 7.1): every league match from 2017-18 on predicted from
earlier matches only, a week at a time.

For each league and each week (Monday-Sunday by match date):

* **Dixon-Coles** on goals and on proxy xG (separately), fitted on the previous 3 years with
  time decay at each half-life in ``HALF_LIVES``; promoted clubs are pulled, all season,
  toward last season's relegated clubs' strengths (``fit_league``). The rates of both
  are stored, so any goals/xG blend ``log l = w log l_goals + (1 - w) log l_xg`` is scored
  afterwards without refitting.
* **Elo** (sequential, pre-match ratings) with an ordered logit fitted on the league's
  earlier seasons.
* **Base rates:** the league's home/draw/away frequencies in earlier seasons.
* **Market:** the closing line, margin removed (the benchmark, not a model of ours).

Half-life and blend weight are chosen on the tuning seasons (2017-18 -> 2020-21) by mean
RPS and reported on the test seasons (2021-22 onward), which played no part in choosing.
"""

from __future__ import annotations

import logging
import time

import numpy as np
import pandas as pd

from pitchvision.config import Paths
from pitchvision.db import materialize
from pitchvision.models.team import (
    devig_power,
    fit_dc,
    fit_ordered_logit,
    fit_rho,
    ordered_probs,  # fmt: skip
    outcome_probs,
    rps,
    run_elo,
)

log = logging.getLogger(__name__)

LEAGUES = ("GB1", "ES1", "L1", "IT1", "FR1", "GB2", "NL1", "PO1", "MLS1")
FIRST_EVAL = 2017
TUNE = (2017, 2020)  # inclusive seasons for choosing half-life and blend
HALF_LIVES = (90, 180, 365)
BLENDS = (1.0, 0.75, 0.5, 0.25, 0.0)
WINDOW_DAYS = 3 * 365


def _outcome(hg, ag) -> np.ndarray:
    return np.where(hg > ag, 0, np.where(hg == ag, 1, 2))


def fit_league(train: pd.DataFrame, clubs_now: set, season: int, half_life: float,
               ref: pd.Timestamp, target: str = "goals") -> dict | None:  # fmt: skip
    """Dixon-Coles for one league as of ``ref`` on the previous ``WINDOW_DAYS`` of
    ``train`` (goals or proxy xG). Clubs new to the league this season (promoted) are pulled,
    all season, toward the mean strength of last season's relegated clubs (spec 5.8);
    everyone else toward the league average."""
    hcol, acol = ("home_goals", "away_goals") if target == "goals" else (
        "proxy_home_xg", "proxy_away_xg")  # fmt: skip
    tr = train.dropna(subset=[hcol, acol])
    if len(tr) < 200:
        return None
    teams = pd.Index(sorted(set(tr.home_club) | set(tr.away_club) | set(clubs_now)))
    h, a = teams.get_indexer(tr.home_club), teams.get_indexer(tr.away_club)
    w = np.exp(-np.log(2) / half_life * (ref - tr.match_date).dt.days.to_numpy())
    n = len(teams)
    hg, ag = tr[hcol].to_numpy(float), tr[acol].to_numpy(float)
    fit = fit_dc(h, a, hg, ag, w, n)
    last = tr[tr.season == season - 1]
    last_clubs = set(last.home_club) | set(last.away_club)
    promoted = sorted(set(clubs_now) - last_clubs) if last_clubs else []
    relegated = sorted(last_clubs - set(clubs_now))
    pi, ri = teams.get_indexer(promoted), teams.get_indexer(relegated)
    pi, ri = pi[pi >= 0], ri[ri >= 0]
    if len(pi) and len(ri):
        pa, pd_ = np.zeros(n), np.zeros(n)
        pa[pi], pd_[pi] = fit["att"][ri].mean(), fit["dfn"][ri].mean()
        fit = fit_dc(h, a, hg, ag, w, n, prior_att=pa, prior_dfn=pd_)
    return {"fit": fit, "teams": teams, "h": h, "a": a, "train": tr,
            "promoted": promoted}  # fmt: skip


def _fit_week(
    train: pd.DataFrame,
    week: pd.DataFrame,
    season: int,
    half_life: float,
    target: str,
    clubs_now: set,
) -> tuple | None:
    """Rates for the week's matches from ``fit_league``."""
    r = fit_league(train, clubs_now, season, half_life, week.match_date.min(), target)
    if r is None:
        return None
    fit, teams, h, a = r["fit"], r["teams"], r["h"], r["a"]
    wh, wa = teams.get_indexer(week.home_club), teams.get_indexer(week.away_club)
    lh = np.exp(fit["home"] + fit["att"][wh] + fit["dfn"][wa])
    la = np.exp(fit["att"][wa] + fit["dfn"][wh])
    return (
        lh,
        la,
        {
            "train_lh": np.exp(fit["home"] + fit["att"][h] + fit["dfn"][a]),
            "train_la": np.exp(fit["att"][a] + fit["dfn"][h]),
            "train": r["train"],
        },
    )


def league(m: pd.DataFrame) -> pd.DataFrame:
    """Walk-forward predictions for one league's matches."""
    m = m.sort_values(["match_date", "match_id"]).reset_index(drop=True)
    m["match_date"] = pd.to_datetime(m.match_date)
    m = run_elo(m)
    played = m[m.played].copy()
    played["outcome"] = _outcome(played.home_goals, played.away_goals)
    ev = played[played.season >= FIRST_EVAL].copy()
    rows = []
    # Elo ordered logit and base rates per evaluation season, from earlier seasons
    elo_p, base_p = {}, {}
    for s in sorted(ev.season.unique()):
        prior = played[played.season < s]
        t = fit_ordered_logit(prior.elo_diff.to_numpy(), prior.outcome.to_numpy())
        cur = ev[ev.season == s]
        elo_p.update(dict(zip(cur.index, ordered_probs(cur.elo_diff.to_numpy(), t),
                              strict=True)))  # fmt: skip
        freq = np.bincount(prior.outcome, minlength=3) / len(prior)
        base_p.update({i: freq for i in cur.index})
    ev["week"] = ev.match_date - pd.to_timedelta(ev.match_date.dt.day_of_week, unit="D")
    for wk, week in ev.groupby("week"):
        train = played[(played.match_date < wk)
                       & (played.match_date >= wk - pd.Timedelta(days=WINDOW_DAYS))]  # fmt: skip
        season = int(week.season.iloc[0])
        # the season's clubs known by this week: its fixtures so far plus this week's
        so_far = m[(m.season == season) & (m.match_date < wk + pd.Timedelta(days=7))]
        clubs_now = set(so_far.home_club) | set(so_far.away_club)
        out = {"match_id": week.match_id.to_numpy()}
        for hl in HALF_LIVES:
            g = _fit_week(train, week, season, hl, "goals", clubs_now)
            x = _fit_week(train, week, season, hl, "xg", clubs_now)
            if g is None:
                continue
            rho = fit_rho(g[2]["train_lh"], g[2]["train_la"],
                          g[2]["train"].home_goals.to_numpy(),
                          g[2]["train"].away_goals.to_numpy())  # fmt: skip
            out[f"lh_g_{hl}"], out[f"la_g_{hl}"] = g[0], g[1]
            out[f"lh_x_{hl}"] = x[0] if x is not None else np.full(len(week), np.nan)
            out[f"la_x_{hl}"] = x[1] if x is not None else np.full(len(week), np.nan)
            out[f"rho_{hl}"] = np.full(len(week), rho)
        rows.append(pd.DataFrame(out))
    pred = ev.merge(pd.concat(rows, ignore_index=True), on="match_id", how="left")
    pe = np.array([elo_p[i] for i in ev.index])
    pb = np.array([base_p[i] for i in ev.index])
    pred[["elo_h", "elo_d", "elo_a"]] = pe
    pred[["base_h", "base_d", "base_a"]] = pb
    odds = pred[["close_home", "close_draw", "close_away"]].to_numpy(float)
    ok = np.isfinite(odds).all(axis=1) & (odds > 1).all(axis=1)
    mk = np.full((len(pred), 3), np.nan)
    mk[ok] = devig_power(odds[ok])
    pred[["mkt_h", "mkt_d", "mkt_a"]] = mk
    return pred


def blend_probs(pred: pd.DataFrame, hl: int, w: float) -> np.ndarray:
    """1X2 from a goals/xG blend of the two fits' rates (goals alone where xG is missing)."""
    lg_h, lg_a = pred[f"lh_g_{hl}"].to_numpy(), pred[f"la_g_{hl}"].to_numpy()
    lx_h, lx_a = pred[f"lh_x_{hl}"].to_numpy(), pred[f"la_x_{hl}"].to_numpy()
    lx_h, lx_a = np.where(np.isnan(lx_h), lg_h, lx_h), np.where(np.isnan(lx_a), lg_a, lx_a)
    lh = np.exp(w * np.log(lg_h) + (1 - w) * np.log(lx_h))
    la = np.exp(w * np.log(lg_a) + (1 - w) * np.log(lx_a))
    rho = pred[f"rho_{hl}"].to_numpy()
    out = np.zeros((len(pred), 3))
    for r in np.unique(rho[np.isfinite(rho)]):
        sel = rho == r
        out[sel] = outcome_probs(lh[sel], la[sel], r)
    return out


def _metrics(p: np.ndarray, y: np.ndarray) -> dict:
    p = np.clip(p, 1e-9, 1)
    p = p / p.sum(axis=1, keepdims=True)
    o = np.zeros_like(p)
    o[np.arange(len(y)), y] = 1
    return {"n": len(y), "rps": float(rps(p, y).mean()),
            "logloss": float(-np.log(p[np.arange(len(y)), y]).mean()),
            "brier": float(((p - o) ** 2).sum(axis=1).mean())}  # fmt: skip


def evaluate(pred: pd.DataFrame) -> tuple[pd.DataFrame, dict, pd.DataFrame]:
    """Choose half-life and blend on the tuning seasons; score every model per split and
    league on the matches every model covers (including the closing line)."""
    pred = pred[pred[[f"lh_g_{h}" for h in HALF_LIVES]].notna().all(axis=1)].copy()
    tune = pred.season.between(*TUNE).to_numpy()
    y = pred.outcome.to_numpy()
    grid = []
    for hl in HALF_LIVES:
        for w in BLENDS:
            p = blend_probs(pred, hl, w)
            grid.append({"half_life": hl, "w_goals": w,
                         "rps_tune": float(rps(p[tune], y[tune]).mean())})  # fmt: skip
    grid = pd.DataFrame(grid)
    best = grid.loc[grid.rps_tune.idxmin()]
    hl, w = int(best.half_life), float(best.w_goals)
    best_goals = grid[grid.w_goals == 1.0].sort_values("rps_tune").iloc[0]
    models = {
        "base rates": pred[["base_h", "base_d", "base_a"]].to_numpy(),
        "elo": pred[["elo_h", "elo_d", "elo_a"]].to_numpy(),
        "dixon-coles goals": blend_probs(pred, int(best_goals.half_life), 1.0),
        "dixon-coles proxy xG": blend_probs(pred, hl, 0.0),
        "dixon-coles blend": blend_probs(pred, hl, w),
        "closing line": pred[["mkt_h", "mkt_d", "mkt_a"]].to_numpy(),
    }
    have_mkt = np.isfinite(models["closing line"]).all(axis=1)
    rows = []
    split = np.where(tune, "tune 2017-18 to 2020-21", "test 2021-22 on")
    for name, p in models.items():
        for sp in np.unique(split):
            for lg in ["all", *sorted(pred.competition_id.unique())]:
                sel = (split == sp) & have_mkt & ((pred.competition_id == lg).to_numpy()
                                                  if lg != "all" else True)  # fmt: skip
                if sel.sum():
                    rows.append({"model": name, "split": sp, "league": lg,
                                 **_metrics(p[sel], y[sel])})  # fmt: skip
    for name, p in models.items():
        pred[[f"{name}_h", f"{name}_d", f"{name}_a"]] = p
    chosen = {"half_life": hl, "w_goals": w, "half_life_goals_only":
              int(best_goals.half_life)}  # fmt: skip
    return pd.DataFrame(rows), chosen, grid


def build(con, paths: Paths) -> dict:
    lg = "(" + ",".join(f"'{c}'" for c in LEAGUES) + ")"
    tm = con.execute(f"""select * from core.team_matches where competition_id in {lg}
                         order by match_date""").df()  # fmt: skip
    preds = []
    for code, m in tm.groupby("competition_id"):
        t0 = time.perf_counter()
        preds.append(league(m))
        log.info("walk-forward %s: %d matches, %.0f s", code, len(preds[-1]),
                 time.perf_counter() - t0)  # fmt: skip
    pred = pd.concat(preds, ignore_index=True)
    ev, chosen, grid = evaluate(pred)
    keep = [c for c in pred.columns if c.endswith(("_h", "_d", "_a"))
            or c.startswith(("lh_", "la_", "rho_")) or c in (
        "match_id", "competition_id", "season", "match_date", "home_club", "away_club",
        "home_goals", "away_goals", "outcome", "elo_home", "elo_away")]  # fmt: skip
    n = {}
    for name, df in (("wf_predictions", pred[keep]), ("wf_eval", ev), ("wf_tuning", grid),
                     ("wf_chosen", pd.DataFrame([chosen]))):  # fmt: skip
        con.register("tmp_df", df)
        n[name] = materialize(con, paths, "forecast", name, "select * from tmp_df")
        con.unregister("tmp_df")
    n["chosen"] = chosen
    return n
