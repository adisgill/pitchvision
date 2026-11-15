import * as Plot from "@observablehq/plot";
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { ClubLink, css, Figure, fmt, LEAGUES, Loading, ProbBar } from "../components";
import { useManifest, useQuery } from "../db";

export default function Home() {
  const manifest = useManifest();
  const wf = useQuery(`select model, rps, n from wf_eval where league = 'all' and split like 'test%'`);
  const xg = useQuery(`select auc from xg_eval where model = 'gbm' and "group" = 'all'`);
  const race = useQuery(`select competition_id, club_id, name, p_title, exp_points from season_sim
                         qualify row_number() over (partition by competition_id order by p_title desc) <= 3
                         order by competition_id, p_title desc`);
  const recent = useQuery(`select * from matches where played order by kickoff_utc desc, match_id limit 16`);
  const lt = useQuery(`select * from league_translation order by log_factor`);

  const rps = Object.fromEntries(wf.rows.map((r) => [r.model, r.rps]));
  const best = ["elo", "dixon-coles blend"].reduce((a, m) => (rps[m] < rps[a] ? m : a), "elo");

  const ltPlot = useMemo(() => {
    if (!lt.rows.length) return undefined;
    return (width: number) => ({
      width, height: 260, marginLeft: 110,
      x: { label: "Goal difference a Premier League side would add per match, ×", grid: true, type: "log" as const },
      y: { label: null, domain: lt.rows.map((r) => LEAGUES[r.league]) },
      marks: [
        Plot.ruleX([1], { stroke: css("--line") }),
        Plot.link(lt.rows, { y: (d: any) => LEAGUES[d.league], x1: (d: any) => Math.exp(d.lo), x2: (d: any) => Math.exp(d.hi),
                             stroke: css("--neutral"), strokeWidth: 3, strokeOpacity: 0.5 }),
        Plot.dot(lt.rows, { y: (d: any) => LEAGUES[d.league], x: "goals_multiplier_vs_pl", r: 5, fill: css("--good"),
                            title: (d: any) => `${LEAGUES[d.league]}: ×${d.goals_multiplier_vs_pl.toFixed(2)} (from ${d.movers} players who moved)` }),
      ],
    });
  }, [lt.rows]);

  return (
    <>
      <h1>Club football, measured honestly</h1>
      <p className="muted" style={{ maxWidth: 760, marginTop: 0 }}>
        Ratings, forecasts and season odds for Europe's top leagues, built from public data and
        scored in the open against the closing betting line. Where a model loses to the market, we say so.
      </p>
      <div className="card" style={{ marginBottom: "1rem" }}>
        <div className="kpis">
          <div className="kpi"><div className="v">{fmt.date(manifest?.data_through)}</div><div className="l">Results through</div></div>
          <div className="kpi"><div className="v">{fmt.n(rps[best], 4)}</div><div className="l">Our forecast error (RPS, {best}, {fmt.n(wf.rows[0]?.n)} test matches)</div></div>
          <div className="kpi"><div className="v">{fmt.n(rps["closing line"], 4)}</div><div className="l">Closing betting line (lower is better)</div></div>
          <div className="kpi"><div className="v">{fmt.n(xg.rows[0]?.auc, 3)}</div><div className="l">xG model AUC (out of sample)</div></div>
        </div>
        <p className="small muted" style={{ marginBottom: 0 }}>
          The market still beats us by {fmt.n(rps[best] - rps["closing line"], 4)} RPS. <Link to="/accuracy">Every number is scored here.</Link>
        </p>
      </div>
      <div className="grid">
        <div className="span-6 card">
          <p className="figure-title">Title races</p>
          <p className="figure-sub">The three likeliest champions in each league, from 10,000 simulated seasons.</p>
          <Loading state={race} />
          <table className="data">
            <tbody>
              {race.rows.map((r, i) => (
                <tr key={r.club_id}>
                  <td className="muted small">{i === 0 || race.rows[i - 1].competition_id !== r.competition_id
                    ? <Link to={`/league?league=${r.competition_id}`}>{LEAGUES[r.competition_id]}</Link> : ""}</td>
                  <td><ClubLink id={r.club_id} name={r.name} /></td>
                  <td><ProbBar p={r.p_title} /></td>
                  <td className="r muted small">{fmt.n(r.exp_points, 0)} pts</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="span-6 card">
          <p className="figure-title">Latest results</p>
          <p className="figure-sub">With the closing market's pre-match odds (home / draw / away) and match xG.</p>
          <Loading state={recent} />
          <table className="data">
            <tbody>
              {recent.rows.map((m) => (
                <tr key={m.match_id}>
                  <td className="muted small">{fmt.date(m.match_date).slice(5)}</td>
                  <td className="r"><ClubLink id={m.home_club} name={m.home_team} /></td>
                  <td style={{ textAlign: "center" }}>
                    <Link to={`/match/${encodeURIComponent(m.match_id)}`}><b>{fmt.n(m.home_goals)}–{fmt.n(m.away_goals)}</b></Link>
                  </td>
                  <td><ClubLink id={m.away_club} name={m.away_team} /></td>
                  <td className="r small muted">{m.home_xg != null ? `${fmt.n(m.home_xg, 1)}–${fmt.n(m.away_xg, 1)} xG` : ""}</td>
                  <td className="r small muted num">{fmt.pct(m.mkt_h)} / {fmt.pct(m.mkt_d)} / {fmt.pct(m.mkt_a)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="span-12">
          {ltPlot && (
            <Figure title="The Eredivisie and Primeira Liga are the furthest below the Premier League"
                    subtitle="How much more goal difference the same player-quality buys in each league, estimated from players who moved between leagues. Bars: 90% interval."
                    source="Transfermarkt minutes and results" plot={ltPlot} alt="League translation factors relative to the Premier League" />
          )}
        </div>
      </div>
    </>
  );
}
