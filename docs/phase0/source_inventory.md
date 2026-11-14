# Source inventory and coverage matrix

*Phase 0, 2026-11-14. Terms and licences were read from each source's own pages.
StatsBomb, Wyscout and Transfermarkt samples were pulled and profiled with your OK (see
[data_profile.md](data_profile.md)). football-data.co.uk is approved for personal use from
2012-13, and you run its fetch yourself. Claims I couldn't confirm are marked
**UNCONFIRMED**.*

**Decisions so far (2026-11-14):**

- Scope is **historical player ratings plus live team-level forecasts**, with no paid feed.
- football-data.co.uk is used from 2012-13, for personal use.
- Core Python dependencies are approved.

## The short version: the brief's data assumptions no longer hold

Three sources the brief relies on have failed or changed in 2026:

1. **Understat is offline.** Since about 1 November 2026, every page, robots.txt included,
   returns a "We will come back soon" holding page (Last-Modified 3 Nov 2026). No official
   statement has been made. Even before the outage, its robots.txt was `Disallow: /` and it
   published no terms.
2. **FBref lost all its Opta advanced data on 20 January 2026.** That means xG, xA, PSxG,
   progressive actions and SCA, for both men's and women's competitions
   ([Sports Reference blog](https://www.sports-reference.com/blog/2026/01/fbref-stathead-data-update/)).
   Basic data remains: results, lineups, goals, cards and minutes. Its terms forbid
   automated access without permission.
3. **The Kaggle Transfermarkt mirror (`davidcariboo/player-scores`) is frozen at 6 July
   2026.** Updates are paused indefinitely
   ([Discussion #383](https://github.com/dcaribou/transfermarkt-datasets/discussions/383)).
   There are no 2026-27 squads, games or minutes.

**Consequence:** I found no free, legitimately licensed source of current-season (2026-27)
player-level data for the big five. That covers minutes, lineups, substitutions, shots and
xG. Free current-season data exists only at **team level**: results and fixtures
(football-data.org free tier; football-data.co.uk twice a week), odds, basic team match
stats, and possibly team xG (see §1, unverified).

Open full-event data is richer than the brief assumes in one area: **women's leagues**.
StatsBomb added full 2023-24 seasons of the WSL, Frauen-Bundesliga, Liga F and Serie A
Women, plus NWSL 2023, in May 2026.

---

## 1. Results, odds and match stats

### football-data.co.uk

| | |
|---|---|
| **Contents** | One CSV per league-season. Results (full time and half time), basic stats, 1X2 / over-under 2.5 / Asian handicap odds from many bookmakers, and market max and average. Column key: [notes.txt](https://www.football-data.co.uk/notes.txt) |
| **Coverage** | Main files: England tiers 1-4 from 1993-94, Scotland, Germany 1-2, Italy A-B, Spain 1-2, France 1-2, Netherlands, Belgium, Portugal, Turkey, Greece. "Extra" files: 16 more leagues, including **USA (MLS)**; MLS start season UNCONFIRMED |
| **Match stats** | Shots, shots on target, corners, fouls, cards, referee. Major European leagues from 2000-01; all 22 main divisions from 2017-18. notes.txt also lists **HxG / AxG** (team xG per match): **which leagues and seasons have it is UNCONFIRMED**, and if they do, it is the most valuable current-season column we have. Referee by league: UNCONFIRMED (hints suggest England only) |
| **Closing odds** | Pinnacle closing 1X2 from **2012-13**; all bookmakers and market average closing odds from **2019-20**. The site warns that Pinnacle's public odds feed has been unreliable since 23 July 2025, which needs checking in the 2025-26 and 2026-27 files |
| **Freshness** | Updated at least twice a week (Sunday and Wednesday nights). Last update shown: 10 Nov 2026 |
| **Terms** | [data.php](https://www.football-data.co.uk/data.php): "intended for private individuals only, NOT commerical or data training products using automated bots/scrapers/AI" [sic], and "for the purposes of league match prediction only". Footer: "All Rights Reserved". No licence, no redistribution permission |
| **robots.txt** | Generic crawlers allowed; AI crawlers (ClaudeBot, GPTBot and others) fully disallowed |
| **Cost / limits** | Free; no stated rate limit |
| **Risks** | Its wording can be read two ways: a ban on commercial or AI-training products that use bots, or a ban on any automated download. A scheduled script in a public repo sits in that grey zone. **Recommendation:** email the owner for written permission. Until then, ingest from files you download by hand into `data/raw/`. Never re-host the CSVs; publish only derived numbers (market-implied strengths, closing-line scores) |

### football-data.org (API)

| | |
|---|---|
| **Free tier** | €0, "free forever". 12 competitions: CL, PL, Championship, Bundesliga, Serie A, La Liga, Ligue 1, Eredivisie, Primeira Liga, Brasileirão, World Cup, Euros. Fixtures, **delayed** scores (delay length not stated), standings. 10 calls/min. **No live scores, lineups or events** |
| **Paid** | €12/mo: live scores. **€29/mo ("Deep Data"): lineups, substitutions, scorers, cards, squads** for the same 12 competitions |
| **Terms** ([T&C](https://www.football-data.org/client/register), 2018) | Credit line required: "Football data provided by the Football-Data.org API". §6.1: keys "may not be stored in code repositories of open source projects", so the key stays in `.env`. §9.1: after cancelling you may not "reference the football data" obtained, which is a risk for published derived data. Crests are their owners' copyright |
| **Use for us** | The **live backbone for fixtures and results**: daily scoring, kickoff times in UTC, postponements. You need to register for the free key yourself; I don't create accounts |

## 2. Shot-level and full event data

### StatsBomb Open Data (now `hudl/open-data`)

| | |
|---|---|
| **Full league seasons** | **Men's:** 2015-16 PL, La Liga, Serie A, Ligue 1 (377), Bundesliga (306 released, but see risks); Indian Super League 2021-22. **Women's:** WSL 2018-19, 2019-20 (cut short), 2020-21, 2023-24; Frauen-Bundesliga, Liga F and Serie A Women 2023-24; NWSL 2023 (looks full) |
| **Subsets** (not full seasons) | Barcelona's matches in La Liga 2004-05 → 2020-21; PSG 2021-23; Inter Miami 2023; Arsenal 2003-04; **Leverkusen's 34 Bundesliga 2023-24 matches** |
| **Tournaments** | World Cup 2018 and 2022, Euro 2020 and 2024, Copa América 2024, AFCON 2023, Women's World Cup 2019 and 2023, Women's Euro 2022 and 2025; single historical finals |
| **360 frames** | WC 2022, Euro 2020 and 2024, AFCON 2023, Leverkusen 23-24, PSG 21-23, Barça 20-21, Miami 2023, WWC 2023, WEuro 2022 and 2025. Research only (rule 2) |
| **Coordinates** | 120 × 80, origin top-left, y increasing downward; goal posts at y = 36 and 44 |
| **Licence** | "Public Data User Agreement" (Sept 2023). Non-commercial: no commercial exploitation "of the data or any analysis derived". **No redistribution of the data**, while **analysis may be shared publicly with the StatsBomb logo**. Where analysis ends and data begins is undefined, so per-event derived tables are a grey area. The logo to use after the Hudl rebrand is unresolved (issue #80) |
| **Risks** | Since the May 2026 export, the **Bundesliga 2015-16 match index lists only 34 of 306 matches** (fix PRs #81 and #86 are open). Pin a known-good commit. 360 frames don't join to events in 7 matches (#82) |

### Wyscout public dataset (Pappalardo et al. 2019)

| | |
|---|---|
| **Contents** | Full events for **2017-18**: PL, La Liga, Serie A, Ligue 1 (380 each), Bundesliga (306), plus WC 2018 and Euro 2016. 1,941 matches, 3.25 M events. Also players, teams, coaches, referees and PlayeRank |
| **Licence** | **CC BY 4.0** (figshare, and stated in the paper). One catalogue (D4Science) says non-commercial; figshare is authoritative |
| **Coordinates** | 0-100 percentages from the attacking team's view; y = nearness to the right touchline; no pitch size given |
| **Known issues** | Duels are logged as pairs; substitutions with player id 0; the paper contradicts itself on its event-type counts; the public format differs from the commercial Wyscout API |
| **Size** | events.zip ≈ 77 MB |

### Understat: offline

Before the outage it covered the big five plus the Russian league from 2014-15. Stale
Kaggle mirrors exist (MIT, Apache or "Other" licences their uploaders applied to data that
was itself unlicensed):

- `codytipton/player-stats-per-game-understat`: shots, 2014-15 → part of 2024-25.
- `mexwell/understat-database`: big five, 2014 → 2023; x/y values need repair.

**Recommendation:** use them **for research and xG validation only**, never as a published
input, unless you accept the provenance risk.

### Other shot-level options: none usable

- **pannadata** has Opta-derived big-five shots, refreshed daily, but **no licence** and an
  undocumented source. Excluded.
- **Zenodo** has no recent big-five shot or event data under a permissive licence.

## 3. Lineups, minutes, events, values

### Kaggle Transfermarkt mirror: `davidcariboo/player-scores` (frozen)

| | |
|---|---|
| **Tables** | games (incl. managers, formations, referee, stadium, attendance), appearances (**minutes_played**, goals, assists, cards), game_events (goals, cards, **substitutions with minute and player_in_id**), game_lineups, player_valuations, transfers, clubs, players (incl. **contract_expiration_date**), competitions, club_games |
| **Coverage** | 70 competitions: the big five and about 20 other European leagues, MLS, Brazil, Argentina; CL, EL and Conference League including qualifiers; domestic cups. Seasons **2012-13 → 2025-26** |
| **Cutoff** | games and events 2026-07-06; appearances 2026-06-28; valuations 2026-06-12. **Nothing from 2026-27** |
| **Injuries** | None |
| **Licence** | Labelled CC0. Transfermarkt's own terms forbid bots and reserve text-and-data-mining rights (§44b UrhG), so the uploader probably cannot grant CC0. **Risk:** use it for analysis, publish only derived figures, and say where it came from |
| **Size** | ≈ 915 MB in all; single files can be downloaded |

**Alternative with injuries:** `salimt/football-datasets` has about 143k injury spells.
Its Kaggle copy is labelled CC0, but the GitHub repo has no licence file. Last updated
September-October 2025. Coverage is undocumented.

## 4. Strength benchmarks

| Source | Finding |
|---|---|
| **ClubElo** | Its docs, terms and robots.txt are behind a Cloudflare challenge, and `api.clubelo.com` was unreachable on 14 Nov. Third-party wrappers describe a CSV API: snapshots by date (Rank, Club, Country, Level, Elo, From, To) and per-club histories back to 1939. **Licence UNCONFIRMED.** Recommendation: compute **our own Elo** from football-data.co.uk results (easy, fully reproducible), and use ClubElo only as a cross-check if its owner allows it |
| **UEFA coefficients** | UEFA's terms ban automated collection and use in models. kassiesa.net's robots.txt disallows all crawlers. Recommendation: **compute coefficients ourselves** from European results using UEFA's published method, checked against a few values typed in by hand |

## 5. Live, lineups, injuries, wages

| Need | Finding |
|---|---|
| **Confirmed lineups ~1 h before kickoff** | **No free, legitimate source.** Cheapest options: football-data.org Deep Data (€29/mo) or Sportmonks Starter (€29/mo, 5 leagues; its terms allow storage). Neither documents a release time. API-Football's free plan reportedly covers past seasons only (UNCONFIRMED; its pages blocked automated reads) |
| **Live scores** | football-data.org €12/mo, or none |
| **Injuries** | No current open source. Suspensions can be computed from cards plus each league's accumulation rules, but only when we have current-season cards (see the scope question) |
| **Wages** | Capology: private, non-commercial use only, and no scraping. The ZBW big-five salary panel is reportedly CC BY 4.0 but unverified (anti-bot wall). MLSPA guide: MLS only. Recommendation: a user override CSV plus clearly labelled estimates |
| **Sofascore / FotMob / WhoScored** | Terms forbid automated access. Excluded |

## 6. Research and optional

| Source | Licence | Use |
|---|---|---|
| Metrica sample games (3) | no licence file; "please acknowledge" | research notebooks only |
| SkillCorner open data (20 A-League 2024-25 matches, 10 fps) | MIT, credit requested | research notebooks; validating event-based proxies |
| American Soccer Analysis API (MLS, NWSL, USL; xG, xPass, g+) | **CC BY-SA 4.0** (share-alike) | only if MLS or NWSL are in scope |
| Open-Meteo | CC BY 4.0 data; free tier non-commercial, < 10k calls/day | weather research feature |
| Wikidata | CC0 | stadium coordinates and capacity (preferred) |
| OpenStreetMap / Nominatim | ODbL share-alike; 1 req/s | cross-check only; don't publish a mixed table |

## 7. Coverage matrix

From 2012-13, per your answer. The Transfermarkt (L) and event (A) layers are **verified by
profiling** (see [data_profile.md](data_profile.md)). The football-data.co.uk layers
(R O C T) are still documented only, until you run its fetch.

Layer codes:

- **A**: full events
- **S**: shot-level xG (Understat mirrors; research only)
- **T**: team match stats (shots, shots on target, corners, fouls, cards)
- **L**: lineups, minutes, substitutions, goals, cards
- **O**: odds
- **C**: closing odds (Pinnacle from 2012-13, all bookmakers from 2019-20)
- **R**: results

| Seasons | Big five (men) | CL / EL / UECL | Championship | Eredivisie, Primeira | MLS | Women (WSL, F-BL, Liga F, Serie A W, NWSL) |
|---|---|---|---|---|---|---|
| 2012-13 | R O C T, L (**no lineups**) | L R | R O C T (no L) | R O C T L | R O C? | – |
| 2013-14 | R O C T L | L R | R O C T | R O C T L | R O C? | – |
| 2014-15 | R O C T L (appearances 94%) + S | L R | R O C T | R O C T L | R O C? | – |
| **2015-16** | **A (StatsBomb, all five)** + R O C T L S | L R | R O C T | R O C T L | R O C? | – |
| 2016-17 | R O C T L S | L R | R O C T | R O C T L | R O C? | – |
| **2017-18** | **A (Wyscout, all five)** + R O C T L S | L R | R O C T | R O C T L | R O C? | – |
| 2018-19 → 2022-23 | R O C T L S (2019-20 Ligue 1 stopped at 279 games) | L R (UECL from 2021-22) | R O C T | R O C T L | R O C? | WSL **A** 18-19, 19-20, 20-21; NWSL 2018 partial |
| **2023-24** | R O C T L, S patchy; Leverkusen subset A | L R | R O C T | R O C T L | R O C? | **A: WSL, F-BL, Liga F, Serie A W; NWSL 2023** |
| 2024-25 | R O C T L | L R | R O C T | R O C T L | R O C? **L** | – |
| 2025-26 | R O C T L | L R | R O C T | R O C T L | R O C? L partial | – |
| **2026-27 (current)** | **R O C T only** (+ team xG if `HxG` holds) | R (football-data.org) | R O C T | R O C T | R O C? | – |

**Gaps:**

- **No player-level data for 2026-27.** This is accepted in scope: live forecasts are
  team-level.
- The Championship and MLS have no lineup layer before 2024.
- Shot-level xG beyond the event seasons is research-only (Understat mirrors).
- Women's leagues have events but no results or odds layer (football-data.co.uk doesn't
  cover them).
- No injuries.
- No wages.

Gaps to call out:

- **No player-level data of any kind for 2026-27.**
- No shot-level xG after 2023-24 from any usable source.
- Women's data is excellent for 2023-24 but has no results or odds layer: football-data.co.uk
  doesn't cover women's leagues, which is UNCONFIRMED and should be checked.
- No injuries.
- No wages.

---

## 8. Status of the Phase 0 questions

1. **Scope:** decided. Historical player ratings plus live team-level forecasts.
2. **football-data.co.uk:** decided. Personal use from 2012-13; you run the fetch.
3. **Samples:** StatsBomb, Wyscout and Transfermarkt were pulled and profiled. The
   Transfermarkt tables came from the maintainer's public CSVs (the same build as Kaggle),
   so no Kaggle token was needed.
4. **Understat mirrors** (research and xG validation only): still open, as spec
   decision D5.
5. **Tier 2:** still open, as spec decision D3.
