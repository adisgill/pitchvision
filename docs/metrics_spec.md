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
| | *Change, Nov 14 (football-data.co.uk profiled): `HxG/AxG` exist only for 2026-27, so the shots and shots-on-target proxy is the team-xG input for 2012-13 → 2025-26. The current season's `HxG` is used live, and it is the check on how well the proxy tracks real team xG.* | | |
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

*Change, Nov 14 (Phase 1, tier-C ratings):*

- **The acceptance test checks the unclipped scale.** It is run on the unclipped
  `50 + 10·z` (stored as `<dim>_score` next to the clipped `<dim>_rating`), because
  clipping at 0 and 100 necessarily moves the mean and SD in skewed groups.
  - The share clipped is reported: 0.03-0.10% per tier-C dimension.
  - Result: mean and SD are exact (to 1e-13) in every league-season-group with ≥ 10
    qualified players.
- **No scoring or creation ratings for goalkeepers.** They aren't goalkeeper dimensions,
  and goalkeepers' near-all-zero goals and assists made the scale meaningless.
- **Metrics with no spread are blank, not 50.**

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

*Change, Nov 14 (Phase 1, tier-C ratings):*

- **Weights are provisional.** Tier-C dimension weights are equal until Phase 2 measures
  each component's out-of-sample validity `v_c`. Only Availability has more than one
  component (minutes share and starts share).
- **First reliability results**, split-half, pooled across positions, 2012-13 → 2025-26
  in the domestic leagues:

  | Metric | `k` (90s at which r = 0.5) | Minutes |
  |---|---|---|
  | Non-penalty goals per 90 | 7.2 | ≈ 650 |
  | Assists per 90 | 14.5 | ≈ 1,300 |
  | Cards per 90 | 29 | ≈ 2,600 |

- Pooling across positions inflates r (between-position differences count as "skill"),
  so Phase 2 re-estimates `k` within position group.

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

*Change, Nov 14 (Phase 1, Wyscout staging):* **this doesn't work, and it's dropped.** The
public Wyscout files chain positions: each event's start equals the previous pass's end
exactly. So there is no gap to infer a carry from. Over 3.1 M events the rule found 2,853
"gaps", all after duels or stoppages (mean 32 m), which are artifacts, not carries.

- Wyscout's own `Acceleration` events (≈ 27k) are the only carries, kept as `dribble`.
- For the 2017-18 Wyscout season, progressive carries, carry xT and carry-based
  final-third and box entries are **blank, not zero**. Progression there is built from
  passes and accelerations only, and the rating notes it.
- Goals scored direct from a corner carry the goal tag on the corner, so they are staged
  as direct set-piece shots.

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

*Change, Nov 15 (Phase 1, tier-A catalog and ratings built):* `metrics/players_a.py`,
`ratings/players_a.py`.

**Coverage**

- 133,224 player-matches and 7,600 player-seasons, carrying the catalog of 4.1-4.8.
- **Not built yet:** xGOT / PSxG and xPass (6.4); pass completion is raw for now.
- **xGChain / xGBuildup** wait for possession sequences on Wyscout.
- StatsBomb-only metrics are blank for Wyscout seasons: carries, recoveries, blocks,
  pressures, dribbled-past, fouls won, sweeper actions.

**Definitions**

- **xA links each non-penalty shot** to the shooting team's last completed pass within
  6 s with no opponent ball action between.
- The share of non-penalty xG assisted this way is 73% (StatsBomb) and 63% (Wyscout).
- **Raw counts aren't comparable across providers.** Wyscout records a pass's end where the
  receiver next played the ball, so it shows more progressive passes (6.6 vs 4.0 per 90)
  and logs every defending duel as a tackle. Ratings are always within league-season, so
  this doesn't leak into them.

**Position groups**

- Each player's group is the one with the most minutes over the season. A first version
  took the longest single match's position, a bug caught in the spot checks.
- StatsBomb slots are used as given: a right-back who played right centre-back in a back
  three is a CB in those matches (for example Simon Francis 2015-16). Roles (5.3) will
  separate wide centre-backs.
- **Wyscout's location rule finds few DMs** (71). Role clustering will refine this.

**Reliability, within position group** (split-half, weighted median across 33-54
provider-competition-position groups; the 90s at which r = 0.5):

| Metric | k (90s) |
|---|---|
| Progressive carries | 2.4 |
| Progressive passes | 2.9 |
| Pressures | 2.9 |
| Final-third entries | 3.5 |
| xT | 4.7 |
| Box entries | 5.1 |
| Turnovers | 5.4 |
| Tackles + interceptions (possession-adjusted) | 6.2 |
| npxG | 9.4 |
| Key passes | 9.9 |
| xA | 11.0 |
| Through balls | 14.0 |
| **Finishing (goals − xG)** | **54** (≈ 4,900 minutes) |
| **Goalkeeper goals prevented** | **57** (≈ 5,100 minutes) |
| **Defensive VAEP** | **64** (≈ 5,800 minutes) |

- **Pooled across positions, the volume metrics looked near-perfectly reliable** (r ≈ 0.9
  after four matches): role, not skill. Hence the within-group estimate.
- **Finishing, goalkeeper shot-stopping and defensive VAEP are mostly noise over a
  season.** They're shrunk accordingly; this is the first evidence for H1 and H2.
- **Success rates** are shrunk with a fixed 30-attempt prior until Phase 2 measures them.
- **Dimension weights** are equal (provisional, D10).

**Results and checks**

- 5,639 rated player-seasons. Mean 50 and SD 10 are exact per league-season-group for
  every dimension.
- **Known-answer check:**
  - PL 2015-16 creation: Fàbregas, Cazorla, Firmino, Özil in the top five;
  - La Liga 2015-16 progression: Mascherano, Marcelo, Banega, Messi, Dani Alves;
  - PL 2017-18 defending among centre-backs: Koscielny, Maguire, Vertonghen.

### 5.3 Roles (tier A)

- **Features:** per-90 action shares by 6 × 4 pitch zones and action type (touches,
  passes, carries, shots, defensive actions), standardised within position group.
- **Model:** Gaussian mixture per position group, with K chosen by BIC (2-4 per group).
- **Labels** are assigned by hand from cluster centroids: ball-playing CB, inverted
  full-back, deep-lying playmaker, box-to-box, inside forward, target forward, and so on.
- The UI shows the role and its posterior probability.
- **Tier C role** = position group only.

*Change, Nov 15 (Phase 1, roles built):* `ratings/roles.py`.

**Method**

- **Features:** the share of on-ball actions in 6 length × 3 width bands (left and right
  folded), the action mix and volume rates.
- **Fitted per provider and position group** (features differ: no carries or pressures on
  Wyscout), 2-4 diagonal-covariance mixture components by BIC.
- **Names:** templates scored against each centroid. Clusters with the same name are split
  "deep" / "advanced" by where their actions sit. The centroid's highest and lowest traits
  are stored in `ratings.role_clusters` to audit each name.

**Results**

- 5,603 player-seasons (99%) have a role.
- **Known-answer check:**
  - Messi: inside forward;
  - Mascherano and Piqué: ball-playing CB;
  - Giroud: target forward;
  - Busquets and Kroos: deep-lying playmaker;
  - Casemiro: ball-winning midfielder.

**Limits**

- **Kanté (Wyscout 2017-18) lands in "playmaker"**: without pressure data, his passing
  volume dominates.
- **Posterior probabilities are overconfident** (mean 0.97) because of the diagonal
  mixture. Treat them as an ordering, not a calibrated probability.
- Roles exist only for tier-A seasons.

### 5.4 Similarity

*Change, Nov 15 (Phase 1, built):*

- **Within provider and position group, across seasons.** Other seasons of the same player
  are excluded.
- Top 10 per player-season, 56,470 rows.
- **Known-answer check:** Messi 2015-16's nearest are Alexis Sánchez, Coutinho, Neymar,
  Mertens and Hazard.

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

*Change, Nov 15 (Phase 1, goal-RAPM built):* `ratings/rapm.py`.

**Data and fitting**

- 243,984 valid stints (domestic leagues plus CL / EL / UECL), 19,774 players, and a
  home-advantage term per competition-season.
- Solved by conjugate gradient without forming X'WX: 0.7 s per fit.
- The prior is a minutes-weighted regression of the no-prior RAPM on non-penalty goals per
  90, assists per 90, minutes share, log market value and position group. It is fitted on
  earlier seasons only.
- **The tuning grid was widened** to ridge 30-1000 after the first run chose the top of a
  10-100 grid.
- Chosen on 2015-2019: decay 0.75 per season, ridge 300.
- 2013-14 are warm-up seasons (the prior has no history yet) and are left out of the
  evaluation. A first run had wrongly counted them as test seasons.

**Validation: next-season team goal difference per 90** from the players each team actually
fielded, test seasons 2020-21 → 2024-25 (5 seasons, about 600 team-seasons):

| Variant | r | RMSE |
|---|---|---|
| **RAPM + prior (chosen settings)** | **0.818** | **0.455** |
| Prior alone, same settings | 0.812 | 0.580 |
| Prior alone, best setting | 0.817 | 0.463 |
| RAPM without prior, best setting | 0.802 | 0.461 |
| Raw on/off | 0.736 | 0.501 |

**The honest reading**

- Adjusted plus-minus with the prior is clearly better than raw on/off (+0.08 r).
- **Almost all of that gain is the prior.** The box score plus market value (D13) carry the
  signal, and the on-pitch adjustment adds +0.001 to +0.006 r.
- **Soccer lineups are this collinear:** a regular shares a median 94-96% of his minutes
  with his most frequent teammate (usually the goalkeeper or a centre-back).
- **The data share is small:** the share of a regular's rating coming from his own minutes
  is a median 0.17 (max 0.36). This is an upper bound of exposure / (exposure + λ);
  collinearity lowers it further.
- Every rating carries `data_weight`. `prior_dominated` (data weight < 0.5) is true for
  nearly every player, and **the app must say so** next to any RAPM number.
- The spec's `max_overlap > 0.85` rule would have flagged 92% of players; it's replaced by
  the data-weight rule, and overlap is reported only.

**Known-answer check (2024-25 top, ≥ 40 decayed 90s):** Hakimi, Grimaldo, Rodri,
Marquinhos, Ederson, Kane, Salah, Dembélé, Rúben Dias, Lewandowski, Mbappé, Kimmich,
De Bruyne.

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

*Change, Nov 15 (Phase 1, league strength and age curves built):*

**League strength** (`ratings/league.py`)

- **European results.** Per-season offsets in goals per match against the Premier League,
  with 80% bootstrap bands (typically ±0.35 a season). Means for 2012-2025:

  | League | Offset |
  |---|---|
  | La Liga | −0.04 |
  | Bundesliga | −0.16 |
  | Serie A | −0.29 |
  | Ligue 1 | −0.49 |
  | Primeira | −0.98 |
  | Eredivisie | −1.30 |

- **Translation factors** (attacking movers, age-adjusted log non-penalty goals per 90, 990
  movers): moving into a league multiplies scoring by

  | League | Multiplier (80% band) |
  |---|---|
  | Serie A | 1.17 (1.09-1.26) |
  | La Liga | 1.22 |
  | Bundesliga | 1.27 |
  | Ligue 1 | 1.38 |
  | Primeira | 1.77 |
  | Eredivisie | 1.93 (1.80-2.12) |

- **The two methods agree on the order** (r 0.96).
- **UEFA-style coefficient.** Points per club with no bonus points, a labelled
  approximation. It ranks 2024-25 as England, Italy, Spain, Germany, Portugal,
  Netherlands, France. France sits lower than in UEFA's official table, where bonus points
  matter for associations with few clubs.
- The adjusted rating of 5.6 (`rating_adj`) waits for the app phase. The factors are in
  `ratings.league_translation`.

**Age curves** (`ratings/aging.py`) use **fixed effects, not the delta method.**

- The delta method put every peak at 17-21. A player is a regular in season one partly
  because it went well, so the average change was negative at every age, and two
  survivor-correction attempts (league leavers as dropouts, then minutes weights) didn't
  fix it.
- The minutes-weighted regression has player and league-season fixed effects.
- **Dropouts** (seen in none of the mirror's 70 competitions the next season) get one
  imputed season at the 20th percentile; the 10th and 30th change the peaks by ≤ 1 year in
  almost all groups.
- A unit test checks the method recovers a known peak under the selection that broke the
  delta method.

| Metric | Peak (80% band) |
|---|---|
| Impact | CB 27 (26-27), DM 27 (25-27), ST 27 (25-28), FB 26, W 25, AM 24, CM 24, GK 29 (25-29) |
| Minutes share | 23-24 outfield, GK 26 |
| Non-penalty goals per 90 | ST 27 (18-27), W 24, FB 24, CM 24 |

- For goals per 90, **AM and DM aren't identified** (bands 17-29) and aren't used for
  projections.
- Projections for the latest season's players, 1-3 years ahead with 80% bands, are in
  `ratings.age_projection`.

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

*Change, Nov 14 (Phase 1, xG built):* results and the changes they forced.
`metrics.xg_eval` holds every number below; out of fold means leave-one-season-out over
18 provider-league-seasons.

- **Training data.** 116,003 non-penalty shots (SB 73,501; WY 42,502) plus 1,305
  penalties (conversion 0.749).
- **Feature derivation.** Situation and assist type come from the action sequence the same
  way for both providers, ignoring carries (spec 4.3).
- **The models, out of fold:**

  | Model | Log loss | Brier | AUC | xG vs goals |
  |---|---|---|---|---|
  | Base rate | 0.3284 | 0.0912 | – | – |
  | Spline logistic | 0.2753 | 0.0786 | 0.782 | 11,769 vs 11,773 |
  | **Monotone GBM (chosen)** | **0.2736** | **0.0782** | **0.787** | 11,780 vs 11,773 |

  The GBM's calibration slope is 0.98.
- **Against StatsBomb's own xG** on the StatsBomb seasons: ours scores 0.2709 log loss and
  0.788 AUC; `statsbomb_xg` scores 0.2607 and 0.808. **We trail it**, as expected:
  StatsBomb's model uses freeze frames (goalkeeper and defender positions), which rule 2
  keeps out of production. The gap is reported, not hidden.
- **Two features added** to the spec's list:
  - `provider`: Wyscout seasons converted about 10% above a provider-blind model, a
    measurement difference in how shots are recorded;
  - `women`: a real difference in conversion.

  Together they cut the mean per-season |xG/goals − 1| from 9.6% to 4.9%, and log loss from
  0.2748 to 0.2736.
- **Remaining per-season miss:** −12% (Liga F 2023-24) to +20% (NWSL 2023). Recalibration
  per league-season is a Phase 2 item.
- **The pressure flag is worth almost nothing.** On a StatsBomb-only fit, log loss goes
  from 0.2709 to 0.2707, so the SB-only variant isn't used.
- **Threads.** Fits run with OpenMP capped at 4 threads (`threadpoolctl`, already
  installed as a scikit-learn dependency). With all cores busy, uncapped threads
  spin-waited and a 10-minute fit didn't finish in 48 minutes.
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

*Change, Nov 14 (Phase 1, xT built):*

- **Fit.** 6,224,195 open-play passes, crosses and carries and 111,011 open-play shots,
  using our xG as G. Value iteration converges in 38-52 iterations.
- **Surface.** It runs from ≈ 0.003 deep in a team's own half to 0.34 in the central
  cells on the six-yard line.
- **Subsets.** The surfaces fitted on StatsBomb men's, Wyscout men's and StatsBomb women's
  data correlate 0.997-0.9997 with the pooled one, so **actions are credited with the
  pooled surface**.
  - Wyscout's surface peaks higher (0.44 against 0.31) because its moves have no carries.
- **Take-ons are not moves.** They have no end location in either provider.
- **Mean xT added per successful action:** crosses 0.096, passes 0.0018, carries 0.0011.
  xT rewards completed crosses into the box heavily (a known property of the model), so
  wide crossers rank high on total xT. The split by action type is always shown.
- **Known-answer check.** The top xT per 90 (≥ 900 minutes) is Neymar and Messi in La Liga
  2015-16, Özil and Alexis Sánchez in the PL 2015-16, and Fàbregas and De Bruyne in the
  PL 2017-18 (passes and crosses only, since Wyscout has no carries).

*Change, Nov 14 (Phase 1, tier-A minutes):*

- **StatsBomb minutes are real on-pitch time**: the union of each player's lineup spells
  on a linear match timeline. Some extra-time matches have spells that overlap or run
  backwards; overlaps count once and backward spells are dropped.
- **Result:** team-match minutes average exactly 11 × real match length, and 98.9% of
  team-matches are within 2%.
- **Wyscout minutes are nominal** (0-90 from starts and substitutions). Its red cards are
  foul-event tags that staging doesn't keep, so a sent-off player is counted to 90; this
  is a known limitation, to fix in Phase 2.

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

*Change, Nov 14-15 (Phase 1, VAEP built):*

**Data and fitting**

- 9,502,908 ball actions with own implementation of the features (`models/vaep.py`).
- Labels use a 10-action window within a period; own goals count for the other team.
- Two `HistGradientBoostingClassifier` models, fitted in 5 folds that hold out whole
  provider-league-seasons (18 groups). Every action's probability is **out of fold**, and
  those are the production values.
  - The spec said leave-one-season-out. Five grouped folds cut the fits from 36 to 10, at
    about 5 minutes each, and every action is still valued by a model that never saw its
    season.
- Fits run with OpenMP capped at 4 threads, as for xG.

**Results**

| Label | AUC | Log loss | Base rate | Predicted vs actual |
|---|---|---|---|---|
| Scores within 10 actions | 0.838 | 0.0443 | 0.0583 | 99,868 vs 99,726 |
| Concedes within 10 actions | 0.854 | 0.0181 | 0.0225 | 31,950 vs 31,940 |

- Per-season calibration of the scoring label is within ±12% (worst NWSL 2023, +12%),
  reported by a non-blocking QA check.

**Mean value per action**

| Action | VAEP |
|---|---|
| Completed pass | +0.0035 |
| Failed pass | −0.0061 |
| Recovery | +0.010 |
| Successful take-on | +0.012 |
| Completed cross | +0.070 |
| Missed shot | −0.058 |
| Foul | −0.014 |

**Two properties to keep in view**

1. **Goal kicks earn defensive value** (≈ +0.014) because the danger left from the
   opponent's missed shot ends there. This is standard in VAEP.
   - It inflates goal-kick takers' defensive VAEP, so goalkeepers' VAEP is reported apart
     from outfield players' (`vaep_keeper_p90`, and goal kicks in the passing family).
2. **A shot's value includes whether it went in**, so raw offensive VAEP contains finishing
   luck.
   - Example: Bale tops La Liga 2015-16 at 0.95 per 90, 0.60 of it from shots.
   - The rating uses a shot-value-replaced-by-xG variant (VAEP with each shot's outcome
     swapped for its xG), to be built in Phase 2 alongside the Finishing dimension.

**Reliability** (split-half, odd vs even matches, ≥ 450 minutes per half; quartiles of
minutes per half)

| VAEP per 90 | r by quartile |
|---|---|
| Total | 0.19, 0.37, 0.34, 0.48 |
| Offensive | 0.17, 0.35, 0.31, 0.50 |
| Defensive | 0.43, 0.49, 0.59, 0.78 |

- **Defensive r is inflated by position.** Goalkeepers (the goal-kick effect) and
  defenders versus forwards differ systematically, so Phase 2 re-estimates it within
  position group before any weight is set.

**Known-answer check**

The top VAEP per 90 (≥ 900 minutes) is:

- Payet, Mahrez and De Bruyne in the PL 2015-16;
- Bale, Messi and James Rodríguez in La Liga 2015-16;
- Coutinho, Martial, De Bruyne and Salah in the PL 2017-18;
- Lauren James, Khadija Shaw and Höbinger in the WSL 2023-24.

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

*Change, Nov 15 (Phase 1, team models and walk-forward built):*

**Data**

- `core.team_matches` holds 48,543 league matches (8 European leagues plus MLS,
  2012-13 → 8 Nov 2026), all with canonical clubs.
- Played and official scores are kept apart.
- Kickoffs are converted from football-data.co.uk's UK time to UTC from 2019-20, and
  stored as plain UTC timestamps (a time-zone-aware type would have needed a new
  dependency).
- The closing line follows D15 and is present for ≥ 99.8% of matches.

**Proxy xG** (Poisson on shots on target and off target, earlier seasons only) **is weak.**
Against the real team xG available for 2026-27, it correlates 0.43-0.75 per team-match and
0.62 for the xG difference.

**Walk-forward, every match predicted weekly from earlier matches only**

- 31,997 matches, 2017-18 → 2026-27.
- Half-life (90 / 180 / 365 days) and the goals/xG blend were tuned on 2017-18 to 2020-21
  (chosen: 365 days, 75% goals).
- A test checks that changing a later result can't move an earlier prediction.

**Test seasons, 2021-22 onward, 18,668 matches** (all models scored on the same matches):

| Model | RPS | Log loss |
|---|---|---|
| Base rates | 0.2294 | 1.072 |
| Dixon-Coles, proxy xG | 0.2091 | 1.014 |
| Dixon-Coles, goals | 0.2052 | 1.001 |
| Dixon-Coles, blend | 0.2050 | 1.001 |
| **Elo** | **0.2047** | **1.000** |
| **Closing line** | **0.1983** | **0.979** |

**Conclusions**

- **We trail the market by ≈ 0.0065 RPS** in every league. The gap is smallest in the
  Championship (0.0054) and largest in the PL, Eredivisie and Primeira (≈ 0.0070).
- The proxy-xG blend is worth ≈ 0.0002 RPS. **Proxy xG on its own is worse than goals.**
- **Elo matches Dixon-Coles.** On these inputs, neither has an edge.
- **Promoted clubs** are pulled toward last season's relegated clubs all season
  (`walkforward.fit_league`). The change was measured and moved test RPS by < 0.0001.
- The rest/congestion, travel and manager adjustments of the spec are still to be tested
  (Phase 2 ablations). Lineup adjustments are historical-only per D18.

**Team ratings** (`ratings.team_season`)

- Three systems per league-season, at season end and as of the latest data.
- Dixon-Coles and the market agree closely (r 0.85-0.97 by league).
- Disagreements are informative:
  - **Leicester 2015-16 at season end:** Elo 1st, Dixon-Coles +0.64 goals per match, the
    market +0.04.
  - **Promoted Hull, 2026-27 so far** (P10, goal difference 0): Dixon-Coles ≈ 0, the market
    −0.68.

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

*Change, Nov 15 (Phase 1, market value built):* `ratings/market.py`.

- **Features differ from the list above.** Contract length and caps are left out: the
  mirror has them only as a 2026 snapshot, so they'd leak the future into earlier seasons.
  The previous valuation is left out by design. Club strength (Dixon-Coles) is added.
- **Every value is out of fold**, grouped by player.
- **Results** (40,019 player-seasons):
  - R² on log value 0.88;
  - median absolute error 30%;
  - the raw 10th-90th band held 75% and was widened by conformalised quantile regression
    to 80% (79-81% in every season). The overall figure is calibrated by construction; the
    per-season figures are the check.
- **The model compresses the top end.** The largest "market above model" gaps are stars and
  goalkeepers: Kane 60M vs 12M model, Álvarez 100M vs 28M, Oblak. It has no reputation,
  international or event-data features, and a strong age effect.
- The largest "model above market" gaps are mostly older Eredivisie players and back-up
  goalkeepers.
- **Read gaps as the market's premium over a player's league numbers, not as mispricing.**

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

*Change, Nov 15 (Phase 1, simulator built):* `forecast/season.py`.

**Rules file**

- `rules/leagues.toml` lives at the repo root (committed), not `data/rules/`. It records
  tiebreak order, per-season club counts (Ligue 1 20 → 18 from 2023-24, Primeira 16 → 18
  from 2014-15), zones counted from the bottom for relegation, and a `verified` level per
  league.
- **No league is "official" yet.** These are "secondary" (press and reference sources,
  official texts not yet read):
  - Ligue 1's 2025-26 switch to goal difference before head-to-head;
  - Serie A's play-off for a tie at 1st or at the last relegation place;
  - head-to-head first in La Liga, Serie A and Primeira.
- The Championship is "assumed".
- MLS isn't simulated (unbalanced schedule; needs a fixture list, Phase 4).
- **Not modelled:** points deductions, and European places that depend on cup winners
  ("europe" is approximate).

**Method**

- Remaining fixtures are the unplayed ordered pairs.
- **Uncertainty comes from Laplace posterior draws** (the walk-forward's chosen model plus
  its inverse-Hessian covariance, prior included), with a shared draw for the goals and xG
  fits. 10,000 runs per league.
  - A bootstrap of matches was tried first and dropped: a promoted club's strength swung
    from −0.7 to +0.65 with ~10 matches.
- Tables use official results, with head-to-head mini-leagues computed per run.
- The current season's odds are appended to `forecast.season_sim_history` on every build.

**Backtest** (every complete season 2017-18 → 2025-26 from its halfway date; abandoned
2019-20 seasons skipped; 2,756 club-seasons)

| Zone | Brier, model | Brier, equal strength | Skill |
|---|---|---|---|
| Title | 0.0157 | 0.0196 | +20% |
| Top four | 0.0344 | 0.0427 | +19% |
| "Europe" | 0.0624 | 0.0718 | +13% |
| Relegation | 0.0558 | 0.0605 | +8% |
| Relegation play-off place | 0.0480 | 0.0481 | ±0% |

- By league-zone, three of the 37 cells are slightly negative (Primeira title −10%,
  Ligue 1 top four −3%, Serie A title −1%), from nine seasons each.
- **Calibration** (title, top four and relegation pooled) is good but **slightly
  underconfident at the edges**:

  | Forecast band | Happened |
  |---|---|
  | 0.01-0.05 | 1.1% |
  | 0.15-0.30 | 18.6% |
  | 0.50-0.70 | 66% |
  | 0.85-0.95 | 95% |

  The posterior tails are a little wide (promoted clubs especially). Tightening the prior
  is a Phase 2 item.
- **Current season** (as of 8 Nov 2026): for example, Arsenal 72% for the title, Bayern
  90%, Paris SG 81%, Barcelona 71%, Inter 58%, PSV 64%, Porto 57%.

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

---

## 11. Phase 1 additions, Nov 15 (win probability, team style, referees)

*Change, Nov 15:* built ahead of the app, all in the build and its QA.

**Win probability by game state** (`forecast/winprob.py`, spec 6.6). Fitted on the minutes
of 2017-18 → 2020-21 (domestic leagues plus the Championship); checked on 2021-22 onward.

- **Accuracy by match phase:**

  | Minutes | Log loss, in play | Log loss, pre-match only |
  |---|---|---|
  | 0-14 | 0.96 | 0.98 |
  | 75-89 | 0.48 | 0.98 |

  The mean home-win probability is within 0.006 of the actual rate in every 15-minute bucket.
- **Rate multipliers:**
  - leading by one: 0.93;
  - final 15 minutes: 1.35;
  - **red cards:** a side down to ten scores at 0.58× its rate and the opponent at 1.69×.
- **H11 (red-card effect by minute):** a red card costs the side 0.94 expected points at
  kick-off, 0.78 at 30 minutes, 0.54 at 60 and 0.26 at 80 (level score, average rates).
- **Timelines** for 30k matches (1.94 M minutes) are in `forecast.wp_timelines`.

**Team style, deserved results and the xPoints table** (`metrics/teams.py`, spec 4.9-4.10)

- Style metrics for every team-season on the event seasons.
- Deserved P(W/D/L) from shots for 4,745 event-season matches.
- The **xPoints table for every league-season**: real team xG for 2026-27, the shots proxy
  before.
- **Leicester 2015-16 finished 26 points above its xPoints**, the largest gap in that
  season.
- Two league-seasons miss the 3% xPoints-vs-points check (non-blocking): the proxy's
  calibration varies by season.

**Referees** (`metrics/referees.py`, spec 4.11). Reliability, in matches to r = 0.5:

| Tendency | k (matches) | Reading |
|---|---|---|
| Yellow cards | 5 | a real tendency |
| Fouls | 2.4 | a real tendency |
| Red cards | 36 | weak |
| Penalties (scored) | 225 | essentially noise |
| Home bias (yellows) | 130 | essentially noise at any realistic sample |

- Every rate is shrunk to its league-season mean with these `k`. **H8 (referee home bias)
  is a null result**: a bias exists on average, but it can't be told apart referee by
  referee.

**Parked for after the app launch** (the user's priority, Nov 15):

- xPass and post-shot xG (6.4, 6.1);
- the player-projection backtest (7.3);
- xG-based plus-minus (5.5).

## 12. Additions, Nov 15 (pitch value maps, hidden matchup factors, daily refresh)

*Change, Nov 15 (asked for: "value every part of the pitch that affects a matchup" and "find
metric impacts almost no one sees"):* two new outputs and a daily operating mode.

### 12.1 Pitch value maps (`metrics/zones.py`)

- **Grid:** 12 x 8 zones of 8.75 m x 8.5 m on the 105 x 68 frame. Every on-ball event of
  the event-data seasons goes in the zone it starts in; receptions go in the zone a
  completed pass ends in. Everything is from the acting team's view, attacking left to
  right.
- **Measures:** touches, passes and completions, receptions, xT added, VAEP offensive and
  defensive, shots, xG and goals by shot origin, defensive actions, pressures, turnovers.
- **Team maps** come in two sides: `for` (the team's own actions) and `against` (its
  opponents' actions in the same matches, mirrored into the team's view). So "where A
  creates" and "where B concedes" line up zone by zone. The app's matchup view computes
  `(A_for / league_for) x (B_against / league_against) - 1` per zone.
- **Player maps:** the same measures for each player-season (receptions excluded, since
  the receiver isn't recorded).
- **Checks:** for and against totals are equal by construction. Zone xG sums to 12,754
  against 12,751 goals. xG per shot rises toward goal (0.20 in the last column).
- **Licence:** StatsBomb-derived values are published only as per-zone sums per
  player-season or team-season. These are aggregates (D20).

### 12.2 Hidden matchup factors (`research/matchup_factors.py`)

- **Sample:** every domestic match in the seven player leagues with a Transfermarkt
  record, a walk-forward forecast and closing odds, 2017-18 onward: **21,538 matches**.
- **Outcome:** the home-minus-away points margin, as a residual against two baselines:
  - our model (the chosen Dixon-Coles blend);
  - the de-vigged closing line.
- **Factors (26):** each is computed only from what is known before kickoff, or at line-up
  time where flagged. They cover:
  - schedule and fatigue: rest, congestion, European matches before and after, midweek,
    early kickoffs;
  - selection: rotation, regulars missing, a red card in the previous match;
  - coaching: the new-manager window, tenure;
  - luck and regression: finishing luck, conceding luck, results against market
    expectation, form;
  - style: shot and corner dominance, back three, mirrored shapes;
  - officials and venue: the referee's prior home lean, aggression x strict referee, empty
    stadiums, crowd fill;
  - motivation: newly promoted, dead rubbers;
  - the market: opening-to-closing movement.
- **Test:** OLS slope with HC1 errors per SD (per unit for 0/1 factors). The discovery
  seasons are 2017-18 to 2021-22, with Benjamini-Hochberg q < 0.10. The holdout is 2022-23
  onward, and needs the same sign at p < 0.10. We also report how far the closing line
  moves with each factor beyond our model.
- **Result: no factor beats the closing line.**
  - **Real and priced in, missing from our model:** recent shot dominance (+0.22 points
    per SD beyond the model), corner dominance (+0.20), regulars not starting (-0.09), form
    (+0.10), rotation (-0.05) and congestion (+0.07). These are the candidates for a richer
    forecast model (a Phase 2 item: adding them changes the forecast, so it needs its own
    walk-forward test).
  - **Empty stadiums:** home advantage fell by 0.21 points. It is real, but there are no
    holdout cases.
  - **Did not replicate:** results against market expectation (the over-reaction test),
    finishing luck, rest days, back three, dead rubbers, crowd fill.
  - **No detectable effect:** the new-manager bounce, the referee's home lean, the previous
    red card, European matches, mirrored formations, early kickoffs, midweek, promoted
    sides, tenure, conceding luck, aggression x strict referee.

### 12.3 Daily operations

- `pitchvision build --daily` re-runs only what new results change: football-data
  staging, the crosswalk, team matches, the walk-forward, team ratings, the simulator, win
  probability, referees and xPoints. Transfermarkt is frozen, and the event-data models
  cover static seasons.
- `scripts/daily.ps1` runs the fetch (current season only), the daily build and
  `demo --publish`. Each step stops the run on failure.
- Demo exports are written in sorted order, so a table whose data hasn't changed keeps the
  same bytes, the same content-hashed name and the same version.
- The football-data season is now derived from the date (it turns over on 1 July) rather
  than hard-coded.

### 12.4 Current-season data from FotMob

*Change, Nov 15 (asked for: "we need data for recency heavily"):* the user approved
scraping WhoScored, FotMob and SofaScore.

- **What we can use:**
  - **FotMob:** we use its public league and match pages. robots.txt allows the HTML pages
    and disallows `/api/*`, which we never call. Requests go every 3 s under an honest user
    agent.
  - **WhoScored** answers a plain request with a CAPTCHA challenge, and **SofaScore**
    blocks automated clients even on robots.txt. Getting past either would mean defeating
    bot protection, which we don't do. Neither is used.
- **Coverage:** all nine leagues, 2024-25 onward, fetched newest season first. League
  pages carry each season's full schedule, including upcoming matches. Match pages carry:
  - shots with x/y, xG and xGOT;
  - line-ups with layout positions;
  - about 60 per-player stats (Opta-based, including distance, sprints and top speed);
  - about 46 team stats;
  - a goal, card and substitution timeline;
  - the stadium with coordinates.
- **Linking** (`core/fm_crosswalk.py`):
  - Clubs: one-to-one optimal assignment on normalised names per league-season. The first
    two leagues linked all 40 clubs at score 100.
  - Matches: same league and clubs within 2 days. Every finished match linked.
  - Players: same club, name and birth year, then any recent Transfermarkt player with
    the same name and birth year, if unique. That covers summer 2026 transfers after the
    freeze. 89% linked; the rest keep `fm-<id>`.
- **Metrics** (`metrics/fotmob.py`):
  - **Player-seasons:** per-90 measures and seven dimension ratings on the house scale
    (shooting, creation, progression, security, defending, duels, physical, plus
    goalkeeping), shrunk at k = 450 minutes. Position groups come from the line-up layout.
  - **Shot zone maps:** 12 x 8, for and against, team and player.
  - **Team match stats**, keyed to our match ids.
  - **The schedule**, with our club ids.
- **Licence:** we publish only aggregates: player-season and team-match stats, zone sums
  and the fixture list. Raw pages, per-shot rows and per-event coordinates stay local.

### 12.5 What wins: in-match drivers and skill vs luck (`research/what_wins.py`)

*Change, Nov 16 (asked for: "find answers and correlations with this data"):*

- **Sample:** 8,290 FotMob-era league matches (2024-25 onward, nine leagues), each seen from
  both teams' sides.
- **Drivers** (descriptive): points beyond the closing line's expectation against each
  stat's in-match difference. The results are shaped by game state: possession, passes and
  crosses come out negative and clearances positive, because leading teams sit deeper. The
  joint model uses five non-collinear stats; the shot stats are too collinear to separate.
- **Skill vs luck:** split-half reliability (Spearman-Brown) and first-half → second-half
  predictive r, over 401 team-seasons.
  - Touches in the opposition box (predictive r 0.67, reliability 0.87) predict as well as
    xG difference (0.67, 0.81) and goal difference (0.67).
  - Points predict slightly less well (0.65).
  - Opposition-half passes and possession are the most stable traits (0.93).
  - Defensive volume (tackles, interceptions, clearances, blocks, saves) predicts fewer
    future points (r -0.30 to -0.56).
  - Set-piece xG has reliability 0.53 within a season.

### 12.6 Recent-era factors: travel, weather, absences (`research/fm_factors.py`)

- **New FotMob fields:**
  - pre-match unavailability lists: 21.7k records (injury, suspension, international duty)
    with market values, on 59% of team-matches;
  - weather at kickoff, from 2025-26 only;
  - stadium coordinates, which give away travel distance.
- **Test:** the same method as 12.2. Discovery is 2024-25; the holdout is 2025-26 onward.
- **Result:** nothing beats the closing line. Injuries are priced by the market (-0.076
  points per SD of injured value share) but not by our model, which is a forecast-upgrade
  item.
- **Candidate, unreplicated:** rain adds goals beyond the market's over/under 2.5 line
  (+6.7 pp, ±5.1, q = 0.039, n = 3,776, single season). It's re-tested as data accrues.

### 12.7 Forecast upgrade and the ledger (`forecast/upgrade.py`, `forecast/upcoming.py`)

*Change, Nov 16 (asked for: "upgrade model"):*

- **Model:** a Poisson adjustment on top of the chosen Dixon-Coles rates (offsets),
  `log l' = log l + c + b·z` (home) and `- b·z` (away), with one shared coefficient per
  standardised home-minus-away signal and a ridge penalty of 2. It is fitted walk-forward
  by season.
- **Core test** (11,968 matches, 2021-22 to 2025-26), RPS (lower is better):

| Model | RPS | Paired t vs current |
|---|---|---|
| Current | 0.19790 | |
| Elo | 0.19769 | |
| Upgraded, days ahead | 0.19658 | -6.4 |
| Upgraded, at line-ups | 0.19640 | -6.7 |
| Closing line | 0.19109 | |

  - "Days ahead" adds congestion, European matches either side, last-5 points, and shot
    and corner dominance.
  - "At line-ups" adds rotation and missing regulars.
  - Both are better in every test season and every league, and close 19-22% of the gap
    to the market.
- **FotMob era** (trained on 2024-25, tested on 2025-26 onward, 4,852 matches): adding
  FotMob xG form and injured value share improves RPS from 0.20761 to 0.20683 (paired
  t -2.5). The production set (computable before a fixture after the Transfermarkt freeze:
  last-5 points, shot and corner dominance, xG form, injured share) scores the same.
- **Shipped:** upcoming fixtures use the production set (`forecast.upcoming`). The app's
  upcoming lists show it; the predictor stays plain Dixon-Coles plus the user's sliders.
- **Ledger (spec 7.4):** `pitchvision ledger` (a daily step) appends each upcoming
  fixture's forecast once per UTC day before kickoff to `data/ledger/predictions.csv`.
  Rows are never rewritten. Matches are graded on the last forecast before kickoff and
  published on the Accuracy page. The first rows were logged on 2026-11-16.
