"""Source constants shared by ingest (which fetches) and stg (which never does)."""

from __future__ import annotations

# ---- StatsBomb open data (github.com/hudl/open-data) -----------------------------------------
# Pinned commits, never a moving branch. The May 2026 export (b0bc9f22) cut the Bundesliga
# 2015-16 match index from 306 matches to 34 (hudl/open-data PRs #81/#86), so that one index
# comes from the last commit before it.
SB_COMMIT = "4b73468fc5b0f1950f9f66fada70ad3a4f9327cb"  # 2026-09-07, master
SB_COMMIT_BL1516 = "3bfbffe1de5750ebd47d770be0bb924a10cde54f"  # 2025-07-30

# Tier A full seasons (spec 1.1): (competition_id, season_id)
SB_TIER_A = [
    (2, 27), (11, 27), (12, 27), (7, 27), (9, 27),  # 2015-16 big five (men)
    (37, 4), (37, 42), (37, 90), (37, 281),  # WSL 2018-19, 2019-20, 2020-21, 2023-24
    (135, 281), (182, 281), (131, 281),  # Frauen-Bundesliga, Liga F, Serie A Women 2023-24
    (49, 107),  # NWSL 2023
]  # fmt: skip


def _sb_commit(comp: int, season: int) -> str:
    return SB_COMMIT_BL1516 if (comp, season) == (9, 27) else SB_COMMIT
