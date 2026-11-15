import * as Plot from "@observablehq/plot";
import { useMemo } from "react";
import { lit, Row, useQuery } from "../../db";
import { css, fmt, seasonLabel } from "../../lib/format";
import { Figure } from "../../ui/Figure";
import { Card, Empty, Tile } from "../../ui/kit";
import { InlineLegend } from "./shared";

export default function Impact({ id }: { id: string }) {
  const rapm = useQuery(`select * from rapm where player_id = ${lit(id)} order by season`);
  const proj = useQuery(`select * from age_projection where player_id = ${lit(id)}
                         and season = (select max(season) from age_projection where player_id = ${lit(id)}) order by metric, horizon`);
  const r = rapm.rows;
  const last = r[r.length - 1];
  const avgW = r.length ? r.reduce((a, x) => a + x.data_weight, 0) / r.length : null;

  const plot = useMemo(() => {
    if (!r.length) return undefined;
    const rows = r.map((x) => ({ ...x, s: seasonLabel(x.season) }));
    return (width: number) => ({
      width, height: 300, marginLeft: 52,
      x: { label: null, domain: rows.map((x) => x.s) },
      y: { label: "↑ Goal difference per 90 vs an average player", grid: true },
      marks: [
        Plot.ruleY([0], { stroke: css("--axis") }),
        Plot.line(rows, { x: "s", y: "prior", stroke: css("--muted"), strokeWidth: 2 }),
        Plot.line(rows, { x: "s", y: "rapm", stroke: css("--s1"), strokeWidth: 2 }),
        Plot.dot(rows, { x: "s", y: "rapm", r: (d: Row) => 3 + 6 * d.data_weight, fill: css("--s1"), stroke: css("--surface"), strokeWidth: 2 }),
        Plot.tip(rows, Plot.pointerX({ x: "s", y: "rapm", title: (d: Row) =>
          `${d.s}\nRAPM ${fmt.signed(d.rapm)} (prior ${fmt.signed(d.prior)}, data alone ${fmt.signed(d.rapm_noprior)})\n${fmt.pct(d.data_weight)} of the estimate from on-pitch data · ${fmt.n(d.exposure_90s, 0)} 90s${d.prior_dominated ? "\nmostly prior" : ""}` })),
      ],
    });
  }, [r]);

  const projPlot = useMemo(() => {
    const rows = proj.rows;
    if (!rows.length) return undefined;
    const base = rows[0];
    const series = ["minutes_share", "np90"].map((metric) => {
      const pts = rows.filter((x) => x.metric === metric);
      if (!pts.length) return [];
      return [{ metric, age: pts[0].age, v: pts[0].now, lo: pts[0].now, hi: pts[0].now }, ...pts.map((x) => ({ metric, age: x.age + x.horizon, v: x.proj, lo: x.lo, hi: x.hi }))];
    });
    return { base, series };
  }, [proj.rows]);

  const mkProj = (metric: string, label: string, f: (v: number) => string) => {
    const s = projPlot?.series.find((x) => x[0]?.metric === metric);
    if (!s || !s.length) return null;
    return (width: number) => ({
      width, height: 200, marginLeft: 48,
      x: { label: "Age →", ticks: s.map((d) => d.age), tickFormat: (d: number) => String(d) },
      y: { label: `↑ ${label}`, grid: true, tickFormat: metric === "minutes_share" ? "%" : undefined, zero: true },
      marks: [
        Plot.areaY(s, { x: "age", y1: "lo", y2: "hi", fill: css("--s1"), fillOpacity: 0.12 }),
        Plot.line(s, { x: "age", y: "v", stroke: css("--s1"), strokeWidth: 2 }),
        Plot.dot(s, { x: "age", y: "v", r: 4, fill: css("--s1"), stroke: css("--surface"), strokeWidth: 2 }),
        Plot.tip(s, Plot.pointerX({ x: "age", y: "v", title: (d: any) => `Age ${d.age}: ${f(d.v)}\n80% range ${f(d.lo)}–${f(d.hi)}` })),
      ],
    });
  };
  const minPlot = useMemo(() => mkProj("minutes_share", "Share of team minutes", (v) => fmt.pct(v)), [projPlot]);
  const npPlot = useMemo(() => mkProj("np90", "Non-penalty goals / 90", (v) => fmt.n(v, 2)), [projPlot]);

  return (
    <div className="grid">
      <div className="c12">
        <div className="tiles">
          <Tile label={last ? `RAPM ${seasonLabel(last.season)}` : "RAPM"} value={last ? fmt.signed(last.rapm) : "–"}
                delta={last ? (last.prior_dominated ? "mostly prior: little on-pitch evidence" : `${fmt.pct(last.data_weight)} from on-pitch data`) : "not rated"}
                tone={last ? (last.rapm >= 0 ? "up" : "down") : undefined} />
          <Tile label="Average weight of on-pitch data" value={fmt.pct(avgW)} delta="the rest is the box-score prior" />
          <Tile label="Seasons rated" value={fmt.n(r.length)} />
        </div>
      </div>
      <div className="c8">
        {plot ? (
          <Figure title={last ? `Worth ${fmt.signed(last.rapm)} goals per 90 to his team in ${seasonLabel(last.season)}` : "On-pitch impact"}
                  subtitle={<>
                    <InlineLegend items={[{ label: "RAPM (with prior)", color: "var(--s1)", kind: "line" }, { label: "Box-score prior it is shrunk toward", color: "var(--muted)", kind: "line" }]} />
                    Goal difference while he's on the pitch, adjusted for team-mates and opponents. Bigger dots: more of the estimate comes from on-pitch
                    data. Honest caveat: in our tests RAPM correlates 0.82 with future impact and the prior alone 0.82, so the on-pitch signal adds little.
                  </>}
                  source="Transfermarkt line-ups, substitutions and goals" plot={plot} alt="RAPM by season"
                  table={{ rows: r, cols: [["season", "Season", (v) => seasonLabel(v)], ["rapm", "RAPM", (v) => fmt.signed(v)], ["prior", "Prior", (v) => fmt.signed(v)], ["data_weight", "Data weight", fmt.pct], ["exposure_90s", "90s", (v) => fmt.n(v, 0)]] }} />
        ) : <Empty>No RAPM: needs at least five 90s in the top seven leagues (seasons to 2024-25).</Empty>}
      </div>
      <div className="c4">
        <Card title="How to read RAPM" sub={null}>
          <p className="small ink2">Regularised adjusted plus-minus asks: holding everyone else on the pitch fixed, how does the goal difference change with this player on?</p>
          <p className="small ink2">Football has few goals and stable line-ups, so the data alone is noisy. We shrink toward a prior built from box-score output and market value, and show how much of each estimate is evidence vs prior.</p>
        </Card>
      </div>
      {projPlot?.base && (
        <>
          <div className="c6">{minPlot && <Figure title="Projected playing time" subtitle={`From age ${projPlot.base.age} (${seasonLabel(projPlot.base.season)}): the position's average ageing curve applied to his level, 80% band.`}
                                                  source="pitchvision age curves" plot={minPlot} alt="Projected minutes share by age"
                                                  table={{ rows: proj.rows.filter((x) => x.metric === "minutes_share"), cols: [["horizon", "Years ahead"], ["proj", "Projected", fmt.pct], ["lo", "Low", fmt.pct], ["hi", "High", fmt.pct]] }} />}</div>
          <div className="c6">{npPlot && <Figure title="Projected scoring rate" subtitle="Non-penalty goals per 90 along the average ageing curve. A curve, not a scouting forecast."
                                                 source="pitchvision age curves" plot={npPlot} alt="Projected goals per 90 by age"
                                                 table={{ rows: proj.rows.filter((x) => x.metric === "np90"), cols: [["horizon", "Years ahead"], ["proj", "Projected", (v) => fmt.n(v, 2)], ["lo", "Low", (v) => fmt.n(v, 2)], ["hi", "High", (v) => fmt.n(v, 2)]] }} />}</div>
        </>
      )}
    </div>
  );
}
