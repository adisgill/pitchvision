"""Impact: regularised adjusted plus-minus on goals (spec 5.5, D12, D13).

**Model.** Every valid Transfermarkt stint (domestic leagues in scope plus CL / EL / UECL,
which connect the leagues) is a row: target = goal difference per 90 (home - away), weight
= stint length in 90s x ``decay ** (S - season)``; +1 for each home player, -1 for each
away player, plus a home-advantage term per competition-season. Ridge pulls each player
toward a prior ``beta0``:

    minimise  sum w (y - X b - h)^2 + lam * ||b - beta0||^2

solved by conjugate gradient with the design matrix (never forming X'WX).

**Prior (D13).** ``beta0`` = a minutes-weighted regression of the no-prior RAPM on box
features (non-penalty goals and assists per 90, minutes share, log market value, position
group), fitted only on **earlier** seasons, so the prior for season S never sees S's RAPM.

**Validation (spec 5.5).** For each season S, ratings from data up to S predict every team's
goal difference per 90 in S+1 from the players it actually fielded (minutes-weighted over
its S+1 stints). Variants: RAPM with prior, RAPM without prior, prior alone, raw on/off
plus-minus. The decay and ridge strength are chosen on 2015-2019 and reported on 2020-2024.
"""

from __future__ import annotations

import logging
import time

import numpy as np
import pandas as pd
from scipy import sparse
from scipy.sparse.linalg import LinearOperator, cg

from pitchvision.config import Paths
from pitchvision.db import materialize

log = logging.getLogger(__name__)

DOMESTIC = ("GB1", "ES1", "L1", "IT1", "FR1", "NL1", "PO1")
EUROPE = ("CL", "EL", "UCOL")
LAMBDAS = (30.0, 100.0, 300.0, 1000.0)
DECAYS = (0.5, 0.75)
TUNE = range(2015, 2020)
TEST = range(2020, 2025)
FIRST = 2013
GROUPS = ("GK", "CB", "FB", "DM", "CM", "AM", "W", "ST")


def load_stints(con) -> pd.DataFrame:
    comps = "(" + ",".join(f"'{c}'" for c in DOMESTIC + EUROPE) + ")"
    return con.execute(f"""
        select s.game_id, s.stint, s.minutes, s.home_goals, s.away_goals, s.home_players,
               s.away_players, g.competition_id, g.season, g.home_club_id, g.away_club_id
        from metrics.stints s join stg.tm_games g using (game_id)
        where s.valid and g.competition_id in {comps} and s.minutes > 0""").df()  # fmt: skip


class Design:
    """Sparse stint design over all players and competition-seasons."""

    def __init__(self, st: pd.DataFrame):
        players = sorted({p for col in ("home_players", "away_players") for lst in st[col]
                          for p in lst})  # fmt: skip
        self.players = np.array(players)
        pidx = {p: i for i, p in enumerate(players)}
        self.cs = (st.competition_id + ":" + st.season.astype(str)).astype("category")
        rows, cols, vals = [], [], []
        for r, (hp, ap) in enumerate(zip(st.home_players, st.away_players, strict=True)):
            for p in hp:
                rows.append(r)
                cols.append(pidx[p])
                vals.append(1.0)
            for p in ap:
                rows.append(r)
                cols.append(pidx[p])
                vals.append(-1.0)
        n_p = len(players)
        n_cs = len(self.cs.cat.categories)
        rows += list(range(len(st)))
        cols += list(n_p + self.cs.cat.codes.to_numpy())
        vals += [1.0] * len(st)
        self.x = sparse.csr_matrix((vals, (rows, cols)), shape=(len(st), n_p + n_cs))
        self.n_p, self.n_cs = n_p, n_cs
        self.pidx = pidx
        self.y = 90 * (st.home_goals - st.away_goals).to_numpy(float) / st.minutes.to_numpy()
        self.w90 = st.minutes.to_numpy(float) / 90
        self.season = st.season.to_numpy()

    def solve(self, upto: int, decay: float, lam: float, beta0: np.ndarray | None = None,
              x0: np.ndarray | None = None) -> np.ndarray:  # fmt: skip
        """Ridge fit on stints of seasons <= ``upto`` (others weight 0)."""
        w = np.where(self.season <= upto, self.w90 * decay ** (upto - self.season), 0.0)
        pen = np.concatenate([np.full(self.n_p, lam), np.full(self.n_cs, 1e-3)])
        prior = np.zeros(self.n_p + self.n_cs)
        if beta0 is not None:
            prior[: self.n_p] = beta0
        x = self.x
        b = x.T @ (w * self.y) + pen * prior
        diag = np.asarray(x.multiply(x).T @ w).ravel() + pen

        def mv(v):
            return x.T @ (w * (x @ v)) + pen * v

        op = LinearOperator((len(pen), len(pen)), matvec=mv, dtype=float)
        sol, info = cg(op, b, x0=x0, rtol=1e-8, maxiter=3000,
                       M=sparse.diags(1.0 / diag))  # fmt: skip
        if info:
            log.warning("cg did not converge (info %d)", info)
        return sol

    def exposure(self, upto: int, decay: float) -> np.ndarray:
        """Decayed 90s on the pitch per player."""
        w = np.where(self.season <= upto, self.w90 * decay ** (upto - self.season), 0.0)
        return np.asarray(abs(self.x[:, : self.n_p]).T @ w).ravel()


def box_features(con) -> pd.DataFrame:
    """Per player-season (domestic leagues): np goals and assists per 90, minutes share,
    log market value at season end, modal position group."""
    lg = "(" + ",".join(f"'{c}'" for c in DOMESTIC) + ")"
    return con.execute(f"""
        with ps as (select player_id, season, sum(minutes) minutes_, sum(np_goals) npg,
                           sum(assists) ast, sum(minutes) / sum(team_minutes) share,
                           arg_max(position_group, minutes) grp
                    from metrics.player_season where competition_id in {lg}
                    group by all),
        mv as (select p.player_id, p.season,
                      (select arg_max(v.value_eur, v.value_date) from stg.tm_valuations v
                       where v.player_id = p.player_id
                         and v.value_date <= make_date(p.season + 1, 7, 1)) value_eur
               from ps p)
        select ps.player_id, ps.season, ps.minutes_ as minutes, 90 * ps.npg / ps.minutes_ np90,
               90 * ps.ast / ps.minutes_ a90, ps.share, ps.grp,
               ln(1 + coalesce(mv.value_eur, 0)) logmv, mv.value_eur is null no_value
        from ps left join mv using (player_id, season)
        where ps.minutes_ > 0""").df()  # fmt: skip


def _feature_matrix(f: pd.DataFrame) -> np.ndarray:
    cols = [f.np90.clip(0, 2), f.a90.clip(0, 1.5), f.share, f.logmv, f.no_value.astype(float)]
    cols += [(f.grp == g).astype(float) for g in GROUPS]
    return np.column_stack(cols)


def fit_prior(rapm0: dict[int, pd.Series], feats: pd.DataFrame, season: int,
              min_minutes: float = 900) -> tuple[np.ndarray | None, pd.Series]:  # fmt: skip
    """Coefficients of RAPM-without-prior on box features over seasons < ``season``;
    returns (coef, prior per player for ``season``)."""
    train = []
    for s, r in rapm0.items():
        if s >= season:
            continue
        f = feats[(feats.season == s) & (feats.minutes >= min_minutes)]
        f = f[f.player_id.isin(r.index)]
        train.append(f.assign(target=r.loc[f.player_id].to_numpy()))
    cur = feats[feats.season == season]
    if not train:
        return None, pd.Series(0.0, index=cur.player_id)
    t = pd.concat(train)
    x = np.column_stack([_feature_matrix(t), np.ones(len(t))])
    w = t.minutes.to_numpy()
    coef = np.linalg.lstsq(x * np.sqrt(w)[:, None], t.target.to_numpy() * np.sqrt(w),
                           rcond=None)[0]  # fmt: skip
    xc = np.column_stack([_feature_matrix(cur), np.ones(len(cur))])
    return coef, pd.Series(xc @ coef, index=cur.player_id.to_numpy())


def team_prediction(d: Design, st: pd.DataFrame, season: int,
                    beta: pd.Series) -> pd.DataFrame:  # fmt: skip
    """Each domestic team's predicted vs actual GD per 90 in ``season`` from player values
    ``beta`` (players without a value count 0), minutes-weighted over its stints."""
    sel = (st.season == season) & st.competition_id.isin(DOMESTIC)
    s = st[sel]
    val = beta.reindex(d.players).fillna(0.0).to_numpy()
    xp = d.x[np.flatnonzero(sel.to_numpy()), : d.n_p]
    pred = xp @ val  # home sum minus away sum per stint
    w = s.minutes.to_numpy(float)
    gd = (s.home_goals - s.away_goals).to_numpy(float)
    home = pd.DataFrame({"club": s.home_club_id, "comp": s.competition_id, "w": w,
                         "pred": pred, "gd": gd})  # fmt: skip
    away = pd.DataFrame({"club": s.away_club_id, "comp": s.competition_id, "w": w,
                         "pred": -pred, "gd": -gd})  # fmt: skip
    t = pd.concat([home, away])
    g = t.groupby(["comp", "club"]).apply(
        lambda x: pd.Series({"pred": np.average(x.pred, weights=x.w),
                             "actual": 90 * x.gd.sum() / x.w.sum(), "minutes": x.w.sum()}),
        include_groups=False).reset_index()  # fmt: skip
    return g.assign(season=season)


def on_off(d: Design, upto: int, decay: float) -> pd.Series:
    """Raw on-pitch goal difference per 90 (decayed window), no adjustment."""
    w = np.where(d.season <= upto, d.w90 * decay ** (upto - d.season), 0.0)
    xp = d.x[:, : d.n_p]
    num = np.asarray(xp.T @ (w * d.y)).ravel()  # sign: + when home
    den = np.asarray(abs(xp).T @ w).ravel()
    return pd.Series(np.divide(num, den, out=np.zeros_like(num), where=den > 0), index=d.players)


def run(con) -> dict[str, pd.DataFrame]:
    t0 = time.perf_counter()
    st = load_stints(con)
    d = Design(st)
    feats = box_features(con)
    log.info("rapm design: %d stints x %d players, %.0f s", len(st), d.n_p,
             time.perf_counter() - t0)  # fmt: skip
    seasons = sorted(s for s in st.season.unique() if s >= FIRST)
    evals, ratings = [], []
    for decay in DECAYS:
        for lam in LAMBDAS:
            rapm0, warm = {}, None
            for s in seasons:
                sol = d.solve(s, decay, lam, x0=warm)
                warm = sol
                rapm0[s] = pd.Series(sol[: d.n_p], index=d.players)
            for s in [x for x in seasons if x + 1 in set(st.season)]:
                coef, prior = fit_prior(rapm0, feats, s)
                b0 = prior.reindex(d.players).fillna(0.0).to_numpy()
                sol = d.solve(s, decay, lam, beta0=b0, x0=np.concatenate(
                    [rapm0[s].to_numpy(), np.zeros(d.n_cs)]))  # fmt: skip
                rapm = pd.Series(sol[: d.n_p], index=d.players)
                variants = {"rapm + prior": rapm, "rapm, no prior": rapm0[s],
                            "prior only": pd.Series(b0, index=d.players),
                            "raw on/off": on_off(d, s, decay) / 11}  # fmt: skip
                for name, beta in variants.items():
                    tp = team_prediction(d, st, s + 1, beta)
                    evals.append(tp.assign(variant=name, decay=decay, lam=lam, rated=s))
                ratings.append(pd.DataFrame({
                    "player_id": d.players, "season": s, "decay": decay, "lam": lam,
                    "rapm": rapm.to_numpy(), "rapm_noprior": rapm0[s].to_numpy(),
                    "prior": b0, "exposure_90s": d.exposure(s, decay)}))  # fmt: skip
            log.info("rapm decay %.2f lam %.0f done, %.0f s", decay, lam,
                     time.perf_counter() - t0)  # fmt: skip
    ev = pd.concat(evals, ignore_index=True)
    return {"team_eval": ev, "ratings": pd.concat(ratings, ignore_index=True), "design": d,
            "stints": st}  # fmt: skip


def summarise(ev: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    def r(g):
        return pd.Series({"r": np.corrcoef(g.pred, g.actual)[0, 1],
                          "rmse": float(np.sqrt(((g.pred - g.actual) ** 2).mean())),
                          "teams": len(g)})  # fmt: skip

    split = np.where(ev.rated.isin(TUNE), "tune", np.where(ev.rated.isin(TEST), "test", ""))
    ev = ev.assign(split=split)
    ev = ev[ev.split != ""]  # 2013-14 are warm-up seasons (the prior has no history yet)
    by = ev.groupby(["variant", "decay", "lam", "split", "rated"]).apply(
        r, include_groups=False).reset_index()  # fmt: skip
    summ = (
        by.groupby(["variant", "decay", "lam", "split"])
        .agg(r=("r", "mean"), rmse=("rmse", "mean"), seasons=("r", "size"))
        .reset_index()
    )
    tune = summ[(summ.variant == "rapm + prior") & (summ.split == "tune")]
    best = tune.loc[tune.r.idxmax()]
    return summ, {"decay": float(best.decay), "lam": float(best.lam)}


def collinearity(d: Design, st: pd.DataFrame, season: int) -> pd.DataFrame:
    """Per player (stints of ``season``): share of minutes shared with the most frequent
    teammate. In soccer this is near 1 for almost every regular (the same goalkeeper and
    centre-backs play nearly every minute), which is the collinearity RAPM has to fight;
    it's reported, not used as a cut-off."""
    s = st[st.season == season]
    shared: dict[int, dict[int, float]] = {}
    total: dict[int, float] = {}
    for hp, ap, m in zip(s.home_players, s.away_players, s.minutes, strict=True):
        for side in (hp, ap):
            for p in side:
                total[p] = total.get(p, 0.0) + m
                dct = shared.setdefault(p, {})
                for q in side:
                    if q != p:
                        dct[q] = dct.get(q, 0.0) + m
    return pd.DataFrame([{"player_id": p, "season": season, "minutes": total[p],
                          "max_overlap": max(shared[p].values()) / total[p]
                          if shared[p] else 0.0} for p in total])  # fmt: skip


def build(con, paths: Paths) -> dict:
    out = run(con)
    summ, best = summarise(out["team_eval"])
    rt = out["ratings"]
    rt = rt[(rt.decay == best["decay"]) & (rt.lam == best["lam"])].drop(columns=["decay", "lam"])
    col = pd.concat(
        [collinearity(out["design"], out["stints"], s) for s in sorted(rt.season.unique())],
        ignore_index=True,
    )
    rt = rt.merge(col, on=["player_id", "season"], how="left")
    # data weight: the share of the estimate that comes from his own minutes rather than
    # the prior, exp / (exp + lambda) (an upper bound: collinearity with teammates lowers
    # it further). Below one half the rating is mostly the prior.
    rt["data_weight"] = rt.exposure_90s / (rt.exposure_90s + best["lam"])
    rt["prior_dominated"] = rt.data_weight < 0.5
    n = {}
    for name, schema, df in (("player_rapm", "ratings", rt), ("rapm_eval", "metrics", summ),
                             ("rapm_team_eval", "metrics", out["team_eval"]),
                             ("rapm_chosen", "metrics", pd.DataFrame([best]))):  # fmt: skip
        con.register("tmp_df", df)
        n[name] = materialize(con, paths, schema, name, "select * from tmp_df")
        con.unregister("tmp_df")
    n["chosen"] = best
    return n
