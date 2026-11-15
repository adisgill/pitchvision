"""Roles and similarity (spec 5.3, 5.4), tier A.

* **Role features** per player-season: the share of his on-ball actions in each of 6 length
  bands x 3 width bands (central / half-space / wide, left and right folded together), his
  action mix, and volume rates (passes, progressive passes, crosses, shots, key passes,
  take-ons, possession-adjusted tackles + interceptions, aerials; carries and pressures where
  the provider has them). Standardised within provider and position group.
* **Roles:** a Gaussian mixture per provider and position group on qualified players (900+
  minutes), 2-4 components by BIC; every player-season with 450+ minutes gets the role with
  the highest posterior and that probability. Names come from a small template per position
  (e.g. a CB cluster heavy on progressive and long passes is "ball-playing CB"), scored
  against each cluster's centroid; the centroid traits are kept so the names can be audited.
* **Similarity:** cosine similarity on the role features plus the dimension ratings (z),
  within provider and position group, across seasons; the top 10 per player-season, each
  explained by the three traits with the largest shared z (product of the two players' z).
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.mixture import GaussianMixture

from pitchvision.config import Paths
from pitchvision.db import materialize

QUALIFY, SHOW = 900, 450
ZONES = [f"z{x}{y}" for x in range(6) for y in "cmw"]
MIX = ["mix_pass", "mix_cross", "mix_carry", "mix_takeon", "mix_shot", "mix_def"]
RATES = ["passes_p90", "prog_passes_p90", "crosses_p90", "np_shots_p90", "key_passes_p90",
         "take_ons_p90", "tkl_int_padj_p90", "aerials_p90", "prog_carries_p90",
         "pressures_p90", "box_entries_p90", "long_share"]  # fmt: skip
DIMS = ["finishing_score", "creation_score", "progression_score", "ball_security_score",
        "defending_score", "duels_score"]  # fmt: skip

# role templates: name -> feature weights (on standardised features)
TEMPLATES = {
    "CB": {
        "ball-playing CB": {"prog_passes_p90": 1, "long_share": 0.5, "passes_p90": 0.5},
        "stopper CB": {"aerials_p90": 1, "mix_def": 1, "passes_p90": -0.5},
        "wide CB (back three)": {"z1w": 1, "z2w": 1, "crosses_p90": 0.5},
    },
    "FB": {
        "attacking full-back": {"crosses_p90": 1, "z4w": 1, "z5w": 1},
        "inverted full-back": {"z2m": 1, "z3m": 1, "z2c": 0.5, "passes_p90": 0.5},
        "defensive full-back": {"z1w": 1, "mix_def": 1, "tkl_int_padj_p90": 0.5},
    },
    "DM": {
        "deep-lying playmaker": {"passes_p90": 1, "prog_passes_p90": 1, "long_share": 0.5},
        "ball-winner": {"tkl_int_padj_p90": 1, "pressures_p90": 0.7, "mix_def": 0.7},
    },
    "CM": {
        "box-to-box": {
            "np_shots_p90": 0.7,
            "box_entries_p90": 0.7,
            "tkl_int_padj_p90": 0.5,
            "z4c": 0.5,
        },
        "playmaker": {"passes_p90": 1, "prog_passes_p90": 1, "key_passes_p90": 0.5},
        "wide midfielder": {"crosses_p90": 1, "z3w": 0.7, "z4w": 0.7},
        "ball-winning midfielder": {"tkl_int_padj_p90": 1, "mix_def": 0.7, "pressures_p90": 0.5},
    },
    "AM": {
        "creator": {"key_passes_p90": 1, "passes_p90": 0.5, "prog_passes_p90": 0.5},
        "second striker": {"np_shots_p90": 1, "z5c": 1, "mix_shot": 0.5},
        "wide creator": {"crosses_p90": 1, "z4w": 0.7},
    },
    "W": {
        "inside forward": {"np_shots_p90": 1, "z5c": 0.7, "z4m": 0.7},
        "traditional winger": {"crosses_p90": 1, "z4w": 1, "z5w": 0.7},
        "dribbling winger": {"take_ons_p90": 1, "prog_carries_p90": 0.7},
    },
    "ST": {
        "target forward": {"aerials_p90": 1, "mix_shot": 0.3, "passes_p90": -0.3},
        "poacher": {"np_shots_p90": 1, "z5c": 1, "passes_p90": -0.7},
        "mobile forward": {
            "pressures_p90": 0.7,
            "take_ons_p90": 0.7,
            "passes_p90": 0.5,
            "z4m": 0.5,
        },
    },
    "GK": {
        "sweeper-keeper": {"passes_p90": 1, "z1c": 1, "prog_passes_p90": 0.5},
        "line keeper": {"long_share": 1, "passes_p90": -0.5},
    },
}


def features(con) -> pd.DataFrame:
    z = con.execute("""
        with a as (select provider, match_id, player_id, start_x, abs(start_y - 34) ay, type
                   from stg.actions
                   where type in ('pass', 'cross', 'dribble', 'take_on', 'shot', 'tackle',
                                  'interception', 'clearance', 'recovery', 'block',
                                  'aerial_duel', 'ground_duel', 'touch', 'bad_touch')
                     and start_x is not null),
        m as (select 'wyscout' provider, match_id, competition_id, season from stg.wy_matches
              union all select 'statsbomb', match_id, competition_id, season
              from stg.sb_matches)
        select provider, competition_id, season, player_id,
               least(floor(start_x / 17.5), 5)::int xb,
               case when ay < 12 then 'c' when ay < 24 then 'm' else 'w' end yb,
               count(*) n,
               count(*) filter (where type = 'pass') n_pass,
               count(*) filter (where type = 'cross') n_cross,
               count(*) filter (where type = 'dribble') n_carry,
               count(*) filter (where type = 'take_on') n_takeon,
               count(*) filter (where type = 'shot') n_shot,
               count(*) filter (where type in ('tackle', 'interception', 'clearance',
                                               'recovery', 'block')) n_def
        from a join m using (provider, match_id) group by all""").df()  # fmt: skip
    key = ["provider", "competition_id", "season", "player_id"]
    tot = z.groupby(key).n.sum().rename("n_all")
    zz = z.assign(zone="z" + z.xb.astype(str) + z.yb).pivot_table(
        index=key, columns="zone", values="n", aggfunc="sum", fill_value=0)  # fmt: skip
    zz = zz.reindex(columns=ZONES, fill_value=0).div(tot, axis=0)
    mix = z.groupby(key)[["n_pass", "n_cross", "n_carry", "n_takeon", "n_shot", "n_def"]].sum()
    mix = mix.div(tot, axis=0)
    mix.columns = MIX
    ps = con.execute("""select * from metrics.player_season_a""").df()
    ps["crosses_p90"] = 90 * ps.crosses / ps.minutes
    ps["aerials_p90"] = 90 * ps.aerials / ps.minutes
    ps["take_ons_p90"] = 90 * ps.take_ons / ps.minutes
    ps["long_share"] = ps.long_passes / ps.passes.replace(0, np.nan)
    f = ps.set_index(key)[["canonical_id", "minutes", "position_group", *RATES]].join(
        zz, how="left").join(mix, how="left").reset_index()  # fmt: skip
    r = con.execute(f"select provider, competition_id, season, player_id, "
                    f"{', '.join(DIMS)} from ratings.player_season_a").df()  # fmt: skip
    return f.merge(r, on=key, how="left")


def _standardise(g: pd.DataFrame, cols: list[str]) -> pd.DataFrame:
    x = g[cols].astype(float)
    x = x.loc[:, x.notna().mean() > 0.9]  # drop features the provider lacks
    q = g.minutes >= QUALIFY
    mu, sd = x[q].mean(), x[q].std().replace(0, np.nan)
    return ((x - mu) / sd).fillna(0.0)


def roles(f: pd.DataFrame, seed: int = 0) -> tuple[pd.DataFrame, pd.DataFrame]:
    out, cents = [], []
    for (prov, grp), g in f[f.minutes >= SHOW].groupby(["provider", "position_group"]):
        x = _standardise(g, ZONES + MIX + RATES)
        q = (g.minutes >= QUALIFY).to_numpy()
        if q.sum() < 40:
            continue
        best = None
        for k in (2, 3, 4):
            gm = GaussianMixture(k, covariance_type="diag", random_state=seed, n_init=5,
                                 reg_covar=1e-3).fit(x[q])  # fmt: skip
            bic = gm.bic(x[q])
            if best is None or bic < best[0]:
                best = (bic, gm)
        gm = best[1]
        post = gm.predict_proba(x)
        lab = post.argmax(axis=1)
        tmpl = TEMPLATES.get(grp, {})
        names = {}
        for c in range(gm.n_components):
            cen = pd.Series(gm.means_[c], index=x.columns)
            scores = {n: sum(w * cen.get(k_, 0.0) for k_, w in t.items())
                      for n, t in tmpl.items()}  # fmt: skip
            names[c] = max(scores, key=scores.get) if scores else f"{grp} {c}"
            fwd = cen[[z for z in x.columns if z[:2] in ("z4", "z5")]].sum() - cen[
                [z for z in x.columns if z[:2] in ("z0", "z1")]].sum()  # fmt: skip
            names[c] = (names[c], float(fwd))
            top = cen.sort_values()
            cents.append({"provider": prov, "position_group": grp, "cluster": c,
                          "role": names[c][0], "players": int((lab[q] == c).sum()),
                          "high": ", ".join(top.index[-4:][::-1]),
                          "low": ", ".join(top.index[:3])})  # fmt: skip
        # clusters sharing a name are told apart by where they play
        base = {c: n for c, (n, _) in names.items()}
        for nm in set(base.values()):
            same = sorted((c for c in base if base[c] == nm), key=lambda c: names[c][1])
            if len(same) > 1:
                tags = ["deep", "advanced"] if len(same) == 2 else [
                    "deep", "middle", "advanced", "highest"][: len(same)]  # fmt: skip
                for c, tag in zip(same, tags, strict=True):
                    base[c] = f"{nm} ({tag})"
        names = base
        for rec in cents:
            if rec["provider"] == prov and rec["position_group"] == grp:
                rec["role"] = names[rec["cluster"]]
        out.append(g[["provider", "competition_id", "season", "player_id",
                      "canonical_id"]].assign(position_group=grp, cluster=lab,
                                              role=[names[c] for c in lab],
                                              role_probability=post.max(axis=1)))  # fmt: skip
    return pd.concat(out, ignore_index=True), pd.DataFrame(cents)


def similarity(f: pd.DataFrame, top: int = 10) -> pd.DataFrame:
    rows = []
    for (prov, grp), g in f[f.minutes >= SHOW].groupby(["provider", "position_group"]):
        x = _standardise(g, ZONES + MIX + RATES + [d for d in DIMS if g[d].notna().any()])
        v = x.to_numpy()
        norm = np.linalg.norm(v, axis=1, keepdims=True)
        u = v / np.where(norm == 0, 1, norm)
        sim = u @ u.T
        np.fill_diagonal(sim, -np.inf)
        same_player = g.player_id.to_numpy()[:, None] == g.player_id.to_numpy()[None, :]
        sim[same_player] = -np.inf  # other seasons of the same player aren't "similar"
        idx = np.argsort(-sim, axis=1)[:, :top]
        cols = x.columns.to_numpy()
        gi = g.reset_index(drop=True)
        for i in range(len(gi)):
            for rank, j in enumerate(idx[i], 1):
                shared = v[i] * v[j]
                traits = cols[np.argsort(-shared)[:3]]
                rows.append({"provider": prov, "position_group": grp,
                             "competition_id": gi.competition_id[i], "season": gi.season[i],
                             "player_id": gi.player_id[i], "rank": rank,
                             "similar_competition_id": gi.competition_id[j],
                             "similar_season": gi.season[j],
                             "similar_player_id": gi.player_id[j],
                             "similarity": float(sim[i, j]),
                             "shared_traits": ", ".join(traits)})  # fmt: skip
    return pd.DataFrame(rows)


def build(con, paths: Paths) -> dict[str, int]:
    f = features(con)
    r, c = roles(f)
    s = similarity(f)
    n = {}
    for name, df in (("roles", r), ("role_clusters", c), ("similar_players", s)):
        con.register("tmp_df", df)
        n[name] = materialize(con, paths, "ratings", name, "select * from tmp_df")
        con.unregister("tmp_df")
    return n
