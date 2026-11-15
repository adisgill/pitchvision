"""FotMob (approved by the user, Nov 15; personal, non-commercial use; raw pages never
re-hosted). FotMob's robots.txt allows its HTML pages and disallows ``/api/*``: we read
only the public league and match pages, whose server-rendered ``__NEXT_DATA__`` carries the
season's fixtures and each match's shots (x, y, xG, xGOT), line-ups, player and team stats.

* League pages (one per league-season) are re-fetched for the current season every run:
  they hold the fixture list, including upcoming matches with kick-off times.
* Match pages are fetched once, after full time, and kept (gzipped, bytes as served).
* One request every ``MIN_INTERVAL`` seconds, honest user agent (see ``fetch.py``).
"""

from __future__ import annotations

import gzip
import json
import re
from pathlib import Path

from pitchvision.ingest.fetch import Fetcher

BASE = "https://www.fotmob.com"
MIN_INTERVAL = 3.0
# our competition id -> FotMob league id
LEAGUES = {"GB1": 47, "ES1": 87, "L1": 54, "IT1": 55, "FR1": 53, "NL1": 57, "PO1": 61,
           "GB2": 48, "MLS1": 130}  # fmt: skip
CALENDAR_YEAR = {"MLS1"}
FIRST_SEASON = 2024  # 2024-25: the seasons the frozen Transfermarkt mirror and the free
# event data don't cover well enough for current analysis

NEXT_DATA = re.compile(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', re.S)


def page_props(path: Path) -> dict:
    """The ``pageProps`` object of a stored (gzipped) FotMob page."""
    with gzip.open(path, "rt", encoding="utf-8") as f:
        m = NEXT_DATA.search(f.read())
    if not m:
        raise ValueError(f"no __NEXT_DATA__ in {path}")
    return json.loads(m.group(1))["props"]["pageProps"]


def season_param(comp: str, start: int) -> str:
    """FotMob's season label: "2025/2026" for European leagues, "2026" for MLS (our MLS
    seasons are calendar years too)."""
    return str(start) if comp in CALENDAR_YEAR else f"{start}/{start + 1}"


def fotmob(root: Path, sample: bool = True, current: int | None = None,
           leagues: list[str] | None = None) -> list[Path]:  # fmt: skip
    """League pages for every league-season from 2024-25, then every finished match page
    not yet on disk. ``sample`` limits the run to one league's current season."""
    from pitchvision.ingest.sources import current_season

    cur = current or current_season()
    comps = leagues or (["GB1"] if sample else list(LEAGUES))
    got: list[Path] = []
    with Fetcher("fotmob", root, min_interval=MIN_INTERVAL) as f:
        # season-major: every league's current season first (recency matters most)
        for start in range(cur, FIRST_SEASON - 1, -1):
            if sample and start != cur:
                continue
            for comp in comps:
                q = season_param(comp, start).replace("/", "%2F")
                url = f"{BASE}/leagues/{LEAGUES[comp]}/overview/x?season={q}"
                p = f.get(url, f"leagues/{comp}/{start}.html.gz", refresh=start == cur)
                got.append(p)
                try:
                    matches = page_props(p)["fixtures"]["allMatches"]
                except (KeyError, ValueError):
                    continue
                for m in matches:
                    st = m.get("status", {})
                    if st.get("finished") and not st.get("cancelled"):
                        got.append(f.get(f"{BASE}/match/{m['id']}",
                                         f"matches/{comp}/{start}/{m['id']}.html.gz"))  # fmt: skip
    return got
