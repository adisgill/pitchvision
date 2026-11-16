"""Forecasts for upcoming fixtures with the upgraded model, and the public ledger (spec 7.4,
12.7).

* **Base rates:** each club's current Dixon-Coles attack/defence (``ratings.team_season``,
  current), so ``lh = exp(home + att_h + dfn_a)``, ``la = exp(att_a + dfn_h)``; ``rho`` is
  the league's median over its latest season.
* **Upgrade:** the production signal set, i.e. the upgrade signals that can be computed
  before a fixture: points in the last 5, recent shot and corner dominance (previous 10
  league matches), recent FotMob xG difference, and the injured players' share of squad
  value from the club's latest FotMob unavailability list. Coefficients are fitted on every
  FotMob-era match with known results; ``walk_forward_check`` scores this exact set out of
  sample.
* **Ledger:** ``append_ledger`` adds one row per fixture per day before kickoff to
  ``data/ledger/predictions.csv``. Rows are never rewritten; a fixture can collect several
  rows, and the scorecard grades the last one made before kickoff.
"""

from __future__ import annotations

import csv
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import pandas as pd

from pitchvision.config import Paths
from pitchvision.db import has_table, materialize
from pitchvision.forecast import upgrade as up

PROD = [
    "form5_diff",
    "shot_dominance_diff",
    "corner_dominance_diff",
    "fm_xg_form_diff",
    "injured_value_share_diff",
]
LEDGER_COLS = [
    "logged_at",
    "fm_match_id",
    "competition_id",
    "kickoff_utc",
    "home_club",
    "away_club",
    "home_name",
    "away_name",
    "p_home",
    "p_draw",
    "p_away",
    "lh",
    "la",
    "model",
]


def _team_rolling(con) -> pd.DataFrame:
    """Per club: its played league matches (football-data) with points, shots, corners, and
    FotMob xG difference where available, in date order."""
    m = con.execute("""
        select t.match_id, t.match_date, t.home_club, t.away_club, t.home_goals, t.away_goals,
               t.home_shots, t.away_shots, t.home_corners, t.away_corners,
               f.home_expected_goals fxh, f.away_expected_goals fxa
        from core.team_matches t
        left join metrics.fm_team_match f using (match_id)
        where t.played""").df()
    pts = lambda a, b: np.select([a > b, a == b], [3, 1], 0)  # noqa: E731
    h = pd.DataFrame(
        {
            "club": m.home_club,
            "d": m.match_date,
            "pts": pts(m.home_goals, m.away_goals),
            "sf": m.home_shots,
            "sa": m.away_shots,
            "cf": m.home_corners,
            "ca": m.away_corners,
            "xd": m.fxh - m.fxa,
        }
    )
    a = pd.DataFrame(
        {
            "club": m.away_club,
            "d": m.match_date,
            "pts": pts(m.away_goals, m.home_goals),
            "sf": m.away_shots,
            "sa": m.home_shots,
            "cf": m.away_corners,
            "ca": m.home_corners,
            "xd": m.fxa - m.fxh,
        }
    )
    return pd.concat([h, a]).sort_values(["club", "d"])


def _club_signals(con) -> pd.DataFrame:
    """Each club's signals as of now (after its latest match), same definitions as the
    research frame: last-5 points, last-10 shot and corner share, last-10 FotMob xG diff."""
    t = _team_rolling(con)
    rows = []
    for club, g in t.groupby("club"):
        g10, g5 = g.tail(10), g.tail(5)
        if len(g10) < 5:
            continue
        rows.append(
            {
                "club": club,
                "form5": g5.pts.sum() if len(g5) == 5 else np.nan,
                "shot_dom": g10.sf.sum() / (g10.sf.sum() + g10.sa.sum()),
                "corner_dom": g10.cf.sum() / (g10.cf.sum() + g10.ca.sum()),
                "xg_form": g.xd.dropna().tail(10).mean() if g.xd.notna().sum() >= 4 else np.nan,
            }
        )
    s = pd.DataFrame(rows).set_index("club")
    if has_table(con, "stg", "fm_unavailable"):
        inj = (
            con.execute("""
            with last as (
                select c.club_id, max(m.kickoff_utc) k
                from stg.fm_matches m join core.fm_clubs c
                  on c.competition_id = m.competition_id and c.season = m.season
                 and c.fm_id in (m.home_fm_id, m.away_fm_id)
                group by 1),
            lm as (select l.club_id, m.fm_match_id, c.fm_id
                   from last l join stg.fm_matches m on m.kickoff_utc = l.k
                   join core.fm_clubs c on c.club_id = l.club_id
                    and c.competition_id = m.competition_id
                    and c.season = m.season and c.fm_id in (m.home_fm_id, m.away_fm_id))
            select lm.club_id,
                   coalesce((select sum(coalesce(u.market_value, 0)) from stg.fm_unavailable u
                             where u.fm_match_id = lm.fm_match_id and u.team_fm_id = lm.fm_id
                               and u.type = 'injury'), 0) inj_v,
                   (select sum(coalesce(p.market_value, 0)) from stg.fm_player_match p
                    where p.fm_match_id = lm.fm_match_id and p.team_fm_id = lm.fm_id
                      and p.starter) xi_v
            from lm""")
            .df()
            .drop_duplicates("club_id")
            .set_index("club_id")
        )
        s["inj_share"] = (inj.inj_v / (inj.xi_v + inj.inj_v)).reindex(s.index)
    else:
        s["inj_share"] = np.nan
    return s


def production_model(con) -> dict:
    """The production signal set fitted on all FotMob-era matches with results."""
    d = up.base(con)
    fr = con.execute("""select match_id, form5_diff, shot_dominance_diff, corner_dominance_diff
                        from research.matchup_factor_frame""").df()
    fe = up.fm_features(con, d)
    fd = d.merge(fr, on="match_id", how="left").merge(fe, on="match_id", how="left")
    fd = fd[(fd.season >= 2024)]
    return up.fit(fd, PROD), fd


def walk_forward_check(fd: pd.DataFrame) -> dict:
    wf = up.walk_forward(fd, PROD, [2025, 2026], 2024)
    t = wf[wf.mkt_h.notna()]
    y = t.outcome.to_numpy().astype(int)
    base = up._score(up.probs(t.lh.to_numpy(), t.la.to_numpy(), t.rho.to_numpy()), y)
    new = up._score(t[["u_h", "u_d", "u_a"]].to_numpy(), y)
    mk = up._score(t[["mkt_h", "mkt_d", "mkt_a"]].to_numpy(), y)
    return {
        "n": base["n"],
        "rps_current": base["rps"],
        "rps_upgraded": new["rps"],
        "rps_closing_line": mk["rps"],
    }


def forecasts(con) -> pd.DataFrame:
    fx = con.execute("""
        select f.fm_match_id, f.competition_id, f.season, f.kickoff_utc, f.home_club,
               f.away_club, f.home_name, f.away_name
        from metrics.fm_fixtures f
        where not f.finished and not f.cancelled and f.home_club is not null
          and f.away_club is not null""").df()
    tr = con.execute("""select club_id, competition_id, dc_att, dc_dfn, dc_home
                        from ratings.team_season where current""").df()
    rho = con.execute("""
        select competition_id, median(rho_365) rho from forecast.wf_predictions
        where season = (select max(season) from forecast.wf_predictions) group by 1""").df()
    r = tr.set_index("club_id")
    fx = fx[fx.home_club.isin(r.index) & fx.away_club.isin(r.index)].copy()
    home_adv = fx.home_club.map(r.dc_home)
    fx["base_lh"] = np.exp(home_adv + fx.home_club.map(r.dc_att) + fx.away_club.map(r.dc_dfn))
    fx["base_la"] = np.exp(fx.away_club.map(r.dc_att) + fx.home_club.map(r.dc_dfn))
    fx["rho"] = fx.competition_id.map(rho.set_index("competition_id").rho).fillna(-0.05)
    s = _club_signals(con)
    g = lambda col, club: club.map(s[col]) if col in s else np.nan  # noqa: E731
    fx["form5_diff"] = g("form5", fx.home_club) - g("form5", fx.away_club)
    fx["shot_dominance_diff"] = g("shot_dom", fx.home_club) - g("shot_dom", fx.away_club)
    fx["corner_dominance_diff"] = g("corner_dom", fx.home_club) - g("corner_dom", fx.away_club)
    fx["fm_xg_form_diff"] = g("xg_form", fx.home_club) - g("xg_form", fx.away_club)
    fx["injured_value_share_diff"] = g("inj_share", fx.home_club) - g("inj_share", fx.away_club)
    model, _ = production_model(con)
    fx = fx.rename(columns={"base_lh": "lh", "base_la": "la"})
    lh, la = up.apply(model, fx)
    p0 = up.probs(fx.lh.to_numpy(), fx.la.to_numpy(), fx.rho.to_numpy())
    p1 = up.probs(lh, la, fx.rho.to_numpy())
    fx["base_h"], fx["base_d"], fx["base_a"] = p0.T
    fx["p_home"], fx["p_draw"], fx["p_away"] = p1.T
    fx["up_lh"], fx["up_la"] = lh, la
    return fx.rename(columns={"lh": "base_lh", "la": "base_la"})


def build(con, paths: Paths) -> dict[str, int]:
    if not has_table(con, "metrics", "fm_fixtures") or not has_table(
        con, "research", "matchup_factor_frame"
    ):
        return {}
    f = forecasts(con)
    model, fd = production_model(con)
    check = pd.DataFrame([walk_forward_check(fd)])
    coefs = pd.DataFrame({"feature": PROD, "coef": model["b"], "sd": model["sd"][PROD].to_numpy()})
    n = {}
    for name, df in (("upcoming", f), ("production_check", check), ("production_coefs", coefs)):
        con.register("tmp_df", df)
        n[name] = materialize(con, paths, "forecast", name, "select * from tmp_df")
        con.unregister("tmp_df")
    return n


def append_ledger(con, path: Path, now: datetime | None = None) -> int:
    """Append today's forecast for every fixture not yet kicked off (one row per fixture per
    UTC day). Never rewrites existing rows."""
    now = now or datetime.now(UTC).replace(tzinfo=None)
    f = con.execute("select * from forecast.upcoming").df()
    f = f[pd.to_datetime(f.kickoff_utc) > now]
    path.parent.mkdir(parents=True, exist_ok=True)
    seen = set()
    if path.exists():
        with path.open(newline="", encoding="utf-8") as fh:
            for r in csv.DictReader(fh):
                seen.add((r["fm_match_id"], r["logged_at"][:10]))
    day = now.strftime("%Y-%m-%d")
    rows = [r for r in f.itertuples() if (str(r.fm_match_id), day) not in seen]
    new = not path.exists()
    with path.open("a", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        if new:
            w.writerow(LEDGER_COLS)
        for r in rows:
            w.writerow(
                [
                    now.isoformat(timespec="seconds"),
                    r.fm_match_id,
                    r.competition_id,
                    pd.Timestamp(r.kickoff_utc).isoformat(),
                    r.home_club,
                    r.away_club,
                    r.home_name,
                    r.away_name,
                    round(r.p_home, 5),
                    round(r.p_draw, 5),
                    round(r.p_away, 5),
                    round(r.up_lh, 4),
                    round(r.up_la, 4),
                    "dixon-coles blend + upgrade v1",
                ]
            )
    return len(rows)
