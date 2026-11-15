"""Expected threat (spec 6.2): a 16 x 12 grid Markov model of where possession leads.

Per cell, from open-play moves (passes, crosses and carries, successful or not) and
open-play shots:

* ``P(shoot) = shots / (shots + moves)``, ``P(move) = 1 - P(shoot)``;
* ``G`` = mean xG of the cell's shots (our model, ``metrics.shots``);
* ``T[i, j]`` = successful moves from i ending in j, over all moves from i (a failed move
  ends the chain, so rows sum to the cell's success rate).

``xT = P(shoot) * G + P(move) * T @ xT``, iterated to convergence. Set-piece restarts
(corners, free kicks, throw-ins, goal kicks) are not moves; take-ons have no end location
and are left out. Surfaces are fitted pooled and per subset (StatsBomb men, Wyscout men,
StatsBomb women); actions are credited with the pooled surface.

``xT added`` = xT(end cell) - xT(start cell) for successful moves; 0 for failed ones (the
action-value model, not xT, prices turnovers).
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from pitchvision.config import Paths
from pitchvision.db import materialize

NX, NY = 16, 12
LENGTH, WIDTH = 105.0, 68.0
MOVES = ("pass", "cross", "dribble")
SUBSETS = {  # name -> row filter
    "pooled": lambda d: np.ones(len(d), bool),
    "statsbomb men": lambda d: (d.provider == "statsbomb") & ~d.women,
    "wyscout men": lambda d: d.provider == "wyscout",
    "statsbomb women": lambda d: (d.provider == "statsbomb") & d.women,
}


def cell(x, y) -> np.ndarray:
    """Flat cell index (row-major over x then y) of meter coordinates."""
    cx = np.clip((np.asarray(x, dtype=float) / LENGTH * NX).astype(int), 0, NX - 1)
    cy = np.clip((np.asarray(y, dtype=float) / WIDTH * NY).astype(int), 0, NY - 1)
    return cx * NY + cy


def solve(shots: np.ndarray, goal: np.ndarray, moves: np.ndarray, trans: np.ndarray,
          tol: float = 1e-6, max_iter: int = 500) -> tuple[np.ndarray, int]:  # fmt: skip
    """Value iteration. ``shots``, ``moves``: counts per cell; ``goal``: mean xG per cell;
    ``trans``: successful-move counts [from, to]. Returns (xT per cell, iterations)."""
    total = shots + moves
    with np.errstate(divide="ignore", invalid="ignore"):
        ps = np.where(total > 0, shots / total, 0.0)
        pm = np.where(total > 0, moves / total, 0.0)
        t = np.where(moves[:, None] > 0, trans / moves[:, None], 0.0)
    xt = np.zeros_like(ps)
    for it in range(1, max_iter + 1):
        new = ps * goal + pm * (t @ xt)
        if np.max(np.abs(new - xt)) < tol:
            return new, it
        xt = new
    return xt, max_iter


def fit_surface(moves: pd.DataFrame, shots: pd.DataFrame) -> tuple[np.ndarray, int]:
    n = NX * NY
    s_cell = cell(shots.start_x, shots.start_y)
    shot_n = np.bincount(s_cell, minlength=n).astype(float)
    xg_sum = np.bincount(s_cell, weights=shots.xg.to_numpy(), minlength=n)
    goal = np.divide(xg_sum, shot_n, out=np.zeros(n), where=shot_n > 0)
    m_from = cell(moves.start_x, moves.start_y)
    move_n = np.bincount(m_from, minlength=n).astype(float)
    ok = (moves.result == "success").to_numpy()
    m_to = cell(moves.end_x, moves.end_y)
    trans = np.zeros((n, n))
    np.add.at(trans, (m_from[ok], m_to[ok]), 1.0)
    return solve(shot_n, goal, move_n, trans)


def _load(con) -> tuple[pd.DataFrame, pd.DataFrame]:
    moves = con.execute(f"""
        with m as (select 'wyscout' provider, match_id, competition_id, season
                   from stg.wy_matches
                   union all
                   select 'statsbomb', match_id, competition_id, season from stg.sb_matches)
        select a.provider, a.match_id, a.event_id, a.team_id, a.player_id, a.type,
               a.result, a.start_x, a.start_y, a.end_x, a.end_y, m.competition_id,
               m.season,
               m.competition_id not in ('GB1', 'ES1', 'IT1', 'FR1', 'L1') as women
        from stg.actions a join m using (provider, match_id)
        where a.type in {MOVES} and a.start_x is not null and a.end_x is not null
        """).df()  # fmt: skip
    shots = con.execute("""
        select provider, women, start_x, start_y, xg from metrics.shots
        where type = 'shot' and situation not in ('penalty', 'direct_free_kick')
        """).df()  # fmt: skip
    return moves, shots


def build(con, paths: Paths) -> dict[str, int]:
    moves, shots = _load(con)
    surfaces, info = {}, []
    for name, cond in SUBSETS.items():
        m, s = moves[cond(moves)], shots[cond(shots)]
        xt, iters = fit_surface(m, s)
        surfaces[name] = xt
        info.append({"subset": name, "moves": len(m), "shots": len(s), "iterations": iters,
                     "max_xt": float(xt.max())})  # fmt: skip
    pooled = surfaces["pooled"]
    for r in info:
        r["corr_with_pooled"] = float(np.corrcoef(surfaces[r["subset"]], pooled)[0, 1])
    grid = pd.DataFrame([{"subset": k, "cell": i, "cx": i // NY, "cy": i % NY,
                          "x_mid": (i // NY + 0.5) * LENGTH / NX,
                          "y_mid": (i % NY + 0.5) * WIDTH / NY, "xt": float(v)}
                         for k, xt in surfaces.items() for i, v in enumerate(xt)])  # fmt: skip
    a = moves.copy()
    a["xt_start"] = pooled[cell(a.start_x, a.start_y)]
    a["xt_end"] = pooled[cell(a.end_x, a.end_y)]
    a["xt_added"] = np.where(a.result == "success", a.xt_end - a.xt_start, 0.0)
    a = a.drop(columns=["start_x", "start_y", "end_x", "end_y"])
    n = {}
    for name, df in (("xt_grid", grid), ("xt_fit", pd.DataFrame(info)), ("xt_actions", a)):
        con.register("tmp_df", df)
        n[name] = materialize(con, paths, "metrics", name, "select * from tmp_df")
        con.unregister("tmp_df")
    return n
