# Metrics spec

**Status: v0.1, approved 2026-11-14 with every recommended decision (D1–D24).**
- Implementation follows this spec. Any deviation found while implementing goes in as a
  dated "*Change, <date>:*" note, and I tell you.
- It is grounded in [`phase0/data_profile.md`](phase0/data_profile.md),
  [`phase0/source_inventory.md`](phase0/source_inventory.md) and
  [`phase0/identity_plan.md`](phase0/identity_plan.md).

Contents:
[0 Decisions](#0-decisions) · [1 Scope and tiers](#1-scope-and-data-tiers) ·
[2 Conventions](#2-conventions) · [3 Scale and shrinkage](#3-the-0100-scale-and-shrinkage) ·
[4 Metrics catalog](#4-metrics-catalog) · [5 Ratings](#5-ratings) ·
[6 Models](#6-models) · [7 Forecasting and live operations](#7-forecasting-and-live-operations) ·
[8 Validation plan](#8-validation-plan) · [9 Data-quality tests](#9-data-quality-tests) ·
[10 Out of scope for v1](#10-out-of-scope-for-v1)

---

## 0. Decisions

All 24 were approved as recommended on 2026-11-14. The table is kept as the record of what
was decided and why.

| # | Decision | Options | Recommendation |
|---|---|---|---|
| D1 | **0-100 mapping** | (a) `50 + 10·z`, clipped to [0, 100]; (b) percentile | **(a)**, as in courtvision. Keeps magnitude, so differences mean the same thing across seasons. |
| D2 | **Reference group for z** | (a) league-season × position group; (b) league-season × role cluster | **(a)** for the rating. Role-peer percentiles are shown alongside, because roles exist only for tier A and carry assignment uncertainty. |
| D3 | **Tier 2 competitions** | CL/EL/UECL; Eredivisie and Primeira; Championship; MLS; women's leagues | **CL/EL/UECL** (they're the league-strength evidence), **Eredivisie and Primeira** (full TM and FD coverage). **Championship: team level only** (no lineup layer). **MLS: team level only** (lineups only 2024-25). **Women's: tier-A ratings only** for the WSL, F-BL, Liga F and Serie A W seasons in StatsBomb, plus NWSL 2023, with no forecasts (no results or odds feed). |
| D4 | **Seasons** | per your answer | **2012-13 → today** for everything except the event seasons (2015-16, 2017-18, women's 2018-24). |
| D5 | **Understat mirrors** (stale, uploader-applied licences) | (a) research only: xG validation and notebooks; (b) a production tier-B input 2014-15 → 2022-23; (c) not at all | **(a)**. Never shown as a rating input, never published. It gives an external xG check across about 9 seasons. |
| D6 | **Coordinate frame** | — | **Meters, 105 × 68, origin at the bottom-left corner of the pitch as seen by the team in possession attacking left to right, y increasing upward (toward the attacker's left).** Section 2.3. |
| D7 | **Provider transforms** | (a) hand-written linear transforms + landmark tests; (b) `kloppy` (new dependency) | **(a)**. Two providers, about 100 lines, unit-tested on landmarks. kloppy stays an option if a third provider joins. |
| D8 | **Possession adjustment** | (a) scale by opponent possession *time* (tier A); (b) sigmoid of possession share (StatsBomb's public PAdj) | **(a)**: `count × T_ref / T_opp` (section 2.5). Time is measurable in both event providers and the formula is linear and auditable. |
| D9 | **Progressive action threshold** | — | **Δd ≥ 25% of start distance to goal, or Δd ≥ 10 m when starting in the attacking 60% (x ≥ 42 m)**; open play, completed. Section 4.3. |
| D10 | **Component weights in a dimension** | (a) equal; (b) reliability × out-of-sample validity; (c) learned ridge weights | **(b)**. `w_c ∝ r_c · v_c`, where `r_c` is the component's split-half reliability at 1,500 minutes and `v_c` is its out-of-sample correlation with on-pitch team xG difference in the other half of the season. Clipped at 0, so components that don't predict get no weight. (c) overfits on single seasons. |
| D11 | **Overall rating** | (a) none: dimensions only; (b) weighted by position; (c) Impact as the overall | **(a) for v1.** Dimensions plus Impact. An "overall" invites a single-number ranking the data can't support for tier C. |
| D12 | **Impact (adjusted plus-minus)** | targets: goals (tier C, 2012-26) and xG (tier A seasons) | **Both, reported separately.** Goal-RAPM on TM stints, multi-season with decay and a box prior; xG-RAPM within each tier-A season, flagged as low-power. Section 5.5. |
| D13 | **Box prior inputs for RAPM** | (a) np goals, assists, minutes share; (b) (a) + **market value** | **(b), labelled.** Market value is a strong, independent, public opinion of quality, and an honest prior. The app shows the prior-only and data-only versions too. |
| D14 | **Team xG for 2012 → today** | (a) FD `HxG/AxG` if present; (b) a shots and shots-on-target proxy fitted per league-season; (c) goals only | **(a) where present, else (b)**, decided after you run the FD fetch. The blend weight is tuned walk-forward. |
| D15 | **Closing-line benchmark** | Pinnacle closing (from 2012-13) vs market-average closing (from 2019-20) | **Pinnacle 2012-13 → 2018-19, market average 2019-20 on** (FD warns its Pinnacle feed has been unreliable since July 2025). Margin removed with the **power method**. |
| D16 | **Elo** | ClubElo (licence unconfirmed) vs our own | **Our own**, from results. Fully reproducible. ClubElo is a cross-check only if its owner allows it. |
| D17 | **UEFA coefficients** | scrape vs compute | **Compute** from European results with UEFA's published method; check against a few values typed in by hand. |
| D18 | **Lineup and injury adjustments in forecasts** | — | **Historical walk-forward only** (TM lineups through 2025-26), to measure what a lineup feed would add. Live 2026-27 forecasts are team-level. This quantifies the value of a paid feed with no money spent. |
| D19 | **Live win probability** | — | **Model fitted and shown on played matches** (timelines from TM goal and card minutes). **No live page in v1**: there's no free live feed. |
| D20 | **Publication policy** | — | Publish **derived** tables only. No raw FD, TM, SB or WY files. Per-event SB-derived values are kept off the public demo, and shown only as aggregates (per player-season, per team-match) with the StatsBomb logo. Licences and attributions on an About page. |
| D21 | **Front end** | A Streamlit / **B static React + DuckDB-WASM** / C FastAPI | **B.** See [`phase0/stack.md`](phase0/stack.md). Needs Node 22+ (yours is 20, end of life). |
| D22 | **Name** | pitchvision / fullninety / other | **pitchvision** (free on PyPI and as `adisgill/pitchvision`; shares a name with a cricket video company). |
| D23 | **Phase 1 dependencies** | — | Add **scipy, scikit-learn, rapidfuzz**. No kloppy, socceraction or LightGBM: sklearn's `HistGradientBoostingClassifier` supports monotone constraints. |
| D24 | **Rules file format** | YAML (new dependency) vs TOML | **TOML** (`tomllib` is in the standard library) for league rules: tiebreakers, European places, relegation, card accumulation. |

---

## 1. Scope and data tiers

### 1.1 Tiers

Every player-season rating carries its tier. The UI shows it, and a rating is never
compared across tiers without saying so.

| Tier | Data | Seasons and competitions | Dimensions available |
|---|---|---|---|
| **A** | full events with locations (StatsBomb, Wyscout) | men's 2015-16 (SB) and 2017-18 (WY) big five; women's WSL 2018-19/19-20/20-21/23-24, F-BL, Liga F, Serie A W 2023-24, NWSL 2023 (SB) | all (section 5.2) |
| **C** | lineups, minutes, subs, goals, assists, cards (Transfermarkt) | 2012-13 → 2025-26, big five + Eredivisie + Primeira + CL/EL/UECL (+ other TM leagues as league-strength context) | Scoring, Creation (assists), Availability, Discipline, Impact (goal-RAPM) |
| **Team** | results, team shots and shots on target, corners, fouls, cards, odds (FD); fixtures and results (FDO) | 2012-13 → today, big five + tier-2 leagues | team ratings, forecasts, simulator |

Tier **B** (shot-level xG plus match events) exists in the brief, but no usable source
backs it in production (D5). It is kept as a label so a future source slots in without
schema changes.

### 1.2 What the scope change removes (decided 2026-11-14)

These are removed for the current season, because no free, licensed current player data
exists:

- current-season player ratings;
- next-match player stat lines;
- lineup-, injury- and suspension-adjusted live forecasts;
- a live win-probability page.

Each is still built and **tested historically** where the data allows (D18, D19), so
the app can show what each would add.

---

## 2. Conventions

### 2.1 Seasons, time and clock

- **Season label:** "2025-26"; MLS "2026". Stored as `season` = start year (2025) plus
  `season_label`.
- **Kickoff:** stored in UTC (`kickoff_utc`). Sources in local time (SB, FD) are converted
  with the stadium's IANA zone. All scheduling uses UTC (European and US DST change on
  different dates).
- **Match clock:** `period` (1, 2, 3, 4 = extra time, 5 = shootout), `minute` (nominal
  minute of the period), `added` (minutes of added time, null outside it), stored as
  displayed: "45+3" → (1, 45, 3).
  - StatsBomb's continuous minute converts exactly: period-1 minute 47 → (1, 45, 2).
  - Wyscout `eventSec` converts exactly.
  - **TM collapses added time into 45 and 90.** TM events have `added` = unknown, and are
    ordered within a minute by event id.
- **Minutes played:** TM `minutes_played` (capped at 90, so team minutes = 990) is the tier-C
  exposure.

  *Change, Nov 14 (Phase 1, staging):* TM team minutes are **not** always 990. Only 93-98%
  of team-matches without a red card are within 3 of 990, because TM drops a player's
  whole appearance row in 3-7% of team-matches (the profile wrongly inferred "exactly 990"
  from an average). Tier-C minutes are now **derived from stints**: lineups, substitutions
  and red cards. They agree with TM's own `minutes_played` within 1 minute for **99.98%**
  of 719k big-five appearances. TM gives a player brought on in the 90th minute 1 minute;
  stints give 0. Tier A uses exact on-pitch seconds from substitution and red-card events, so a
  tier-A 90 can be 96 real minutes. Per-90 rates in tier A use **real** on-pitch time; in
  tier C, nominal minutes.

### 2.2 Position groups

8 groups: **GK, CB, FB/WB, DM, CM, AM, W, ST.**

| Group | TM lineup slot | SB position | WY (role code + mean action location) |
|---|---|---|---|
| GK | Goalkeeper | Goalkeeper | GK |
| CB | Centre-Back, Sweeper | Left/Right/Center Back | DF with mean y in central 50% |
| FB/WB | Left-Back, Right-Back | Left/Right Back, Left/Right Wing Back | DF with wide mean y |
| DM | Defensive Midfield | Left/Center/Right Defensive Midfield | MD with mean x < 45 m |
| CM | Central Midfield, Left/Right Midfield | Left/Center/Right Center Midfield, Left/Right Midfield | MD, 45 ≤ x < 60 |
| AM | Attacking Midfield, Second Striker | Left/Center/Right Attacking Midfield | MD with mean x ≥ 60 m |
| W | Left/Right Winger | Left/Right Wing | FW with wide mean y |
| ST | Centre-Forward | Left/Center/Right Center Forward | FW central |

- A player-season's group is the one with the **most minutes**.
- Groups covering ≥ 25% of minutes are listed as secondary.
- TM's generic slots ("Attack", "Midfield", "Defender": 0.4% of rows) take the player's
  modal specific slot.

### 2.3 Coordinates (D6)

All providers are normalised to meters on 105 × 68, attacking left to right (x = 0 at own
goal line), y = 0 at the attacker's right touchline.

| Provider | Native | Transform |
|---|---|---|
| StatsBomb | 120 × 80 yd-like units, origin top-left, y down, team in possession attacks left → right | `x = X·105/120`, `y = 68 − Y·68/80` |
| Wyscout | 0-100 %, origin top-left (attacker's view), y down; integer | clip to [0, 100]; `x = X·1.05`, `y = 68 − Y·0.68` |
| Understat (research only) | 0-1 from the shooter's view | `x = X·105`, `y = Y·68` (orientation to be verified on penalties) |

**Landmark tests** (tolerance 0.5 m for SB, 1.1 m for WY because of integer resolution):

| Landmark | Expected (x, y) m |
|---|---|
| Centre spot | (52.5, 34) |
| Penalty spot | (94, 34) |
| Penalty-box corners | (88.5, 13.84), (88.5, 54.16) |
| Six-yard-box corners | (99.5, 24.84), (99.5, 43.16) |
| Corner flags | (0, 0), (105, 68) |
| Goal posts | (105, 30.34), (105, 37.66) |

Wyscout's percentages don't scale linearly to real box dimensions on every pitch. The test
documents the residual, and it is accepted at 1.1 m.

### 2.4 Exposure and per-90

- `per90(x) = 90 · x / minutes`.
- Non-penalty versions sit next to totals everywhere goals or xG appear.
- **Team-share** versions: a player's share of his team's value *while he was on the pitch*
  (tier A) or over the matches he played (tier C).

### 2.5 Possession adjustment (D8, tier A)

For defensive volume (tackles, interceptions, recoveries, pressures, blocks):

`PAdj(count) = count · T_ref / T_opp`

- `T_opp` = opponent ball-in-play possession time while the player was on the pitch. It is
  measured from event timestamps within possession sequences, excluding dead-ball time.
- `T_ref` = the league-season mean of `T_opp` per 90 on-pitch minutes.

A player whose team defends more than the league average has his counts scaled down.
Rates are then per 90.

### 2.6 Game state

Every event and every minute carries `state` ∈ {level, leading, trailing} (by 1, or by 2+)
and `men` ∈ {11v11, 11v10, 10v11, other}, from goal and red-card events.

- Splits by state and by home/away are stored for every per-90 metric.
- **Score-effect-adjusted** team metrics reweight minutes so each team's state mix equals
  the league average (direct standardisation).

### 2.7 Era effects (flags, not filters)

These are verified from the data during Phase 1, with dates recorded in the rules TOML.

| Effect | Leagues and dates (to verify) | Handling |
|---|---|---|
| VAR | Bundesliga and Serie A 2017-18, La Liga and Ligue 1 2018-19, PL 2019-20 | `var` flag per league-season. Penalty rates and baselines are already season-relative. Reported as a finding. |
| 5 substitutions | **Verified from TM** (subs per game, both teams): about 5.7 in every league through 2018-19. La Liga, Serie A and Bundesliga reached 6.6-6.8 in 2019-20 (restart only) and 8.3-8.6 from 2020-21. Ligue 1 stayed at 5.7 in 2019-20 (never restarted) and was 8.3 from 2020-21. **PL: 5.4-5.6 until 2021-22, 7.9 from 2022-23** | `max_subs` per league-season. RAPM stint counts change with it. |
| Empty stadiums | 2019-20 restart and 2020-21 (TM attendance coverage 76% and 8%) | `crowd` flag per match from attendance. Home-advantage natural experiment (H4). |

---

## 3. The 0-100 scale and shrinkage

### 3.1 Scale

For metric `m`, player `i`, league-season `s`, position group `g`:

`rating = clip(50 + 10 · (m̃_i − μ_sg) / σ_sg, 0, 100)`

- `m̃` is the shrunk per-90 value (3.2).
- `μ`, `σ` are the **minute-weighted** mean and SD over qualified players in (s, g).
- Lower-is-better metrics (turnovers, errors) are sign-flipped first, so **higher is always
  better**.
- **Qualification:** ≥ 900 minutes for the reference group (μ, σ). Every player with
  ≥ 270 minutes gets a rating, shrunk. No season is in progress for player ratings (the
  latest is 2025-26, complete).
- **Acceptance:** per (s, g), the minute-weighted mean of ratings over qualified players is
  50 ± 0.5 and the SD is 10 ± 0.5. Tested.

### 3.2 Shrinkage (empirical Bayes, per metric)

`m̃ = (n · m + k · μ_prior) / (n + k)`

- `n` = minutes / 90.
- `μ_prior` = the (s, g) minute-weighted mean.
- `k` = the number of 90s at which split-half reliability reaches 0.5, from the
  Spearman-Brown fit `r(n) = n / (n + k)` on odd vs even matches (section 8.1).
- Every metric's `k` is stored and shown in the Methods view.
- Finishing (goals − xG) and GK shot-stopping get their `k` from the data too. Expect
  thousands of minutes; no hand-tuning.

### 3.3 Dimension composites (D10)

`D_i = Σ_c w_c z_ic / sd(Σ_c w_c z_c)`, where:

- `z_ic` = the component's z within (s, g);
- `w_c = max(0, r_c · v_c)`, normalised to sum to 1, estimated per position group, pooled
  across seasons of the same tier.

`D_i` is then mapped with 3.1. The weights table is published.

---

## 4. Metrics catalog

**Legend.**

- **Tier:** A (full events) or C (Transfermarkt).
- **Adj:** P = possession-adjusted, S = shrunk, L = league-season relative (all metrics are L).
- **Min:** the minimum minutes to display a value; below it the UI blanks the value (never 0)
  and says why.

### 4.1 Shooting and finishing

| Metric | Definition | Tier | Adj | Min |
|---|---|---|---|---|
| Shots, np shots /90 | shot events excluding penalties | A | S | 450 |
| npxG /90 | sum of **our** xG over non-penalty shots | A | S | 450 |
| xG per shot | npxG / np shots | A | S | 20 shots |
| Shot distance | mean distance (m) to goal centre, np shots | A | S | 20 shots |
| Header share | headed shots / shots | A | S | 20 shots |
| Big-chance share | shots with xG ≥ 0.30 / shots | A | S | 20 shots |
| Long-range share | shots from > 25 m / shots | A | S | 20 shots |
| Penalties | taken, scored, conversion vs league-season rate | A, C | S | 3 taken |
| np goals /90 | goals excluding penalties and own goals | A, C | S | 450 |
| **Finishing (np G − npxG)** /shot and /90 | shrunk hard; persistence tested (H1) | A | S | 30 shots |
| xGOT / PSxG | post-shot model on SB `end_location` (y, z) and shot features | A (SB only) | S | 20 on-target shots |

### 4.2 Creation

| Metric | Definition | Tier | Adj | Min |
|---|---|---|---|---|
| xA /90 | xG of the shot that **any** pass led to (SB `key_pass_id`; WY: pass immediately before a same-team shot in the same possession), completed or not | A | S | 450 |
| Key passes /90 | passes followed by a shot | A | S | 450 |
| Through balls | SB `through_ball`, WY `Smart pass` | A | S | 450 |
| Crosses | attempts, completion %, xA from crosses | A | S | 450 |
| Cutbacks | completed passes from the byline zone (x ≥ 99.5, outside the 6-yard box) backwards into the box | A | S | 450 |
| Set-piece xA | xA from corners and free kicks | A | S | 450 |
| xGChain /90 | sum of xG of possessions ending in a shot in which the player had an action | A | S | 450 |
| xGBuildup /90 | as xGChain, excluding possessions where the player's only actions were the shot or key pass | A | S | 450 |
| Assists /90 | TM assists. **Within a season only**: TM's definition changes across seasons (data_profile.md §3) | C | S | 900 |

Creation is never defined from completed assists alone. Assists appear only as a tier-C
component, labelled.

### 4.3 Progression (D9)

`d` = distance to the centre of the opponent goal (105, 34).

**Progressive:** completed, open play, and either `d_start − d_end ≥ 0.25 · d_start`, or
(`x_start ≥ 42` and `d_start − d_end ≥ 10`).

| Metric | Definition | Tier | Adj | Min |
|---|---|---|---|---|
| Progressive passes /90 | as above | A | S | 450 |
| Progressive carries /90 | SB carries; WY inferred carries (see below) | A | S | 450 |
| Final-third entries | completed passes and carries from x < 70 to x ≥ 70 | A | S | 450 |
| Box entries | to inside the penalty box | A | S | 450 |
| Deep completions | completed non-cross passes ending within 20 m of goal centre | A | S | 450 |
| Zone-skipping passes | completed passes crossing ≥ 2 of the 4 pitch thirds-of-length bands (0-26.25-52.5-78.75-105) forward | A | S | 450 |
| xT added /90 | by passes, carries and dribbles (6.2) | A | S | 450 |

**Wyscout inferred carries:** between consecutive same-team events in the same possession,
if the receiver's next action starts ≥ 3 m from where the ball arrived, record a carry from
the arrival point to the next start. The start is the pass end location; there are no
time limits, because WY has no durations.

### 4.4 Possession value (headline)

| Metric | Definition | Tier |
|---|---|---|
| xT (expected threat) | 16 × 12 grid Markov model (6.2) | A |
| VAEP value /90 | Σ over the player's actions of ΔP(score) − ΔP(concede) (6.3); offensive and defensive parts shown separately | A |
| PV by action type | VAEP split by pass, carry, dribble, shot, defensive action; credited to the actor | A |

No reduced shot-level fallback exists in production (D5).

### 4.5 Ball security

| Metric | Definition | Tier |
|---|---|---|
| Pass completion vs expected | completed − xPass over attempted passes; xPass model (6.4); `under_pressure` feature on SB only | A |
| Turnovers /90 | dispossessed + miscontrol + failed dribbles; lower is better | A |
| Passes under pressure | volume and completion vs expected | A (SB only) |

### 4.6 Defending

| Metric | Definition | Tier | Adj |
|---|---|---|---|
| Tackles + interceptions /90 | SB duel(tackle) + interception; WY ground defending duel won + interception tag | A | P S |
| Tackle success | tackles won / (tackles + dribbled past) | A | S |
| Dribbled past /90 | lower is better | A | P S |
| Ball recoveries /90, high recoveries | high = x ≥ 70 | A | P S |
| Blocks /90 | shot and pass blocks | A | P S |
| Clearances /90 | reported; weight decided by D10 (expected near 0) | A | P S |
| Errors leading to shots | SB `Error`; WY tag 'error' + same-match opponent shot within the next 2 opponent actions | A | S |
| Pressures, counterpressures /90 | SB only (labelled "open data only") | A (SB) | P S |
| Threat prevented /90 | defensive component of VAEP | A | S |

### 4.7 Duels

| Metric | Definition | Tier |
|---|---|---|
| Aerial win % | adjusted for zone: logistic model with zone fixed effects, expected vs actual | A |
| Ground duel win % | same, by zone | A |
| Dribble success % | completed / attempted | A |
| Fouls won / committed /90 | valued: fouls won in the attacking third weighted by the free-kick xG they lead to | A |

### 4.8 Goalkeeping

| Metric | Definition | Tier |
|---|---|---|
| PSxG − GA (/90 and per shot faced) | SB only (needs end location); shrunk hard; persistence tested (H2) | A (SB) |
| Save % vs expected | saves − (on-target shots × (1 − PSxG)) | A (SB) |
| Penalties saved vs expected | shrunk to league rate | A, C |
| Crosses claimed, stopped | SB `Goal Keeper` claim/punch over opponent crosses into the box | A |
| Sweeper actions /90, avg distance | defensive actions outside the box; mean x of all GK actions | A |
| Distribution | long-pass completion, launch share, xT of distribution | A |
| Errors | as 4.6 | A |

### 4.9 Team style and quality (team level, every season)

| Metric | Definition | Data |
|---|---|---|
| Goals, xG proxy for/against /90 | D14 | FD (team) |
| Shots, SoT for/against, shot share | — | FD |
| Corners, fouls, cards | — | FD |
| xPoints | Poisson simulation from each match's xG (or proxy) for each side | FD |
| Table vs xPoints | the "deserved table" | FD |
| Field tilt, PPDA, high turnovers, line height, directness, possession share, counters, set-piece xG for/against, crossing reliance, width | definitions as in SB/WY conventions; PPDA = opponent passes in their own 60% / our defensive actions there | tier-A seasons only |

### 4.10 Match level

| Output | Definition | Data |
|---|---|---|
| xG race | cumulative xG by minute, goals annotated | tier A |
| xT momentum | Σ xT added per 5 minutes per team, mirrored bars | tier A |
| Win-probability timeline | 6.6 model over the minute-level state | every TM match 2012-26 |
| Deserved result | P(W/D/L) from 10k simulations of the match's shots (independent Bernoulli by xG) | tier A |

### 4.11 Discipline and officials

| Metric | Definition | Data |
|---|---|---|
| Cards /90, second yellows, straight reds | — | TM |
| Penalties won / conceded | SB/WY events; TM penalty goals (scored only) as a fallback | A, C |
| Referee tendencies | cards, penalties (scored), fouls per game; home bias = home − away card rate; shrunk to league-season (k from split-half by matches) | TM + FD |

### 4.12 Availability and load

| Metric | Definition | Data |
|---|---|---|
| Minutes share, starts, sub on/off patterns | — | TM |
| Congestion | team games in last 7 / 14 days, rest days (all competitions TM has) | TM, FDO |
| Travel | great-circle km between stadiums (Wikidata coordinates, fetch to be approved in Phase 1) | — |
| International duty | caps from TM `players`; international-break calendar from FIFA dates (hand-entered TOML) | TM |
| Injury days lost | **unavailable**: no open, current, licensed source. Shown blank with the reason. | — |

---

## 5. Ratings

### 5.1 Levels

- Player-season (per competition).
- Player-match (tier A).
- Team-season.
- Team-match.

Every rating stores `tier`, `minutes`, `league_season`, `group`.

### 5.2 Dimensions and their components

**Outfield, tier A**

| Dimension | Components (weights by D10) |
|---|---|
| Finishing | npxG /90, xG per shot, Finishing (shrunk), header and big-chance shares (context, weight 0) |
| Chance creation | xA /90, key passes, through balls, cross and cutback xA, xGChain |
| Progression | progressive passes and carries, final-third and box entries, deep completions, xT added |
| Ball security | pass completion vs expected, turnovers (inverted), xGBuildup share |
| Defending | PAdj tackles + interceptions, tackle success, dribbled past (inverted), PAdj recoveries, high recoveries, blocks, clearances, threat prevented, pressures (SB seasons) |
| Duels & aerials | aerial and ground win % vs expected, dribble success, valued fouls won and committed |
| Impact | xG-RAPM (season), goal-RAPM (multi-season) |

**Goalkeepers, tier A**

| Dimension | Components |
|---|---|
| Shot-stopping | PSxG − GA per shot (SB), penalty saves vs expected |
| Claiming & sweeping | crosses claimed rate, sweeper actions, distance |
| Distribution | long-pass completion vs expected, xT of distribution |
| Impact | as outfield |

**Tier C** (every player 2012-13 → 2025-26)

| Dimension | Components |
|---|---|
| Scoring | np goals /90 (shrunk), penalty goals (context) |
| Creation | assists /90 (within season only) |
| Availability | minutes share of team minutes, starts share |
| Discipline | cards /90 (inverted) |
| Impact | goal-RAPM with prior (5.5) |

### 5.3 Roles (tier A)

- **Features:** per-90 action shares by 6 × 4 pitch zones and action type (touches,
  passes, carries, shots, defensive actions), standardised within position group.
- **Model:** Gaussian mixture per position group, with K chosen by BIC (2-4 per group).
- **Labels** are assigned by hand from cluster centroids: ball-playing CB, inverted
  full-back, deep-lying playmaker, box-to-box, inside forward, target forward, and so on.
- The UI shows the role and its posterior probability.
- **Tier C role** = position group only.

### 5.4 Similarity

- **Tier A:** cosine similarity in the standardised role-feature plus dimension space,
  within position group, across seasons and providers after provider harmonisation.
  Explained by the top 3 shared traits (largest product of z-scores).
- **Tier C:** the same over Scoring, Creation, Availability, Impact and age.

### 5.5 Impact: adjusted plus-minus (D12, D13)

**Stints**

- Rebuilt from TM lineups and substitution and red-card events.
- A new stint starts at every substitution and every red card.
- Added-time events count at minute 45 or 90 (2.1).
- Expected about 6-11 stints per match.

*Change, Nov 14 (Phase 1, stints):* the ordering rules TM forces, implemented in
`metrics/stints.py` and unit-tested:

- TM event ids are hashes, so they give no order. A goal in the same minute as a
  substitution counts **before** it, unless the scorer came on in that minute.
- Zero-length 90th-minute stints are dropped, and their goals are attached to the
  previous stint.
- Match length is 120 if any event falls after minute 90.
- 2012-13 has no lineups, so starters are the appearances minus the players brought on.
- A match's stints are `valid` for plus-minus when every event has a minute, every stint
  has 9-11 players a side, and the match isn't a known score issue.

Result: 246,970 stints. Stint goals reconcile with the final score in ≥ 99.5% of valid
matches in every league-season. **UECL 2021-22 to 2022-23 and EL 2012-13 have no lineups
in the mirror** and get no stints.

**Goal-RAPM**

- Model: ridge regression of `Δgoals per 90` (home − away) per stint on player indicators
  (+1 home, −1 away), weighted by stint minutes, plus a home intercept per league-season.
- Data: the big five + Eredivisie + Primeira + CL/EL/UECL, 2012-13 → 2025-26, with season
  decay `0.5^(age/h)`.
- Prior: Bayesian ridge toward a prior mean
  `β₀ = a·npG90 + b·A90 + c·log(market value) + d·minutes share + group intercept`.
  The prior coefficients are fitted on the previous seasons' RAPM.
- `λ`, the prior weight and `h` are tuned by cross-validation on held-out **matches**.
- Report: out-of-sample predictive r for next-season team goal difference against the
  prior alone, and against raw on/off.

**Collinearity**

- Soccer has few substitutions, so report:
  - the condition number;
  - per player, the share of his minutes shared with his most-frequent teammate;
  - the effective sample size.
- Players with < 1,500 stint minutes or > 85% minutes overlap show "prior-dominated".

**xG-RAPM**

- The same within each tier-A season (one season of about 1,826 matches).
- Expect low power, said plainly.

**Cross-league**

- Players appear in European competitions against other leagues' players. That connects
  the design matrix across leagues, so RAPM is on a common scale.
- League intercepts are also estimated and compared with 5.6.

### 5.6 League strength and the "big-five-adjusted" rating

Three estimates, all shown with intervals next to the within-league number:

1. **European results:** a hierarchical Elo / Poisson model on CL/EL/UECL matches (TM,
   2012-26) with league random effects, by season.
2. **Player translation factors:**
   - For players who switch leagues (1,948 within the big five, more with the other TM
     leagues), take the ratio of per-90 metrics (np goals, minutes share, RAPM) after vs
     before the move.
   - Pair each player's last season before with the first season after.
   - Adjust for age with the 5.7 curve.
   - Shrink by league pair.
   - Chain all pairs into factors relative to the PL by weighted least squares over the
     league graph, with bootstrap intervals.
3. **Computed UEFA coefficient** (D17), as a published cross-check.

`rating_adj = rating + 10 · (factor_league − factor_ref) / σ`. Always shown beside the raw
rating, never instead of it.

### 5.7 Age curves

- **Method:** the delta method per position group on tier-C metrics (minutes share,
  np goals /90, RAPM).
  - Use pairs of consecutive seasons, weighted by the harmonic mean of minutes.
  - Survivor-bias correction: players who disappear are imputed at the 20th-percentile
    level of their group for the missing season (sensitivity reported at the 10th and
    30th).
- **Outputs:** peak age with bootstrap band; a projection for each player from his current
  level along the curve, with an 80% band.
- **Dates of birth:** missing for 49 players, who are excluded.

### 5.8 Team ratings (show all three and where they disagree)

1. **Opponent-adjusted attack/defence:** Dixon-Coles on goals, and on xG (D14), blended
   (6.5).
2. **Elo:** our own (D16).
   - K and home advantage per league tuned on log loss.
   - A goal-difference multiplier.
   - Between seasons, ratings regress one third of the way to the league mean.
   - Promoted teams start at the mean of last season's relegated teams.
3. **Market-implied:**
   - Closing odds (D15), with the margin removed by the power method.
   - Then the attack/defence Poisson strengths that reproduce each match's 1X2 (and
     over/under 2.5 where present), with the same time decay.

---

## 6. Models

### 6.1 xG

- **Training:** all shots from SB 2015-16 big five, SB women's seasons, and WY 2017-18
  big five, about 50k shots.
  - Harmonised features: distance, angle (radians subtended by the goal mouth), body part
    (foot / head / other), situation (open play, corner, direct free kick, other set
    piece, counter, penalty), assist type (cross, through ball, cutback, pass, rebound,
    none), previous action type, fast break (≤ 10 s since possession won, SB only; WY
    approximates with event counts), game state.
  - `under_pressure` is used only in an SB-only variant, reported separately.
- **Models:** logistic regression with splines on distance and angle; and
  `HistGradientBoostingClassifier` with monotone constraints (xG decreasing in distance,
  increasing in angle). Choose on held-out log loss.
- **Validation:**
  - Leave-one-season/provider-out.
  - Calibration plots.
  - Log loss and Brier against SB's `statsbomb_xg` on the SB seasons, and against Understat
    xG on the research mirror (D5).
  - A recalibration check per league-season (calibration slope and intercept).
- **Penalties:** fixed at the pooled conversion rate (about 0.76), shown separately.
- **PSxG:** SB only. Features: end location (y, z) in the goal mouth, distance, angle, body
  part, plus pre-shot xG.

### 6.2 Expected threat

- Grid 16 × 12 on 105 × 68.
- From open-play passes, carries and dribbles (successful or not) and shots, estimate per
  cell:
  - P(shoot), P(move), P(goal | shot) (mean xG of shots from the cell);
  - the move transition matrix over end cells (successful moves only; failed moves end the
    chain).
- Value iteration `xT = P(shoot)·G + P(move)·Σ T·xT` until max change < 1e-6.
- Fitted per provider and pooled; the difference is reported.
- **xT added** = xT(end) − xT(start) for successful moves.

### 6.3 VAEP-style action values

- **Schema:** a unified action table (SPADL-like, own implementation) from SB and WY:
  type, result, body part, start and end (m), time, team, player.
- **Features:** the last 3 actions' types, results, locations, distances and angles to
  goal, time gaps, and goal difference.
- **Labels:** `scores` = the team scores within the next 10 actions; `concedes` likewise.
- **Models:** two `HistGradientBoostingClassifier`, trained leave-one-season-out.
- **Action value:** `[P_s(t) − P_s(t−1)] − [P_c(t) − P_c(t−1)]`, with resets at possession
  changes as in the VAEP paper.
- Validated by AUC, calibration, and the split-half reliability of player VAEP /90.

### 6.4 xPass

- Logistic regression or GBM on start location, end location, length, angle, pass height
  and body part (both providers), plus `under_pressure` (SB variant).
- Completion vs expected per player.

### 6.5 Match outcomes

**Strengths**

- Time-decayed Dixon-Coles (low-score correction ρ) with attack α, defence β and home
  advantage γ per league-season.
- Fitted on goals and, separately, on xG (or the proxy, D14) treated as Poisson-like
  weights (Gamma-Poisson pseudo-likelihood).
- `λ = exp(w·log λ_goals + (1−w)·log λ_xG)`, with the blend weight `w` and the decay
  half-life tuned walk-forward on RPS.

**Adjustments** (each kept only if it improves walk-forward RPS)

- Rest days and congestion (all TM competitions historically; FDO for current CL games).
- European midweek travel.
- Manager change (TM, historical; current season if derivable from FDO team data,
  unverified).
- **Lineup strength (historical only, D18):** the starting XI's summed Impact × expected
  minutes, vs the season's modal XI.
- Promoted-team prior.

**Outputs:** P(H/D/A); expected goals each; the scoreline matrix 0-10 × 0-10; over/under
totals; both teams to score.

**Metrics:** RPS (primary), log loss, Brier, calibration (10 bins).

**Benchmarks:**

1. League base rates (home/draw/away for the league-season to date).
2. Our Elo.
3. The closing line (D15).

The gap to the closing line is reported as is.

### 6.6 Win probability by game state

- Multinomial model of the final result given (minute, goal difference, red-card
  difference, pre-match expected goals each, home).
- Implemented as remaining-goals Poisson processes with rates scaled by state, fitted by
  maximum likelihood.
- Fitted on TM minute-level states, 2012-26 (about 60k matches).
- **Check:** calibration by 15-minute bucket.
- Used for the historical win-probability timelines (4.10) and the red-card-by-minute
  hypothesis (H11).

### 6.7 Market value model

- Target: log TM market value at date t.
- Features: age (spline), contract months left (snapshot-limited: `contract_expiration_date`
  exists only for the current snapshot, so it is used only for the latest valuation),
  minutes share, tier-C ratings, league factor, position group, caps.
- Model: GBM, cross-validated by player.
- Output: model value with a 80% interval (quantile GBM), and over/under-valued players.
- **Labelled:** the model learns Transfermarkt's own valuation; it doesn't price fees.

---

## 7. Forecasting and live operations

### 7.1 Walk-forward engine

- Retrains weekly using only data before each match week, for every match 2017-18 →
  2025-26.
- Every experiment runs through it.
- **Ablations:** home advantage, xG blend, rest and congestion, travel, manager change,
  head-to-head (expected useless), lineup strength (D18), promoted-team prior.

### 7.2 Season simulator

- At least 10,000 Monte Carlo runs of the remaining fixtures, drawing team strengths from
  their posterior (parametric bootstrap of the Dixon-Coles fit).
- **League rules**, from `data/rules/<league>.toml`, verified per season:
  - points;
  - tiebreak order:
    - head-to-head first in La Liga and Serie A;
    - goal difference first in the PL, Bundesliga and Ligue 1, with Ligue 1's
      post-2023 rules checked;
  - points deductions (a hand table with sources);
  - European places (league ranking and cup-winner reallocations);
  - relegation play-offs (Bundesliga 16th vs 2. BL 3rd; Ligue 1 barrage; Serie A tie
    play-off rule).
- **Outputs:**
  - title, top-four, Europe and relegation odds;
  - expected points;
  - full position distributions.
  - Each run is stored, so odds plot over time.
- **"What if":** add or remove a team-strength delta for N weeks. A player-level what-if
  for the current season is not possible (no current player data). Historical seasons can
  use RAPM.

### 7.3 Player projections (historical backtest only)

- Next-match start probability and minutes, goals, assists and cards from tier-C data.
- Negative binomial counts with role priors, calibrated 80% intervals with exact bounds.
- Tested walk-forward 2017-18 → 2025-26 against the season-to-date average.
- Not produced for 2026-27 (1.2).

### 7.4 Prediction ledger and scorecard

**Ledger**

- `forecast.ledger_matches` is append-only. Columns:
  - `match_id`, `kickoff_utc`;
  - `predicted_at_utc`;
  - `model_version`, `commit`, `data_through`;
  - `lineup_source` (always `none` in v1), `injury_snapshot` (null in v1);
  - P(H/D/A), expected goals each, the scoreline matrix (JSON), totals.
- Rows are never rewritten. Tests check the table only grows and existing rows are
  byte-identical.

**Kickoff guard**

- A forecast run never predicts a match whose `kickoff_utc ≤ now_utc`; those teams get
  their next fixture.
- The scorecard grades each match's **latest pre-kickoff** prediction.
- Both are tested with fixed clocks.

**Scorecard**

- Daily and rolling RPS, log loss, Brier and calibration.
- Against Elo, base rates, and the closing line once the FD file for that week arrives
  (twice a week).

**Daily automation** (Phase 4)

- Poll FDO for results and fixture changes.
- Score finished matches.
- Rebuild when FD updates.
- Forecast each morning and again before each kickoff window (from FDO kickoffs, in UTC).
- Publish the demo.
- Scheduled with courtvision's Windows lessons:
  - the base interpreter's `pythonw.exe` on a launcher script;
  - child steps with `CREATE_NO_WINDOW`;
  - backup trigger times with "ignore new instance";
  - heartbeats.

---

## 8. Validation plan

Phase 2 deliverable: `docs/validation.md` plus an app page.

1. **Reliability.**
   - For every per-90 metric: split-half r (odd vs even matches) by minutes bin.
   - The minutes needed for r ≥ 0.5 and ≥ 0.7.
   - `k` for shrinkage.
2. **Predictive validity.**
   - Team: first-half xG difference (or proxy) vs second-half goal difference, against
     first-half goal difference.
   - Player: np goals /90 → next season.
   - RAPM → next-season team goal difference.
3. **Convergent validity.**
   - Our xG vs `statsbomb_xg` and Understat xG.
   - Our team ratings vs Elo vs market-implied.
   - Our RAPM vs market value.
4. **Known-answer checks.**
   - A page of sanity examples: consensus elite players and teams near the top in their
     seasons.
   - Promoted teams start low.
   - Leicester 2015-16 shows up as the outlier that it was.
5. **Forecasts:** 6.5 metrics walk-forward, with calibration plots.
6. **Hypotheses register**, each kept even if null:

| # | Hypothesis | Data |
|---|---|---|
| H1 | Finishing skill persists | tier A; Understat research mirror |
| H2 | GK shot-stopping persists | SB seasons (PSxG); TM-era goals vs team xG proxy |
| H3 | New-manager bounce vs regression to the mean (matched controls: teams with equal form and no change) | TM managers 2012-26 |
| H4 | Home advantage over time; the 2020-21 empty-stadium drop | FD/TM + attendance |
| H5 | Set-piece prowess persists | tier A |
| H6 | Head-to-head history adds value | walk-forward ablation |
| H7 | Congestion and travel effects | TM schedule |
| H8 | Referee home bias | TM/FD cards by referee |
| H9 | "Momentum": goals soon after conceding | TM goal minutes |
| H10 | Value of possession share | tier A |
| H11 | Red-card effects by minute | 6.6 |
| H12 | Substitution timing | TM subs |

---

## 9. Data-quality tests (every build)

| Test | Source | Threshold (from the profile) |
|---|---|---|
| Goals in events = final score | TM, SB, WY | ≥ 99.5% of matches per league-season; every miss listed |
| Team minutes ≈ 11 × length | TM: = 990 exactly (capped); tier A: on-pitch seconds sum to 11 × match length minus red-card time, within 1% | |
| No duplicate events | all | 0 |
| xG in [0, 1] | ours, SB | 100% |
| Two lineups per match | TM (from 2013-14), SB, WY | 100% where lineups exist |
| Players on pitch reconcile with subs and reds | stints | 11 per side at every minute until a red card |
| Shot counts vs FD | SB/WY seasons vs FD HS/AS | per-team-match difference ≤ 3 in ≥ 90% of matches (providers count blocked shots differently) |
| Crosswalk QA | core | ambiguous ≤ 0.5% of rows; unmatched listed |
| Ratings mean 50, SD 10 | ratings | per (league-season, group), ± 0.5 |
| Coordinates in frame | all | 100% after clipping; clip count reported |

*Change, Nov 14 (Phase 1, QA):*

- **Shootouts.** TM's reported score includes penalty-shootout goals, so shootout matches
  are excluded from score checks. Their score after 90 / 120 minutes is the goal events.
- **Goal checks by club.** Goals are reconciled by club (own goals carry the benefiting
  club), not just in total.
- **Known issues.** Seven raw-source errors are listed in the committed
  `overrides/tm_known_issues.csv` and excluded from the checks, never silently merged:
  - two shootouts with no shootout events;
  - two matches whose score disagrees with the goal events;
  - three Primeira matches with no goal events.

  The two score disagreements stay unresolved until they're checked against
  football-data.co.uk.
- **Valid-stint threshold.** The share of matches with valid stints is checked at 0.98
  (not 0.99). Primeira 2012-13, 2016-17 and 2017-18 have events with unknown minutes in
  1-2% of matches.
- Overrides live in `overrides/` at the repo root (committed), not under the gitignored
  `data/` that [identity_plan.md](phase0/identity_plan.md) named.

**Current build:** 494 checks, 0 failures.

---

## 10. Out of scope for v1

- Anything needing tracking or 360 frames in production (rule 2). 360 and SkillCorner are
  for research notebooks only.
- Current-season player ratings, player stat-line forecasts and live pages (1.2).
- Injuries (no source).
- Wages: a user override CSV only, labelled.
- Weather: optional research, after Open-Meteo is approved as a source.
- Set-piece routine clustering and pressing-trap detection: v1.x waves, tier A only.
