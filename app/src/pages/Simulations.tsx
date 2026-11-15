import * as Plot from "@observablehq/plot";
import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { css, Figure, fmt, LEAGUES, Loading, seasonLabel, Select } from "../components";
import { lit, useQuery } from "../db";

const SIM_LEAGUES = ["GB1", "ES1", "L1", "IT1", "FR1", "NL1", "PO1", "GB2"];

export default function Simulations() {
  const [params, setParams] = useSearchParams();
  const league = params.get("league") ?? "GB1";
  const sim = useQuery(`select * from season_sim where competition_id = ${lit(league)} order by exp_points desc`);
  const bt = useQuery(`select * from season_backtest_eval where league = ${lit(league)}`);

  const heat = useMemo(() => {
    if (!sim.rows.length) return undefined;
    const n = sim.rows.length;
    const cells = sim.rows.flatMap((r) =>
      Array.from({ length: n }, (_, i) => ({ team: r.name, pos: i + 1, p: r[`p_pos_${i + 1}`] ?? 0 })));
    const order = sim.rows.map((r) => r.name);
    return (width: number) => ({
      width, height: order.length * 22 + 60, marginLeft: 120, padding: 0.05,
      x: { label: "Final position", domain: Array.from({ length: n }, (_, i) => i + 1), tickSize: 0 },
      y: { label: null, domain: order, tickSize: 0 },
      color: { type: "sqrt", scheme: "blues", domain: [0, 1], legend: true, label: "Probability" },
      marks: [
        Plot.cell(cells, { x: "pos", y: "team", fill: "p", inset: 0.5,
                           title: (d: any) => `${d.team}: ${fmt.pct(d.p, 1)} to finish ${d.pos}` }),
        Plot.text(cells.filter((d) => d.p >= 0.1), { x: "pos", y: "team", text: (d: any) => Math.round(100 * d.p),
                                                     fill: (d: any) => (d.p > 0.45 ? "white" : css("--text")), fontSize: 9 }),
      ],
    });
  }, [sim.rows]);

  const skill = bt.rows.filter((r) => r.variant === "model");
  const eq = Object.fromEntries(bt.rows.filter((r) => r.variant === "equal strength").map((r) => [r.zone, r.brier]));

  return (
    <>
      <h1>Season simulations</h1>
      <div className="controls">
        <Select label="League" value={league} onChange={(v) => setParams({ league: v })}
                options={SIM_LEAGUES.map((k) => [k, LEAGUES[k]])} />
      </div>
      <Loading state={sim} />
      {heat && (
        <Figure title={`Where every ${LEAGUES[league]} team finishes ${seasonLabel(Number(sim.rows[0].season), league)}`}
                subtitle={<>Share of 10,000 simulated seasons ending in each position, from results to {fmt.date(sim.rows[0]?.as_of)}.
                  Strength uncertainty included; numbers shown where at least 10%.</>}
                source="football-data.co.uk results" plot={heat} alt="Heatmap of final-position probabilities" />
      )}
      <div className="card" style={{ marginTop: "1rem" }}>
        <p className="figure-title">How good were these odds in past seasons?</p>
        <p className="figure-sub">Every complete season 2017-18 to 2025-26 simulated from its halfway point, then scored against the final
          table (Brier score, lower is better), against the same simulator with every team equally strong.</p>
        <table className="data">
          <thead><tr><th>Zone</th><th className="r">Brier (model)</th><th className="r">Brier (equal strength)</th><th className="r">Skill</th></tr></thead>
          <tbody>
            {skill.map((r) => (
              <tr key={r.zone}>
                <td>{r.zone.replace("_", " ")}</td>
                <td className="r">{fmt.n(r.brier, 4)}</td>
                <td className="r">{fmt.n(eq[r.zone], 4)}</td>
                <td className="r" style={{ color: eq[r.zone] > r.brier ? "var(--good)" : "var(--bad)" }}>
                  {fmt.pct(1 - r.brier / eq[r.zone], 0)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
