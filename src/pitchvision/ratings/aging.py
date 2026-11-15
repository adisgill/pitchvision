"""Age curves and projections (spec 5.7), per position group.

*Change, Nov 15:* **fixed effects, not the delta method.** The delta method put every peak at
17-21: a player is a regular in season one partly because it went well, so the average
change looked negative at every age (regression to the mean). Here the age effect comes from
a minutes-weighted regression with a fixed effect per player (his level, estimated once
from all his seasons) and per league-season (so league strength and scoring eras don't
masquerade as ageing). Age = whole years at 1 July of the season's start.
* **Metrics:** minutes share (availability; pairs unweighted), non-penalty goals per 90
  (raw, players with 900+ minutes in both seasons), and Impact (goal-RAPM with prior,
  ``ratings.player_rapm``). (*Change, Nov 15:* shrunk goals per 90 and minutes-weighted
  minutes share were both biased toward early peaks and dropped.)
* **Survivor correction:** players who appear in **no** competition of the mirror the next
  season are given a next-season value at the 20th percentile of their group (minutes
  share: 0). Transfers to other leagues aren't dropouts. (*Change, Nov 15:* a first run
  imputed every league leaver and put every peak at 17-19.) The 10th
  and 30th percentiles are run too and reported as sensitivity.
* **Curve:** the age effects relative to the peak, with an 80% band from a bootstrap over
  players.
* **Projection:** each player's latest value moved along his group's curve for the next
  three seasons, band from the bootstrap curves.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from scipy import sparse
from scipy.sparse.linalg import lsqr

from pitchvision.config import Paths
from pitchvision.db import has_table, materialize

DOMESTIC = ("GB1", "ES1", "L1", "IT1", "FR1", "NL1", "PO1")
GROUPS = ("GK", "CB", "FB", "DM", "CM", "AM", "W", "ST")
AGES = range(17, 39)
METRICS = ("minutes_share", "np90", "rapm")
MIN_RATE_MINUTES = 900  # both seasons, for per-90 rates
BOOT = 40
SENSITIVITY = (0.10, 0.20, 0.30)


def player_seasons(con) -> pd.DataFrame:
    lg = "(" + ",".join(f"'{c}'" for c in DOMESTIC) + ")"
    rapm = "left join ratings.player_rapm r using (player_id, season)" if has_table(
        con, "ratings", "player_rapm") else ""  # fmt: skip
    rcol = "r.rapm" if rapm else "null::double"
    return con.execute(f"""
        with ps as (select player_id, competition_id, season, sum(minutes) minutes_,
                           sum(minutes) / sum(team_minutes) minutes_share,
                           arg_max(position_group, minutes) grp
                    from metrics.player_season where competition_id in {lg} group by all),
        c as (select player_id, competition_id, season,
                     90 * sum(np_goals) / sum(minutes) np90
              from metrics.player_season group by all)
        select ps.*, c.np90, {rcol} rapm, p.date_of_birth,
               exists (select 1 from stg.tm_appearances x where x.player_id = ps.player_id
                       and x.season = ps.season + 1) seen_next,
               date_diff('year', p.date_of_birth, make_date(ps.season, 7, 1))
                 - (strftime(p.date_of_birth, '%m-%d') > '07-01')::int age
        from ps left join c using (player_id, competition_id, season)
        join stg.tm_players p using (player_id)
        {rapm}
        where p.date_of_birth is not null""").df()  # fmt: skip


def with_dropouts(ps: pd.DataFrame, metric: str, pct: float) -> pd.DataFrame:
    """Player-seasons plus one imputed season for each dropout (a player seen nowhere in
    the mirror the next season): age + 1, value at the group-season ``pct`` quantile
    (minutes share: 0), weight = his last season's minutes."""
    a = ps.dropna(subset=[metric, "grp", "age"])
    last = ps.groupby("competition_id").season.max()
    drop = a[(~a.seen_next.astype(bool)) & (a.season < a.competition_id.map(last))]
    q = a.groupby(["grp", "season"])[metric].quantile(pct)
    imp = drop.assign(season=drop.season + 1, age=drop.age + 1, imputed=True)
    imp[metric] = 0.0 if metric == "minutes_share" else drop.set_index(
        ["grp", "season"]).index.map(q).to_numpy()  # fmt: skip
    return pd.concat([a.assign(imputed=False), imp], ignore_index=True)


def fe_curve(d: pd.DataFrame, metric: str) -> pd.Series:
    """Age effects from a minutes-weighted regression with player and league-season fixed
    effects; level relative to the peak age."""
    d = d[(d.age >= AGES[0]) & (d.age <= AGES[-1])]
    d = d[d.groupby("player_id").season.transform("size") >= 2]
    pi = d.player_id.astype("category").cat.codes.to_numpy()
    ai = (d.age - AGES[0]).astype(int).to_numpy()
    li = (d.competition_id + d.season.astype(str)).astype("category").cat.codes.to_numpy()
    n, p_, na = len(d), pi.max() + 1, len(AGES)
    x = sparse.csr_matrix((np.ones(3 * n), (np.tile(np.arange(n), 3),
                                            np.concatenate([pi, p_ + ai, p_ + na + li]))),
                          shape=(n, p_ + na + li.max() + 1))  # fmt: skip
    w = np.sqrt(d.minutes_.to_numpy() / 90)
    sol = lsqr(sparse.diags(w) @ x, w * d[metric].to_numpy(), damp=1e-3, atol=1e-10,
               btol=1e-10, iter_lim=20000)[0]  # fmt: skip
    age = sol[p_ : p_ + na]
    seen = np.bincount(ai, minlength=na) > 0
    age = np.where(seen, age, np.nan)
    return pd.Series(age - np.nanmax(age), index=list(AGES)).interpolate(
        limit_direction="both")  # fmt: skip


def fit(ps: pd.DataFrame, rng: np.random.Generator) -> tuple[pd.DataFrame, dict]:
    rows, boots = [], {}
    for metric in METRICS:
        base = ps[ps.minutes_ >= MIN_RATE_MINUTES / 2] if metric == "np90" else ps
        for pct in SENSITIVITY:
            dd = with_dropouts(base, metric, pct)
            for g in GROUPS:
                if metric == "np90" and g == "GK":
                    continue
                dg = dd[dd.grp == g]
                if dg.player_id.nunique() < 200:
                    continue
                c = fe_curve(dg, metric)
                rec = {"metric": metric, "group": g, "dropout_pct": pct,
                       "player_seasons": len(dg), "peak_age": int(c.idxmax())}  # fmt: skip
                if pct == 0.20:
                    players = dg.player_id.unique()
                    by = dict(tuple(dg.groupby("player_id")))
                    bc = []
                    for _ in range(BOOT):
                        pick = rng.choice(players, len(players))
                        bd = pd.concat([by[q].assign(player_id=k) for k, q in enumerate(pick)])
                        bc.append(fe_curve(bd, metric).to_numpy())
                    bc = np.array(bc)
                    boots[(metric, g)] = bc
                    peaks = np.array(list(AGES))[np.nanargmax(bc, axis=1)]
                    rec |= {"peak_lo": float(np.percentile(peaks, 10)),
                            "peak_hi": float(np.percentile(peaks, 90))}  # fmt: skip
                    for age, v, lo, hi in zip(
                        AGES,
                        c,
                        np.nanpercentile(bc, 10, axis=0),
                        np.nanpercentile(bc, 90, axis=0),
                        strict=True,
                    ):
                        rows.append({"metric": metric, "group": g, "age": age, "level": v,
                                     "lo": lo, "hi": hi, "kind": "curve"})  # fmt: skip
                rows.append({**rec, "kind": "summary"})
    return pd.DataFrame(rows), boots


def project(ps: pd.DataFrame, boots: dict, horizon: int = 3) -> pd.DataFrame:
    """Latest season's players moved along their group's curve (median, 10th, 90th)."""
    last = ps[ps.season == ps.season.max()]
    out = []
    ages = np.array(list(AGES))
    for metric in METRICS:
        for r in last.dropna(subset=[metric, "grp", "age"]).itertuples(index=False):
            bc = boots.get((metric, r.grp))
            if bc is None or not (ages[0] <= r.age <= ages[-1] - 1):
                continue
            i0 = int(r.age - ages[0])
            for h in range(1, horizon + 1):
                i1 = min(i0 + h, len(ages) - 1)
                change = bc[:, i1] - bc[:, i0]
                v = getattr(r, metric)
                out.append({"player_id": r.player_id, "competition_id": r.competition_id,
                            "season": r.season, "metric": metric, "age": r.age,
                            "horizon": h, "now": v, "proj": v + np.median(change),
                            "lo": v + np.percentile(change, 10),
                            "hi": v + np.percentile(change, 90)})  # fmt: skip
    return pd.DataFrame(out)


def build(con, paths: Paths) -> dict[str, int]:
    rng = np.random.default_rng(0)
    ps = player_seasons(con)
    curves, boots = fit(ps, rng)
    proj = project(ps, boots)
    n = {}
    for name, df in (("age_curves", curves), ("age_projection", proj)):
        con.register("tmp_df", df)
        n[name] = materialize(con, paths, "ratings", name, "select * from tmp_df")
        con.unregister("tmp_df")
    return n
