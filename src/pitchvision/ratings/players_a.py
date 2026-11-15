"""Tier-A ratings (spec 3, 5.2): the outfield dimensions and the goalkeeper dimensions from
the event seasons, 0-100 against (league-season, position group).

* **Reliability:** split-half (odd vs even matches) per per-90 metric within each
  provider-competition and position group, Spearman-Brown ``k`` (``metrics.players.fit_k``),
  the weighted median across groups; stored in ``metrics.reliability_a``.
* **Shrinkage:** per-90 metrics toward the group mean with their ``k``; success rates
  toward the group rate with ``RATE_K`` attempts (a fixed beta-binomial-style prior, until
  Phase 2 measures each rate's reliability).
* **Dimensions:** the mean of the available components' z-scores (provisional equal weights,
  D10's validity weights come in Phase 2), re-standardised to 50 / 10. Components a
  provider lacks are blank and simply drop out of that season's dimension.
* **Finishing** uses non-penalty goals minus xG per 90 shrunk with its own ``k``: expect a
  large ``k`` (it's mostly noise, spec 6.1, H1).
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from pitchvision.config import Paths
from pitchvision.db import has_table, materialize
from pitchvision.metrics.players import fit_k, split_half

QUALIFY_MIN, RATE_MIN = 900, 450
RATE_K = 30.0
OUTFIELD = {
    "finishing": ["npxg_p90", "xg_per_shot", "finishing_p90"],
    "creation": ["xa_p90", "key_passes_p90", "through_balls_p90", "crosses_ok_p90"],
    "progression": ["prog_passes_p90", "prog_carries_p90", "final_third_entries_p90",
                    "box_entries_p90", "deep_completions_p90", "xt_p90"],
    "ball_security": ["pass_completion", "-turnovers_p90"],
    "defending": ["tkl_int_padj_p90", "tackle_success", "recoveries_padj_p90",
                  "high_recoveries_p90", "blocks_p90", "-dribbled_past_p90", "pressures_p90",
                  "vaep_def_p90"],
    "duels": ["aerial_win_rate", "ground_win_rate", "take_on_success"],
}  # fmt: skip
GOALKEEPER = {
    "shot_stopping": ["goals_prevented_p90"],
    "claiming_sweeping": ["claims_p90", "sweeper_p90"],
    "distribution": ["long_pass_completion", "vaep_pass_p90"],
}
# per-90 metrics with a split-half k; their numerator column in player_match_a
P90_NUM = {
    "npxg_p90": "npxg", "finishing_p90": "fin", "xa_p90": "xa", "key_passes_p90": "key_passes",
    "through_balls_p90": "through_balls", "crosses_ok_p90": "crosses_ok",
    "prog_passes_p90": "prog_passes", "prog_carries_p90": "prog_carries",
    "final_third_entries_p90": "final_third_entries", "box_entries_p90": "box_entries",
    "deep_completions_p90": "deep_completions", "xt_p90": "xt",
    "turnovers_p90": "turnovers", "tkl_int_padj_p90": "tkl_int",
    "recoveries_padj_p90": "recoveries", "high_recoveries_p90": "high_recoveries",
    "blocks_p90": "blocks", "dribbled_past_p90": "dribbled_past",
    "pressures_p90": "pressures", "vaep_def_p90": "vaep_def",
    "goals_prevented_p90": "gp", "claims_p90": "claims", "sweeper_p90": "sweeper",
    "vaep_pass_p90": "vaep_pass",
}  # fmt: skip
RATES = {"xg_per_shot": "np_shots", "pass_completion": "passes", "tackle_success": "tackles",
         "aerial_win_rate": "aerials", "ground_win_rate": "ground_duels",
         "take_on_success": "take_ons", "long_pass_completion": "long_passes"}  # fmt: skip


def _match_frame(con) -> pd.DataFrame:
    pm = con.execute("""
        with d as (select 'wyscout' provider, match_id, kickoff_utc::date match_date
                   from stg.wy_matches
                   union all select 'statsbomb', match_id, match_date from stg.sb_matches)
        select p.*, d.match_date from metrics.player_match_a p join d using (provider, match_id)
        """).df()  # fmt: skip
    pm["fin"] = pm.np_goals - pm.npxg
    pm["xt"] = pm.xt_pass_cross + pm.xt_carry.fillna(0)
    pm["tkl_int"] = pm.tackles_won + pm.interceptions
    pm["gp"] = pm.gk_xg_faced - pm.gk_goals_conceded
    pm["player_id"] = pm.provider + ":" + pm.player_id.astype(str)
    pm["competition_id"] = pm.provider + ":" + pm.competition_id
    return pm


def reliability(pm: pd.DataFrame) -> tuple[dict[str, float], pd.DataFrame]:
    """Split-half k per metric **within** each provider-competition and position group, then
    the player-weighted median across groups. Pooled across positions, volume metrics looked
    near-perfectly reliable (r ~0.9 after four matches) because a centre-back and a winger
    differ for role reasons, not skill."""
    ks, rows = {}, []
    for metric, num in P90_NUM.items():
        d = pm.dropna(subset=[num, "position_group"])
        if metric in ("goals_prevented_p90", "claims_p90", "sweeper_p90"):
            d = d[d.position_group == "GK"]
        per = []
        for (comp, grp), g in d.groupby(["competition_id", "position_group"]):
            sh = split_half(g, num, min_half=360)
            if len(sh) < 40:
                continue
            k, tab = fit_k(sh)
            per.append((k, len(sh)))
            rows.append(tab.assign(metric=metric, competition_id=comp, position_group=grp,
                                   k90=k))  # fmt: skip
        if per:
            kk = np.array([k for k, _ in per])
            ww = np.array([n for _, n in per], dtype=float)
            order = np.argsort(kk)
            cw = np.cumsum(ww[order]) / ww.sum()
            ks[metric] = float(kk[order][np.searchsorted(cw, 0.5)])
    rel = pd.concat(rows, ignore_index=True)
    rel["k90_median"] = rel.metric.map(ks)
    return ks, rel


def _wstats(x, w):
    ok = ~np.isnan(x)
    if ok.sum() < 5:
        return np.nan, np.nan
    m = np.average(x[ok], weights=w[ok])
    return m, np.sqrt(np.average((x[ok] - m) ** 2, weights=w[ok]))


def rate(ps: pd.DataFrame, ks: dict[str, float]) -> pd.DataFrame:
    ps = ps[(ps.minutes >= RATE_MIN) & ps.position_group.notna()].copy()
    n90 = (ps.minutes / 90).to_numpy()
    out = []
    for _, g in ps.groupby(["provider", "competition_id", "season", "position_group"]):
        g = g.copy()
        q = (g.minutes >= QUALIFY_MIN).to_numpy()
        if q.sum() < 5:
            continue
        w = g.minutes.to_numpy(float)
        nn = n90[ps.index.get_indexer(g.index)]
        dims = GOALKEEPER if g.position_group.iloc[0] == "GK" else OUTFIELD
        for dim, comps in dims.items():
            zs = []
            for c in comps:
                sign, col = (-1, c[1:]) if c.startswith("-") else (1, c)
                if col not in g or g[col].isna().all():
                    continue
                x = g[col].to_numpy(float)
                mu, _ = _wstats(x[q], w[q])
                if col in ks:
                    x = (nn * x + ks[col] * mu) / (nn + ks[col])
                elif col in RATES:
                    att = g[RATES[col]].to_numpy(float)
                    x = np.where(np.isnan(x), mu, (att * x + RATE_K * mu) / (att + RATE_K))
                mu, sd = _wstats(x[q], w[q])
                if not sd or np.isnan(sd):
                    continue
                g[f"{col}_shrunk"] = x
                zs.append(sign * (x - mu) / sd)
            if not zs:
                g[f"{dim}_score"] = np.nan
                continue
            s = np.nanmean(np.vstack(zs), axis=0)
            mu, sd = _wstats(s[q], w[q])
            g[f"{dim}_score"] = 50 + 10 * (s - mu) / sd if sd else np.nan
            g[f"{dim}_rating"] = np.clip(g[f"{dim}_score"], 0, 100)
            g[f"{dim}_components"] = len(zs)
        g["qualified"] = q
        out.append(g)
    r = pd.concat(out, ignore_index=True)
    r["tier"] = "A"
    return r


def build(con, paths: Paths) -> dict[str, int]:
    pm = _match_frame(con)
    ps = con.execute("select * from metrics.player_season_a").df()
    grp = ps.assign(player_id=ps.provider + ":" + ps.player_id.astype(str),
                    competition_id=ps.provider + ":" + ps.competition_id)[
        ["player_id", "competition_id", "season", "position_group"]]  # fmt: skip
    pm = pm.merge(grp, on=["player_id", "competition_id", "season"], how="left")
    ks, rel = reliability(pm)
    r = rate(ps, ks)
    if has_table(con, "ratings", "player_rapm"):  # Impact for men's TM-mapped players
        rp = con.execute("""select 'tm-' || player_id canonical_id, season, rapm, data_weight
                            from ratings.player_rapm""").df()  # fmt: skip
        r = r.merge(rp, on=["canonical_id", "season"], how="left")
    n = {}
    for name, schema, df in (("reliability_a", "metrics", rel),
                             ("player_season_a", "ratings", r)):  # fmt: skip
        con.register("tmp_df", df)
        n[name] = materialize(con, paths, schema, name, "select * from tmp_df")
        con.unregister("tmp_df")
    return n
