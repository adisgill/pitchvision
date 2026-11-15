"""VAEP-style action values (spec 6.3): every on-ball action valued by how it changes the
acting team's chances of scoring and of conceding within the next 10 actions.

* **Actions:** the unified table's ball actions (passes, crosses, set pieces, carries,
  take-ons, shots, duels, defensive and keeper actions, fouls); pressures and other
  off-ball events are left out.
* **Labels:** ``scores`` = the acting team scores within this and the next 9 actions of the
  same period; ``concedes`` = it concedes. Own goals count for the other team.
* **Features** (the action and the two before it, each put in the acting team's frame:
  an opponent's action is mirrored): type, result, body part, start and end location,
  distance and angle to goal, movement, time since the previous action, whether the earlier
  actions were by the same team, goal difference, period, provider and women's league.
* **Models:** two ``HistGradientBoostingClassifier``. Every action gets an **out-of-fold**
  probability from a model trained on other seasons (5 folds over the 18 provider-league-
  seasons), and those out-of-fold probabilities are the production values. Nothing is
  valued by a model that saw its season.
* **Value:** ``offensive = P_s(t) - P_s(t-1)``, ``defensive = -(P_c(t) - P_c(t-1))``,
  ``vaep = offensive + defensive``. If the previous action was the opponent's, its
  probabilities are swapped into the acting team's view. After a goal or at the start of a
  period the previous probabilities are 0 (a kick-off).
"""

from __future__ import annotations

import logging
import time

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import brier_score_loss, log_loss, roc_auc_score
from sklearn.model_selection import GroupKFold

from pitchvision.config import Paths
from pitchvision.db import materialize
from pitchvision.metrics.shots import BALL_TYPES, SHOT_TYPES, geometry

log = logging.getLogger(__name__)
TYPES = BALL_TYPES + ("foul",)
WINDOW = 10
FOLDS = 5
THREADS = 4
LENGTH, WIDTH = 105.0, 68.0
CATS = ["type", "result", "bodypart"]


def load(con) -> pd.DataFrame:
    """Actions with labels and the lagged raw columns (one SQL pass with windows)."""
    types = "(" + ",".join(f"'{t}'" for t in TYPES) + ")"
    shots = "(" + ",".join(f"'{t}'" for t in SHOT_TYPES) + ")"
    lag_cols = ["type", "result", "bodypart", "start_x", "start_y", "end_x", "end_y",
                "team_id", "time_s"]  # fmt: skip
    lags = ",\n".join(f"lag({c}, {k}) over w as {c}_{k}" for k in (1, 2) for c in lag_cols)
    return con.execute(f"""
        with m as (
            select 'wyscout' provider, match_id, competition_id, season, home_team_id
            from stg.wy_matches
            union all
            select 'statsbomb', match_id, competition_id, season, home_team_id
            from stg.sb_matches),
        a as (
            select a.provider, a.match_id, a.event_id, a.seq, a.period, a.time_s, a.team_id,
                   a.player_id, a.type, a.result, a.bodypart,
                   coalesce(a.start_x, case when a.type = 'goalkick' then 5.5 end) start_x,
                   coalesce(a.start_y, case when a.type = 'goalkick' then 34.0 end) start_y,
                   coalesce(a.end_x, case when a.type in {shots} then 105.0 end, a.start_x,
                            case when a.type = 'goalkick' then 5.5 end) end_x,
                   coalesce(a.end_y, case when a.type in {shots} then 34.0 end, a.start_y,
                            case when a.type = 'goalkick' then 34.0 end) end_y,
                   m.competition_id, m.season, m.home_team_id,
                   m.competition_id not in ('GB1', 'ES1', 'IT1', 'FR1', 'L1') women,
                   (a.type in {shots} and a.result = 'success') goal,
                   a.result = 'owngoal' own_goal
            from stg.actions a join m using (provider, match_id)
            where a.type in {types} or a.result = 'owngoal'),
        f as (
            select *,
                   ((goal and team_id = home_team_id)
                    or (own_goal and team_id <> home_team_id))::int gh,
                   ((goal and team_id <> home_team_id)
                    or (own_goal and team_id = home_team_id))::int ga
            from a where start_x is not null),
        w as (
            select *,
                   max(gh) over fw fut_h, max(ga) over fw fut_a,
                   coalesce(sum(gh - ga) over cum, 0) gd_home,
                   {lags}
            from f
            window w as (partition by provider, match_id order by seq),
                   fw as (partition by provider, match_id, period order by seq
                          rows between current row and {WINDOW - 1} following),
                   cum as (partition by provider, match_id order by seq
                           rows between unbounded preceding and 1 preceding))
        select *,
               case when team_id = home_team_id then fut_h else fut_a end scores,
               case when team_id = home_team_id then fut_a else fut_h end concedes,
               case when team_id = home_team_id then gd_home else -gd_home end goal_diff
        from w
        order by provider, match_id, seq""").df()  # fmt: skip


def features(a: pd.DataFrame) -> pd.DataFrame:
    """Numeric feature matrix (float32) in the acting team's frame."""
    out = {}
    for k in ("", "_1", "_2"):
        sx, sy = a[f"start_x{k}"].to_numpy(float), a[f"start_y{k}"].to_numpy(float)
        ex, ey = a[f"end_x{k}"].to_numpy(float), a[f"end_y{k}"].to_numpy(float)
        if k:  # mirror an opponent's action into the acting team's frame
            same = (a[f"team_id{k}"] == a.team_id).fillna(False).to_numpy(dtype=bool)
            sx, ex = np.where(same, sx, LENGTH - sx), np.where(same, ex, LENGTH - ex)
            sy, ey = np.where(same, sy, WIDTH - sy), np.where(same, ey, WIDTH - ey)
            out[f"same_team{k}"] = same.astype(float)
            out[f"dt{k}"] = (a.time_s - a[f"time_s{k}"]).astype(float).to_numpy()
        sd, sa = geometry(sx, sy)
        ed, ea = geometry(ex, ey)
        out.update({f"sx{k}": sx, f"sy{k}": sy, f"ex{k}": ex, f"ey{k}": ey,
                    f"sdist{k}": sd, f"sang{k}": sa, f"edist{k}": ed, f"eang{k}": ea,
                    f"dx{k}": ex - sx, f"dy{k}": ey - sy,
                    f"len{k}": np.hypot(ex - sx, ey - sy)})  # fmt: skip
        for c in CATS:
            out[f"{c}{k}"] = a[f"{c}{k}"].astype("category").cat.codes.to_numpy(float)
            out[f"{c}{k}"][a[f"{c}{k}"].isna().to_numpy()] = -1
    out["goal_diff"] = a.goal_diff.clip(-3, 3).to_numpy(float)
    out["period"] = a.period.to_numpy(float)
    out["provider"] = (a.provider == "statsbomb").to_numpy(float)
    out["women"] = a.women.to_numpy(float)
    return pd.DataFrame(out).astype("float32")


def _model(cat_idx: list[int]) -> HistGradientBoostingClassifier:
    return HistGradientBoostingClassifier(
        learning_rate=0.1,
        max_iter=200,
        max_leaf_nodes=63,
        min_samples_leaf=200,
        l2_regularization=1.0,
        categorical_features=cat_idx,
        random_state=0,
    )


def fit_oof(x: pd.DataFrame, y: np.ndarray, groups: np.ndarray, label: str) -> np.ndarray:
    # categorical codes must be non-negative for the native categorical support
    cat_cols = [c for c in x.columns if c.split("_")[0] in CATS or c.rstrip("_12") in CATS]
    xx = x.copy()
    for c in cat_cols:
        xx[c] = xx[c] + 1
    cat_idx = [xx.columns.get_loc(c) for c in cat_cols]
    out = np.full(len(x), np.nan)
    for k, (tr, te) in enumerate(GroupKFold(n_splits=FOLDS).split(xx, y, groups), 1):
        t0 = time.perf_counter()
        m = _model(cat_idx).fit(xx.iloc[tr], y[tr])
        out[te] = m.predict_proba(xx.iloc[te])[:, 1]
        log.info("vaep %s fold %d/%d: %.0f s", label, k, FOLDS, time.perf_counter() - t0)
    return out


def values(a: pd.DataFrame, ps: np.ndarray, pc: np.ndarray) -> pd.DataFrame:
    """VAEP values from per-action probabilities (``a`` ordered by match and seq)."""
    same_match = (a.match_id == a.match_id.shift()) & (a.provider == a.provider.shift())
    same_period = same_match & (a.period == a.period.shift())
    same_team = (a.team_id == a.team_id.shift()).to_numpy()
    prev_ps, prev_pc = np.roll(ps, 1), np.roll(pc, 1)
    prev_s = np.where(same_team, prev_ps, prev_pc)
    prev_c = np.where(same_team, prev_pc, prev_ps)
    prev_goal = (a.goal.shift(fill_value=False) | a.own_goal.shift(fill_value=False)).to_numpy()
    reset = (~same_period.to_numpy()) | prev_goal
    prev_s, prev_c = np.where(reset, 0.0, prev_s), np.where(reset, 0.0, prev_c)
    off, dfn = ps - prev_s, -(pc - prev_c)
    return pd.DataFrame({"p_score": ps, "p_concede": pc, "offensive": off,
                         "defensive": dfn, "vaep": off + dfn})  # fmt: skip


def _scores(y: np.ndarray, p: np.ndarray) -> dict:
    p = np.clip(p, 1e-6, 1 - 1e-6)
    base = np.full(len(y), y.mean())
    return {"n": len(y), "positives": int(y.sum()), "logloss": log_loss(y, p),
            "logloss_base": log_loss(y, base), "brier": brier_score_loss(y, p),
            "auc": roc_auc_score(y, p), "pred_sum": float(p.sum())}  # fmt: skip


def build(con, paths: Paths) -> dict[str, int]:
    from threadpoolctl import threadpool_limits

    a = load(con)
    x = features(a)
    groups = (a.provider + " " + a.competition_id + " " + a.season.astype(str)).to_numpy()
    with threadpool_limits(limits=THREADS):
        ps = fit_oof(x, a.scores.to_numpy(), groups, "scores")
        pc = fit_oof(x, a.concedes.to_numpy(), groups, "concedes")
    del x
    v = values(a, ps, pc)
    out = pd.concat([a[["provider", "match_id", "event_id", "seq", "period", "time_s",
                        "team_id", "player_id", "type", "result", "competition_id", "season",
                        "women"]].reset_index(drop=True), v], axis=1)  # fmt: skip
    ev = []
    labels = (("scores", a.scores.to_numpy(), ps), ("concedes", a.concedes.to_numpy(), pc))
    for label, y, p in labels:
        ev.append({"label": label, "group": "all", **_scores(y, p)})
        for g in np.unique(groups):
            t = groups == g
            ev.append({"label": label, "group": g, **_scores(y[t], p[t])})
    n = {}
    for name, df in (("vaep_actions", out), ("vaep_eval", pd.DataFrame(ev))):
        con.register("tmp_df", df)
        n[name] = materialize(con, paths, "metrics", name, "select * from tmp_df")
        con.unregister("tmp_df")
    return n
