"""Stage football-data.co.uk (personal use; raw files never re-hosted): results, team match
stats, team xG (2026-27 only), and odds, 2012-13 -> today, plus MLS (results and odds).

Profile (docs/phase0/data_profile.md, updated Nov 14):

* ``HxG`` / ``AxG`` exist only from 2026-27.
* Pinnacle closing 1X2 (``PSC*``) is complete 2012-13 -> 2024-25, about half of 2025-26
  (the site warns its Pinnacle feed has been unreliable since July 2025), absent 2026-27.
  The market-average closing line (``AvgC*``) is complete from 2019-20.
* Shots: big five and Championship from 2012-13, Eredivisie and Primeira from 2017-18.
* Referee: England only. Kick-off ``Time`` from 2019-20, in UK time.
* Files start with a UTF-8 byte-order mark and are otherwise latin-1.
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd

from pitchvision.config import Paths
from pitchvision.db import materialize

LEAGUE = {"E0": "GB1", "SP1": "ES1", "D1": "L1", "I1": "IT1", "F1": "FR1", "E1": "GB2",
          "N1": "NL1", "P1": "PO1"}  # fmt: skip
STATS = {"HS": "home_shots", "AS": "away_shots", "HST": "home_sot", "AST": "away_sot",
         "HC": "home_corners", "AC": "away_corners", "HF": "home_fouls", "AF": "away_fouls",
         "HY": "home_yellows", "AY": "away_yellows", "HR": "home_reds", "AR": "away_reds",
         "HxG": "home_xg", "AxG": "away_xg"}  # fmt: skip
ODDS = {  # prefix -> our name; H/D/A suffixes appended
    "PS": "ps_open", "PSC": "ps_close", "Avg": "avg_open", "AvgC": "avg_close",
    "Max": "max_open", "MaxC": "max_close", "B365": "b365_open", "B365C": "b365_close",
    "BbAv": "avg_open_bb",
}  # fmt: skip


def _read(p: Path) -> pd.DataFrame:
    d = pd.read_csv(p, encoding="latin-1", on_bad_lines="skip").dropna(how="all")
    d.columns = [c.replace("ï»¿", "").strip() for c in d.columns]
    return d


def _date(s: pd.Series) -> pd.Series:
    """Dates are dd/mm/yyyy in recent files and dd/mm/yy in older ones; never guessed."""
    s = s.astype(str).str.strip()
    long = pd.to_datetime(s, format="%d/%m/%Y", errors="coerce")
    short = pd.to_datetime(s, format="%d/%m/%y", errors="coerce")
    return long.fillna(short).dt.date


def _num(d: pd.DataFrame, col: str) -> pd.Series:
    return pd.to_numeric(d[col], errors="coerce") if col in d.columns else pd.Series(
        float("nan"), index=d.index)  # fmt: skip


def league_files(root: Path) -> pd.DataFrame:
    out = []
    for f in sorted(root.glob("[0-9]" * 4 + "/*.csv")):
        if f.stem not in LEAGUE:
            continue
        d = _read(f)
        start = 2000 + int(f.parent.name[:2])
        t = pd.DataFrame({
            "competition_id": LEAGUE[f.stem], "fd_division": f.stem, "season": start,
            "season_label": f"{start}-{(start + 1) % 100:02d}",
            "match_date": _date(d["Date"]),
            "kickoff_uk": d["Time"] if "Time" in d.columns else None,
            "home_team": d["HomeTeam"].str.strip(), "away_team": d["AwayTeam"].str.strip(),
            "home_goals": _num(d, "FTHG"), "away_goals": _num(d, "FTAG"),
            "home_goals_ht": _num(d, "HTHG"), "away_goals_ht": _num(d, "HTAG"),
            "referee": d["Referee"].str.strip() if "Referee" in d.columns else None,
        })  # fmt: skip
        for src, dst in STATS.items():
            t[dst] = _num(d, src)
        for src, dst in ODDS.items():
            for side, s in (("H", "home"), ("D", "draw"), ("A", "away")):
                t[f"{dst}_{s}"] = _num(d, f"{src}{side}")
        for src, dst in (
            ("PC>2.5", "ps_close_over25"),
            ("PC<2.5", "ps_close_under25"),
            ("AvgC>2.5", "avg_close_over25"),
            ("AvgC<2.5", "avg_close_under25"),
            ("P>2.5", "ps_open_over25"),
            ("P<2.5", "ps_open_under25"),
            ("Avg>2.5", "avg_open_over25"),
            ("Avg<2.5", "avg_open_under25"),
        ):
            t[dst] = _num(d, src)
        out.append(t)
    return pd.concat(out, ignore_index=True)


def mls_file(root: Path) -> pd.DataFrame:
    p = root / "extra" / "USA.csv"
    if not p.exists():
        return pd.DataFrame()
    d = _read(p)
    d = d[d["League"].astype(str).str.strip() == "MLS"]
    t = pd.DataFrame({
        "competition_id": "MLS1", "fd_division": "USA", "season": _num(d, "Season"),
        "season_label": _num(d, "Season").astype("Int64").astype(str),
        "match_date": _date(d["Date"]),
        "kickoff_uk": d["Time"], "home_team": d["Home"].str.strip(),
        "away_team": d["Away"].str.strip(), "home_goals": _num(d, "HG"),
        "away_goals": _num(d, "AG"),
    })  # fmt: skip
    for src, dst in (("PSC", "ps_close"), ("AvgC", "avg_close"), ("MaxC", "max_close"),
                     ("B365C", "b365_close")):  # fmt: skip
        for side, s in (("H", "home"), ("D", "draw"), ("A", "away")):
            t[f"{dst}_{s}"] = _num(d, f"{src}{side}")
    return t


def build(con, paths: Paths) -> dict[str, int]:
    root = paths.source("footballdata")
    df = pd.concat([league_files(root), mls_file(root)], ignore_index=True)
    df = df[df.home_team.notna() & df.away_team.notna() & df.match_date.notna()]
    df["season"] = df.season.astype(int)
    df.insert(0, "fd_match_id", (df.competition_id + ":" + df.match_date.astype(str) + ":"
                                 + df.home_team + ":" + df.away_team))  # fmt: skip
    df["played"] = df.home_goals.notna() & df.away_goals.notna()
    con.register("tmp_df", df)
    n = {"fd_matches": materialize(con, paths, "stg", "fd_matches", "select * from tmp_df")}
    con.unregister("tmp_df")
    return n
