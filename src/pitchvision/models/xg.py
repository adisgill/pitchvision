"""Expected goals (spec 6.1).

Two candidate models on the harmonised non-penalty shots of both providers:

* ``logit``: logistic regression, natural-spline bases on distance and angle, one-hot body,
  situation, assist and game state;
* ``gbm``: ``HistGradientBoostingClassifier`` with monotone constraints (xG falls with
  distance, rises with angle) on the same features.

Both are scored **leave-one-group-out** (a group is a provider-league-season: 18 of them),
so every shot gets an out-of-fold prediction from a model that never saw its season. The
model with the lower pooled out-of-fold log loss is chosen; the chosen model refitted on
all shots gives the production ``xg``. Penalties get the pooled training conversion rate.

Benchmarks on the same shots: StatsBomb's own ``statsbomb_xg`` (StatsBomb seasons) and a
base-rate model. A StatsBomb-only variant adds ``under_pressure`` to measure what the
pressure flag is worth (it can't be used on Wyscout seasons).
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import brier_score_loss, log_loss, roc_auc_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import OneHotEncoder, OrdinalEncoder, SplineTransformer

NUM = ["distance", "angle"]
# provider corrects how each provider records shots (Wyscout seasons convert ~10% above a
# provider-blind model); women is a real difference in conversion. Both cut the mean
# per-season xG/goals error from 9.6% to 4.9% out of fold (Phase 1 test, Nov 14).
CAT = ["body", "situation", "assist", "state", "provider", "women"]
EPS = 1e-6
THREADS = 4


def _logit_model():
    pre = ColumnTransformer([
        ("spl", SplineTransformer(n_knots=6, degree=3, extrapolation="linear"), NUM),
        ("cat", OneHotEncoder(handle_unknown="ignore"), CAT),
    ])  # fmt: skip
    return make_pipeline(pre, LogisticRegression(C=1.0, max_iter=3000))


def _gbm_model(extra_cat: list[str] | None = None):
    cats = CAT + (extra_cat or [])
    pre = ColumnTransformer([
        ("num", "passthrough", NUM),
        ("cat", OrdinalEncoder(handle_unknown="use_encoded_value", unknown_value=-1), cats),
    ])  # fmt: skip
    gbm = HistGradientBoostingClassifier(
        learning_rate=0.05, max_iter=300, max_leaf_nodes=31, l2_regularization=1.0,
        min_samples_leaf=40, monotonic_cst=[-1, 1] + [0] * len(cats),
        categorical_features=list(range(2, 2 + len(cats))), random_state=0)  # fmt: skip
    return make_pipeline(pre, gbm)


MODELS = {"logit": _logit_model, "gbm": _gbm_model}


def _prep(s: pd.DataFrame) -> pd.DataFrame:
    s = s.copy()
    s["state"] = s.state.astype(str)
    s["women"] = s.women.astype(str)
    s["under_pressure"] = s.under_pressure.fillna(False).astype(bool).astype(str)
    return s


def calibration(y: np.ndarray, p: np.ndarray) -> tuple[float, float]:
    """Calibration intercept and slope: logistic regression of y on logit(p)."""
    lp = np.log(np.clip(p, EPS, 1 - EPS) / (1 - np.clip(p, EPS, 1 - EPS)))
    m = LogisticRegression(C=1e6, max_iter=1000).fit(lp.reshape(-1, 1), y)
    return float(m.intercept_[0]), float(m.coef_[0, 0])


def scores(y: np.ndarray, p: np.ndarray) -> dict:
    p = np.clip(p, EPS, 1 - EPS)
    ci, cs = calibration(y, p)
    return {"n": len(y), "goals": int(y.sum()), "xg_sum": float(p.sum()),
            "logloss": log_loss(y, p, labels=[0, 1]), "brier": brier_score_loss(y, p),
            "auc": roc_auc_score(y, p) if 0 < y.sum() < len(y) else np.nan,
            "cal_intercept": ci, "cal_slope": cs}  # fmt: skip


def logo_predict(s: pd.DataFrame, make, features: list[str], label: str = "") -> np.ndarray:
    """Leave-one-group-out predictions (one fit per held-out group, logged)."""
    import logging
    import time

    log = logging.getLogger(__name__)
    out = np.full(len(s), np.nan)
    for k, g in enumerate(s.group.unique(), 1):
        t0 = time.perf_counter()
        test = (s.group == g).to_numpy()
        m = make().fit(s.loc[~test, features], s.goal[~test])
        out[test] = m.predict_proba(s.loc[test, features])[:, 1]
        log.info("xg %s fold %d (%s) %.1f s", label, k, g, time.perf_counter() - t0)
    return out


def fit(shots: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame, str]:
    """Return (shots with xg and xg_oof, evaluation table, calibration bins, chosen model).

    OpenMP is capped at ``THREADS``: with every core busy (other jobs on the machine), the
    gradient-boosting threads spin-wait on each other and a 5-minute fit took over 48."""
    from threadpoolctl import threadpool_limits

    with threadpool_limits(limits=THREADS):
        return _fit(shots)


def _fit(shots: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame, str]:
    s = _prep(shots)
    pen = s.situation == "penalty"
    np_s = s[~pen].reset_index(drop=True)
    feats = NUM + CAT
    oof = {name: logo_predict(np_s, make, feats, name) for name, make in MODELS.items()}
    oof["base_rate"] = np.full(len(np_s), np.nan)
    for g in np_s.group.unique():
        t = (np_s.group == g).to_numpy()
        oof["base_rate"][t] = np_s.goal[~t].mean()
    y = np_s.goal.to_numpy()
    chosen = min(MODELS, key=lambda k: log_loss(y, np.clip(oof[k], EPS, 1 - EPS)))

    rows = []
    sb = (np_s.provider == "statsbomb") & np_s.provider_xg.notna()
    for name, p in oof.items():
        rows.append({"model": name, "group": "all", **scores(y, p)})
        rows.append({"model": name, "group": "statsbomb seasons",
                     **scores(y[sb], p[sb.to_numpy()])})  # fmt: skip
        for g in np_s.group.unique():
            t = (np_s.group == g).to_numpy()
            rows.append({"model": name, "group": g, **scores(y[t], p[t])})
    psb = np_s.provider_xg.to_numpy()
    rows.append({"model": "statsbomb_xg (provider)", "group": "statsbomb seasons",
                 **scores(y[sb], psb[sb.to_numpy()])})  # fmt: skip
    # StatsBomb-only: does the pressure flag help? (LOGO within StatsBomb seasons)
    sbs = np_s[sb].reset_index(drop=True)
    base = logo_predict(sbs, MODELS["gbm"], feats, "gbm sb-only")
    press = logo_predict(sbs, lambda: _gbm_model(["under_pressure"]),
                         feats + ["under_pressure"], "gbm+pressure sb-only")  # fmt: skip
    ysb = sbs.goal.to_numpy()
    rows.append({"model": "gbm, StatsBomb-only fit", "group": "statsbomb seasons",
                 **scores(ysb, base)})  # fmt: skip
    rows.append({"model": "gbm + under_pressure, StatsBomb-only fit",
                 "group": "statsbomb seasons", **scores(ysb, press)})  # fmt: skip
    ev = pd.DataFrame(rows)

    # calibration bins of the chosen model's out-of-fold predictions
    p = oof[chosen]
    bins = pd.qcut(p, 20, duplicates="drop")
    cal = (pd.DataFrame({"pred": p, "obs": y, "bin": bins})
           .groupby("bin", observed=True).agg(mean_pred=("pred", "mean"),
                                              mean_obs=("obs", "mean"), n=("obs", "size"))
           .reset_index(drop=True).assign(model=chosen))  # fmt: skip

    final = MODELS[chosen]().fit(np_s[feats], y)
    np_s["xg"] = final.predict_proba(np_s[feats])[:, 1]
    np_s["xg_oof"] = oof[chosen]
    pens = s[pen].copy()
    pens["xg"] = pens["xg_oof"] = float(pens.goal.mean()) if len(pens) else 0.76
    out = pd.concat([np_s, pens], ignore_index=True).assign(xg_model=chosen)
    out["under_pressure"] = out.under_pressure == "True"
    out["state"] = out.state.astype(int)
    out["women"] = out.women == "True"
    return out, ev, cal, chosen


def build(con, paths) -> dict[str, int]:
    from pitchvision.db import materialize
    from pitchvision.metrics.shots import extract

    out, ev, cal, chosen = fit(extract(con))
    n = {}
    for name, df in (("shots", out), ("xg_eval", ev), ("xg_calibration", cal)):
        con.register("tmp_df", df)
        n[name] = materialize(con, paths, "metrics", name, "select * from tmp_df")
        con.unregister("tmp_df")
    n["chosen"] = chosen
    return n
