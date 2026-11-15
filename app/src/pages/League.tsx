import * as Plot from "@observablehq/plot";
import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import {
  ClubLink, css, DataTable, Figure, fmt, LEAGUES, Loading, ProbBar, seasonLabel, Select,
} from "../components";
import { lit, useQuery } from "../db";

const SIM_LEAGUES = ["GB1", "ES1", "L1", "IT1", "FR1", "NL1", "PO1", "GB2"];

export default function League() {
  const [params, setParams] = useSearchParams();
  const league = params.get("league") ?? "GB1";
  const seasons = useQuery(`select distinct season from xpoints where competition_id = ${lit(league)}
                            order by season desc`);
  const season = Number(params.get("season") ?? seasons.rows[0]?.season ?? 2026);
  const set = (k: string, v: string) => {
    const p = new URLSearchParams(params);
    p.set(k, v);
    if (k === "league") p.delete("season");
    setParams(p);
  };

  const sim = useQuery(`select * from season_sim where competition_id = ${lit(league)} order by exp_points desc`);
  const xp = useQuery(`select * from xpoints where competition_id = ${lit(league)}
                       and season = ${season} order by points desc`);
  const tr = useQuery(`select * from team_ratings where competition_id = ${lit(league)}
                       and season = ${season} order by dc_gd desc`);
  const isCurrent = sim.rows.length > 0 && Number(sim.rows[0].season) === season;

  const xpPlot = useMemo(() => {
    if (!xp.rows.length) return undefined;
    const rows = xp.rows.map((r) => ({ ...r, label: r.name }));
    return (width: number) => ({
      width, height: Math.max(320, rows.length * 20 + 40), marginLeft: 120,
      x: { label: "Points", grid: true }, y: { label: null, domain: rows.map((r) => r.label) },
      marks: [
        Plot.link(rows, { y: "label", x1: "xpoints", x2: "points", stroke: css("--neutral"), strokeWidth: 1.5 }),
        Plot.dot(rows, { y: "label", x: "xpoints", r: 4, fill: "var(--surface)", stroke: css("--neutral"),
                         title: (d: any) => `${d.name}: ${d.xpoints.toFixed(1)} xPoints` }),
        Plot.dot(rows, { y: "label", x: "points", r: 4.5,
                         fill: (d: any) => (d.points >= d.xpoints ? css("--good") : css("--bad")),
                         title: (d: any) => `${d.name}: ${d.points} points (${fmt.signed(d.points - d.xpoints, 1)} vs xPoints)` }),
      ],
    });
  }, [xp.rows]);

  const scatter = useMemo(() => {
    if (!tr.rows.length) return undefined;
    const rows = tr.rows.map((r) => ({ ...r, atk: r.dc_att, dfn: -r.dc_dfn }));
    return (width: number) => ({
      width, height: Math.min(520, width * 0.75), grid: true,
      x: { label: "Attack → (Dixon-Coles, log goals vs average)" },
      y: { label: "↑ Defence (fewer conceded)" },
      marks: [
        Plot.ruleX([0], { stroke: css("--line") }), Plot.ruleY([0], { stroke: css("--line") }),
        Plot.dot(rows, { x: "atk", y: "dfn", r: 5, fill: (d: any) => (d.dc_gd >= 0 ? css("--good") : css("--bad")),
                         title: (d: any) => `${d.name}\nexpected GD vs average ${fmt.signed(d.dc_gd)}/match\nElo ${fmt.n(d.elo)}\nmarket ${fmt.signed(d.mkt_gd)}` }),
        Plot.text(rows, { x: "atk", y: "dfn", text: "name", dy: -9, fontSize: 10, fill: css("--muted") }),
        Plot.text(["Strong both ends"], { frameAnchor: "top-right", dx: -4, dy: 4, fill: css("--muted"), fontSize: 10 }),
        Plot.text(["Weak both ends"], { frameAnchor: "bottom-left", dx: 4, dy: -4, fill: css("--muted"), fontSize: 10 }),
      ],
    });
  }, [tr.rows]);

  return (
    <>
      <h1>{LEAGUES[league]} {seasonLabel(season, league)}</h1>
      <div className="controls">
        <Select label="League" value={league} onChange={(v) => set("league", v)}
                options={Object.keys(LEAGUES).filter((k) => [...SIM_LEAGUES, "MLS1"].includes(k)).map((k) => [k, LEAGUES[k]])} />
        <Select label="Season" value={String(season)} onChange={(v) => set("season", v)}
                options={seasons.rows.map((r) => [String(r.season), seasonLabel(r.season, league)])} />
      </div>
      <div className="grid">
        {isCurrent && (
          <div className="span-12 card">
            <p className="figure-title">
              {(() => { const f = sim.rows.reduce((a, r) => (r.p_title > a.p_title ? r : a), sim.rows[0]); return `${f.name} are ${fmt.pct(f.p_title)} favourites for the title`; })()}
            </p>
            <p className="figure-sub">
              10,000 simulations of the remaining fixtures from results to {fmt.date(sim.rows[0]?.as_of)}, with
              team strengths drawn from the model's uncertainty. Tiebreakers per the league's rules;
              points deductions not modelled. "Europe" is approximate (cup winners shift places).
            </p>
            <DataTable rows={sim.rows} initialSort={{ key: "exp_points", desc: true }} cols={[
              { key: "name", label: "Team", fmt: (v, r) => <ClubLink id={r.club_id} name={v} /> },
              { key: "played", label: "P", num: true },
              { key: "points_now", label: "Pts", num: true },
              { key: "exp_points", label: "Exp. pts", num: true, fmt: (v) => fmt.n(v, 1) },
              { key: "exp_gd", label: "Exp. GD", num: true, fmt: (v) => fmt.signed(v, 0) },
              { key: "p_title", label: "Title", fmt: (v) => <ProbBar p={v} /> },
              { key: "p_top4", label: league === "GB2" ? "Promoted" : "Top four", fmt: (v) => <ProbBar p={v} /> },
              { key: "p_europe", label: league === "GB2" ? "Top six" : "Europe", fmt: (v) => <ProbBar p={v} /> },
              { key: "p_relegation", label: "Relegated", fmt: (v) => <ProbBar p={v} /> },
            ]} />
          </div>
        )}
        <div className="span-6">
          <Loading state={xp} />
          {xpPlot && (
            <Figure
              title={(() => {
                const top = [...xp.rows].sort((a, b) => b.points - b.xpoints - (a.points - a.xpoints))[0];
                return top ? `${top.name} ran furthest ahead of their chances (${fmt.signed(top.points - top.xpoints, 1)} points)` : "Points vs expected points";
              })()}
              subtitle={<>Filled dot: points (blue above expectation, orange below). Hollow: expected points from each match's xG
                ({xp.rows[0]?.xg_source ?? "–"}).</>}
              source="football-data.co.uk, Transfermarkt" plot={xpPlot}
              alt="Dumbbell chart of each team's points against expected points" />
          )}
        </div>
        <div className="span-6">
          <Loading state={tr} />
          {scatter && (
            <Figure title={`${tr.rows[0]?.name} are the strongest team on goals-based ratings`}
                    subtitle="Dixon-Coles attack and defence at the end of the period (3-year window, 1-year half-life). Hover for Elo and the market's view."
                    source="football-data.co.uk results and closing odds" plot={scatter}
                    alt="Scatter of team attack against defence ratings" />
          )}
        </div>
        <div className="span-12 card">
          <p className="figure-title">Three ratings, side by side, and where they disagree</p>
          <p className="figure-sub">Dixon-Coles (goals) and the market (closing odds) in expected goal difference per match vs an average team; Elo in rating points. Disagreement = the largest gap between the three ranks.</p>
          <DataTable rows={tr.rows} initialSort={{ key: "dc_gd", desc: true }} cols={[
            { key: "name", label: "Team", fmt: (v, r) => <ClubLink id={r.club_id} name={v} /> },
            { key: "dc_gd", label: "Dixon-Coles GD", num: true, fmt: (v) => fmt.signed(v) },
            { key: "mkt_gd", label: "Market GD", num: true, fmt: (v) => fmt.signed(v) },
            { key: "elo", label: "Elo", num: true, fmt: (v) => fmt.n(v) },
            { key: "dc_gd_rank", label: "DC rank", num: true },
            { key: "mkt_gd_rank", label: "Market rank", num: true },
            { key: "elo_rank", label: "Elo rank", num: true },
            { key: "disagreement", label: "Disagreement", num: true },
          ]} />
        </div>
      </div>
    </>
  );
}
