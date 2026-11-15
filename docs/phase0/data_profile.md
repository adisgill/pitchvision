# What's actually in the data (Phase 0 samples, 2026-11-14)

Samples were pulled with `pitchvision ingest <source> --fetch` into `data/raw/<source>/`.
Each source has a `manifest.jsonl` recording url, UTC fetch time, bytes and sha256.

| Source | Pulled | Size |
|---|---|---|
| StatsBomb (`hudl/open-data` @ `4b73468f`, BL 15-16 index @ `3bfbffe1`) | competitions, 4 season indexes, events + lineups for 8 matches, 360 for 2 | 43 MB |
| Wyscout public (figshare) | **complete**: events, matches, players, teams, competitions, coaches, referees, id maps | 80 MB |
| Transfermarkt mirror (maintainer's public CSVs, same build as Kaggle) | **complete**: all 10 tables | 241 MB |
| football-data.co.uk | **not pulled.** The site's robots.txt blocks AI agents, so you run the fetch yourself | – |

## Transfermarkt mirror

**Size.** 88,958 games, 1.89 M appearances, 1.27 M game events, 3.18 M lineup rows,
50,149 players, 656k valuations, 175k transfers. 65 competitions.

**Coverage by competition and season (games):**

| Seasons | Big five | CL | EL | UECL | Eredivisie | Primeira | MLS |
|---|---|---|---|---|---|---|---|
| 2012-13 → 2018-19 | complete (380 / 306) | 125 | 205 | – | 306 | 240 → 306 | – |
| 2019-20 | complete except **Ligue 1 279** (stopped for COVID) | 119 | 197 | – | **232** (stopped) | 306 | – |
| 2020-21 → 2023-24 | complete (Ligue 1 is 306 from 2023-24) | 125 | ~140 | 141 | 306 | 306 | – |
| 2024-25 → 2025-26 | complete | 188-189 (new league phase) | 188 | 152 | 306 | 306 | **2024: 509; 2025: 218 (partial)** |

- **The Championship is not in the mirror** (no GB2), nor are any second tiers.
- MLS covers only 2024 and part of 2025.
- No women's leagues.

**Quality checks, big five:**

| Check | Result |
|---|---|
| Goal events = final score | **99.8-100% of games every season** |
| Games with ≥ 22 appearances | 100%, except **2014-15: 93.8%** |
| Lineups (22 starters) | 100% from 2013-14; **none for 2012-13** |
| Team minutes | Exactly 990 per team: **minutes are capped at 90 and added time is not recorded** |
| Substitutions per game | 5.6-5.8 until 2018-19, 7.8 in 2020-21 (five-sub rule), **9.0 by 2024-25** |
| Referee, managers | 100% |
| Formation | 100% except **2012-13 (0%)** |
| Attendance | 100% except **2019-20 (76%) and 2020-21 (8%)**: the empty-stadium seasons are visible directly |
| Players missing date of birth | 49 of 50,149 |

**Things that shape the spec:**

1. **Minute stamps collapse added time.** Goals spike at minute 45 (565 PL goals vs ~150
   at neighbouring minutes) and at minute 90 (1,068). "45+3" is stored as 45. Stints
   split at those minutes can't be ordered within added time, so stint-level plus-minus
   needs a rule: in-added-time events are ordered by event id, and stint length is
   nominal minutes.
2. **Penalties and own goals are identifiable** from the goal description (6,172 penalties
   and 2,066 own goals in the big five). So non-penalty goals work.
3. **Assists are inconsistent across seasons.** The share of PL goals with an assist was
   92% in 2012-13, 70% in 2014-15 to 2023-24, and 82% in 2024-25, so Transfermarkt's assist
   definition changed. Assists are used only within a season, never as a trend.
4. **Card descriptions carry the season count** ("3. Yellow card"). That's a ready-made
   input for the yellow-card accumulation tracker on historical data. Second yellow and
   straight red are distinguished (9,742 and 9,897).
5. **Per-match positions** come from lineups in 14 granular slots (Centre-Back, Right-Back,
   Defensive Midfield, Left Winger, Second Striker…), which map cleanly to the 8 position
   groups.
6. **Club names are flattened.** Each club id has one name in every season (the current
   name), so renames are invisible. The club crosswalk needs a hand-made rename table for
   display only.
7. **1,948 players played in more than one big-five league from 2012-13 to 2025-26**, plus
   many more moving to or from other leagues. That's the sample for league translation
   factors.
8. **Market values** are dated observations (656k), and players carry
   `contract_expiration_date` (a snapshot, not a history).

## StatsBomb open data

- **Indexes:** PL 2015-16 has 380 matches. Bundesliga 2015-16 has **306 at the pinned
  pre-May-2026 commit** (34 on master), so pinning works. WSL 2023-24 has 132.
  Leverkusen 2023-24 has 34.
- **Per match:** about 3,300-3,900 events. 34 event types, including Carry (≈ 800 per
  match), Pressure (≈ 330), Ball Receipt, Ball Recovery, Duel, Dribble, Dribbled Past,
  Miscontrol, Dispossessed, Block, Clearance, Interception, Goal Keeper, 50/50, Shield,
  Error.
- **Shots:** `statsbomb_xg`, `end_location` (x, y, z, so **shot placement exists** and
  xGOT/PSxG are possible), technique, body part, type, key_pass_id, and a **freeze frame on
  97-100% of shots**. Freeze frames are research only (rule 2).
- **Goals reconcile** in all 8 sample matches, once "Own Goal For" events are credited to
  the benefiting team.
- **Coordinates:** x in [0.1, 120], y in [0.1, 80], as documented.
- **Clock:** `minute` runs continuously. Period 1 ran to minute 46 in the sample; period 2
  starts at 45. So "45+2" is minute 46 of period 1, and period plus minute together give
  the brief's "45+2" form.
- **Lineups:** per-player `positions` with from/to times (15 position names), plus cards.
- **360:** a median of 15 of 22 players visible per frame (range 3-21). That confirms
  360 frames are partial and research only.
- **Play patterns** (Regular, Throw In, Goal Kick, Free Kick, Corner, Counter, Keeper,
  Kick Off) give set-piece and counter situations for xG features.

## Wyscout public dataset

- **Five leagues, 2017-18:** 1,826 matches, **3,071,395 events** (England 643k, France
  633k, Germany 519k, Italy 647k, Spain 629k). WC 2018 and Euro 2016 are also present.
- **Goal reconciliation:** 2,245 of 2,246 league matches. Goals were rebuilt from tag 101
  on shots and free-kick shots, plus tag 102 own goals credited to the opponent. The one
  England miss gets a QA entry.
- **Event taxonomy:** 10 event types with 35 sub-events in `eventid2name.csv`. That settles
  the paper's 6-vs-7 inconsistency. **No carries and no pressures**: carries must be
  inferred from gaps between consecutive same-team events, and Wyscout-era pressing
  metrics are not available.
- **No xG.** Our xG model scores Wyscout shots.
- **Coordinates:** integers 0-100, so about 1.05 m × 0.68 m resolution, with rare outliers
  (x = -1, y = 101) to clip. Origin top-left from the attacking team's view, the same as
  StatsBomb.
- **Matches:** UTC kickoff (`dateutc`), scores (HT, FT, ET, pens), referees, coach ids,
  and lineups, bench and substitutions with minute. So Wyscout stints are rebuildable.

## Implications for the spec

- **Tier A** (full events): StatsBomb 2015-16 big five, Wyscout 2017-18 big five, and
  StatsBomb women's 2023-24 (WSL, Frauen-Bundesliga, Liga F, Serie A Women; NWSL 2023)
  plus WSL 2018-21. Three providers' worth of men's seasons gives xG and xT training data
  from two taxonomies, with StatsBomb xG as an external check.
- **Tier C** (lineups, minutes, goals, cards, subs): Transfermarkt 2012-13 → 2025-26,
  70 competitions. This is the long backbone for Impact (plus-minus), availability,
  aging, league translation and the market model.
- **Team level, every season to today:** football-data.co.uk (results, shots, shots on
  target, corners, cards, odds, closing odds; xG columns to be confirmed when you run the
  fetch) plus football-data.org for live fixtures and results.

## football-data.co.uk (profiled Nov 14, after you ran the fetch)

121 files, 16 MB: 8 leagues × 2012-13 → 2026-27, plus MLS. 48,543 matches.

| Layer | Coverage |
|---|---|
| Results | every league-season, complete; 2026-27 has 81-180 matches per league (through 8 Nov) |
| Team xG (`HxG` / `AxG`) | **2026-27 only**, all 8 leagues; no history |
| Pinnacle closing 1X2 | complete 2012-13 → 2024-25; **about 50% of 2025-26**, which confirms the site's warning about its Pinnacle feed; none in 2026-27 |
| Market-average closing 1X2 (`AvgC*`) | complete from 2019-20, current season included |
| Shots / on target, corners, fouls, cards | big five and Championship from 2012-13; Eredivisie and Primeira from 2017-18 |
| Referee | England only (PL all seasons; Championship from 2013-14) |
| Kick-off time (UK) | from 2019-20 |
| MLS | results and closing odds 2012-2026, no match stats |

**Formats.** Dates are `dd/mm/yy` in older files and `dd/mm/yyyy` in newer ones, so both
are parsed explicitly. Files start with a UTF-8 byte-order mark.

**Crosswalk to Transfermarkt.** Clubs are matched by fixture voting per (name, season),
because "Belenenses" refers to two different clubs before and after 2018. Every big-five
match from 2012-13 to 2025-26 maps.

**Three score disagreements**, now in `overrides/match_scores.csv`:

- **Nantes–Bastia 2013-14.** football-data.co.uk agrees with Transfermarkt's goal events
  (2-0), so Transfermarkt's 0-0 score field is wrong.
- **Bastia–Lyon 2016-17 and Verona–Roma 2020-21.** One source has 0-0 and the other 3-0,
  consistent with awarded results. Both scores are kept: the played score for models, the
  official result for standings.

**Lorient–Lille 2013-14** (score 1-4, events 1-3): football-data.co.uk agrees with 1-4, so
Transfermarkt's goal events are missing one.

**Transfermarkt season labels.** Transfermarkt labels calendar-year leagues one year early:
its MLS "2024" ran February-December 2025. Staging now uses the calendar year.

## Still to verify (needs the football-data.co.uk files)

*Done Nov 14: see the section above.*

- Which leagues and seasons have `HxG` / `AxG`, and the referee column.
- Closing-odds columns by season. Whether Pinnacle closing odds are populated after
  July 2025.
- MLS file coverage.
- Team names, for the crosswalk to Transfermarkt.

Run it yourself (the site's robots.txt blocks AI agents like me, and its terms allow
private use). It takes about 6 minutes at one request every 3 s:

```
uv run pitchvision ingest footballdata --fetch
```
