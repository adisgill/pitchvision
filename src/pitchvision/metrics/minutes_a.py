"""Tier-A player minutes (spec 2.1): the exposure for per-90 rates on event data.

* **StatsBomb:** real on-pitch time from the lineup spells (continuous match clock with
  explicit periods), as the union of each player's spells on a linear match timeline. Some
  extra-time matches have spells that overlap or run backwards; overlaps count once and
  backward spells are dropped. Treatment breaks ("Player Off" / "Player On") and sendings-off end a
  spell, so they're excluded. Each period's length is the last event's time in it, so
  added time counts and a tier-A 90 can be 96 real minutes.
* **Wyscout:** nominal minutes from the starting XI and substitution minutes (0-90).
  Wyscout's red cards are tags on foul events that staging doesn't keep, so a sent-off
  player is counted to 90 here (*limitation, recorded in the spec*).
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from pitchvision.config import Paths
from pitchvision.db import materialize

PERIOD_START = {1: 0, 2: 45 * 60, 3: 90 * 60, 4: 105 * 60}


def _clock(s) -> float:
    if not isinstance(s, str) or ":" not in s:
        return np.nan
    m, sec = s.split(":")
    return int(m) * 60 + int(sec)


def statsbomb_intervals(spells: pd.DataFrame,
                        lengths: dict[tuple[int, int], float]) -> pd.DataFrame:  # fmt: skip
    """Each spell as [start, end) seconds on a linear match timeline (periods laid end to
    end at their real lengths). Spells that run backwards (a StatsBomb glitch in some
    extra-time matches) are dropped (``valid = False``)."""
    starts, ends = np.full(len(spells), np.nan), np.full(len(spells), np.nan)
    offset_cache: dict[int, tuple[list[int], dict[int, float]]] = {}
    for i, r in enumerate(spells.itertuples(index=False)):
        if r.match_id not in offset_cache:
            periods = sorted(p for (m, p) in lengths if m == r.match_id)
            cum, acc = {}, 0.0
            for p in periods:
                cum[p] = acc
                acc += lengths[(r.match_id, p)]
            offset_cache[r.match_id] = (periods, cum)
        periods, cum = offset_cache[r.match_id]
        if not periods:
            continue
        fp = int(r.from_period) if pd.notna(r.from_period) else periods[0]
        if fp not in cum:
            continue
        f = cum[fp] + min(max(_clock(r.from_time) - PERIOD_START.get(fp, 0), 0.0),
                          lengths[(r.match_id, fp)])  # fmt: skip
        if pd.notna(r.to_period) and isinstance(r.to_time, str) and int(r.to_period) in cum:
            tp = int(r.to_period)
            t = cum[tp] + min(max(_clock(r.to_time) - PERIOD_START.get(tp, 0), 0.0),
                              lengths[(r.match_id, tp)])  # fmt: skip
        else:
            last = periods[-1]
            t = cum[last] + lengths[(r.match_id, last)]
        starts[i], ends[i] = f, t
    out = spells.assign(t0=starts, t1=ends)
    out["valid"] = out.t1 >= out.t0
    return out


def union_seconds(iv: pd.DataFrame) -> float:
    """Total length of the union of [t0, t1) intervals (overlapping spells counted once)."""
    total, cur0, cur1 = 0.0, None, None
    for t0, t1 in sorted(zip(iv.t0, iv.t1, strict=True)):
        if cur1 is None or t0 > cur1:
            if cur1 is not None:
                total += cur1 - cur0
            cur0, cur1 = t0, t1
        else:
            cur1 = max(cur1, t1)
    return total + (cur1 - cur0 if cur1 is not None else 0.0)


def build(con, paths: Paths) -> dict[str, int]:
    parts = []
    if con.execute("select count(*) from information_schema.tables where table_schema='stg' "
                   "and table_name='sb_lineups'").fetchall()[0][0]:  # fmt: skip
        spells = con.execute("""
            select match_id, team_id, player_id, position, from_time, to_time, from_period,
                   to_period, start_reason
            from stg.sb_lineups where position is not null""").df()  # fmt: skip
        lens = con.execute("""
            select match_id, period, max(time_s) len from stg.sb_actions
            where period between 1 and 4 group by all""").df()  # fmt: skip
        lengths = {(r.match_id, r.period): float(r.len) for r in lens.itertuples(index=False)}
        iv = statsbomb_intervals(spells, lengths)
        iv["starter"] = iv.start_reason == "Starting XI"
        iv["seconds"] = (iv.t1 - iv.t0).where(iv.valid, 0.0)
        ok = iv[iv.valid]
        sb = (ok.groupby(["match_id", "team_id", "player_id"])
              .apply(union_seconds, include_groups=False).rename("seconds").reset_index()
              .merge(iv.groupby(["match_id", "team_id", "player_id"]).starter.max()
                     .reset_index(), on=["match_id", "team_id", "player_id"]))  # fmt: skip
        spells = iv
        modal = (spells.groupby(["match_id", "player_id", "position"]).seconds.sum()
                 .reset_index().sort_values("seconds").groupby(["match_id", "player_id"])
                 .tail(1)[["match_id", "player_id", "position"]])  # fmt: skip
        parts.append(sb.merge(modal, on=["match_id", "player_id"], how="left")
                     .assign(provider="statsbomb"))  # fmt: skip
    if con.execute("select count(*) from information_schema.tables where table_schema='stg' "
                   "and table_name='wy_lineups'").fetchall()[0][0]:  # fmt: skip
        wy = con.execute("""
            with lu as (select * from stg.wy_lineups),
            off as (select match_id, replaced_player_id player_id, min(sub_minute) m_off
                    from lu where sub_minute is not null group by all),
            ons as (select match_id, team_id, player_id, min(sub_minute) m_on from lu
                    where sub_minute is not null group by all)
            select s.match_id, s.team_id, s.player_id, true starter,
                   60 * coalesce(o.m_off, 90) as seconds
            from lu s left join off o using (match_id, player_id) where s.starter
            union all
            select n.match_id, n.team_id, n.player_id, false,
                   60 * greatest(90 - n.m_on, 0) - 60 * greatest(90 - coalesce(o.m_off, 90), 0)
            from ons n left join off o using (match_id, player_id)""").df()  # fmt: skip
        wy = wy.merge(con.execute("select player_id, role position from stg.wy_players").df(),
                      on="player_id", how="left").assign(provider="wyscout")  # fmt: skip
        parts.append(wy)
    df = pd.concat(parts, ignore_index=True)
    df["minutes"] = df.seconds / 60
    con.register("tmp_df", df)
    n = {"player_minutes_a": materialize(con, paths, "metrics", "player_minutes_a",
                                         "select * from tmp_df")}  # fmt: skip
    con.unregister("tmp_df")
    return n
