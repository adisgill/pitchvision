import * as Plot from "@observablehq/plot";
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { lit, Row, useQuery } from "../db";
import { css, fmt, LEAGUES, SIM_LEAGUES } from "../lib/format";
import { EffectBars } from "../ui/charts";
import { Figure } from "../ui/Figure";
import { Card, ClubLink, DataTable, Field, Loading, PageHead, Select, Tile, useParam } from "../ui/kit";
import { managerSlug } from "../lib/tactics";
import { shrink, stintHalvesSql, stintsSql } from "./team/stints";

export default function Managers() {
  const [league, setLeague] = useParam("league", "all");
  const [minS, setMin] = useParam("min", "38");
  const min = Number(minS);
  const where = league === "all" ? `m.competition_id in (${SIM_LEAGUES.map(lit).join(", ")})` : `m.competition_id = ${lit(league)}`;
  const q = useQuery(`select * from (${stintsSql(where)}) order by n desc`);
  const halves = useQuery(`select * from (${stintHalvesSql(where)}) where n >= 76`);
  const slugs = useQuery(`select distinct manager, manager_slug from manager_spells`);
  const slugOf = useMemo(() => new Map(slugs.rows.map((r) => [r.manager, r.manager_slug])), [slugs.rows]);

  const { rows, tau2 } = useMemo(() => {
    const s = shrink(q.rows, min);
    return { rows: s.rows.filter((r) => r.n >= min), tau2: s.tau2 };
  }, [q.rows, min]);

  const persist = useMemo(() => {
    const h = halves.rows.filter((r) => r.first_half != null && r.second_half != null);
    if (h.length < 10) return null;
    const mx = h.reduce((a, r) => a + r.first_half, 0) / h.length, my = h.reduce((a, r) => a + r.second_half, 0) / h.length;
    let sxy = 0, sxx = 0, syy = 0;
    h.forEach((r) => { sxy += (r.first_half - mx) * (r.second_half - my); sxx += (r.first_half - mx) ** 2; syy += (r.second_half - my) ** 2; });
    return { r: sxy / Math.sqrt(sxx * syy), n: h.length, rows: h };
  }, [halves.rows]);

  const sd = useMemo(() => {
    const all = rows.filter((r) => r.n >= 10);
    return all.length ? Math.sqrt(all.reduce((a, r) => a + r.se ** 2 * r.n, 0) / all.length) : 1.2;
  }, [rows]);

  const funnel = useMemo(() => {
    if (!rows.length) return undefined;
    const maxN = Math.max(...rows.map((r) => r.n));
    const band = Array.from({ length: 60 }, (_, i) => { const n = min + ((maxN - min) * i) / 59; return { n, lo: -1.96 * sd / Math.sqrt(n), hi: 1.96 * sd / Math.sqrt(n) }; });
    const labelled = [...rows].sort((a, b) => Math.abs(b.over_pm / b.se) - Math.abs(a.over_pm / a.se)).slice(0, 6);
    return (width: number) => ({
      width, height: 380, marginLeft: 50, x: { label: "League matches in charge →", type: "log" as const },
      y: { label: "↑ Points per match above the odds", grid: true, tickFormat: (v: number) => fmt.signed(v, 2) },
      marks: [
        Plot.areaY(band, { x: "n", y1: "lo", y2: "hi", fill: css("--muted"), fillOpacity: 0.14 }),
        Plot.ruleY([0], { stroke: css("--axis") }),
        Plot.dot(rows, { x: "n", y: "over_pm", r: 4.5, fill: css("--s1"), fillOpacity: 0.75, stroke: css("--surface"), strokeWidth: 1.5 }),
        Plot.text(labelled, { x: "n", y: "over_pm", text: (r: any) => r.manager, dy: -10, fill: css("--text"), fontSize: 10.5 }),
        Plot.tip(rows, Plot.pointer({ x: "n", y: "over_pm", title: (r: any) =>
          `${r.manager} · ${r.team}\n${fmt.date(r.start_date)} – ${fmt.date(r.end_date)}\n${r.n} matches: ${fmt.n(r.ppg, 2)} PPG vs ${fmt.n(r.xppg, 2)} expected\n${fmt.signed(r.over_pm, 2)} ± ${fmt.n(1.96 * r.se, 2)} per match (shrunk ${fmt.signed(r.shrunk, 2)})` })),
      ],
    });
  }, [rows, sd, min]);

  const persistPlot = useMemo(() => {
    if (!persist) return undefined;
    return (width: number) => ({
      width, height: 300, marginLeft: 50, x: { label: "First half of the spell →", tickFormat: (v: number) => fmt.signed(v, 1) },
      y: { label: "↑ Second half", grid: true, tickFormat: (v: number) => fmt.signed(v, 1) },
      marks: [
        Plot.ruleX([0], { stroke: css("--axis") }), Plot.ruleY([0], { stroke: css("--axis") }),
        Plot.dot(persist.rows, { x: "first_half", y: "second_half", r: 4, fill: css("--s1"), fillOpacity: 0.7, stroke: css("--surface") }),
        Plot.linearRegressionY(persist.rows, { x: "first_half", y: "second_half", stroke: css("--s2"), strokeWidth: 2 }),
        Plot.tip(persist.rows, Plot.pointer({ x: "first_half", y: "second_half", title: (r: any) => `${r.manager}\n${r.n} matches\nfirst half ${fmt.signed(r.first_half, 2)}, second ${fmt.signed(r.second_half, 2)} per match` })),
      ],
    });
  }, [persist]);

  const ranked = [...rows].sort((a, b) => b.shrunk - a.shrunk);
  const top = ranked.slice(0, 12), bottom = ranked.slice(-12).reverse();
  const signal = tau2 > 0 ? Math.sqrt(tau2) : 0;
  return (
    <>
      <PageHead eyebrow="Managers"
        title={persist ? (persist.r < 0.15 ? "Beating the odds as a manager barely persists" : `Managers who beat the odds tend to keep doing it (r = ${fmt.n(persist.r, 2)})`) : "Managers against the odds"}
        lead={<>Every spell in charge since 2017-18, scored on points won minus the points the closing betting market expected from the same fixtures. The odds already price
          squad quality and the manager's reputation, so this is <em>results beyond what bettors expected</em>. Most of it is noise; the shrunk figure accounts for that.
          (Our <Link to="/factors">hidden-factors study</Link> found no new-manager bounce either.)</>} />
      <div className="filters">
        <Select label="League" value={league} onChange={(v) => setLeague(v)} options={[["all", "All eight leagues"], ...SIM_LEAGUES.map((k) => [k, LEAGUES[k]] as [string, string])]} />
        <Select label="Minimum matches" value={minS} onChange={(v) => setMin(v)} options={[["19", "19"], ["38", "38 (a season)"], ["76", "76"], ["114", "114"]]} />
        <Field label="Spells shown"><span className="small" style={{ padding: "0.45rem 0" }}>{rows.length}</span></Field>
      </div>
      <Loading state={q} />
      <div className="tiles" style={{ marginBottom: 16 }}>
        <Tile label="Spread of true manager effects" value={`±${fmt.n(signal, 2)}`} delta="points per match (1 SD), after removing noise" />
        <Tile label="Noise in one season (38 matches)" value={`±${fmt.n(sd / Math.sqrt(38), 2)}`} delta="1 SD of luck alone" tone="down" />
        {persist && <Tile label="First-half vs second-half correlation" value={fmt.n(persist.r, 2)} delta={`${persist.n} spells of 76+ matches`} />}
        {ranked[0] && <Tile label="Best shrunk record" value={ranked[0].manager} delta={`${fmt.signed(ranked[0].shrunk, 2)}/match at ${ranked[0].team}`} />}
      </div>
      <div className="grid">
        <div className="c7">
          {funnel && <Figure title="Most spells sit inside the band luck alone produces"
            subtitle={`Each dot is a spell in charge. The grey funnel is the 95% range of pure luck for that many matches (match-to-match spread ±${fmt.n(sd, 2)} points); dots outside it are candidates for real skill — or for the odds missing something.`}
            source="Transfermarkt managers, football-data.co.uk closing odds" plot={funnel} alt="Funnel plot of manager over-performance"
            table={{ rows, cols: [["manager", "Manager"], ["team", "Club"], ["n", "Matches"], ["over_pm", "vs odds", (v) => fmt.signed(v, 2)], ["shrunk", "Shrunk", (v) => fmt.signed(v, 2)]] }} />}
        </div>
        <div className="c5">
          {persistPlot && <Figure title={`Does it persist? r = ${fmt.n(persist!.r, 2)}`}
            subtitle="Long spells (76+ matches) split in half by match order: results vs the odds in the first half against the second. A real, lasting skill would line up along a rising line."
            source="Transfermarkt, football-data.co.uk" plot={persistPlot} alt="First-half against second-half over-performance"
            table={{ rows: persist!.rows, cols: [["manager", "Manager"], ["n", "Matches"], ["first_half", "First half", (v) => fmt.signed(v, 2)], ["second_half", "Second half", (v) => fmt.signed(v, 2)]] }} />}
        </div>
        <div className="c12">
          <Card title="Furthest above the odds (shrunk)" sub="Dot: raw points per match above expectation; whisker: 95% interval.">
            <EffectBars rows={top.map((r) => ({ label: `${r.manager} (${r.team})`, b: r.over_pm, se: r.se, note: <div className="muted">{r.n} matches · shrunk {fmt.signed(r.shrunk, 2)}</div> }))} unit=" pts/match" />
          </Card>
        </div>
        <div className="c12">
          <Card title="Furthest below the odds (shrunk)" sub="Same scale. Sacked managers' short spells dominate here.">
            <EffectBars rows={bottom.map((r) => ({ label: `${r.manager} (${r.team})`, b: r.over_pm, se: r.se, note: <div className="muted">{r.n} matches · shrunk {fmt.signed(r.shrunk, 2)}</div> }))} unit=" pts/match" />
          </Card>
        </div>
        <div className="c12">
          <Card title="All spells" sub="Shrunk: the raw figure pulled toward zero in proportion to its noise (empirical Bayes).">
            <DataTable rows={rows} initialSort={{ key: "shrunk", desc: true }} rank maxHeight={600} cols={[
              { key: "manager", label: "Manager", fmt: (v) => <Link to={`/manager/${slugOf.get(v) ?? managerSlug(String(v))}`}>{v}</Link> },
              { key: "team", label: "Club", fmt: (v, r: Row) => <ClubLink id={r.club_id} name={v} /> },
              { key: "league", label: "League", fmt: (v) => LEAGUES[v] ?? v },
              { key: "start_date", label: "From", fmt: (v) => fmt.date(v) },
              { key: "end_date", label: "To", fmt: (v) => fmt.date(v) },
              { key: "n", label: "Matches", num: true },
              { key: "ppg", label: "PPG", num: true, fmt: (v) => fmt.n(v, 2) },
              { key: "xppg", label: "Expected", num: true, fmt: (v) => fmt.n(v, 2) },
              { key: "over_pm", label: "vs odds", num: true, fmt: (v, r) => <>{fmt.signed(v, 2)} <span className="muted xs">±{fmt.n(1.96 * r.se, 2)}</span></> },
              { key: "shrunk", label: "Shrunk", num: true, heat: "pos", fmt: (v) => fmt.signed(v, 2) },
            ]} />
          </Card>
        </div>
      </div>
    </>
  );
}
