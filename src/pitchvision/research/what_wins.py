"""What wins football matches, and what is skill rather than luck (spec 12.5).

On every FotMob-covered league match (2024-25 onward, nine leagues), from each team's view:

* **Drivers:** for every team stat, the difference between the two teams in the match
  (team minus opponent) against the points the team took, *beyond* what the closing line
  expected before kickoff (3 x win + draw probability). Reported as the change in points per
  SD of the stat difference, with robust intervals, alone and jointly (all stats together,
  so shared signal isn't double counted). This is descriptive: it says what the winning
  side did, not what to do.
* **Skill vs luck:** for every stat, (a) its split-half reliability inside a team-season
  (odd vs even matches: how much is a stable team trait) and (b) its predictive value: the
  correlation of a team's first-half-of-season average with its points per game in the
  second half. Goals, points and xG are included as reference stats.
* **Curves:** binned results-beyond-expectation for possession, distance covered, sprints,
  long-ball share and crossing.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from pitchvision.config import Paths
from pitchvision.db import materialize

# FotMob team stat key -> (label, group)
STATS = {
    "expected_goals": ("Expected goals (xG)", "Chance quality"),
    "expected_goals_open_play": ("Open-play xG", "Chance quality"),
    "expected_goals_set_play": ("Set-piece xG", "Set pieces"),
    "expected_goals_on_target": ("xG on target (xGOT)", "Chance quality"),
    "big_chance": ("Big chances", "Chance quality"),
    "total_shots": ("Shots", "Volume"),
    "shotsontarget": ("Shots on target", "Volume"),
    "shots_inside_box": ("Shots inside the box", "Volume"),
    "shots_outside_box": ("Shots outside the box", "Volume"),
    "touches_opp_box": ("Touches in the opposition box", "Territory"),
    "ballpossesion": ("Possession %", "Control"),
    "passes": ("Passes", "Control"),
    "accurate_passes": ("Accurate passes", "Control"),
    "opposition_half_passes": ("Passes in the opposition half", "Territory"),
    "long_balls_accurate": ("Accurate long balls", "Directness"),
    "accurate_crosses": ("Accurate crosses", "Directness"),
    "corners": ("Corners", "Set pieces"),
    "dribbles_succeeded": ("Successful dribbles", "Individual"),
    "duel_won": ("Duels won", "Duels"),
    "aerials_won": ("Aerial duels won", "Duels"),
    "matchstats_headers_tackles": ("Tackles", "Defending"),
    "interceptions": ("Interceptions", "Defending"),
    "clearances": ("Clearances", "Defending"),
    "shot_blocks": ("Blocked shots", "Defending"),
    "keeper_saves": ("Goalkeeper saves", "Defending"),
    "fouls": ("Fouls committed", "Discipline"),
    "yellow_cards": ("Yellow cards", "Discipline"),
    "offsides": ("Offsides", "Discipline"),
    "physical_metrics_distance_covered": ("Distance covered", "Physical"),
    "physical_metrics_number_of_sprints": ("Sprints", "Physical"),
    "physical_metrics_sprinting": ("Sprint distance", "Physical"),
    "physical_metrics_running": ("High-speed running", "Physical"),
}  # fmt: skip
CURVES = ["ballpossesion", "physical_metrics_distance_covered",
          "physical_metrics_number_of_sprints", "long_balls_accurate",
          "accurate_crosses"]  # fmt: skip


def team_match(con) -> pd.DataFrame:
    """One row per team per match: own and opponent value of every stat, points, goals,
    and the closing line's expected points."""
    keys = ", ".join(f"'{k}'" for k in STATS)
    t = con.execute(f"""
        select x.match_id, s.key, s.home, s.away
        from stg.fm_team_stats s join core.fm_matches_xw x using (fm_match_id)
        where x.match_id is not null and s.key in ({keys})""").df()
    wide_h = t.pivot_table(index="match_id", columns="key", values="home", aggfunc="max")
    wide_a = t.pivot_table(index="match_id", columns="key", values="away", aggfunc="max")
    m = con.execute("""
        select t.match_id, t.competition_id, t.season, t.match_date, t.home_club, t.away_club,
               t.home_goals, t.away_goals, p.mkt_h, p.mkt_d, p.mkt_a
        from core.team_matches t join forecast.wf_predictions p using (match_id)
        where t.played and p.mkt_h is not null""").df()
    m = m[m.match_id.isin(wide_h.index)]
    rows = []
    for side in ("home", "away"):
        own, opp = (wide_h, wide_a) if side == "home" else (wide_a, wide_h)
        d = pd.DataFrame({
            "match_id": m.match_id.to_numpy(), "competition_id": m.competition_id.to_numpy(),
            "season": m.season.to_numpy(), "match_date": m.match_date.to_numpy(), "side": side,
            "club_id": (m.home_club if side == "home" else m.away_club).to_numpy(),
            "gf": (m.home_goals if side == "home" else m.away_goals).to_numpy(),
            "ga": (m.away_goals if side == "home" else m.home_goals).to_numpy(),
            "xpts": (3 * (m.mkt_h if side == "home" else m.mkt_a) + m.mkt_d).to_numpy(),
        })  # fmt: skip
        for k in STATS:
            if k in own.columns:
                d[f"{k}"] = m.match_id.map(own[k]).to_numpy()
                d[f"{k}_opp"] = m.match_id.map(opp[k]).to_numpy()
        rows.append(d)
    d = pd.concat(rows, ignore_index=True)
    d["pts"] = np.select([d.gf > d.ga, d.gf == d.ga], [3, 1], 0)
    d["res"] = d.pts - d.xpts
    return d


def _ols(y, X):
    xtx = np.linalg.pinv(X.T @ X)
    b = xtx @ X.T @ y
    e = y - X @ b
    v = xtx @ ((X * (e**2)[:, None]).T @ X) @ xtx * len(y) / max(len(y) - X.shape[1], 1)
    return b, np.sqrt(np.diag(v))


def drivers(d: pd.DataFrame) -> pd.DataFrame:
    """Points beyond the closing line vs each stat's team-minus-opponent difference."""
    rows = []
    diffs = {}
    for k, (label, group) in STATS.items():
        if k not in d.columns:
            continue
        x = d[k] - d[f"{k}_opp"] if k != "ballpossesion" else d[k] - 50
        ok = x.notna() & d.res.notna()
        if ok.sum() < 500 or x[ok].std() == 0:
            continue
        sd = float(x[ok].std())
        z = (x[ok] / sd).to_numpy()
        b, se = _ols(d.res[ok].to_numpy(), np.column_stack([np.ones(ok.sum()), z]))
        r = float(np.corrcoef(x[ok], d.res[ok])[0, 1])
        r_gd = float(np.corrcoef(x[ok], (d.gf - d.ga)[ok])[0, 1])
        diffs[k] = x / sd
        rows.append({"stat": k, "label": label, "group": group, "n": int(ok.sum()), "sd": sd,
                     "effect": b[1], "effect_se": se[1], "r_res": r, "r_gd": r_gd})  # fmt: skip
    out = pd.DataFrame(rows)
    # a joint model on a small, non-collinear set (the shot stats overlap too much to
    # separate): chance quality, control, set pieces, duels, discipline
    keys = [k for k in ("expected_goals", "ballpossesion", "expected_goals_set_play",
                        "duel_won", "fouls") if k in diffs]  # fmt: skip
    X = pd.DataFrame({k: diffs[k] for k in keys})
    ok = X.notna().all(axis=1) & d.res.notna()
    b, se = _ols(d.res[ok].to_numpy(), np.column_stack([np.ones(ok.sum()), X[ok].to_numpy()]))
    out["joint_effect"] = out.stat.map(dict(zip(keys, b[1:], strict=True)))
    out["joint_se"] = out.stat.map(dict(zip(keys, se[1:], strict=True)))
    return out


def stability(d: pd.DataFrame) -> pd.DataFrame:
    """Split-half reliability and first-half -> second-half predictive power, per stat."""
    d = d.sort_values("match_date").copy()
    d["k"] = d.groupby(["club_id", "competition_id", "season"]).cumcount()
    d["n_ts"] = d.groupby(["club_id", "competition_id", "season"]).match_id.transform("count")
    full = d[d.n_ts >= 20]
    cols = {k: (lambda g, k=k: g[k] - g[f"{k}_opp"] if k != "ballpossesion" else g[k])
            for k in STATS if k in d.columns}  # fmt: skip
    cols.update({"goal_diff": lambda g: g.gf - g.ga, "points": lambda g: g.pts,
                 "xg_diff": lambda g: g["expected_goals"] - g["expected_goals_opp"]})  # fmt: skip
    rows = []
    for name, f in cols.items():
        v = full.assign(v=f(full))
        if v.v.notna().sum() < 1000:
            continue
        g = v.groupby(["club_id", "competition_id", "season"])
        odd = g.apply(lambda t: t.v[t.k % 2 == 1].mean(), include_groups=False)
        even = g.apply(lambda t: t.v[t.k % 2 == 0].mean(), include_groups=False)
        half = g.apply(lambda t: t.v[t.k < t.n_ts / 2].mean(), include_groups=False)
        later_ppg = g.apply(lambda t: t.pts[t.k >= t.n_ts / 2].mean(), include_groups=False)
        ok = odd.notna() & even.notna()
        r_half = float(np.corrcoef(odd[ok], even[ok])[0, 1])
        ok2 = half.notna() & later_ppg.notna()
        r_pred = float(np.corrcoef(half[ok2], later_ppg[ok2])[0, 1])
        ref = {"goal_diff": "Goal difference", "points": "Points", "xg_diff": "xG difference"}
        label = STATS[name][0] if name in STATS else ref[name]
        rows.append({"stat": name, "label": label,
                     "group": STATS.get(name, ("", "Results"))[1],
                     "team_seasons": int(ok.sum()),
                     "split_half_r": r_half,
                     "reliability": 2 * r_half / (1 + r_half) if r_half > -1 else None,
                     "predict_r": r_pred})  # fmt: skip
    return pd.DataFrame(rows)


def curves(d: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for k in CURVES:
        if k not in d.columns:
            continue
        x = d[k] if k == "ballpossesion" else d[k] - d[f"{k}_opp"]
        ok = x.notna() & d.res.notna()
        bins = pd.qcut(x[ok], 10, duplicates="drop")
        for iv, g in d[ok].groupby(bins, observed=True):
            xs = x[g.index]
            rows.append({"stat": k, "label": STATS[k][0], "x": float(xs.mean()), "n": len(g),
                         "res": float(g.res.mean()), "res_se": float(g.res.std() / np.sqrt(len(g))),
                         "ppg": float(g.pts.mean()), "xpts": float(g.xpts.mean())})  # fmt: skip
            _ = iv
    return pd.DataFrame(rows)


def build(con, paths: Paths) -> dict[str, int]:
    d = team_match(con)
    out = {"ww_drivers": drivers(d), "ww_stability": stability(d), "ww_curves": curves(d)}
    n = {}
    for name, df in out.items():
        con.register("tmp_df", df)
        n[name] = materialize(con, paths, "research", name, "select * from tmp_df")
        con.unregister("tmp_df")
    n["team_matches_used"] = int(d.match_id.nunique())
    return n
