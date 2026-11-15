import * as Plot from "@observablehq/plot";
import { useEffect, useMemo, useState } from "react";
import { lit, useQuery } from "../../db";
import { css, fmt } from "../../lib/format";
import { Figure } from "../../ui/Figure";
import { Card, ClubLink, DataTable, Empty, Legend, Loading } from "../../ui/kit";
import { HighlightPicker } from "./shared";

export default function RatingsTab({ league, season }: { league: string; season: number }) {
  const tr = useQuery(`select * from team_ratings where competition_id = ${lit(league)} and season = ${season}
                       qualify row_number() over (partition by club_id order by as_of desc) = 1`);
  const elo = useQuery(`select match_date, kickoff_utc, home_club, away_club, home_team, away_team, home_goals, away_goals, elo_home, elo_away
                        from matches where competition_id = ${lit(league)} and season = ${season} and played and elo_home is not null
                        order by kickoff_utc, match_date`);
  const rows = useMemo(() => [...tr.rows].sort((a, b) => b.dc_gd - a.dc_gd), [tr.rows]);
  const [picked, setPicked] = useState<string[]>([]);
  useEffect(() => { setPicked(rows.slice(0, 3).map((r) => r.club_id)); }, [rows.length, league, season]);

  const scatter = useMemo(() => {
    if (!rows.length) return undefined;
    const d = rows.map((r) => ({ ...r, atk: r.dc_att, def: -r.dc_dfn }));
    const mx = d.reduce((a, r) => a + r.atk, 0) / d.length, my = d.reduce((a, r) => a + r.def, 0) / d.length;
    return (width: number) => ({
      width, height: Math.min(560, Math.max(380, width * 0.72)), grid: true, inset: 18,
      x: { label: "Attack: goals scored vs average →", tickFormat: (v: number) => `${v >= 0 ? "+" : ""}${Math.round((Math.exp(v) - 1) * 100)}%` },
      y: { label: "↑ Defence: goals prevented vs average", tickFormat: (v: number) => `${v >= 0 ? "+" : ""}${Math.round((Math.exp(v) - 1) * 100)}%` },
      marks: [
        Plot.ruleX([mx], { stroke: css("--axis") }), Plot.ruleY([my], { stroke: css("--axis") }),
        Plot.dot(d, { x: "atk", y: "def", r: 6, fill: (r: any) => (r.dc_gd >= 0 ? css("--pos") : css("--neg")), stroke: css("--surface"), strokeWidth: 2 }),
        Plot.text(d, { x: "atk", y: "def", text: "name", dy: -11, fontSize: 10.5, fill: css("--text-2") }),
        Plot.text(["Strong at both ends"], { frameAnchor: "top-right", dx: -6, dy: 6, fill: css("--muted"), fontSize: 11 }),
        Plot.text(["Weak at both ends"], { frameAnchor: "bottom-left", dx: 6, dy: -6, fill: css("--muted"), fontSize: 11 }),
        Plot.tip(d, Plot.pointer({ x: "atk", y: "def", title: (r: any) =>
          `${r.name}\nexpected GD vs average: ${fmt.signed(r.dc_gd)} per match\nmarket: ${fmt.signed(r.mkt_gd)} · Elo ${fmt.n(r.elo)}\nranks: goals ${fmt.n(r.dc_gd_rank)}, market ${fmt.n(r.mkt_gd_rank)}, Elo ${fmt.n(r.elo_rank)}` })),
      ],
    });
  }, [rows]);

  const eloSeries = useMemo(() => elo.rows.flatMap((m) => [
    { club: m.home_club, name: m.home_team, date: new Date(m.kickoff_utc ?? m.match_date), elo: m.elo_home, opp: m.away_team, s: `${m.home_goals}–${m.away_goals} (H)` },
    { club: m.away_club, name: m.away_team, date: new Date(m.kickoff_utc ?? m.match_date), elo: m.elo_away, opp: m.home_team, s: `${m.away_goals}–${m.home_goals} (A)` },
  ]), [elo.rows]);
  const eloPlot = useMemo(() => {
    if (!eloSeries.length) return undefined;
    const hl = new Map(picked.map((id, i) => [id, css(`--s${i + 1}`)]));
    const grey = eloSeries.filter((p) => !hl.has(p.club)), col = eloSeries.filter((p) => hl.has(p.club));
    const ends = [...new Map(col.map((p) => [p.club, p])).values()];
    return (width: number) => ({
      width, height: 380, marginRight: 100, y: { label: "↑ Elo before the match", grid: true }, x: { label: null },
      marks: [
        Plot.line(grey, { x: "date", y: "elo", z: "club", stroke: css("--axis"), strokeWidth: 1.25 }),
        Plot.line(col, { x: "date", y: "elo", z: "club", stroke: (d: any) => hl.get(d.club), strokeWidth: 2.5 }),
        Plot.text(ends, { x: "date", y: "elo", text: "name", dx: 8, textAnchor: "start", fill: css("--text"), fontSize: 11, fontWeight: 600 }),
        Plot.tip(eloSeries, Plot.pointer({ x: "date", y: "elo", title: (d: any) => `${d.name}\nElo ${fmt.n(d.elo)} on ${fmt.dayYear(d.date)}\nnext: ${d.s} vs ${d.opp}` })),
      ],
    });
  }, [eloSeries, picked]);

  if (!tr.loading && !rows.length) return <Empty>No team ratings for this season.</Empty>;
  const biggest = [...rows].sort((a, b) => (b.disagreement ?? 0) - (a.disagreement ?? 0))[0];
  return (
    <>
      <Loading state={tr} />
      <div className="grid">
        <div className="c7">
          {scatter && (
            <Figure title={`${rows[0]?.name} rate as the strongest side on goals`}
                    subtitle={`Dixon-Coles attack and defence as of ${fmt.dayYear(rows[0]?.as_of)}: how many more goals each team scores and prevents than an average side in this league (1-year half-life, goals and shot quality blended). Blue = above average overall.`}
                    source="football-data.co.uk" plot={scatter} alt="Attack against defence ratings"
                    table={{ rows, cols: [["name", "Team"], ["dc_att", "Attack", (v) => fmt.n(v, 3)], ["dc_dfn", "Defence (lower=better)", (v) => fmt.n(v, 3)], ["dc_gd", "Exp. GD", (v) => fmt.signed(v)]] }} />
          )}
        </div>
        <div className="c5">
          <Card title="Three ratings, three opinions" sub={<>Goals model and market in expected goal difference per match against an average team; Elo in rating points.
            {biggest && <> The biggest disagreement: <b>{biggest.name}</b> ({fmt.n(biggest.disagreement)} places between systems).</>}</>}>
            <DataTable rows={rows} initialSort={{ key: "dc_gd", desc: true }} maxHeight={520} cols={[
              { key: "name", label: "Team", fmt: (v, r) => <ClubLink id={r.club_id} name={v} /> },
              { key: "dc_gd", label: "Goals", num: true, heat: "pos", fmt: (v) => fmt.signed(v) },
              { key: "mkt_gd", label: "Market", num: true, heat: "pos", fmt: (v) => fmt.signed(v) },
              { key: "elo", label: "Elo", num: true, heat: "pos", fmt: (v) => fmt.n(v) },
              { key: "disagreement", label: "Gap", num: true, title: "Largest rank difference between the three systems" },
            ]} />
          </Card>
        </div>
        <div className="c12">
          <HighlightPicker teams={rows.map((r) => ({ id: r.club_id, name: r.name }))} picked={picked} onChange={setPicked} />
          {eloPlot ? (
            <Figure title="Elo through the season" subtitle="Each team's rating going into every match (K = 20, home advantage 60 points). Pick up to three teams to highlight."
                    source="football-data.co.uk results" plot={eloPlot} alt="Elo ratings over the season"
                    right={<Legend items={picked.map((id, i) => ({ label: rows.find((r) => r.club_id === id)?.name ?? id, color: `var(--s${i + 1})`, kind: "line" }))} />}
                    table={{ rows: eloSeries.slice(-200), cols: [["name", "Team"], ["date", "Date", (v) => fmt.date(v)], ["elo", "Elo", (v) => fmt.n(v)]] }} />
          ) : <Empty>Elo history is available from 2017-18.</Empty>}
        </div>
      </div>
    </>
  );
}
