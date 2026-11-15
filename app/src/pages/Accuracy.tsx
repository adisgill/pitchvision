import * as Plot from "@observablehq/plot";
import { useMemo } from "react";
import { css, DataTable, Figure, fmt, LEAGUES } from "../components";
import { useQuery } from "../db";

const MODELS = ["closing line", "elo", "dixon-coles blend", "dixon-coles goals", "base rates"];
const label = (m: string) => (m.length < 24 ? m.replace(/_/g, " ") : m);

export default function Accuracy() {
  const wf = useQuery(`select * from wf_eval where split like 'test%'`);
  const bt = useQuery(`select variant, zone, sum(n) n, avg(brier) brier from season_backtest_eval group by all`);
  const xg = useQuery(`select * from xg_eval where "group" = 'all' order by logloss`);
  const xgc = useQuery(`select * from xg_calibration order by mean_pred`);
  const vaep = useQuery(`select * from vaep_eval where "group" = 'all'`);
  const wp = useQuery(`select * from wp_eval order by minutes`);
  const wpc = useQuery(`select * from wp_calibration order by bucket, mean_p`);
  const red = useQuery(`select * from wp_red_card order by minute`);
  const rapm = useQuery(`select variant, max(r) r from rapm_eval where split = 'test' group by 1 order by r desc`);
  const mkt = useQuery(`select * from market_eval where scope <> 'all' order by scope`);
  const relc = useQuery(`select metric, any_value(k90) k90 from reliability_c group by 1 order by k90`);
  const rela = useQuery(`select * from reliability_a order by k90`);

  const wfPlot = useMemo(() => {
    const rows = wf.rows.filter((r) => MODELS.includes(r.model));
    if (!rows.length) return undefined;
    const leagues = ["all", ...Object.keys(LEAGUES).filter((k) => rows.some((r) => r.league === k))];
    return (width: number) => ({
      width, height: leagues.length * 28 + 60, marginLeft: 110,
      x: { label: "Ranked probability score (lower is better)", grid: true },
      y: { label: null, domain: leagues, tickFormat: (l: string) => (l === "all" ? "All leagues" : LEAGUES[l]) },
      color: { domain: MODELS, range: [css("--cat-8"), css("--cat-1"), css("--cat-3"), css("--cat-5"), css("--neutral")], legend: true },
      marks: [
        Plot.dot(rows, { y: "league", x: "rps", stroke: "model", fill: "model", r: 4.5, symbol: (d: any) => (d.model === "closing line" ? "diamond" : "circle"),
                         title: (d: any) => `${d.model}, ${d.league}: ${d.rps.toFixed(4)} over ${d.n} matches` }),
      ],
    });
  }, [wf.rows]);

  const calPlot = useMemo(() => {
    if (!xgc.rows.length) return undefined;
    return (width: number) => ({
      width, height: 260, x: { label: "Predicted xG per shot", domain: [0, 1] }, y: { label: "Share scored", domain: [0, 1], grid: true },
      marks: [
        Plot.line([[0, 0], [1, 1]], { stroke: css("--line") }),
        Plot.line(xgc.rows, { x: "mean_pred", y: "mean_obs", stroke: css("--good") }),
        Plot.dot(xgc.rows, { x: "mean_pred", y: "mean_obs", r: (d: any) => Math.sqrt(d.n) / 12, fill: css("--good"),
                             title: (d: any) => `predicted ${fmt.pct(d.mean_pred, 1)}, scored ${fmt.pct(d.mean_obs, 1)} (${d.n} shots)` }),
      ],
    });
  }, [xgc.rows]);

  const wpPlot = useMemo(() => {
    if (!wpc.rows.length) return undefined;
    return (width: number) => ({
      width, height: 260, x: { label: "Predicted home-win probability", domain: [0, 1] },
      y: { label: "Home win rate", domain: [0, 1], grid: true },
      color: { type: "ordinal" as const, scheme: "blues", legend: true, label: "Minute bucket" },
      marks: [
        Plot.line([[0, 0], [1, 1]], { stroke: css("--line") }),
        Plot.line(wpc.rows, { x: "mean_p", y: "freq", stroke: "bucket" }),
        Plot.dot(wpc.rows, { x: "mean_p", y: "freq", fill: "bucket", r: 2.5 }),
      ],
    });
  }, [wpc.rows]);

  const redPlot = useMemo(() => {
    if (!red.rows.length) return undefined;
    return (width: number) => ({
      width, height: 220, x: { label: "Minute of the red card" }, y: { label: "Expected points lost", grid: true },
      marks: [Plot.areaY(red.rows, { x: "minute", y: "cost_xpts", fill: css("--bad"), fillOpacity: 0.3 }),
              Plot.line(red.rows, { x: "minute", y: "cost_xpts", stroke: css("--bad"), strokeWidth: 2, tip: true })],
    });
  }, [red.rows]);

  const all = Object.fromEntries(wf.rows.filter((r) => r.league === "all").map((r) => [r.model, r]));
  const eq = Object.fromEntries(bt.rows.filter((r) => r.variant === "equal strength").map((r) => [r.zone, r.brier]));
  return (
    <>
      <h1>Accuracy</h1>
      <p className="muted" style={{ maxWidth: 780, marginTop: 0 }}>Everything below is scored out of sample: match forecasts week by week with only
        data available before kickoff, models fitted on other seasons or other folds. Where we lose, it's shown.</p>
      <div className="grid">
        <div className="span-12">
          {wfPlot && (
            <Figure title={`The closing line beats every model we have, by ${fmt.n(all["elo"]?.rps - all["closing line"]?.rps, 4)} RPS`}
                    subtitle={<>Match outcome forecasts, 2021-22 onward ({fmt.n(all["elo"]?.n)} matches), made each week from data before kickoff. Base rates = league-average home/draw/away.
                      The gap to the market is the information we don't have (injuries, line-ups, news).</>}
                    source="football-data.co.uk" plot={wfPlot} alt="Forecast error by model and league" />
          )}
        </div>
        <div className="span-6 card">
          <p className="figure-title">Season odds: better than chance, far from certain</p>
          <p className="figure-sub">Each complete season simulated from its halfway point; Brier score vs the same simulator with equal teams, averaged over leagues.</p>
          <table className="data">
            <thead><tr><th>Zone</th><th className="r">Model</th><th className="r">Equal strength</th><th className="r">Skill</th></tr></thead>
            <tbody>{bt.rows.filter((r) => r.variant === "model").map((r) => (
              <tr key={r.zone}><td>{r.zone.replace("_", " ")}</td><td className="r">{fmt.n(r.brier, 4)}</td><td className="r">{fmt.n(eq[r.zone], 4)}</td>
                <td className="r">{fmt.pct(1 - r.brier / eq[r.zone])}</td></tr>))}
            </tbody>
          </table>
        </div>
        <div className="span-6 card">
          <p className="figure-title">Player impact (RAPM) adds little over its prior</p>
          <p className="figure-sub">Correlation with next-period on-pitch goal difference (test seasons, best setting per variant).</p>
          <DataTable rows={rapm.rows} initialSort={{ key: "r", desc: true }} cols={[
            { key: "variant", label: "Variant" }, { key: "r", label: "r", num: true, fmt: (v) => fmt.n(v, 3) }]} />
        </div>
        <div className="span-6">
          {calPlot && <Figure title="Our xG is well calibrated" subtitle={<>Shots grouped by predicted xG. Out-of-fold over {fmt.n(xg.rows[0]?.n)} shots;
            log loss {fmt.n(xg.rows.find((r) => r.model === "gbm")?.logloss, 4)}, AUC {fmt.n(xg.rows.find((r) => r.model === "gbm")?.auc, 3)}.
            StatsBomb's own xG still does better on its data (0.2607 vs 0.2736 log loss).</>}
                              source="StatsBomb open data, Wyscout public dataset" plot={calPlot} alt="xG calibration" />}
        </div>
        <div className="span-6 card">
          <p className="figure-title">Shot and action models</p>
          <DataTable rows={[...xg.rows.map((r) => ({ m: `xG: ${label(r.model)}`, ...r })), ...vaep.rows.map((r) => ({ m: `VAEP: ${r.label}`, ...r }))]} cols={[
            { key: "m", label: "Model" }, { key: "n", label: "N", num: true, fmt: (v) => fmt.n(v) },
            { key: "logloss", label: "Log loss", num: true, fmt: (v) => fmt.n(v, 4) },
            { key: "logloss_base", label: "Baseline", num: true, fmt: (v) => fmt.n(v, 4) },
            { key: "auc", label: "AUC", num: true, fmt: (v) => fmt.n(v, 3) }]} />
          <p className="small muted">VAEP: probability that the possessing team scores (or concedes) within the next 10 actions; baseline = constant rate.</p>
        </div>
        <div className="span-6">
          {wpPlot && <Figure title="In-game win probability is calibrated at every stage" subtitle="Predicted vs actual home-win rate by match phase."
                             source="football-data.co.uk, Transfermarkt events" plot={wpPlot} alt="Win probability calibration" />}
        </div>
        <div className="span-6 card">
          <p className="figure-title">The game state beats the pre-match odds from the first minute</p>
          <DataTable rows={wp.rows} cols={[
            { key: "minutes", label: "Minutes" }, { key: "n", label: "N", num: true, fmt: (v) => fmt.n(v) },
            { key: "logloss_state", label: "Log loss (state)", num: true, fmt: (v) => fmt.n(v, 3) },
            { key: "logloss_prematch", label: "Pre-match only", num: true, fmt: (v) => fmt.n(v, 3) }]} />
          {redPlot && <Figure title="What a red card costs" subtitle="Expected points lost by the home side going down to ten men, by minute." source="model" plot={redPlot} alt="Red card cost by minute" />}
        </div>
        <div className="span-6 card">
          <p className="figure-title">Market-value model, by season</p>
          <DataTable rows={mkt.rows} cols={[
            { key: "scope", label: "Season" }, { key: "n", label: "Players", num: true },
            { key: "r2_log", label: "R² (log)", num: true, fmt: (v) => fmt.n(v, 2) },
            { key: "median_abs_pct_error", label: "Typical miss", num: true, fmt: (v) => fmt.pct(v) },
            { key: "inside_80", label: "Inside 80% band", num: true, fmt: (v) => fmt.pct(v) }]} />
        </div>
        <div className="span-6 card">
          <p className="figure-title">How many minutes until a stat means something</p>
          <p className="figure-sub">90s needed for a per-90 stat to be half signal, half noise (split-half reliability). Lower = stabilises faster. Ratings shrink toward average accordingly.</p>
          <DataTable rows={[...relc.rows.map((r) => ({ ...r, src: "box score" })), ...rela.rows.map((r) => ({ ...r, src: "event data" }))]}
                     initialSort={{ key: "k90", desc: false }} cols={[
            { key: "metric", label: "Metric" }, { key: "src", label: "Source" },
            { key: "k90", label: "90s to 50%", num: true, fmt: (v) => fmt.n(v, 1) }]} />
        </div>
      </div>
    </>
  );
}
