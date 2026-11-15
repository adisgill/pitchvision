import * as Plot from "@observablehq/plot";
import { useMemo, useState } from "react";
import { Row, useQuery } from "../../db";
import { css, fmt, LEAGUES, SIM_LEAGUES } from "../../lib/format";
import { Figure } from "../../ui/Figure";
import { Card, Field, Legend, Loading, Seg, Tile } from "../../ui/kit";
import { HighlightPicker, shortSeason } from "./shared";

const MEASURES: { key: string; label: string; unit: (v: number) => string; note: string }[] = [
  { key: "gpm", label: "Goals per match", unit: (v) => fmt.n(v, 2), note: "Total goals per match." },
  { key: "home_adv", label: "Home advantage", unit: (v) => fmt.signed(v, 2), note: "Home points minus away points per match." },
  { key: "home_win", label: "Home wins", unit: (v) => fmt.pct(v), note: "Share of matches won by the home side." },
  { key: "draw", label: "Draws", unit: (v) => fmt.pct(v), note: "Share of matches drawn." },
  { key: "away_win", label: "Away wins", unit: (v) => fmt.pct(v), note: "Share of matches won by the away side." },
  { key: "shots", label: "Shots per match", unit: (v) => fmt.n(v, 1), note: "Both teams' shots per match." },
  { key: "sot_pct", label: "Shots on target", unit: (v) => fmt.pct(v), note: "Share of shots on target." },
  { key: "cards", label: "Cards per match", unit: (v) => fmt.n(v, 2), note: "Yellow and red cards, both teams." },
  { key: "fav", label: "Favourites winning", unit: (v) => fmt.pct(v), note: "Share of matches won by the closing-odds favourite." },
];

export default function TrendsTab() {
  const q = useQuery(`
    select competition_id, season, count(*) n,
           avg(home_goals + away_goals) gpm,
           avg(case when home_goals > away_goals then 3 when home_goals = away_goals then 1 else 0 end
             - case when away_goals > home_goals then 3 when home_goals = away_goals then 1 else 0 end) home_adv,
           avg((home_goals > away_goals)::int) home_win, avg((home_goals = away_goals)::int) draw, avg((home_goals < away_goals)::int) away_win,
           avg(home_shots + away_shots) shots, sum(home_sot + away_sot) / nullif(sum(home_shots + away_shots), 0) sot_pct,
           avg(home_yellows + away_yellows + home_reds + away_reds) cards,
           avg(case when close_home is null then null
                    when close_home <= least(close_draw, close_away) then (home_goals > away_goals)::int
                    when close_away <= least(close_draw, close_home) then (away_goals > home_goals)::int
                    else (home_goals = away_goals)::int end) fav
    from matches where played and competition_id in (${SIM_LEAGUES.map((l) => `'${l}'`).join(",")})
    group by all having count(*) >= 60 order by season`);
  const [measure, setMeasure] = useState("home_adv");
  const [picked, setPicked] = useState<string[]>(["GB1", "ES1", "L1"]);
  const m = MEASURES.find((x) => x.key === measure)!;
  const rows: Row[] = q.rows.map((r) => ({ ...r, league: LEAGUES[r.competition_id] }));
  const latest = Math.max(0, ...rows.map((r) => r.season));

  const plot = useMemo(() => {
    if (!rows.length) return undefined;
    const hl = new Map(picked.map((id, i) => [id, css(`--s${i + 1}`)]));
    const grey = rows.filter((r) => !hl.has(r.competition_id) && r[measure] != null), col = rows.filter((r) => hl.has(r.competition_id) && r[measure] != null);
    const ends = [...new Map(col.map((r) => [r.competition_id, r])).values()];
    const allAvg = Object.values(rows.reduce((acc: Record<number, { s: number; n: number; season: number }>, r) => {
      if (r[measure] == null) return acc;
      const a = acc[r.season] ?? { s: 0, n: 0, season: r.season }; a.s += r[measure] * r.n; a.n += r.n; acc[r.season] = a; return acc;
    }, {})).map((a) => ({ season: a.season, v: a.s / a.n }));
    const covid = rows.find((r) => r.season === 2020);
    return (width: number) => ({
      width, height: 400, marginRight: 110, marginLeft: 50,
      x: { label: null, tickFormat: (s: number) => shortSeason(s), ticks: [...new Set(rows.map((r) => r.season))].filter((s) => width > 700 || s % 2 === 0) },
      y: { label: `↑ ${m.label}`, grid: true, tickFormat: m.key.includes("win") || m.key === "draw" || m.key === "sot_pct" || m.key === "fav" ? "%" : undefined },
      marks: [
        measure === "home_adv" ? Plot.ruleY([0], { stroke: css("--axis") }) : null,
        covid && measure === "home_adv" ? Plot.rectX([{ x1: 2019.6, x2: 2020.4 }], { x1: "x1", x2: "x2", fill: css("--surface-2") }) : null,
        covid && measure === "home_adv" ? Plot.text(["Empty stadiums (2020-21)"], { x: 2020, frameAnchor: "top", dy: 8, fill: css("--text-2"), fontSize: 11 }) : null,
        Plot.line(grey, { x: "season", y: measure, z: "competition_id", stroke: css("--axis"), strokeWidth: 1.25 }),
        Plot.line(allAvg, { x: "season", y: "v", stroke: css("--muted"), strokeWidth: 1.5, strokeDasharray: "1 0" }),
        Plot.line(col, { x: "season", y: measure, z: "competition_id", stroke: (d: any) => hl.get(d.competition_id), strokeWidth: 2.5 }),
        Plot.dot(col, { x: "season", y: measure, fill: (d: any) => hl.get(d.competition_id), r: 3, stroke: css("--surface"), strokeWidth: 1.5 }),
        Plot.text(ends, { x: "season", y: measure, text: "league", dx: 8, textAnchor: "start", fill: css("--text"), fontSize: 11, fontWeight: 600 }),
        Plot.tip(rows.filter((r) => r[measure] != null), Plot.pointer({ x: "season", y: measure, title: (d: any) => `${d.league} ${shortSeason(d.season)}\n${m.label}: ${m.unit(d[measure])}\n${d.n} matches` })),
      ],
    });
  }, [rows, measure, picked]);

  const ha = (s: number) => {
    const r = rows.filter((x) => x.season === s);
    const n = r.reduce((a, x) => a + x.n, 0);
    return n ? r.reduce((a, x) => a + x.home_adv * x.n, 0) / n : null;
  };
  return (
    <>
      <Loading state={q} />
      <div className="tiles" style={{ marginBottom: 16 }}>
        <Tile label="Home advantage 2018-19" value={fmt.signed(ha(2018), 2)} delta="points per match, all eight leagues" />
        <Tile label="…in empty stadiums (2020-21)" value={fmt.signed(ha(2020), 2)} delta="crowds are most of home advantage" tone="down" />
        <Tile label={`…in ${shortSeason(latest)}`} value={fmt.signed(ha(latest), 2)} delta="so far this season" />
      </div>
      <div className="filters">
        <Field label="Measure"><Seg value={measure} onChange={setMeasure} label="Measure" options={MEASURES.map((x) => [x.key, x.label])} /></Field>
      </div>
      <HighlightPicker teams={SIM_LEAGUES.map((l) => ({ id: l, name: LEAGUES[l] }))} picked={picked} onChange={setPicked} />
      {plot && (
        <Figure title={measure === "home_adv" ? "Home advantage collapsed without crowds, and hasn't fully come back" : `${m.label}, season by season`}
                subtitle={<>{m.note} Up to three leagues in colour (pick above); the rest in grey; the darker grey line is the all-league average. Season 2026-27 is in progress.</>}
                source="football-data.co.uk" plot={plot} alt={`${m.label} by league and season`}
                right={<Legend items={[...picked.map((id, i) => ({ label: LEAGUES[id], color: `var(--s${i + 1})`, kind: "line" as const })), { label: "All leagues", color: "var(--muted)", kind: "line" }]} />}
                table={{ rows, cols: [["league", "League"], ["season", "Season", (v) => shortSeason(v)], [measure, m.label, (v) => m.unit(v)], ["n", "Matches"]] }} />
      )}
      <div style={{ marginTop: 16 }}>
        <Card title="Every league, every season" sub={`${m.label} by league (rows) and season (columns). Darker = higher.`}>
          <HeatTable rows={rows} measure={measure} unit={m.unit} />
        </Card>
      </div>
    </>
  );
}

function HeatTable({ rows, measure, unit }: { rows: any[]; measure: string; unit: (v: number) => string }) {
  const seasons = [...new Set(rows.map((r) => r.season))].sort();
  const vals = rows.map((r) => r[measure]).filter((v) => v != null) as number[];
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const by = new Map(rows.map((r) => [`${r.competition_id}|${r.season}`, r[measure]]));
  return (
    <div className="table-wrap">
      <table className="data">
        <thead><tr><th>League</th>{seasons.map((s) => <th key={s} className="r">{shortSeason(s)}</th>)}</tr></thead>
        <tbody>
          {SIM_LEAGUES.map((l) => (
            <tr key={l}>
              <td>{LEAGUES[l]}</td>
              {seasons.map((s) => {
                const v = by.get(`${l}|${s}`);
                const t = v == null ? 0 : (v - lo) / (hi - lo || 1);
                return <td key={s} className="r">{v == null ? <span className="muted">–</span> :
                  <span className="heatcell" style={{ background: `color-mix(in srgb, var(--accent) ${Math.round(t * 50)}%, transparent)` }}>{unit(v)}</span>}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
