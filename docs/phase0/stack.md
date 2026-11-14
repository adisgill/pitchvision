# Stack proposal, dependencies, name check

*Phase 0 draft, 2026-11-14. Nothing here is installed yet: every line needs your OK (rule 6).*

## Machine as found

| Tool | Version | Note |
|---|---|---|
| uv | 0.12.1 | fine |
| Python | 3.12.13 (uv-managed) | same as courtvision; 3.14 also present, not proposed (wheel coverage for DuckDB-adjacent libs is thinner) |
| Node | 20.14.0 | **Node 20 reached end of life in April 2026.** Option B needs Node 22 or 24 LTS: your install, your call |
| pnpm / npm | 8.3.1 / 10.8.2 | pnpm 8 is old; npm is enough |
| git, gh | present, gh signed in as `adisgill` | repo-local identity set to your noreply address |

## Pipeline (Python)

Same shape as courtvision: `src/pitchvision/`, a Typer CLI, DuckDB views over Parquet, raw
caches with manifests under `data/raw/` (gitignored).

### Runtime dependencies (proposed)

| Package | Why | Courtvision has it? |
|---|---|---|
| `duckdb` | storage, all SQL transforms, Parquet I/O | yes |
| `pyarrow` | Parquet read/write, DuckDB ↔ dataframe handoff, the published app data | yes |
| `pandas` | modeling glue (sklearn, scipy take arrays/frames); DuckDB `.df()` | yes |
| `numpy` | (comes with pandas; listed because we use it directly) | yes |
| `scipy` | Poisson / negative binomial distributions, Dixon-Coles likelihood optimisation, sparse ridge for RAPM | indirect |
| `scikit-learn` | logistic regression and `HistGradientBoostingClassifier` (supports **monotone constraints**, so no LightGBM/XGBoost needed), ridge CV, GMM/k-means for roles, calibration curves | no |
| `typer` | CLI | yes |
| `httpx` | rate-limited fetching with timeouts and retries (one client, used only by `ingest --fetch`) | no (courtvision used `requests` via nba_api) |
| `python-dotenv` | read API keys from the gitignored `.env` | yes |
| `kaggle` | download the Transfermarkt mirror (if approved as a source) | yes |
| `rapidfuzz` | token-sort similarity for the identity crosswalk (accent folding uses the stdlib `unicodedata`) | no |
| `tzdata` | **Windows has no IANA time-zone database**; `zoneinfo` needs this to convert stadium-local kickoffs to UTC correctly across European/US DST gaps | no |

Dropped versus courtvision: `polars` (one dataframe library is enough), `streamlit`,
`plotly` (only if you pick app option A), `nba_api`, `six`.

### Optional, each needs a separate OK (decision D-list in the spec)

| Package | Why we might want it | Why we might not |
|---|---|---|
| `kloppy` | reads StatsBomb, Wyscout, Metrica, SkillCorner into one model and coordinate frame | we only need two event providers; hand-written transforms are ~150 lines and unit-tested on landmarks either way |
| `socceraction` | reference VAEP / xT implementation (KU Leuven) | pins older pandas in past releases; check its status before relying on it; we can implement VAEP features ourselves and use it only to cross-check |
| `mplsoccer` | pitch plots in research notebooks | notebooks only, never the app |

### Dev dependencies

`pytest`, `ruff`, `mypy` (type hints are checked in CI, not just written), `ipykernel` +
`nbclient` (run research notebooks headless, as courtvision does).

## App (decision for you: brief section 11.1)

**Recommendation: B, a static TypeScript front end.**

| | A. Streamlit + Plotly | **B. Static React + DuckDB-WASM** | C. FastAPI + React |
|---|---|---|---|
| Visual ceiling | limited theming, no custom interaction on marks | full control (D3 / Observable Plot), design tokens, light/dark | full control |
| Hosting | Streamlit Cloud, sleeps when idle (~1 min wake) | GitHub Pages / Cloudflare Pages, free, no server, no cold start | needs a server (cost, uptime) |
| Concurrency | one Python process, shared | every viewer runs their own queries | server-bound |
| Daily refresh | app downloads new DuckDB file (the courtvision versioning lessons) | publish versioned Parquet + `manifest.json`; client compares loaded version vs published | redeploy / reload |
| Build effort | lowest, known | highest up front: a component library, a pitch renderer, routing | highest overall |
| Risk | hits the brief's visual bar only partly | DuckDB-WASM first-load size (~3-4 MB wasm) vs the 2 s first-paint budget: mitigated by precomputed small JSON for the first view and lazy Parquet queries after | two deployables |

### Front-end dependencies if B (proposed)

| Package | Why |
|---|---|
| `react`, `react-dom`, `typescript`, `vite` | app shell and build |
| `react-router` | a shareable URL for every view state |
| `@duckdb/duckdb-wasm` | query published Parquet in the browser |
| `d3` (selected modules: scale, shape, array, hexbin, sankey, zoom) | custom marks, pitch, beeswarm, Sankey, hexbins |
| `@observablehq/plot` | fast standard charts (dumbbells, fans, bump) on top of d3 |
| `html-to-image` | PNG/SVG export with watermark |
| `vitest`, `@playwright/test` | unit tests; smoke test per view and the screenshots for phase reports |

Deferred until a view actually needs it: `deck.gl` / `regl` for dense point layers (tens of
thousands of touches). An SVG/canvas hexbin may be enough.

## Name check (2026-11-14)

| Name | PyPI | GitHub repos with the name | Notes |
|---|---|---|---|
| **pitchvision** | free | 55, incl. several 2026 student soccer-analytics repos and a `PitchVision` org; `adisgill/pitchvision` is free | Mirrors courtvision nicely. But **PitchVision is also an established cricket video-analysis company** (pitchvision.com): a search and trademark collision, not a legal block for an MIT hobby repo |
| fullninety | free | 0 | distinctive, soccer-only meaning |
| xgledger | free | 0 | leans on the ledger/scorecard angle; narrower than the project |
| halfspaces | free | 39 | `halfspace` (singular) is taken on PyPI |
| pitchledger | free | 5 | |
| touchline | free | 533 | too common |

**Recommendation:** keep **pitchvision** for the sibling story (courtvision / pitchvision) if
you don't mind sharing the name with the cricket company; otherwise **fullninety**.
