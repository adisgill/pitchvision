import * as Plot from "@observablehq/plot";
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Row, useQuery } from "../db";
import { css, fmt } from "../lib/format";
import { EffectBars } from "../ui/charts";
import { Figure } from "../ui/Figure";
import { Card, Loading, PageHead, Seg, Tile, useParam } from "../ui/kit";

const VERDICTS: { key: string; title: string; blurb: string }[] = [
  { key: "beats the market", title: "Beats the closing line", blurb: "Moves results beyond the market's final price, cleared the false-discovery bar and replicated on unseen seasons." },
  { key: "beats the market (no holdout data)", title: "Beats the line, untested out of sample", blurb: "Cleared the bar on the discovery seasons; the holdout seasons have no cases to check it on." },
  { key: "priced in by the market", title: "Real, and the market already prices it", blurb: "Moves results beyond a ratings-only model, replicated on unseen seasons, but the closing odds already account for it. These are what our forecasts are missing." },
  { key: "partly priced in", title: "Mostly priced in", blurb: "Strong beyond our model; the market prices most of it, with a small leftover that did not clear the false-discovery bar." },
  { key: "real, no holdout data", title: "Real, but can't be replicated", blurb: "Clear in the discovery seasons; nothing to test it on afterwards." },
  { key: "did not replicate", title: "Looked real, didn't replicate", blurb: "Some signal in one sample that vanished in the other, or failed the false-discovery correction. Treat as noise." },
  { key: "no detectable effect", title: "No detectable effect", blurb: "Popular beliefs and plausible ideas that move nothing measurable, beyond the model or the market." },
  { key: "market information", title: "Information only the market has", blurb: "The market's own late moves. They beat our model by construction and cannot beat the closing line." },
];

const pts = (v: number, d = 3) => `${fmt.signed(v, d)} pts`;

export default function Factors() {
  const f = useQuery(`select * from matchup_factors`);
  const bins = useQuery(`select * from matchup_factor_bins order by factor, x`);
  const [target, setTarget] = useParam("vs", "model");
  const [sel, setSel] = useParam("f", "shot_dominance_diff");
  const rows = f.rows;
  const n = rows[0]?.n ? Math.max(...rows.map((r) => r.n)) : null;
  const count = (k: string) => rows.filter((r) => r.verdict === k).length;
  const beat = count("beats the market") + count("beats the market (no holdout data)");
  const priced = count("priced in by the market") + count("partly priced in");

  const sorted = useMemo(() => {
    const key = target === "market" ? "market_all_b" : target === "shift" ? "market_shift" : "model_all_b";
    return [...rows].filter((r) => r.factor !== "line_move" || target !== "market").sort((a, b) => Math.abs(b[key]) - Math.abs(a[key]));
  }, [rows, target]);

  const cur = rows.find((r) => r.factor === sel);
  const curBins = bins.rows.filter((b) => b.factor === sel);
  const binPlot = useMemo(() => {
    if (!curBins.length) return undefined;
    const long = curBins.flatMap((b) => [
      { x: b.x_mean, y: b.res_model, lo: b.res_model - 1.96 * b.res_model_se, hi: b.res_model + 1.96 * b.res_model_se, k: "vs our model", n: b.n },
      { x: b.x_mean, y: b.res_market, lo: b.res_market - 1.96 * b.res_market_se, hi: b.res_market + 1.96 * b.res_market_se, k: "vs closing line", n: b.n },
    ]);
    return (width: number) => ({
      width, height: 300, marginLeft: 56,
      x: { label: cur?.label ?? "factor", grid: false },
      y: { label: "Points margin vs expectation", grid: true, tickFormat: (v: number) => fmt.signed(v, 2) },
      color: { domain: ["vs our model", "vs closing line"], range: [css("--s1"), css("--s2")] },
      marks: [
        Plot.ruleY([0], { stroke: css("--axis") }),
        Plot.ruleX(long, { x: "x", y1: "lo", y2: "hi", stroke: "k", strokeOpacity: 0.5, strokeWidth: 2 }),
        Plot.line(long, { x: "x", y: "y", stroke: "k", strokeWidth: 2, curve: "monotone-x" }),
        Plot.dot(long, { x: "x", y: "y", fill: "k", r: 4.5, stroke: css("--surface"), strokeWidth: 2 }),
        Plot.tip(long, Plot.pointer({ x: "x", y: "y", title: (d: any) => `${d.k}\n${cur?.label}: ${fmt.n(d.x, 2)}\nmargin vs expectation ${fmt.signed(d.y, 3)} (95% ${fmt.signed(d.lo, 2)} to ${fmt.signed(d.hi, 2)})\n${fmt.n(d.n)} matches` })),
      ],
    });
  }, [curBins, cur]);

  return (
    <>
      <PageHead eyebrow="Research · matchup factors"
        title={beat === 0 && rows.length ? "Nothing we tested beats the closing line. Six things beat our model." : "What moves a football match beyond the ratings"}
        lead={<>We tested {rows.length || "–"} factors people rarely quantify (fatigue, rotation, missing regulars, new managers, referees,
          formations, finishing luck, crowds, motivation) on {fmt.n(n)} league matches, against two baselines: our ratings model and the
          closing betting line. Discovery on 2017-18 to 2021-22, replication on 2022-23 onward, with a false-discovery correction. Nulls are results too.</>} />
      <Loading state={f} />
      <div className="tiles" style={{ marginBottom: 16 }}>
        <Tile label="Matches analysed" value={fmt.n(n)} delta="7 leagues, 2017-18 to 2025-26" />
        <Tile label="Factors tested" value={rows.length || "–"} delta="all known before kickoff or at line-ups" />
        <Tile label="Beat the closing line" value={beat} delta="after correction and replication" />
        <Tile label="Priced in, missing from ratings" value={priced} delta="the market knows; our model doesn't (yet)" />
      </div>

      <div className="grid">
        <div className="c7">
          <Card title="Effect of every factor, with 95% intervals"
                sub={<>Change in the home-minus-away points margin per standard deviation of the factor (per unit for yes/no factors).
                  "vs our model": beyond the ratings forecast. "vs closing line": beyond the market's final price. "Market adjustment":
                  how far the closing line itself moves with the factor, beyond our model.</>}
                right={<Seg value={target as any} onChange={(v) => setTarget(v)} label="Baseline"
                            options={[["model", "vs our model"], ["market", "vs closing line"], ["shift", "Market adjustment"]]} />}>
            <EffectBars unit=" pts" rows={sorted.map((r) => ({
              label: <tspan style={{ cursor: "pointer" }} onClick={() => setSel(r.factor)}>{r.label}</tspan>,
              b: target === "market" ? r.market_all_b : target === "shift" ? r.market_shift : r.model_all_b,
              se: target === "market" ? r.market_all_se : target === "shift" ? r.market_shift_se : r.model_all_se,
              color: r.factor === sel ? "var(--s4)" : undefined,
              note: <div className="muted xs">{r.verdict} · {r.unit} · n = {fmt.n(r.n)}</div>,
            }))} />
            <p className="xs muted" style={{ marginTop: 6 }}>Click a factor name to open it on the right. Positive = helps the home side (or the side with more of it).</p>
          </Card>
        </div>
        <div className="c5 stack" style={{ gap: 16 }}>
          {cur && (
            <Card title={cur.label} sub={cur.description}
                  right={<span className={`pill ${cur.verdict.startsWith("beats") ? "good" : ""}`}>{cur.verdict}</span>}>
              <table className="data">
                <thead><tr><th></th><th className="r">vs our model</th><th className="r">vs closing line</th></tr></thead>
                <tbody>
                  {(["disc", "hold", "all"] as const).map((s) => (
                    <tr key={s}>
                      <td>{s === "disc" ? "Discovery 2017-22" : s === "hold" ? "Holdout 2022+" : "All seasons"}</td>
                      {(["model", "market"] as const).map((t) => (
                        <td key={t} className="r">{cur[`${t}_${s}_b`] == null ? "–" : <>{pts(cur[`${t}_${s}_b`])} <span className="muted xs">± {fmt.n(1.96 * cur[`${t}_${s}_se`], 3)}</span></>}</td>
                      ))}
                    </tr>
                  ))}
                  <tr><td>False-discovery q (discovery)</td><td className="r">{fmt.n(cur.model_disc_q, 3)}</td><td className="r">{fmt.n(cur.market_disc_q, 3)}</td></tr>
                </tbody>
              </table>
              <p className="xs muted" style={{ marginTop: 8 }}>
                Known {cur.known_at === "line-ups" ? "at line-up time (about an hour before kickoff)" : cur.known_at === "kickoff" ? "only at kickoff" : "before the match"} ·
                effect {cur.unit} (1 SD = {fmt.n(cur.scale, 2)}) · market moves {pts(cur.market_shift)} per unit beyond our model.
              </p>
            </Card>
          )}
          {binPlot && (
            <Figure title="Results against expectation, by factor level"
                    subtitle="Average points margin minus what each baseline expected, in bins of the factor (deciles, or each value for small counts). Bars: 95% intervals."
                    source="Transfermarkt, football-data.co.uk" plot={binPlot}
                    alt={`Binned residuals for ${cur?.label}`}
                    table={{ rows: curBins, cols: [["x_mean", "Factor (bin mean)", (v) => fmt.n(v, 2)], ["n", "Matches"],
                      ["res_model", "vs model", (v) => fmt.signed(v, 3)], ["res_market", "vs market", (v) => fmt.signed(v, 3)]] }} />
          )}
        </div>
      </div>

      {VERDICTS.filter((v) => count(v.key) > 0).map((v) => (
        <section className="section" key={v.key}>
          <h2>{v.title} <span className="muted small">({count(v.key)})</span></h2>
          <p className="ink2 small" style={{ maxWidth: 820 }}>{v.blurb}</p>
          <div className="grid">
            {rows.filter((r) => r.verdict === v.key).map((r) => <FactorCard key={r.factor} r={r} onOpen={() => { setSel(r.factor); window.scrollTo({ top: 0, behavior: "smooth" }); }} />)}
          </div>
        </section>
      ))}

      <section className="section">
        <h2>How it was tested</h2>
        <div className="grid">
          <div className="c6 callout">
            Every factor is computed from information available before kickoff, or at line-up time where flagged (rotation, missing regulars, formations).
            The outcome is the home-minus-away points margin (3/1/0), minus what each baseline expected: our walk-forward Dixon-Coles blend,
            and the de-vigged closing odds. Effects are OLS slopes with robust (HC1) standard errors.
          </div>
          <div className="c6 callout">
            A factor "beats the market" only if its effect beyond the closing line clears a Benjamini-Hochberg false-discovery rate of 10% on 2017-18 to
            2021-22 and then shows the same sign (p &lt; 0.10) on 2022-23 onward. With {rows.length} factors, one or two would pass a naive p &lt; 0.05 by luck alone,
            which is why the correction matters. Want to see what the pitch itself says about a matchup? Try the <Link to="/matchup">pitch matchup</Link>.
          </div>
        </div>
      </section>
    </>
  );
}

function FactorCard({ r, onOpen }: { r: Row; onOpen: () => void }) {
  const t = (b: number, se: number) => Math.abs(b) / (se || 1);
  return (
    <button className="card link c4" style={{ textAlign: "left", cursor: "pointer" }} onClick={onOpen}>
      <div className="row between"><span className="eyebrow">{r.group}</span><span className="xs muted">{r.known_at}</span></div>
      <p className="fig-title" style={{ marginTop: 4 }}>{r.label}</p>
      <div className="row" style={{ gap: 16, marginTop: 6 }}>
        <div><div className="xs muted">vs our model</div><b className="num">{pts(r.model_all_b, 2)}</b> <span className="xs muted">t {fmt.n(t(r.model_all_b, r.model_all_se), 1)}</span></div>
        <div><div className="xs muted">vs closing line</div><b className="num">{pts(r.market_all_b, 2)}</b> <span className="xs muted">t {fmt.n(t(r.market_all_b, r.market_all_se), 1)}</span></div>
      </div>
      <p className="xs muted" style={{ margin: "6px 0 0" }}>{r.unit} · {fmt.n(r.n)} matches</p>
    </button>
  );
}
