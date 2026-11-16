import * as Plot from "@observablehq/plot";
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "../db";
import { css, fmt, LEAGUES } from "../lib/format";
import { Figure } from "../ui/Figure";
import { Card, ClubLink, DataTable, PageHead, Tile } from "../ui/kit";
import { rps as rpsOf } from "./accuracyLedger";

const MODELS = ["closing line", "elo", "dixon-coles blend", "base rates"];

export default function Accuracy() {
  const wf = useQuery(`select * from wf_eval where split like 'test%'`);
  const bt = useQuery(`select variant, zone, sum(n) n, avg(brier) brier from season_backtest_eval group by all`);
  const xg = useQuery(`select * from xg_eval where "group" = 'all' order by logloss`);
  const xgc = useQuery(`select * from xg_calibration order by mean_pred`);
  const vaep = useQuery(`select * from vaep_eval where "group" = 'all'`);
  const wp = useQuery(`select * from wp_eval order by minutes`);
  const wpc = useQuery(`select * from wp_calibration order by bucket, mean_p`);
  const rapm = useQuery(`select variant, max(r) r from rapm_eval where split = 'test' group by 1 order by r desc`);
  const mkt = useQuery(`select * from market_eval where scope <> 'all' order by scope`);
  const relc = useQuery(`select metric, any_value(k90) k90 from reliability_c group by 1`);
  const rela = useQuery(`select * from reliability_a`);
  const upg = useQuery(`select * from upgrade_eval`);
  const led = useQuery(`select * from ledger`);
  const all = Object.fromEntries(wf.rows.filter((r) => r.league === "all").map((r) => [r.model, r]));
  const eq = Object.fromEntries(bt.rows.filter((r) => r.variant === "equal strength").map((r) => [r.zone, r.brier]));
  const gbm = xg.rows.find((r) => r.model === "gbm");

  const wfPlot = useMemo(() => {
    const rows = wf.rows.filter((r) => MODELS.includes(r.model));
    if (!rows.length) return undefined;
    const leagues = ["all", ...Object.keys(LEAGUES).filter((k) => rows.some((r) => r.league === k))];
    return (width: number) => ({
      width, height: leagues.length * 30 + 70, marginLeft: 112,
      x: { label: "Ranked probability score (lower is better)", grid: true },
      y: { label: null, domain: leagues, tickFormat: (l: string) => (l === "all" ? "All leagues" : LEAGUES[l]) },
      color: { domain: MODELS, range: [css("--text"), css("--s1"), css("--s3"), css("--muted")], legend: true },
      symbol: { domain: MODELS, range: ["diamond2", "circle", "circle", "circle"] },
      marks: [
        Plot.dot(rows, { y: "league", x: "rps", stroke: "model", fill: "model", symbol: "model", r: 5 }),
        Plot.tip(rows, Plot.pointer({ y: "league", x: "rps", title: (d: any) => `${d.model} · ${d.league === "all" ? "all leagues" : LEAGUES[d.league]}\nRPS ${d.rps.toFixed(4)} over ${fmt.n(d.n)} matches` })),
      ],
    });
  }, [wf.rows]);

  const calPlot = useMemo(() => {
    if (!xgc.rows.length) return undefined;
    return (width: number) => ({
      width, height: 260, x: { label: "Predicted xG per shot", domain: [0, 1], tickFormat: "%" }, y: { label: "Share scored", domain: [0, 1], grid: true, tickFormat: "%" },
      marks: [
        Plot.line([[0, 0], [1, 1]], { stroke: css("--axis") }),
        Plot.line(xgc.rows, { x: "mean_pred", y: "mean_obs", stroke: css("--s1"), strokeWidth: 2 }),
        Plot.dot(xgc.rows, { x: "mean_pred", y: "mean_obs", r: (d: any) => 3 + Math.sqrt(d.n) / 15, fill: css("--s1"), stroke: css("--surface"), strokeWidth: 2 }),
        Plot.tip(xgc.rows, Plot.pointer({ x: "mean_pred", y: "mean_obs", title: (d: any) => `predicted ${fmt.pct(d.mean_pred, 1)}\nscored ${fmt.pct(d.mean_obs, 1)}\n${fmt.n(d.n)} shots` })),
      ],
    });
  }, [xgc.rows]);

  const wpPlot = useMemo(() => {
    if (!wpc.rows.length) return undefined;
    const buckets = [...new Set(wpc.rows.map((r) => r.bucket))];
    const ramp = [css("--seq-200"), css("--seq-300"), css("--seq-400"), css("--seq-500"), css("--seq-600"), css("--seq-700")];
    return (width: number) => ({
      width, height: 260, x: { label: "Predicted home-win probability", domain: [0, 1], tickFormat: "%" },
      y: { label: "Home win rate", domain: [0, 1], grid: true, tickFormat: "%" },
      color: { type: "ordinal" as const, domain: buckets, range: ramp.slice(0, buckets.length), legend: true, label: "Minute bucket",
               tickFormat: (b: number) => `${b * 15}–${b * 15 + 14}'` },
      marks: [
        Plot.line([[0, 0], [1, 1]], { stroke: css("--axis") }),
        Plot.line(wpc.rows, { x: "mean_p", y: "freq", stroke: "bucket", strokeWidth: 2 }),
        Plot.tip(wpc.rows, Plot.pointer({ x: "mean_p", y: "freq", title: (d: any) => `${d.bucket * 15}–${d.bucket * 15 + 14}'\npredicted ${fmt.pct(d.mean_p)}, happened ${fmt.pct(d.freq)}\n${fmt.n(d.n)} minutes` })),
      ],
    });
  }, [wpc.rows]);

  return (
    <>
      <PageHead eyebrow="Accuracy" title={all.elo ? `The closing line beats every model we have, by ${fmt.n(all.elo.rps - all["closing line"].rps, 4)} RPS` : "Accuracy"}
        lead="Everything here is scored out of sample: match forecasts week by week with only what was known before kickoff, other models on held-out seasons or folds. Losses are shown, not hidden." />
      <div className="tiles" style={{ marginBottom: 16 }}>
        <Tile label="Match forecasts (RPS, lower is better)" value={fmt.n(all.elo?.rps, 4)} delta={`closing line ${fmt.n(all["closing line"]?.rps, 4)} · base rates ${fmt.n(all["base rates"]?.rps, 4)}`} />
        <Tile label="xG model (AUC)" value={fmt.n(gbm?.auc, 3)} delta={`log loss ${fmt.n(gbm?.logloss, 4)}; StatsBomb's own 0.2607`} />
        <Tile label="Title odds skill vs equal teams" value={eq.title ? fmt.pct(1 - (bt.rows.find((r) => r.variant === "model" && r.zone === "title")?.brier ?? 0) / eq.title) : "–"} delta="Brier skill, simulated from halfway" />
        <Tile label="Market-value model (R², log)" value={fmt.n(mkt.rows.length ? mkt.rows.reduce((a, r) => a + r.r2_log, 0) / mkt.rows.length : null, 2)} delta="80% intervals hold 80%" />
      </div>
      <div className="grid">
        <div className="c12">
          {wfPlot && <Figure title="Match forecasts by league: the market (diamond) leads everywhere"
            subtitle={<>Ranked probability score of home/draw/away forecasts, 2021-22 onward ({fmt.n(all.elo?.n)} matches), each made the week before from data available then.
              The gap to the closing line is information we don't have: line-ups, injuries, news. The <Link to="/factors">hidden-factors study</Link> shows which parts of it are measurable.</>}
            source="football-data.co.uk" plot={wfPlot} alt="Forecast error by model and league"
            table={{ rows: wf.rows.filter((r) => MODELS.includes(r.model)), cols: [["league", "League"], ["model", "Model"], ["rps", "RPS", (v) => v.toFixed(4)], ["n", "Matches"]] }} />}
        </div>
        <div className="c6">
          {calPlot && <Figure title="Our xG is well calibrated" subtitle={`Shots grouped by predicted xG, out of fold over ${fmt.n(gbm?.n)} shots.`}
            source="StatsBomb open data, Wyscout public dataset" plot={calPlot} alt="xG calibration curve"
            table={{ rows: xgc.rows, cols: [["mean_pred", "Predicted", (v) => fmt.pct(v, 1)], ["mean_obs", "Scored", (v) => fmt.pct(v, 1)], ["n", "Shots"]] }} />}
        </div>
        <div className="c6">
          {wpPlot && <Figure title="In-game win probability is calibrated at every stage" subtitle="Predicted vs actual home-win rate, by 15-minute phase, on 2021-22 onward."
            source="football-data.co.uk, Transfermarkt events" plot={wpPlot} alt="Win probability calibration by phase"
            table={{ rows: wp.rows, cols: [["minutes", "Minutes"], ["logloss_state", "Log loss (game state)", (v) => v.toFixed(3)], ["logloss_prematch", "Pre-match only", (v) => v.toFixed(3)]] }} />}
        </div>
        <div className="c6">
          <Card title="Season odds: better than chance, far from certain" sub="Every complete season simulated from its halfway point and scored against the final table (Brier), vs the same simulator with equal teams.">
            <DataTable rows={bt.rows.filter((r) => r.variant === "model").map((r) => ({ ...r, eq: eq[r.zone], skill: 1 - r.brier / eq[r.zone] }))} cols={[
              { key: "zone", label: "Zone", fmt: (v) => v.replace("_", " ") },
              { key: "brier", label: "Model", num: true, fmt: (v) => v.toFixed(4) },
              { key: "eq", label: "Equal teams", num: true, fmt: (v) => v?.toFixed(4) },
              { key: "skill", label: "Skill", num: true, fmt: (v) => fmt.pct(v) },
            ]} />
          </Card>
        </div>
        <div className="c6">
          <Card title="Shot and action models" sub="Out of sample. VAEP: chance the possessing team scores (or concedes) in the next 10 actions; baseline = a constant rate.">
            <DataTable rows={[...xg.rows.map((r) => ({ m: `xG · ${r.model}`, ...r })), ...vaep.rows.map((r) => ({ m: `VAEP · ${r.label}`, ...r }))]} cols={[
              { key: "m", label: "Model" }, { key: "n", label: "N", num: true, fmt: (v) => fmt.compact(v) },
              { key: "logloss", label: "Log loss", num: true, fmt: (v) => v.toFixed(4) },
              { key: "logloss_base", label: "Baseline", num: true, fmt: (v) => v == null ? "–" : v.toFixed(4) },
              { key: "auc", label: "AUC", num: true, fmt: (v) => v?.toFixed(3) },
            ]} />
          </Card>
        </div>
        <div className="c4">
          <Card title="Player impact (RAPM) barely beats its prior" sub="Correlation with next-period on-pitch goal difference, test seasons, best setting per variant.">
            <DataTable rows={rapm.rows} cols={[{ key: "variant", label: "Variant" }, { key: "r", label: "r", num: true, fmt: (v) => v.toFixed(3) }]} />
          </Card>
        </div>
        <div className="c4">
          <Card title="Market-value model by season">
            <DataTable rows={mkt.rows} maxHeight={320} cols={[
              { key: "scope", label: "Season" }, { key: "r2_log", label: "R²", num: true, fmt: (v) => v.toFixed(2) },
              { key: "median_abs_pct_error", label: "Typical miss", num: true, fmt: (v) => fmt.pct(v) },
              { key: "inside_80", label: "In 80% band", num: true, fmt: (v) => fmt.pct(v) }]} />
          </Card>
        </div>
        <div className="c4">
          <Card title="How many 90s until a stat means something" sub="90s needed for a per-90 stat to be half signal (split-half reliability). Ratings shrink accordingly.">
            <DataTable rows={[...relc.rows.map((r) => ({ ...r, src: "box score" })), ...rela.rows.map((r) => ({ ...r, src: "event" }))]} initialSort={{ key: "k90", desc: false }} maxHeight={320} cols={[
              { key: "metric", label: "Metric", fmt: (v) => v.replace(/_p90$/, "").replace(/_/g, " ") }, { key: "src", label: "Source" },
              { key: "k90", label: "90s", num: true, fmt: (v) => v.toFixed(1) }]} />
          </Card>
        </div>
      </div>

      <section className="section">
        <h2>The forecast upgrade</h2>
        <UpgradeSection rows={upg.rows} />
      </section>

      <section className="section">
        <h2>Live track record</h2>
        <LedgerSection rows={led.rows} />
      </section>
    </>
  );
}

const UP_MODELS = ["closing line", "upgraded: at line-ups", "upgraded: days ahead", "our model (current)"];

function UpgradeSection({ rows }: { rows: any[] }) {
  const core = rows.filter((r) => r.study.startsWith("core"));
  const all = Object.fromEntries(core.filter((r) => r.league === "all").map((r) => [r.model, r]));
  const fm = rows.filter((r) => r.study.startsWith("FotMob"));
  const fmAll = Object.fromEntries(fm.map((r) => [r.model, r]));
  const cur = all["our model (current)"]?.rps, mk = all["closing line"]?.rps, up = all["upgraded: days ahead"]?.rps, upl = all["upgraded: at line-ups"]?.rps;
  const closed = cur && mk && up ? (cur - up) / (cur - mk) : null;
  const plot = useMemo(() => {
    const d = core.filter((r) => UP_MODELS.includes(r.model));
    if (!d.length) return undefined;
    const leagues = ["all", ...Object.keys(LEAGUES).filter((k) => d.some((r) => r.league === k))];
    return (width: number) => ({
      width, height: leagues.length * 30 + 70, marginLeft: 112,
      x: { label: "Ranked probability score (lower is better)", grid: true },
      y: { label: null, domain: leagues, tickFormat: (l: string) => (l === "all" ? "All leagues" : LEAGUES[l]) },
      color: { domain: UP_MODELS, range: [css("--text"), css("--s3"), css("--s1"), css("--muted")], legend: true },
      symbol: { domain: UP_MODELS, range: ["diamond2", "circle", "circle", "circle"] },
      marks: [
        Plot.dot(d, { y: "league", x: "rps", stroke: "model", fill: "model", symbol: "model", r: 5 }),
        Plot.tip(d, Plot.pointer({ y: "league", x: "rps", title: (r: any) => `${r.model}: RPS ${r.rps.toFixed(5)} over ${fmt.n(r.n)} matches` })),
      ],
    });
  }, [rows]);
  return (
    <div className="grid">
      <div className="c12">
        <div className="tiles">
          <Tile label="Current model (RPS)" value={fmt.n(cur, 4)} delta="2021-22 to 2025-26" />
          <Tile label="Upgraded, days ahead" value={fmt.n(up, 4)} delta={closed != null ? `closes ${fmt.pct(closed)} of the gap to the market` : ""} tone="up" />
          <Tile label="Upgraded, at line-ups" value={fmt.n(upl, 4)} delta="adds rotation and missing regulars" tone="up" />
          <Tile label="Closing line" value={fmt.n(mk, 4)} delta="still ahead" tone="down" />
        </div>
      </div>
      <div className="c8">
        {plot && <Figure title={closed != null ? `The upgrade closes ${fmt.pct(closed)} of our gap to the closing line` : "The forecast upgrade"}
          subtitle="Our Dixon-Coles forecast plus what the research found the market prices and ratings miss (recent shot dominance, form, congestion, European matches; at line-ups also rotation and missing regulars). Fitted walk-forward: each season's forecasts only use earlier seasons. Better than the current model in each of the five test seasons (paired t = -6.4 days ahead, -6.7 at line-ups)."
          source="football-data.co.uk, Transfermarkt" plot={plot} alt="Forecast error by model and league after the upgrade"
          table={{ rows: core, cols: [["league", "League"], ["model", "Model"], ["rps", "RPS", (v) => v.toFixed(5)], ["n", "Matches"]] }} />}
      </div>
      <div className="c4 stack" style={{ gap: 16 }}>
        <Card title="FotMob era: xG form and injuries help too">
          <p className="small ink2">On 2025-26 onward ({fmt.n(fmAll["our model (current)"]?.n)} matches), adding each side's recent FotMob xG difference and its injured players' share of squad value
            moves our score from {fmt.n(fmAll["our model (current)"]?.rps, 4)} to {fmt.n(fmAll["upgraded: FotMob era: + xG form, injuries"]?.rps, 4)} (closing line {fmt.n(fmAll["closing line"]?.rps, 4)}).
            Recent xG form is the strongest single signal; raw points form gets a negative weight once it's in (results regress toward performance).</p>
        </Card>
        <Card title="What upcoming forecasts use">
          <p className="small ink2">Upcoming matches use the signals known days ahead that are still available after the Transfermarkt freeze: last-5 points, shot and corner dominance,
            FotMob xG form and the latest injury list. Congestion and European fixtures drop out until a current cup schedule is available.</p>
        </Card>
      </div>
    </div>
  );
}

function LedgerSection({ rows }: { rows: any[] }) {
  const graded = rows.filter((r) => r.finished && r.outcome != null && r.home_goals != null);
  const avg = graded.length ? graded.reduce((a, r) => a + rpsOf([Number(r.p_home), Number(r.p_draw), Number(r.p_away)], Number(r.outcome)), 0) / graded.length : null;
  const first = rows.length ? rows.map((r) => String(r.logged_at)).sort()[0] : null;
  const recent = [...graded].sort((a, b) => String(b.kickoff_utc).localeCompare(String(a.kickoff_utc))).slice(0, 30);
  return (
    <div className="grid">
      <div className="c12">
        <div className="tiles">
          <Tile label="Forecasts logged before kickoff" value={fmt.n(rows.length)} delta={first ? `since ${first.slice(0, 10)}` : ""} />
          <Tile label="Graded so far" value={fmt.n(graded.length)} delta="matches played since logging" />
          <Tile label="Average RPS, graded" value={avg != null ? avg.toFixed(4) : "–"} delta={graded.length < 200 ? "too few to judge yet" : ""} />
        </div>
      </div>
      <div className="c12">
        <Card title="An append-only public ledger" sub="Every day, before kickoff, the forecast for each upcoming fixture is appended to a ledger that is never edited. Each match is graded on the last forecast made before it kicked off: no backfilling, no quiet revisions.">
          {recent.length ? (
            <DataTable rows={recent} maxHeight={420} cols={[
              { key: "kickoff_utc", label: "Kickoff", fmt: (v) => String(v).slice(0, 10) },
              { key: "home_name", label: "Home", fmt: (v, r) => <ClubLink id={r.home_club} name={v} /> },
              { key: "home_goals", label: "Score", center: true, fmt: (v, r) => `${v}–${r.away_goals}` },
              { key: "away_name", label: "Away", fmt: (v, r) => <ClubLink id={r.away_club} name={v} /> },
              { key: "p_home", label: "Forecast H / D / A", num: true, fmt: (v, r) => `${fmt.pct(Number(v))} / ${fmt.pct(Number(r.p_draw))} / ${fmt.pct(Number(r.p_away))}` },
              { key: "outcome", label: "RPS", num: true, fmt: (v, r) => rpsOf([Number(r.p_home), Number(r.p_draw), Number(r.p_away)], Number(v)).toFixed(3) },
            ]} />
          ) : <p className="small muted">No logged fixture has been played yet: the first forecasts were logged {first ? first.slice(0, 10) : "today"}, and grading starts with the next round of matches.</p>}
        </Card>
      </div>
    </div>
  );
}
