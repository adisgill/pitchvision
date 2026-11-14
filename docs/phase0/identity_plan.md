# Identity plan: one canonical id per player, club, match, manager and referee

*Phase 0, 2026-11-14. Grounded in the profiled samples; see [data_profile.md](data_profile.md).*

## Sources and their native ids

| Entity | Transfermarkt (TM) | StatsBomb (SB) | Wyscout (WY) | football-data.co.uk (FD) | football-data.org (FDO) |
|---|---|---|---|---|---|
| Player | `player_id` (+ name, DOB, citizenship, height, foot) | `player_id` (+ name, nickname, country, jersey) | `wyId` (+ names, **birthDate**, passport area, height, foot) | – | squads only on paid tier: unused |
| Club | `club_id` (one current name per id) | `team_id` + name per match | `wyId` + name, city, area | team **name string** only | `team.id` + names, TLA |
| Match | `game_id` (date, both clubs, score) | `match_id` (date, kick-off, teams, score) | `wyId` (UTC date, teams, score) | none: (league, date, home, away) | `match.id` (UTC kickoff, teams) |
| Manager | name strings per game (home and away) | name per match, some seasons | `coachId` + coach table | – | – |
| Referee | name string per game | name + id per match | referee ids + table | name string (some leagues) | – |

**TM is the spine for clubs and players.** It spans 2012-13 → 2025-26 across 70
competitions and has dates of birth. Every other source maps onto TM ids where an entity
exists in both, and gets a canonical id of its own where it doesn't (for example women's
players, who appear only in SB).

## Canonical ids and the crosswalk

- `core.player`, `core.club`, `core.match`, `core.manager`, `core.referee`: each row has a
  canonical id `pv_<entity>_<n>`. Ids are stable across rebuilds: they're assigned
  deterministically from the spine, and new entities are appended.
- `core.crosswalk(entity, source, source_id, canonical_id, method, confidence, note)`.
  `method` ∈ {`spine`, `exact`, `deterministic`, `fuzzy`, `override`}.
- `data/overrides/crosswalk_overrides.csv` (committed, hand-edited) **wins over everything**.
  Each row has the form (entity, source, source_id → canonical_id or `distinct`). A
  `distinct` row forbids a merge the matcher would otherwise make.
- `core.crosswalk_qa`: every unmatched source id, every ambiguous candidate set (top two
  scores within 0.05), and every fuzzy match below 0.95, with the reason. **Nothing merges
  silently.** The build prints the counts and fails if ambiguous rows exceed a small
  threshold (D-list).

## Matching rules, in order

### Clubs (do these first: players and matches depend on them)

1. **Exact, normalised name per league-season.** Normalisation: NFKD-fold accents, lower
   case, drop punctuation, then strip a stop-list of club tokens (fc, cf, afc, ac, sc, sv,
   ssc, as, ud, cd, rcd, vfl, vfb, tsg, 1., calcio, club, de, futbol…). The candidate set is
   the clubs that played in that league-season in TM, about 20 per league-season.
2. **Alias table** (`data/overrides/club_aliases.csv`, committed) for the usual short
   forms: "Man United", "Nott'm Forest", "Ath Bilbao", "Ein Frankfurt", "Paris SG",
   "M'gladbach" and so on. FD uses these heavily.
3. **Token-sort similarity** (rapidfuzz) ≥ 90 within the league-season candidates, only if
   the result is unique.
4. **Match-pattern confirmation.** For a proposed mapping in a league-season, the fixture
   list (dates and opponents) must agree on ≥ 95% of matches. This catches the rare
   wrong-but-similar name. It is cheap because candidate sets are small.
5. **Renames and display names:** TM flattens history to the current name. `core.club_name`
   holds (club_id, valid_from, valid_to, display_name) from a small hand table, for display
   only. Relocations are rare in the big five; MLS has them, handled the same way.
6. **Women's clubs** (SB only) get their own ids. They link to the men's club via a
   `parent_club_id` column (manual, about 60 rows), for display and navigation only.

### Matches

- Keyed on **(competition, both canonical clubs, kickoff date ± 1 day)**. The ± 1 day
  covers UTC-vs-local midnight and late reschedules.
- A match is accepted only if exactly one candidate exists **and** the scores agree, when
  both sources have scores.
- A score disagreement is a QA row, never a merge.
- FD rows have no id; their canonical match id comes from this rule.
- Kickoff time: FDO (UTC) or WY (`dateutc`) when available. Otherwise local time (SB, FD)
  converted with the stadium's IANA zone (`zoneinfo`; `tzdata` on Windows).

### Players

1. **Deterministic:** same DOB, same canonical club in the same season, and normalised name
   similarity ≥ 80. Name similarity is the max over full name, "first last", nickname and
   known-as. This handles most SB and WY players, since WY has DOB. SB has no DOB, so for
   SB we use step 2.
2. **Lineup-constrained:** for a matched match, the players of one team in source X are
   assigned to TM's lineup for that team in that match. The assignment is optimal
   (Hungarian) on name similarity plus jersey number agreement plus minutes or position
   agreement. Then votes are aggregated across all of a player's matches: a mapping needs
   ≥ 3 agreeing matches, or all of them if fewer, and no conflicting votes.
3. **Fuzzy:** only within a club-season, with token-sort ≥ 92 and a unique result. These
   are flagged for review if the player has under 5 matches.
4. Everything else goes to QA with its top candidates.

**Expected hard cases:**

- Mononyms and nicknames ("Jorginho", "Pedri", "Rodri"): SB's `player_nickname` helps.
- Transliterations (Cyrillic, Arabic, Korean).
- Brothers at the same club.
- Name changes, including marriage names in women's football.

All of these go through overrides.

### Managers and referees

- **Managers:** TM names per game, normalised. WY `coachId` maps by (club, season, name
  similarity). A manager's tenure (club, from, to) is derived from consecutive games. A
  caretaker is any tenure under N games (D-list).
- **Referees:** name normalisation, then (league, name) uniqueness. FD, TM and SB referee
  strings map to one canonical referee per league. A cross-league referee (European games)
  maps only when exact.

## Tests (Phase 1)

- Unit tests for the normaliser on a fixture list of hard names (accents, apostrophes,
  stop-tokens, mononyms).
- Club mapping for every league-season with FD and TM both present: 100% of clubs mapped,
  and fixture-pattern agreement ≥ 95%.
- Match mapping: ≥ 99.5% of TM league games matched to FD, with score disagreements = 0
  (every disagreement listed in QA).
- Player mapping on the WY 2017-18 and SB 2015-16 seasons: ≥ 98% of minutes played mapped
  to TM players, with the rest in QA.
- Regression: a pinned set of about 30 known players and clubs across sources (Messi,
  Kane, Mbappé, both Inter clubs, both Manchester clubs, "Athletic Club" / "Ath Bilbao"…).
