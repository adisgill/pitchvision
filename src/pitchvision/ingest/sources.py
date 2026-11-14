"""What each source's ``ingest <source> --fetch`` downloads. Phase 0 pulls ``sample=True``
subsets for profiling; Phase 1 widens them once the spec is approved.

Licences and terms are summarised in ``docs/phase0/source_inventory.md``.
"""

from __future__ import annotations

import json
from pathlib import Path

import httpx

from pitchvision.ingest.fetch import Fetcher

# ---- StatsBomb open data (github.com/hudl/open-data) -----------------------------------------
# Pinned commits, never a moving branch. The May 2026 export (b0bc9f22) cut the Bundesliga
# 2015-16 match index from 306 matches to 34 (hudl/open-data PRs #81/#86), so that one index
# comes from the last commit before it.
SB_COMMIT = "4b73468fc5b0f1950f9f66fada70ad3a4f9327cb"  # 2026-09-07, master
SB_COMMIT_BL1516 = "3bfbffe1de5750ebd47d770be0bb924a10cde54f"  # 2025-07-30
SB_RAW = "https://raw.githubusercontent.com/hudl/open-data/{commit}/data/{path}"

# (competition_id, season_id, label, commit): match indexes pulled in the sample
SB_SAMPLE_SEASONS = [
    (2, 27, "Premier League 2015-16", SB_COMMIT),
    (9, 27, "1. Bundesliga 2015-16", SB_COMMIT_BL1516),
    (9, 281, "1. Bundesliga 2023-24 (Leverkusen)", SB_COMMIT),
    (37, None, "FA WSL (latest season)", SB_COMMIT),
]
SB_EVENTS_PER_SEASON = 2  # events + lineups (+ 360 where present) for the first N matches


# Tier A full seasons (spec 1.1): (competition_id, season_id)
SB_TIER_A = [
    (2, 27), (11, 27), (12, 27), (7, 27), (9, 27),  # 2015-16 big five (men)
    (37, 4), (37, 42), (37, 90), (37, 281),  # WSL 2018-19, 2019-20, 2020-21, 2023-24
    (135, 281), (182, 281), (131, 281),  # Frauen-Bundesliga, Liga F, Serie A Women 2023-24
    (49, 107),  # NWSL 2023
]  # fmt: skip


def _sb_commit(comp: int, season: int) -> str:
    return SB_COMMIT_BL1516 if (comp, season) == (9, 27) else SB_COMMIT


def statsbomb(root: Path, sample: bool = True) -> list[Path]:
    if not sample:
        return statsbomb_full(root)
    got: list[Path] = []
    with Fetcher("statsbomb", root, min_interval=1.0) as f:
        comps = f.get(SB_RAW.format(commit=SB_COMMIT, path="competitions.json"),
                      f"{SB_COMMIT[:10]}/competitions.json")  # fmt: skip
        got.append(comps)
        rows = json.loads(comps.read_text(encoding="utf-8"))
        for comp, season, _label, commit in SB_SAMPLE_SEASONS:
            if season is None:  # latest season of that competition
                season = max((r for r in rows if r["competition_id"] == comp),
                             key=lambda r: r["season_name"])["season_id"]  # fmt: skip
            p = f.get(SB_RAW.format(commit=commit, path=f"matches/{comp}/{season}.json"),
                      f"{commit[:10]}/matches/{comp}/{season}.json")  # fmt: skip
            got.append(p)
            matches = json.loads(p.read_text(encoding="utf-8"))
            for m in matches[:SB_EVENTS_PER_SEASON]:
                mid = m["match_id"]
                for kind in ("events", "lineups"):
                    got.append(f.get(SB_RAW.format(commit=SB_COMMIT, path=f"{kind}/{mid}.json"),
                                     f"{SB_COMMIT[:10]}/{kind}/{mid}.json"))  # fmt: skip
                if m.get("match_status_360") == "available":
                    got.append(f.get(
                        SB_RAW.format(commit=SB_COMMIT, path=f"three-sixty/{mid}.json"),
                        f"{SB_COMMIT[:10]}/three-sixty/{mid}.json"))  # fmt: skip
    return got


def statsbomb_full(root: Path) -> list[Path]:
    """Every tier-A season: match index, then events and lineups per match, stored gzipped
    under ``full/`` (about 1.5 GB instead of about 10 GB). 360 frames are research-only and
    not pulled here."""
    got: list[Path] = []
    with Fetcher("statsbomb", root, min_interval=0.5) as f:
        got.append(f.get(SB_RAW.format(commit=SB_COMMIT, path="competitions.json"),
                         f"{SB_COMMIT[:10]}/competitions.json"))  # fmt: skip
        for comp, season in SB_TIER_A:
            commit = _sb_commit(comp, season)
            idx = f.get(SB_RAW.format(commit=commit, path=f"matches/{comp}/{season}.json"),
                        f"{commit[:10]}/matches/{comp}/{season}.json")  # fmt: skip
            got.append(idx)
            for m in json.loads(idx.read_text(encoding="utf-8")):
                mid = m["match_id"]
                for kind in ("events", "lineups"):
                    got.append(f.get(SB_RAW.format(commit=SB_COMMIT, path=f"{kind}/{mid}.json"),
                                     f"full/{kind}/{mid}.json.gz"))  # fmt: skip
    return got


# ---- Wyscout public dataset (figshare collection 4415000, CC BY 4.0) --------------------------
WY_ARTICLES = {  # figshare article id -> what it is
    7770599: "events", 7770422: "matches", 7765196: "players", 7765310: "teams",
    7765316: "competitions", 8082650: "coaches", 8082665: "referees",
    11743836: "eventid2name", 11743818: "tags2name",
}  # fmt: skip


def wyscout(root: Path, sample: bool = True) -> list[Path]:
    got: list[Path] = []
    with Fetcher("wyscout", root, min_interval=2.0, timeout=600) as f:
        for art, name in WY_ARTICLES.items():
            meta = httpx.get(f"https://api.figshare.com/v2/articles/{art}", timeout=60).json()
            for file in meta["files"]:
                got.append(f.get(file["download_url"], f"{name}/{file['name']}"))
    return got


# ---- Transfermarkt mirror (dcaribou/transfermarkt-datasets, frozen at 2026-07-06) ------------
# The same build that feeds Kaggle's davidcariboo/player-scores, published as public gzipped
# CSVs by the maintainer; no Kaggle token needed.
TM_BASE = "https://pub-e682421888d945d684bcae8890b0ec20.r2.dev/data/{table}.csv.gz"
TM_TABLES = ["competitions", "clubs", "players", "games", "club_games", "appearances",
             "game_events", "game_lineups", "player_valuations", "transfers"]  # fmt: skip


def transfermarkt(root: Path, sample: bool = True) -> list[Path]:
    with Fetcher("transfermarkt", root, min_interval=2.0, timeout=600) as f:
        return [f.get(TM_BASE.format(table=t), f"{t}.csv.gz") for t in TM_TABLES]


# ---- football-data.co.uk ---------------------------------------------------------------------
# Its site states the data is for private individuals (not commercial or AI-training
# products). Fetching runs only when the owner of this checkout runs it for personal use;
# raw files are never re-hosted.
FD_URL = "https://www.football-data.co.uk/mmz4281/{yy}/{code}.csv"
FD_LEAGUES = {"E0": "Premier League", "SP1": "La Liga", "D1": "Bundesliga", "I1": "Serie A",
              "F1": "Ligue 1", "E1": "Championship", "N1": "Eredivisie",
              "P1": "Primeira Liga"}  # fmt: skip
FD_EXTRA = {"USA": "https://www.football-data.co.uk/new/USA.csv"}
FD_FIRST_SEASON = 2012  # 2012-13: first season with Pinnacle closing odds


def footballdata(root: Path, sample: bool = True, last_season: int = 2026) -> list[Path]:
    got: list[Path] = []
    with Fetcher("footballdata", root, min_interval=3.0) as f:
        got.append(f.get("https://www.football-data.co.uk/notes.txt", "notes.txt", refresh=True))
        for start in range(FD_FIRST_SEASON, last_season + 1):
            yy = f"{start % 100:02d}{(start + 1) % 100:02d}"
            current = start == last_season
            for code in FD_LEAGUES:
                got.append(f.get(FD_URL.format(yy=yy, code=code), f"{yy}/{code}.csv",
                                 refresh=current))  # fmt: skip
        for name, url in FD_EXTRA.items():
            got.append(f.get(url, f"extra/{name}.csv", refresh=True))
    return got


SOURCES = {"statsbomb": statsbomb, "wyscout": wyscout, "transfermarkt": transfermarkt,
           "footballdata": footballdata}  # fmt: skip
