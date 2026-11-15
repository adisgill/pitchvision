import * as Plot from "@observablehq/plot";
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { lit, useQuery } from "../../db";
import { css, fmt } from "../../lib/format";
import { Figure } from "../../ui/Figure";
import { Card, ClubLink, DataTable, FormStrip, Legend, Loading, ProbBar, Tile } from "../../ui/kit";
import { computeTable, MATCH_COLS, topLabel, zoneOf, zones } from "./shared";

export default function TableTab({ league, season, latest }: { league: string; season: number; latest: number }) {
  const nav = useNavigate();
  const ms = useQuery(`select ${MATCH_COLS} from matches where competition_id = ${lit(league)} and season = ${season}`);
  const xp = useQuery(`select club_id, xpoints, points_minus_xpoints, xposition, xg_source from xpoints
                       where competition_id = ${lit(league)} and season = ${season}`);
  const sim = useQuery(season === latest ? `select * from season_sim where competition_id = ${lit(league)} and season = ${season}` : null);
  const table = useMemo(() => computeTable(ms.rows), [ms.rows]);
  const xpBy = useMemo(() => new Map(xp.rows.map((r) => [r.club_id, r])), [xp.rows]);
  const simBy = useMemo(() => new Map(sim.rows.map((r) => [r.club_id, r])), [sim.rows]);
  const zs = zones(league, table.length);
  const rows = table.map((t, i) => {
    const x = xpBy.get(t.club_id), s = simBy.get(t.club_id);
    return { ...t, pos: i + 1, xpts: x?.xpoints, dx: x?.points_minus_xpoints, xpos: x?.xposition,
             xgd: t.p ? (t.xgf - t.xga) / t.p : null, p_title: s?.p_title, p_top4: s?.p_top4, p_europe: s?.p_europe,
             p_rel: s?.p_relegation, exp_pts: s?.exp_points };
  });
  const leader = rows[0];
  const lucky = [...rows].filter((r) => r.dx != null).sort((a, b) => b.dx - a.dx)[0];
  const unlucky = [...rows].filter((r) => r.dx != null).sort((a, b) => a.dx - b.dx)[0];
  const fav = [...rows].filter((r) => r.p_title != null).sort((a, b) => b.p_title - a.p_title)[0];
  const played = ms.rows.filter((m) => m.played).length;
  const totalGoals = ms.rows.reduce((a, m) => a + (m.played ? m.home_goals + m.away_goals : 0), 0);

  const xpPlot = useMemo(() => {
    const r = rows.filter((x) => x.xpts != null);
    if (!r.length) return undefined;
    return (width: number) => ({
      width, height: Math.max(300, r.length * 21 + 50), marginLeft: 118, marginRight: 30,
      x: { label: "Points →", grid: true }, y: { label: null, domain: r.map((x) => x.name) },
      marks: [
        Plot.link(r, { y: "name", x1: "xpts", x2: "pts", stroke: css("--axis"), strokeWidth: 2 }),
        Plot.dot(r, { y: "name", x: "xpts", r: 4.5, fill: css("--surface"), stroke: css("--muted"), strokeWidth: 2 }),
        Plot.dot(r, { y: "name", x: "pts", r: 5, fill: (d: any) => (d.dx >= 0 ? css("--pos") : css("--neg")), stroke: css("--surface"), strokeWidth: 2 }),
        Plot.tip(r, Plot.pointerY({ y: "name", x: "pts", title: (d: any) => `${d.name}\n${d.pts} points, ${fmt.n(d.xpts, 1)} expected (${fmt.signed(d.dx, 1)})\nxPts rank ${fmt.n(d.xpos)}` })),
      ],
    });
  }, [rows]);

  return (
    <>
      <Loading state={ms} />
      {leader && (
        <div className="tiles" style={{ marginBottom: 16 }}>
          <Tile label="Leaders" value={leader.name} delta={`${leader.pts} pts from ${leader.p} · ${fmt.signed(leader.gd, 0)} GD`} />
          {fav && <Tile label="Title favourite (simulated)" value={`${fav.name} ${fmt.pct(fav.p_title)}`} delta={`expected ${fmt.n(fav.exp_pts, 0)} points`} />}
          {lucky && <Tile label="Most points above chances" value={lucky.name} delta={`${fmt.signed(lucky.dx, 1)} vs expected points`} tone="up" />}
          {unlucky && <Tile label="Most points below chances" value={unlucky.name} delta={`${fmt.signed(unlucky.dx, 1)} vs expected points`} tone="down" />}
          <Tile label="Goals per match" value={played ? fmt.n(totalGoals / played, 2) : "–"} delta={`${played} matches played`} />
        </div>
      )}
      <div className="grid">
        <div className="c8">
          <Card title="Table" sub={<>Click a team for its page. Expected points come from each match's shot quality
            ({xp.rows[0]?.xg_source ?? "shot-based xG"}); xGD = expected goal difference per match from shots.
            {sim.rows.length > 0 && " Odds: 10,000 simulated seasons from the official pipeline."}</>}>
            <Legend items={zs.map((z) => ({ label: z.label, color: z.color, kind: "rect" }))} />
            <DataTable rows={rows} onRow={(r) => nav(`/team/${encodeURIComponent(r.club_id)}`)} maxHeight={760} cols={[
              { key: "pos", label: "#", num: true, fmt: (v) => {
                const z = zoneOf(zs, v);
                return <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 3, height: 16, borderRadius: 2, background: z?.color ?? "transparent" }} title={z?.label} />{v}</span>;
              } },
              { key: "name", label: "Team", fmt: (v, r) => <ClubLink id={r.club_id} name={v} bold={r.pos <= 1} /> },
              { key: "p", label: "P", num: true }, { key: "w", label: "W", num: true }, { key: "d", label: "D", num: true },
              { key: "l", label: "L", num: true }, { key: "gf", label: "GF", num: true }, { key: "ga", label: "GA", num: true },
              { key: "gd", label: "GD", num: true, fmt: (v) => fmt.signed(v, 0) },
              { key: "pts", label: "Pts", num: true, fmt: (v) => <b>{v}</b> },
              { key: "form", label: "Form", sortable: false, fmt: (v) => <FormStrip results={v} /> },
              { key: "xpts", label: "xPts", num: true, fmt: (v) => fmt.n(v, 1) },
              { key: "dx", label: "Pts − xPts", num: true, heat: "pos", fmt: (v) => fmt.signed(v, 1) },
              { key: "xgd", label: "xGD/match", num: true, heat: "pos", fmt: (v) => fmt.signed(v, 2) },
              ...(sim.rows.length ? [
                { key: "p_title", label: "Title", fmt: (v: any) => <ProbBar p={v} width={46} /> },
                { key: "p_top4", label: topLabel(league), fmt: (v: any) => <ProbBar p={v} width={46} /> },
                { key: "p_rel", label: "Relegated", fmt: (v: any) => <ProbBar p={v} width={46} /> },
              ] : []),
            ]} />
          </Card>
        </div>
        <div className="c4">
          {xpPlot && (
            <Figure title={lucky ? `${lucky.name} have the biggest gap over their chances` : "Points vs expected points"}
                    subtitle="Filled: actual points (blue above expectation, red below). Hollow: expected points from shot quality."
                    source="football-data.co.uk, Transfermarkt" plot={xpPlot} alt="Points against expected points per team"
                    table={{ rows, cols: [["name", "Team"], ["pts", "Points"], ["xpts", "xPts", (v) => fmt.n(v, 1)], ["dx", "Diff", (v) => fmt.signed(v, 1)]] }} />
          )}
        </div>
      </div>
    </>
  );
}
