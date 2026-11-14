"""Provider coordinates -> the pitchvision frame (spec 2.3): meters on 105 x 68, the team in
possession attacking left to right, origin at the bottom-left corner (the attacker's right
touchline), y increasing toward the attacker's left.

Neither provider's grid scales linearly to real markings (StatsBomb's 120 x 80 puts the box
edge at 102 = 89.25 m by plain scaling, against 88.5 m), so each axis is mapped piecewise
linearly through the pitch's landmarks: goal line, six-yard line, penalty spot, box edge,
halfway line (x); touchlines, box, six-yard box, goalposts, centre (y).

Wyscout quirks handled upstream: goal-kick start positions and shot end positions are
placeholders ((0, 0) / (100, 100)) and are treated as missing, not transformed.
"""

from __future__ import annotations

import numpy as np

LENGTH, WIDTH = 105.0, 68.0

# real landmarks, meters: x from own goal line; y from the top touchline (as both providers)
X_M = [0, 5.5, 11, 16.5, 52.5, 88.5, 94, 99.5, 105]
Y_M = [0, 13.84, 24.84, 30.34, 34, 37.66, 43.16, 54.16, 68]

STATSBOMB_X = [0, 6, 12, 18, 60, 102, 108, 114, 120]
STATSBOMB_Y = [0, 18, 30, 36, 40, 44, 50, 62, 80]
WYSCOUT_X = [0, 6, 10, 16, 50, 84, 90, 94, 100]
WYSCOUT_Y = [0, 19, 37, 45, 50, 55, 63, 81, 100]

_GRIDS = {"statsbomb": (STATSBOMB_X, STATSBOMB_Y), "wyscout": (WYSCOUT_X, WYSCOUT_Y)}


def to_meters(provider: str, x, y) -> tuple[np.ndarray, np.ndarray]:
    """Map provider coordinates (scalars or arrays; NaN passes through) to meters.
    Values outside the provider's frame are clipped to it first."""
    gx, gy = _GRIDS[provider]
    x = np.clip(np.asarray(x, dtype=float), gx[0], gx[-1])
    y = np.clip(np.asarray(y, dtype=float), gy[0], gy[-1])
    xm = np.interp(x, gx, X_M)
    ym = WIDTH - np.interp(y, gy, Y_M)  # providers measure y down from the top touchline
    nan_x, nan_y = np.isnan(x), np.isnan(y)
    return np.where(nan_x, np.nan, xm), np.where(nan_y, np.nan, ym)


def sql_case(provider: str, axis: str, col: str) -> str:
    """The same mapping as a DuckDB SQL expression (piecewise linear), for staging in SQL."""
    gx, gy = _GRIDS[provider]
    src, dst = (gx, X_M) if axis == "x" else (gy, Y_M)
    c = f"least(greatest({col}::double, {src[0]}), {src[-1]})"
    parts = [f"when {c} <= {b1} then {d0} + ({c} - {b0}) * {(d1 - d0) / (b1 - b0)!r}"
             for b0, b1, d0, d1 in zip(src, src[1:], dst, dst[1:], strict=False)]  # fmt: skip
    expr = "case " + " ".join(parts) + f" else {dst[-1]} end"
    return expr if axis == "x" else f"({WIDTH} - ({expr}))"
