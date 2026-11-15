"""Win probability by game state (spec 6.6), from every minute of every domestic match.

* **Rates:** each team's chance of scoring in a minute = its pre-match expected goals / 90
  (the walk-forward's chosen model, made before the match) x multipliers for the current
  goal difference (from its own view, -2..+2), red-card difference (-1 / 0 / +1, capped)
  and the phase of the match (15-minute buckets). A Poisson model with that offset, fitted
  by maximum likelihood on the minutes of 2017-18 to 2020-21.
* **Probabilities:** exact, by backward recursion over the remaining minutes on the goal
  difference (at most one goal per team per minute; red cards held at their current
  count). Transfermarkt collapses added time into minutes 45 and 90, so the clock has 90
  steps.
* **Checks:** calibration and log loss by 15-minute bucket on 2021-22 onward, against the
  pre-match probabilities alone.
* **Red cards (H11):** the change in expected points from a red card at each minute, at
  level score with average rates.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from scipy.optimize import minimize

from pitchvision.config import Paths
from pitchvision.db import materialize
from pitchvision.models.team import outcome_probs

DOMESTIC = ("GB1", "ES1", "L1", "IT1", "FR1", "NL1", "PO1", "GB2")
FIT_SEASONS = (2017, 2020)
GD_LEVELS = (-2, -1, 1, 2)  # 0 is the base
PHASES = 6  # 15-minute buckets
GDMAX = 10


def load(con) -> tuple[pd.DataFrame, pd.DataFrame]:
    lg = "(" + ",".join(f"'{c}'" for c in DOMESTIC) + ")"
    w = con.execute("select half_life, w_goals from forecast.wf_chosen").fetchall()[0]
    hl = int(w[0])
    # pre-match rates: the walk-forward's stored Dixon-Coles rates, blended as chosen
    cols = con.execute("describe forecast.wf_predictions").df().column_name.tolist()
    if f"lh_g_{hl}" not in cols:
        raise RuntimeError("walk-forward rates missing: rerun forecast.walkforward")
    m = con.execute(f"""
        select match_id, competition_id, season, home_goals, away_goals,
               lh_g_{hl} lhg, la_g_{hl} lag_, lh_x_{hl} lhx, la_x_{hl} lax, rho_{hl} rho
        from forecast.wf_predictions where competition_id in {lg}""").df()  # fmt: skip
    wg = float(w[1])
    m["lh"] = np.exp(wg * np.log(m.lhg) + (1 - wg) * np.log(m.lhx.fillna(m.lhg)))
    m["la"] = np.exp(wg * np.log(m.lag_) + (1 - wg) * np.log(m.lax.fillna(m.lag_)))
    m = m[m.match_id.str.startswith("tm-")].dropna(subset=["lh", "la"]).reset_index(drop=True)
    pre = np.zeros((len(m), 3))
    for r in np.unique(m.rho.fillna(0)):
        sel = (m.rho.fillna(0) == r).to_numpy()
        pre[sel] = outcome_probs(m.lh[sel].to_numpy(), m.la[sel].to_numpy(), r)
    m["ph"], m["pd_"], m["pa"] = pre[:, 0], pre[:, 1], pre[:, 2]
    ev = con.execute("""
        select 'tm-' || e.game_id match_id, e.minute, e.type, e.card, e.club_id,
               g.home_club_id
        from stg.tm_events e join stg.tm_games g using (game_id)
        where (e.type = 'goals' or e.card in ('red', 'second_yellow'))
          and e.minute between 1 and 90""").df()  # fmt: skip
    ev = ev[ev.match_id.isin(set(m.match_id))]
    return m, ev


def minute_states(m: pd.DataFrame, ev: pd.DataFrame) -> pd.DataFrame:
    """One row per match-minute (0..89): state at the minute's start, goals in it."""
    n = len(m)
    mid = {k: i for i, k in enumerate(m.match_id)}
    gh, ga = np.zeros((n, 90)), np.zeros((n, 90))
    rh, ra = np.zeros((n, 90)), np.zeros((n, 90))
    for r in ev.itertuples(index=False):
        i, t = mid[r.match_id], min(int(r.minute), 90) - 1
        home = r.club_id == r.home_club_id
        if r.type == "goals":
            (gh if home else ga)[i, t] += 1
        else:  # the sent-off player's team is the card's club
            (rh if home else ra)[i, t] += 1
    cs_h = np.cumsum(gh, axis=1) - gh  # goals before the minute
    cs_a = np.cumsum(ga, axis=1) - ga
    red_h = np.cumsum(rh, axis=1) - rh
    red_a = np.cumsum(ra, axis=1) - ra
    t = np.tile(np.arange(90), n)
    return pd.DataFrame({
        "match_id": np.repeat(m.match_id.to_numpy(), 90), "minute": t,
        "season": np.repeat(m.season.to_numpy(), 90),
        "lh": np.repeat(m.lh.to_numpy(), 90), "la": np.repeat(m.la.to_numpy(), 90),
        "gd": (cs_h - cs_a).ravel(), "red_d": (red_a - red_h).clip(-1, 1).ravel(),
        "y_h": gh.ravel(), "y_a": ga.ravel(),
    })  # fmt: skip


def _design(gd: np.ndarray, red_d: np.ndarray, minute: np.ndarray) -> np.ndarray:
    """Features for a team's scoring rate: its goal difference levels, its red-card
    advantage, the phase."""
    g = np.clip(gd, -2, 2)
    cols = [(g == lv).astype(float) for lv in GD_LEVELS]
    cols += [(red_d == 1).astype(float), (red_d == -1).astype(float)]
    ph = np.minimum(minute // 15, PHASES - 1)
    cols += [(ph == k).astype(float) for k in range(1, PHASES)]
    return np.column_stack(cols)


def fit(st: pd.DataFrame) -> np.ndarray:
    tr = st[st.season.between(*FIT_SEASONS)]
    # stack home and away rows: each from its own view
    x = np.vstack(
        [
            _design(tr.gd.to_numpy(), tr.red_d.to_numpy(), tr.minute.to_numpy()),
            _design(-tr.gd.to_numpy(), -tr.red_d.to_numpy(), tr.minute.to_numpy()),
        ]
    )
    off = np.log(np.concatenate([tr.lh.to_numpy(), tr.la.to_numpy()]) / 90)
    y = np.concatenate([tr.y_h.to_numpy(), tr.y_a.to_numpy()])

    def nll(b):
        eta = off + x @ b
        mu = np.exp(eta)
        return -(y * eta - mu).sum(), -(x.T @ (y - mu))

    return minimize(nll, np.zeros(x.shape[1]), jac=True, method="L-BFGS-B").x


def multipliers(beta: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """State multipliers on each side's per-minute rate, indexed [red_d + 1, minute, gd]
    (home view): they depend only on the state, so they're computed once."""
    gds = np.arange(-GDMAX, GDMAX + 1)
    mh, ma = np.zeros((3, 90, len(gds))), np.zeros((3, 90, len(gds)))
    for r in (-1, 0, 1):
        for t in range(90):
            rr, tt = np.full_like(gds, r), np.full_like(gds, t)
            mh[r + 1, t] = np.exp(_design(gds, rr, tt) @ beta)
            ma[r + 1, t] = np.exp(_design(-gds, -rr, tt) @ beta)
    return mh, ma


def outcome_table(lh: float, la: float, mult: tuple[np.ndarray, np.ndarray],
                  red_d: int) -> np.ndarray:  # fmt: skip
    """V[t, gd + GDMAX] = P(home win, draw, away win) from the start of minute t at goal
    difference gd (home view), red cards fixed at ``red_d``."""
    gds = np.arange(-GDMAX, GDMAX + 1)
    v = np.zeros((91, len(gds), 3))
    v[90, gds > 0, 0], v[90, gds == 0, 1], v[90, gds < 0, 2] = 1, 1, 1
    ph1 = 1 - np.exp(-lh / 90 * mult[0][red_d + 1])  # [minute, gd]
    pa1 = 1 - np.exp(-la / 90 * mult[1][red_d + 1])
    for t in range(89, -1, -1):
        up = np.vstack([v[t + 1, 1:], v[t + 1, -1:]])  # gd + 1 (capped)
        dn = np.vstack([v[t + 1, :1], v[t + 1, :-1]])  # gd - 1 (capped)
        h, a = ph1[t], pa1[t]
        v[t] = ((h * (1 - a))[:, None] * up + ((1 - h) * a)[:, None] * dn
                + ((1 - h) * (1 - a) + h * a)[:, None] * v[t + 1])  # fmt: skip
    return v


def timelines(m: pd.DataFrame, st: pd.DataFrame, beta: np.ndarray) -> pd.DataFrame:
    mult = multipliers(beta)
    out = np.zeros((len(st), 3))
    pos = 0
    by = {k: g for k, g in st.groupby("match_id", sort=False)}
    for r in m.itertuples(index=False):
        g = by[r.match_id]
        rd = g.red_d.to_numpy().astype(int)
        tabs = {d: outcome_table(r.lh, r.la, mult, d) for d in np.unique(rd)}
        gd = np.clip(g.gd.to_numpy(), -GDMAX, GDMAX).astype(int) + GDMAX
        t = g.minute.to_numpy()
        p = np.empty((len(g), 3))
        for d, tab in tabs.items():
            sel = rd == d
            p[sel] = tab[t[sel], gd[sel]]
        out[pos : pos + len(g)] = p
        pos += len(g)
    return st.assign(p_home=out[:, 0], p_draw=out[:, 1], p_away=out[:, 2])


def evaluate(tl: pd.DataFrame, m: pd.DataFrame) -> pd.DataFrame:
    final = m.set_index("match_id")
    res = np.where(final.home_goals > final.away_goals, 0,
                   np.where(final.home_goals == final.away_goals, 1, 2))  # fmt: skip
    y = pd.Series(res, index=final.index)
    t = tl[~tl.season.between(*FIT_SEASONS)].copy()
    t["y"] = t.match_id.map(y)
    pre = final[["ph", "pd_", "pa"]]
    t[["q_h", "q_d", "q_a"]] = pre.loc[t.match_id].to_numpy()
    rows = []
    for b, g in t.groupby(t.minute // 15):
        p = np.clip(g[["p_home", "p_draw", "p_away"]].to_numpy(), 1e-9, 1)
        q = np.clip(g[["q_h", "q_d", "q_a"]].to_numpy(), 1e-9, 1)
        yy = g.y.to_numpy()
        rows.append({"minutes": f"{b * 15}-{b * 15 + 14}", "n": len(g),
                     "logloss_state": float(-np.log(p[np.arange(len(g)), yy]).mean()),
                     "logloss_prematch": float(-np.log(q[np.arange(len(g)), yy]).mean()),
                     "mean_p_home": float(g.p_home.mean()),
                     "home_win_rate": float((yy == 0).mean())})  # fmt: skip
    return pd.DataFrame(rows)


def calibration(tl: pd.DataFrame, m: pd.DataFrame) -> pd.DataFrame:
    final = m.set_index("match_id")
    hw = (final.home_goals > final.away_goals).astype(float)
    t = tl[~tl.season.between(*FIT_SEASONS)]
    t = t.assign(
        y=t.match_id.map(hw),
        bucket=t.minute // 15,
        pbin=pd.cut(t.p_home, np.linspace(0, 1, 11), include_lowest=True),
    )
    return (t.groupby(["bucket", "pbin"], observed=True)
             .agg(n=("y", "size"), mean_p=("p_home", "mean"), freq=("y", "mean"))
             .reset_index().assign(pbin=lambda d: d.pbin.astype(str)))  # fmt: skip


def red_card_value(beta: np.ndarray, lh: float = 1.5, la: float = 1.2) -> pd.DataFrame:
    rows = []
    mult = multipliers(beta)
    base_t, red_t = outcome_table(lh, la, mult, 0), outcome_table(lh, la, mult, -1)
    for t in range(0, 90, 5):
        base = base_t[t, GDMAX]
        red = red_t[t, GDMAX]  # home side down to ten
        pts = lambda p: 3 * p[0] + p[1]  # noqa: E731
        rows.append({"minute": t, "home_xpts_11v11": pts(base), "home_xpts_10v11": pts(red),
                     "cost_xpts": pts(base) - pts(red)})  # fmt: skip
    return pd.DataFrame(rows)


def build(con, paths: Paths) -> dict[str, int]:
    m, ev = load(con)
    st = minute_states(m, ev)
    beta = fit(st)
    names = ([f"gd_{g}" for g in GD_LEVELS] + ["red_advantage", "red_disadvantage"]
             + [f"phase_{k}" for k in range(1, PHASES)])  # fmt: skip
    params = pd.DataFrame({"term": names, "coef": beta, "multiplier": np.exp(beta)})
    tl = timelines(m, st, beta)
    tables = {"wp_params": params, "wp_eval": evaluate(tl, m),
              "wp_calibration": calibration(tl, m), "wp_red_card": red_card_value(beta),
              "wp_timelines": tl[["match_id", "minute", "gd", "red_d", "p_home", "p_draw",
                                  "p_away"]]}  # fmt: skip
    n = {}
    for name, df in tables.items():
        con.register("tmp_df", df)
        n[name] = materialize(con, paths, "forecast", name, "select * from tmp_df")
        con.unregister("tmp_df")
    return n
