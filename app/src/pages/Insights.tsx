import * as Plot from "@observablehq/plot";
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "../db";
import { css, fmt } from "../lib/format";
import { EffectBars } from "../ui/charts";
import { Figure } from "../ui/Figure";
import { Card, Loading, PageHead, Seg, Tile, useParam } from "../ui/kit";

export default function Insights() {
  const st = useQuery(`select * from ww_stability`);
  const dr = useQuery(`select * from ww_drivers`);
  const cu = useQuery(`select * from ww_curves order by stat, x`);
  const ff = useQuery(`select * from ww_fm_factors`);
  const wg = useQuery(`select * from ww_weather_goals`);
  const [curve, setCurve] = useParam("curve", "ballpossesion");
  const [view, setView] = useParam("drv", "single");

  const S = st.rows;
  const top = [...S].sort((a, b) => b.predict_r - a.predict_r);
  const xg = S.find((r) => r.stat === "xg_diff"), box = S.find((r) => r.stat === "touches_opp_box");
  const pts = S.find((r) => r.stat === "points");

  const skillPlot = useMemo(() => {
    if (!S.length) return undefined;
    // label sparingly: the top cluster is dense, so only its two headline stats, offset apart
    const label = new Set(["opposition_half_passes", "keeper_saves", "clearances", "fouls",
      "long_balls_accurate", "aerials_won", "expected_goals_set_play"]);
    const left = S.filter((d) => d.stat === "xg_diff"), right = S.filter((d) => d.stat === "touches_opp_box");
    return (width: number) => ({
      width, height: 460, marginLeft: 50, marginRight: 20, grid: true,
      x: { label: "Stability: split-half reliability within a team-season →", domain: [0.4, 1] },
      y: { label: "↑ Predicts second-half-of-season points (r)", domain: [-0.65, 0.75] },
      marks: [
        Plot.ruleY([0], { stroke: css("--axis") }),
        Plot.dot(S, { x: "reliability", y: "predict_r", r: 6, stroke: css("--surface"), strokeWidth: 2,
          fill: (d: any) => (d.group === "Results" ? css("--s2") : d.predict_r >= 0 ? css("--s1") : css("--neg")) }),
        Plot.text(S.filter((d) => label.has(d.stat)), { x: "reliability", y: "predict_r", text: "label", dy: -11, fontSize: 10.5, fill: css("--text-2") }),
        Plot.text(left, { x: "reliability", y: "predict_r", text: "label", dx: -10, dy: 14, textAnchor: "end", fontSize: 11, fontWeight: 600, fill: css("--text") }),
        Plot.text(right, { x: "reliability", y: "predict_r", text: "label", dx: 6, dy: 16, textAnchor: "middle", fontSize: 11, fontWeight: 600, fill: css("--text") }),
        Plot.tip(S, Plot.pointer({ x: "reliability", y: "predict_r", title: (d: any) =>
          `${d.label}\nreliability ${d.reliability.toFixed(2)} · predicts later points r = ${d.predict_r.toFixed(2)}\n${d.team_seasons} team-seasons` })),
      ],
    });
  }, [S]);

  const curvePlot = useMemo(() => {
    const rows = cu.rows.filter((r) => r.stat === curve);
    if (!rows.length) return undefined;
    const lbl = rows[0].label;
    return (width: number) => ({
      width, height: 280, marginLeft: 56,
      x: { label: curve === "ballpossesion" ? "Possession % in the match →" : `${lbl}: team minus opponent →` },
      y: { label: "↑ Points beyond the closing line's expectation", grid: true, tickFormat: (v: number) => fmt.signed(v, 2) },
      marks: [
        Plot.ruleY([0], { stroke: css("--axis") }),
        Plot.ruleX(rows, { x: "x", y1: (d: any) => d.res - 1.96 * d.res_se, y2: (d: any) => d.res + 1.96 * d.res_se, stroke: css("--s1"), strokeOpacity: 0.4, strokeWidth: 2 }),
        Plot.line(rows, { x: "x", y: "res", stroke: css("--s1"), strokeWidth: 2, curve: "monotone-x" }),
        Plot.dot(rows, { x: "x", y: "res", r: 4.5, fill: css("--s1"), stroke: css("--surface"), strokeWidth: 2 }),
        Plot.tip(rows, Plot.pointer({ x: "x", y: "res", title: (d: any) => `${fmt.n(d.x, 1)}: ${fmt.signed(d.res, 3)} points vs expectation (${fmt.n(d.n)} team-matches)\nactual ${d.ppg.toFixed(2)} ppg, expected ${d.xpts.toFixed(2)}` })),
      ],
    });
  }, [cu.rows, curve]);

  const drivers = [...dr.rows].sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect));
  const rain = wg.rows.find((r) => r.factor === "rain");
  const curveOpts = [...new Map(cu.rows.map((r) => [r.stat, r.label])).entries()] as [string, string][];

  return (
    <>
      <PageHead eyebrow="Research · what wins"
        title={box && xg ? `Touches in the opposition box predict future points as well as xG, and they're more stable` : "What wins football matches"}
        lead={<>From {fmt.n(dr.rows[0]?.n ? dr.rows[0].n / 2 : null)} league matches across nine leagues since 2024-25 (FotMob/Opta team stats), we asked which
          numbers are repeatable team traits, which predict results, and what the winning side actually did. Companion to the <Link to="/factors">hidden-factors study</Link>.</>} />
      <Loading state={st} />
      <div className="tiles" style={{ marginBottom: 16 }}>
        <Tile label="xG difference → later points" value={xg ? `r ${xg.predict_r.toFixed(2)}` : "–"} delta="first half of a season predicts the second" />
        <Tile label="Touches in the box → later points" value={box ? `r ${box.predict_r.toFixed(2)}` : "–"} delta={box ? `and more stable (${box.reliability.toFixed(2)} vs ${xg?.reliability.toFixed(2)})` : ""} />
        <Tile label="Points → later points" value={pts ? `r ${pts.predict_r.toFixed(2)}` : "–"} delta="the table is a noisier guide than xG" />
        <Tile label="Defending a lot → later points" value={fmt.signed(S.find((r) => r.stat === "keeper_saves")?.predict_r, 2)} delta="saves, blocks, clearances signal being dominated" tone="down" />
      </div>

      <div className="grid">
        <div className="c7">
          {skillPlot && <Figure title="Skill vs luck: which team stats are real, and which matter"
            subtitle="Each dot is a stat (team minus opponent per match). Right = a stable trait of the team (odd vs even matches agree). Up = a team's first-half-of-season average predicts its points per game in the second half. Orange: results themselves. Red: stats that predict fewer points."
            source="FotMob (Opta) team stats, 2024-25 onward" plot={skillPlot} alt="Stat stability against predictive power"
            table={{ rows: top, cols: [["label", "Stat"], ["reliability", "Reliability", (v) => v?.toFixed(2)], ["predict_r", "Predicts later points (r)", (v) => v.toFixed(2)], ["team_seasons", "Team-seasons"]] }} />}
        </div>
        <div className="c5 stack" style={{ gap: 16 }}>
          <Card title="What it means for a club">
            <ul className="small ink2" style={{ paddingLeft: "1.1rem", margin: 0, lineHeight: 1.65 }}>
              <li><b>Judge teams on xG difference and box presence, not the table.</b> Half a season of xG difference predicts the rest at least as well as goal difference or points do.</li>
              <li><b>Territory is a trait.</b> Passes in the opposition half (reliability {S.find((r) => r.stat === "opposition_half_passes")?.reliability.toFixed(2)}) and possession are the most stable things a team does; they predict results well, but less well than getting into the box.</li>
              <li><b>Defensive volume is a warning, not a virtue.</b> Teams making many tackles, clearances, blocks and saves take fewer points later: they're being dominated.</li>
              <li><b>Set-piece xG is half noise</b> within a season (reliability {S.find((r) => r.stat === "expected_goals_set_play")?.reliability.toFixed(2)}): don't over-read a good or bad run.</li>
              <li><b>Long balls and aerial duels barely predict anything.</b></li>
            </ul>
          </Card>
          <Card title="Method" sub="Split-half reliability: correlation of a team's averages over its odd and even matches, stepped up to a full season (Spearman-Brown). Predictive r: correlation of a team's first-half-of-season average with its points per game in the second half. 401 team-seasons with at least 20 matches." />
        </div>
      </div>

      <section className="section">
        <h2>What the winning side did</h2>
        <p className="ink2 small" style={{ maxWidth: 860 }}>Points beyond what the closing line expected, against each stat's difference in the match. This is descriptive and shaped by
          game state: a team that goes ahead sits deeper, so possession, passes and crosses look "bad" and clearances look "good". Read it as what winning looks like, not as advice.</p>
        <div className="grid">
          <div className="c7">
            <Card title="Change in points per SD of the in-match difference" right={<Seg value={view as any} onChange={setView} label="Model" options={[["single", "One at a time"], ["joint", "Together (5 stats)"]]} />}>
              <EffectBars unit=" pts" rows={(view === "joint" ? drivers.filter((r) => r.joint_effect != null).map((r) => ({ ...r, effect: r.joint_effect, effect_se: r.joint_se })) : drivers.slice(0, 18))
                .map((r: any) => ({ label: r.label, b: r.effect, se: r.effect_se, note: <div className="muted xs">{r.group} · {fmt.n(r.n)} team-matches · r with goal difference {r.r_gd?.toFixed(2)}</div> }))} />
            </Card>
          </div>
          <div className="c5">
            {curvePlot && <Figure title="Does it pay to have the ball, or to run more?"
              subtitle="Results beyond the closing line's expectation, by decile of the stat in the match. Physical data covers fewer matches."
              right={<select value={curve} onChange={(e) => setCurve(e.target.value)} aria-label="Stat">{curveOpts.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>}
              source="FotMob (Opta)" plot={curvePlot} alt="Results by stat decile"
              table={{ rows: cu.rows.filter((r) => r.stat === curve), cols: [["x", "Stat", (v) => fmt.n(v, 1)], ["n", "Team-matches"], ["res", "Points vs expectation", (v) => fmt.signed(v, 3)]] }} />}
          </div>
        </div>
      </section>

      <section className="section">
        <h2>New factors from the FotMob era: travel, weather, absences</h2>
        <p className="ink2 small" style={{ maxWidth: 860 }}>Tested exactly like the <Link to="/factors">hidden factors</Link>: beyond our model and beyond the closing line, discovery on 2024-25 and
          replication on 2025-26 onward (weather only exists from 2025-26, so it can't be replicated yet).</p>
        <div className="grid">
          <div className="c7">
            <Card title="Effect beyond the closing line, per SD (per unit for yes/no)">
              <EffectBars unit=" pts" rows={ff.rows.map((r) => ({ label: r.label, b: r.market_all_b, se: r.market_all_se,
                note: <div className="muted xs">{r.verdict} · vs our model {fmt.signed(r.model_all_b, 3)} · market moves {fmt.signed(r.market_shift, 3)} · n {fmt.n(r.n)}</div> }))} />
            </Card>
          </div>
          <div className="c5 stack" style={{ gap: 16 }}>
            <Card title="None beats the market">
              <p className="small ink2">Away travel distance, injured players' value, suspensions, temperature and wind move nothing beyond the closing odds.
                Injuries are priced: the market moves {fmt.signed(ff.rows.find((r) => r.factor === "injured_value_share_diff")?.market_shift, 3)} points per SD of injured value while our ratings model doesn't,
                which is a concrete gap in our forecasts.</p>
            </Card>
            {rain && <Card title={`Candidate: rain adds goals the market misses (${fmt.signed(100 * rain.b, 1)} pp)`}>
              <p className="small ink2">In {fmt.n(rain.n)} matches with weather data, games played in rain went over 2.5 goals {fmt.signed(100 * rain.b, 1)} percentage points more often than the market priced
                (±{fmt.n(196 * rain.se, 1)}; false-discovery q {rain.q.toFixed(3)}). Weather data starts in 2025-26, so this is
                <b> not replicated</b>: it's re-tested automatically as the season goes on.</p>
            </Card>}
          </div>
        </div>
      </section>
    </>
  );
}
