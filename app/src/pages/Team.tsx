import * as Plot from "@observablehq/plot";
import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { ClubLink, css, DataTable, Figure, fmt, LEAGUES, Loading, PlayerLink, RatingBar, seasonLabel } from "../components";
import { lit, useQuery } from "../db";

export default function Team() {
  const id = decodeURIComponent(useParams().id ?? "");
  const club = useQuery(`select * from clubs where club_id = ${lit(id)}`);
  const tr = useQuery(`select * from team_ratings where club_id = ${lit(id)} order by as_of`);
  const xp = useQuery(`select * from xpoints where club_id = ${lit(id)} order by season`);
  const lastSeason = useQuery(`select max(season) s from players_c where club_id = ${lit(id)}`);
  const s = lastSeason.rows[0]?.s;
  const squad = useQuery(s == null ? null : `
    select c.*, p.name, r.rapm, r.prior_dominated from players_c c join players p using (player_id)
    left join rapm r on r.player_id = c.player_id and r.season = c.season
    where c.club_id = ${lit(id)} and c.season = ${s} order by c.minutes desc`);
  const style = useQuery(`select * from team_style where club_id = ${lit(id)} order by season`);
  const games = useQuery(`select * from matches where (home_club = ${lit(id)} or away_club = ${lit(id)}) and played
                          order by kickoff_utc desc limit 12`);
  const name = club.rows[0]?.name ?? tr.rows[0]?.name ?? id;
  const league = club.rows[0]?.league;

  const trend = useMemo(() => {
    if (!tr.rows.length) return undefined;
    const long = tr.rows.flatMap((r) => [
      { as_of: r.as_of, v: r.dc_gd, k: "Dixon-Coles (goals)" },
      { as_of: r.as_of, v: r.mkt_gd, k: "Market (closing odds)" },
    ]).filter((d) => d.v != null);
    return (width: number) => ({
      width, height: 260, y: { label: "Expected goal difference per match vs average", grid: true },
      x: { label: null },
      color: { domain: ["Dixon-Coles (goals)", "Market (closing odds)"], range: [css("--cat-1"), css("--cat-2")], legend: true },
      marks: [
        Plot.ruleY([0], { stroke: css("--line") }),
        Plot.line(long, { x: "as_of", y: "v", stroke: "k", strokeWidth: 2 }),
        Plot.dot(long, { x: "as_of", y: "v", fill: "k", r: 3, title: (d: any) => `${d.k}, ${fmt.date(d.as_of)}: ${fmt.signed(d.v)}` }),
      ],
    });
  }, [tr.rows]);

  const xpPlot = useMemo(() => {
    if (!xp.rows.length) return undefined;
    return (width: number) => ({
      width, height: 260, x: { label: null, tickFormat: (d: number) => seasonLabel(d, league) },
      y: { label: "Points per match", grid: true },
      marks: [
        Plot.link(xp.rows, { x: "season", y1: (d: any) => d.xpoints / d.played, y2: (d: any) => d.points / d.played, stroke: css("--neutral") }),
        Plot.dot(xp.rows, { x: "season", y: (d: any) => d.xpoints / d.played, r: 4, stroke: css("--neutral"), fill: "var(--surface)" }),
        Plot.dot(xp.rows, { x: "season", y: (d: any) => d.points / d.played, r: 4.5,
                            fill: (d: any) => (d.points >= d.xpoints ? css("--good") : css("--bad")),
                            title: (d: any) => `${seasonLabel(d.season, d.competition_id)} ${LEAGUES[d.competition_id] ?? d.competition_id}: ${d.points} pts, ${d.xpoints.toFixed(1)} xPts, finished ${fmt.n(d.position)}` }),
      ],
    });
  }, [xp.rows, league]);

  const latest = tr.rows[tr.rows.length - 1];
  return (
    <>
      <p className="small muted" style={{ margin: 0 }}>
        {league && <Link to={`/league?league=${league}`}>{LEAGUES[league] ?? league}</Link>}
      </p>
      <h1>{name}</h1>
      <Loading state={club} />
      {latest && (
        <div className="card" style={{ marginBottom: "1rem" }}>
          <div className="kpis">
            <div className="kpi"><div className="v">{fmt.signed(latest.dc_gd)}</div><div className="l">Goals-model GD / match vs average</div></div>
            <div className="kpi"><div className="v">{fmt.signed(latest.mkt_gd)}</div><div className="l">Market GD / match</div></div>
            <div className="kpi"><div className="v">{fmt.n(latest.elo)}</div><div className="l">Elo</div></div>
            <div className="kpi"><div className="v">{fmt.date(latest.as_of)}</div><div className="l">As of</div></div>
          </div>
        </div>
      )}
      <div className="grid">
        <div className="span-6">{trend && <Figure title={`${name}'s strength over time`} subtitle="Season-end (and current) ratings from goals and from the closing market."
                                                  source="football-data.co.uk" plot={trend} alt="Team rating over time" />}</div>
        <div className="span-6">{xpPlot && <Figure title="Points vs expected points, by season" subtitle="Filled: actual points per match (blue above expectation). Hollow: expected from xG."
                                                   source="football-data.co.uk, Transfermarkt" plot={xpPlot} alt="Points vs expected points by season" />}</div>
        {squad.rows.length > 0 && (
          <div className="span-12 card">
            <p className="figure-title">Squad, {seasonLabel(s, league)}</p>
            <p className="figure-sub">Box-score ratings: 50 = position average, 10 points = one standard deviation, shrunk toward average for small samples.
              RAPM: goal-difference impact per 90 vs an average player; "prior" means the box-score prior outweighs the on-pitch data.</p>
            <DataTable rows={squad.rows} initialSort={{ key: "minutes", desc: true }} cols={[
              { key: "name", label: "Player", fmt: (v, r) => <PlayerLink id={r.player_id} name={v} /> },
              { key: "position_group", label: "Pos" },
              { key: "minutes", label: "Min", num: true, fmt: (v) => fmt.n(v) },
              { key: "goals", label: "G", num: true, fmt: (v) => fmt.n(v) },
              { key: "assists", label: "A", num: true, fmt: (v) => fmt.n(v) },
              { key: "scoring_rating", label: "Scoring", fmt: (v) => <RatingBar v={v} /> },
              { key: "creation_rating", label: "Creation", fmt: (v) => <RatingBar v={v} /> },
              { key: "availability_rating", label: "Availability", fmt: (v) => <RatingBar v={v} /> },
              { key: "rapm", label: "RAPM", num: true, fmt: (v, r) => v == null ? "–" : <>{fmt.signed(v)}{r.prior_dominated ? <span className="pill">prior</span> : null}</> },
            ]} />
          </div>
        )}
        {style.rows.length > 0 && (
          <div className="span-12 card">
            <p className="figure-title">Playing style (event-data seasons)</p>
            <p className="figure-sub">Per match. Field tilt: share of final-third touches. PPDA: opponent passes per defensive action (lower = more pressing).</p>
            <DataTable rows={style.rows} cols={[
              { key: "season", label: "Season", fmt: (v, r) => `${seasonLabel(v, r.competition_id)} (${r.provider})` },
              { key: "npxg_for_pm", label: "npxG for", num: true, fmt: (v) => fmt.n(v, 2) },
              { key: "npxg_against_pm", label: "npxG against", num: true, fmt: (v) => fmt.n(v, 2) },
              { key: "possession_share", label: "Possession", num: true, fmt: (v) => fmt.pct(v) },
              { key: "field_tilt", label: "Field tilt", num: true, fmt: (v) => fmt.pct(v) },
              { key: "ppda", label: "PPDA", num: true, fmt: (v) => fmt.n(v, 1) },
              { key: "directness", label: "Directness", num: true, fmt: (v) => fmt.n(v, 2) },
              { key: "crossing_reliance", label: "Crossing", num: true, fmt: (v) => fmt.pct(v) },
              { key: "set_piece_xg_for_pm", label: "Set-piece xG", num: true, fmt: (v) => fmt.n(v, 2) },
            ]} />
          </div>
        )}
        <div className="span-12 card">
          <p className="figure-title">Recent matches</p>
          <table className="data"><tbody>
            {games.rows.map((m) => (
              <tr key={m.match_id}>
                <td className="muted small">{fmt.date(m.match_date)}</td>
                <td className="r">{m.home_club === id ? <b>{m.home_team}</b> : <ClubLink id={m.home_club} name={m.home_team} />}</td>
                <td style={{ textAlign: "center" }}><Link to={`/match/${encodeURIComponent(m.match_id)}`}>{fmt.n(m.home_goals)}–{fmt.n(m.away_goals)}</Link></td>
                <td>{m.away_club === id ? <b>{m.away_team}</b> : <ClubLink id={m.away_club} name={m.away_team} />}</td>
                <td className="r small muted">{m.home_xg != null ? `${fmt.n(m.home_xg, 1)}–${fmt.n(m.away_xg, 1)} xG` : ""}</td>
              </tr>
            ))}
          </tbody></table>
        </div>
      </div>
    </>
  );
}
