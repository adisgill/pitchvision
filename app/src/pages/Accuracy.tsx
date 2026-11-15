import * as Plot from "@observablehq/plot";
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "../db";
import { css, fmt, LEAGUES } from "../lib/format";
import { Figure } from "../ui/Figure";
import { Card, DataTable, PageHead, Tile } from "../ui/kit";

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
    </>
  );
}
