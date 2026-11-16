"""Forecast upgrade (spec 12.7): add what the research found the market prices and our
ratings miss, and keep only what helps out of sample.

The chosen Dixon-Coles blend gives each side's expected goals. On top, a Poisson model
with those rates as offsets learns how much each signal shifts them:

    log lh' = log lh + c_h + b . z      log la' = log la + c_a - b . z

where ``z`` are standardised home-minus-away signals (one shared ``b``, so a signal helps
whichever side has more of it), with a light ridge penalty. It is fitted **walk-forward by
season**: each season's forecasts use only coefficients learned on earlier seasons. Probabilities
then come from the Dixon-Coles score matrix with the match's own ``rho``.

Variants, all scored on the same matches as our model and the closing line:

* ``days ahead``: signals known when fixtures are set: fixture congestion, European matches
  either side, points in the last 5, recent shot and corner dominance.
* ``at line-ups``: plus rotation and regulars missing from the XI (known about an hour before).
* ``FotMob era``: the days-ahead set plus the injured players' share of squad value and recent
  FotMob xG difference; trained on 2024-25, tested on 2025-26 onward.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from scipy.optimize import minimize

from pitchvision.config import Paths
from pitchvision.db import has_table, materialize
from pitchvision.models.team import outcome_probs, rps

DAYS_AHEAD = [
    "congestion_diff",
    "euro_prev_diff",
    "euro_next_diff",
    "form5_diff",
    "shot_dominance_diff",
    "corner_dominance_diff",
]
AT_LINEUPS = DAYS_AHEAD + ["rotation_diff", "missing_regulars_diff"]
FM_EXTRA = ["injured_value_share_diff", "fm_xg_form_diff"]
RIDGE = 2.0
TEST_FROM = 2021


def base(con) -> pd.DataFrame:
    """Matches with our blended rates, rho, outcome, market and Elo probabilities."""
    p = con.execute("select * from forecast.wf_predictions").df()
    ch = con.execute("select * from forecast.wf_chosen").df()
    hl, w = int(ch.half_life[0]), float(ch.w_goals[0])
    lg_h, lg_a = p[f"lh_g_{hl}"].to_numpy(), p[f"la_g_{hl}"].to_numpy()
    lx_h = np.where(p[f"lh_x_{hl}"].isna(), lg_h, p[f"lh_x_{hl}"])
    lx_a = np.where(p[f"la_x_{hl}"].isna(), lg_a, p[f"la_x_{hl}"])
    p["lh"] = np.exp(w * np.log(lg_h) + (1 - w) * np.log(lx_h))
    p["la"] = np.exp(w * np.log(lg_a) + (1 - w) * np.log(lx_a))
    p["rho"] = p[f"rho_{hl}"]
    return p[
        [
            "match_id",
            "competition_id",
            "season",
            "match_date",
            "home_club",
            "away_club",
            "home_goals",
            "away_goals",
            "outcome",
            "lh",
            "la",
            "rho",
            "mkt_h",
            "mkt_d",
            "mkt_a",
            "elo_h",
            "elo_d",
            "elo_a",
        ]
    ].dropna(subset=["lh", "la", "outcome"])


def probs(lh, la, rho) -> np.ndarray:
    out = np.zeros((len(lh), 3))
    rho = np.nan_to_num(np.asarray(rho, dtype=float))
    for r in np.unique(rho):
        sel = rho == r
        out[sel] = outcome_probs(lh[sel], la[sel], r)
    return out


def fit(tr: pd.DataFrame, feats: list[str]) -> dict:
    mu = tr[feats].mean()
    sd = tr[feats].std().replace(0, 1)
    z = ((tr[feats] - mu) / sd).fillna(0).to_numpy()
    yh, ya = tr.home_goals.to_numpy(float), tr.away_goals.to_numpy(float)
    oh, oa = np.log(tr.lh.to_numpy()), np.log(tr.la.to_numpy())
    k = len(feats)

    def nll(theta):
        ch, ca, b = theta[0], theta[1], theta[2:]
        eh, ea = oh + ch + z @ b, oa + ca - z @ b
        lh, la = np.exp(eh), np.exp(ea)
        f = -(yh * eh - lh + ya * ea - la).sum() + 0.5 * RIDGE * (b @ b)
        g_b = -(z.T @ (yh - lh)) + (z.T @ (ya - la)) + RIDGE * b
        return f, np.concatenate([[-(yh - lh).sum(), -(ya - la).sum()], g_b])

    r = minimize(nll, np.zeros(k + 2), jac=True, method="L-BFGS-B")
    return {"feats": feats, "mu": mu, "sd": sd, "c_h": r.x[0], "c_a": r.x[1], "b": r.x[2:]}


def apply(model: dict, te: pd.DataFrame) -> tuple[np.ndarray, np.ndarray]:
    z = ((te[model["feats"]] - model["mu"]) / model["sd"]).fillna(0).to_numpy()
    s = z @ model["b"]
    return (
        te.lh.to_numpy() * np.exp(model["c_h"] + s),
        te.la.to_numpy() * np.exp(model["c_a"] - s),
    )


def _score(p: np.ndarray, y: np.ndarray) -> dict:
    p = np.clip(p, 1e-9, 1)
    p = p / p.sum(axis=1, keepdims=True)
    return {
        "n": len(y),
        "rps": float(rps(p, y).mean()),
        "logloss": float(-np.log(p[np.arange(len(y)), y]).mean()),
    }


def walk_forward(d: pd.DataFrame, feats: list[str], seasons, first_train: int) -> pd.DataFrame:
    """Predictions for each test season from a model fitted on all earlier seasons."""
    out = []
    for s in seasons:
        tr = d[(d.season >= first_train) & (d.season < s)]
        te = d[d.season == s]
        if len(tr) < 1000 or te.empty:
            continue
        m = fit(tr, feats)
        lh, la = apply(m, te)
        p = probs(lh, la, te.rho.to_numpy())
        out.append(te.assign(u_h=p[:, 0], u_d=p[:, 1], u_a=p[:, 2], u_lh=lh, u_la=la))
    return pd.concat(out, ignore_index=True) if out else pd.DataFrame()


def fm_features(con, d: pd.DataFrame) -> pd.DataFrame:
    """FotMob-era signals per match: injured value share (from the research frame) and each
    side's FotMob xG difference over its previous 10 league matches."""
    from pitchvision.research.fm_factors import frame as fm_frame

    f = fm_frame(con)[["match_id", "injured_value_share_diff"]]
    t = con.execute("""
        select x.match_id, t.match_date, t.home_club, t.away_club,
               m.home_expected_goals xh, m.away_expected_goals xa
        from metrics.fm_team_match m join core.fm_matches_xw x using (fm_match_id)
        join core.team_matches t on t.match_id = x.match_id""").df()
    long = pd.concat(
        [
            t.assign(club=t.home_club, xd=t.xh - t.xa)[["match_id", "match_date", "club", "xd"]],
            t.assign(club=t.away_club, xd=t.xa - t.xh)[["match_id", "match_date", "club", "xd"]],
        ]
    ).sort_values(["club", "match_date"])
    long["form"] = long.groupby("club").xd.transform(
        lambda s: s.shift(1).rolling(10, min_periods=4).mean()
    )
    fm = long.set_index(["match_id", "club"]).form
    keys_h = list(zip(d.match_id, d.home_club, strict=True))
    keys_a = list(zip(d.match_id, d.away_club, strict=True))
    out = d[["match_id"]].copy()
    out["fm_xg_form_diff"] = [
        fm.get(h, np.nan) - fm.get(a, np.nan) for h, a in zip(keys_h, keys_a, strict=True)
    ]
    return out.merge(f, on="match_id", how="left")


def build(con, paths: Paths) -> dict[str, int]:
    d = base(con)
    fr = con.execute(
        "select * exclude (season, competition_id) from research.matchup_factor_frame"
    ).df()
    core = d.merge(fr, on="match_id", how="inner")
    y = lambda t: t.outcome.to_numpy().astype(int)  # noqa: E731
    rows, coefs, preds = [], [], []
    seasons = sorted(core.season.unique())
    for name, feats in (("days ahead", DAYS_AHEAD), ("at line-ups", AT_LINEUPS)):
        wf = walk_forward(core, feats, [s for s in seasons if s >= TEST_FROM], seasons[0])
        test = wf[wf.season >= TEST_FROM]
        mk = test.mkt_h.notna()
        for scope, t in [("all", test[mk])] + [
            (c, g) for c, g in test[mk].groupby("competition_id")
        ]:
            yy = y(t)
            for model, p in (
                ("closing line", t[["mkt_h", "mkt_d", "mkt_a"]].to_numpy()),
                ("our model (current)", probs(t.lh.to_numpy(), t.la.to_numpy(), t.rho.to_numpy())),
                ("elo", t[["elo_h", "elo_d", "elo_a"]].to_numpy()),
                (f"upgraded: {name}", t[["u_h", "u_d", "u_a"]].to_numpy()),
            ):
                if model in ("closing line", "our model (current)", "elo") and name != "days ahead":
                    continue
                rows.append(
                    {
                        "study": "core 2021-22 to 2025-26",
                        "league": scope,
                        "model": model,
                        **_score(p, yy),
                    }
                )
        last = fit(core, feats)
        coefs += [
            {"variant": name, "feature": f, "coef": float(b), "sd": float(last["sd"][f])}
            for f, b in zip(feats, last["b"], strict=True)
        ]
        preds.append(test.assign(variant=name)[["match_id", "variant", "u_h", "u_d", "u_a"]])

    n = {}
    if has_table(con, "metrics", "fm_team_match"):
        fe = fm_features(con, d)
        fd = d.merge(fe, on="match_id", how="left")
        # days-ahead signals for the FotMob era come from the research frame where it exists
        fd = fd.merge(fr[["match_id"] + DAYS_AHEAD], on="match_id", how="left")
        fd = fd[fd.season >= 2024]
        for name, feats in (
            ("FotMob era: base signals", DAYS_AHEAD),
            ("FotMob era: + xG form, injuries", DAYS_AHEAD + FM_EXTRA),
        ):
            wf = walk_forward(fd, feats, [2025, 2026], 2024)
            t = wf[wf.mkt_h.notna()]
            if t.empty:
                continue
            yy = y(t)
            for model, p in (
                ("closing line", t[["mkt_h", "mkt_d", "mkt_a"]].to_numpy()),
                ("our model (current)", probs(t.lh.to_numpy(), t.la.to_numpy(), t.rho.to_numpy())),
                (f"upgraded: {name}", t[["u_h", "u_d", "u_a"]].to_numpy()),
            ):
                if model != f"upgraded: {name}" and "+" in name:
                    continue
                rows.append(
                    {
                        "study": "FotMob era 2025-26 onward",
                        "league": "all",
                        "model": model,
                        **_score(p, yy),
                    }
                )
            last = fit(fd, feats)
            coefs += [
                {"variant": name, "feature": f, "coef": float(b), "sd": float(last["sd"][f])}
                for f, b in zip(feats, last["b"], strict=True)
            ]

    for tname, df in (
        ("upgrade_eval", pd.DataFrame(rows)),
        ("upgrade_coefs", pd.DataFrame(coefs)),
        ("upgrade_predictions", pd.concat(preds, ignore_index=True)),
    ):
        con.register("tmp_df", df)
        n[tname] = materialize(con, paths, "forecast", tname, "select * from tmp_df")
        con.unregister("tmp_df")
    return n
