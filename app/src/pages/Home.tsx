import * as Plot from "@observablehq/plot";
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useManifest, useQuery } from "../db";
import { css, fmt, LEAGUES, SIM_LEAGUES } from "../lib/format";
import { Figure } from "../ui/Figure";
import { Icon } from "../ui/icons";
import { Card, ClubLink, Loading, MatchLink, OutcomeBar, PageHead, ProbBar, Tile } from "../ui/kit";

const TOOLS: [string, string, string, string][] = [
  ["/predict", "predict", "Match predictor", "Any two clubs, every score, every market. Live."],
  ["/league?tab=simulator", "sim", "What-if simulator", "Drag a team's strength and re-run the season in your browser."],
  ["/matchup", "pitch", "Pitch matchup", "Where one team's attack meets the other's leaks, zone by zone."],
  ["/factors", "factors", "Hidden factors", "26 overlooked factors tested against the closing line."],
  ["/players", "player", "Player explorer", "Any metric against any metric, every league season."],
  ["/lab", "lab", "Model lab", "Win probability, xT and score matrices you can play with."],
];

export default function Home() {
  const manifest = useManifest();
  const wf = useQuery(`select model, rps, n from wf_eval where league = 'all' and split like 'test%'`);
  const recent = useQuery(`select *, case when home_goals > away_goals then mkt_h when home_goals < away_goals then mkt_a else mkt_d end p_res
                           from matches where played and match_date >= (select max(match_date) from matches where played) - interval 6 day
                           order by kickoff_utc desc, match_id limit 40`);
  const race = useQuery(`select competition_id, club_id, name, p_title, p_relegation, exp_points from season_sim
                         qualify row_number() over (partition by competition_id order by p_title desc) <= 3`);
  const movers = useQuery(`
    with t as (select home_club club, home_team name, match_date d, elo_home elo from matches where elo_home is not null
               union all select away_club, away_team, match_date, elo_away from matches where elo_away is not null),
    last as (select club, arg_max(name, d) name, max(d) d1, arg_max(elo, d) e1 from t group by club
             having max(d) >= (select max(match_date) from matches where played) - interval 21 day),
    prev as (select t.club, arg_max(t.elo, t.d) e0 from t join last using (club) where t.d <= last.d1 - interval 42 day group by t.club)
    select last.club, name, e1, e1 - e0 delta from last join prev using (club) order by abs(e1 - e0) desc limit 8`);
  const fac = useQuery(`select verdict, count(*) n from matchup_factors group by 1`);
  const lt = useQuery(`select * from league_translation order by log_factor`);

  const rps = Object.fromEntries(wf.rows.map((r) => [r.model, r.rps]));
  const upset = [...recent.rows].filter((m) => m.p_res != null).sort((a, b) => a.p_res - b.p_res)[0];
  const facN = Object.fromEntries(fac.rows.map((r) => [r.verdict, r.n]));
  const tested = fac.rows.reduce((a, r) => a + r.n, 0);
  const order = SIM_LEAGUES;
  const races = order.map((c) => ({ c, rows: race.rows.filter((r) => r.competition_id === c).sort((a, b) => b.p_title - a.p_title) })).filter((x) => x.rows.length);

  const ltPlot = useMemo(() => {
    if (!lt.rows.length) return undefined;
    return (width: number) => ({
      width, height: 250, marginLeft: 110,
      x: { label: "Goals a Premier League-strength side would add, ×", grid: true, type: "log" as const },
      y: { label: null, domain: lt.rows.map((r) => LEAGUES[r.league]) },
      marks: [
        Plot.ruleX([1], { stroke: css("--axis") }),
        Plot.link(lt.rows, { y: (d: any) => LEAGUES[d.league], x1: (d: any) => Math.exp(d.lo), x2: (d: any) => Math.exp(d.hi), stroke: css("--s1"), strokeWidth: 2, strokeOpacity: 0.35, strokeLinecap: "round" }),
        Plot.dot(lt.rows, { y: (d: any) => LEAGUES[d.league], x: "goals_multiplier_vs_pl", r: 5, fill: css("--s1"), stroke: css("--surface"), strokeWidth: 2 }),
        Plot.tip(lt.rows, Plot.pointerY({ y: (d: any) => LEAGUES[d.league], x: "goals_multiplier_vs_pl",
          title: (d: any) => `${LEAGUES[d.league]}: ×${d.goals_multiplier_vs_pl.toFixed(2)} (90%: ×${Math.exp(d.lo).toFixed(2)}–×${Math.exp(d.hi).toFixed(2)})\nfrom ${d.movers} players who moved` })),
      ],
    });
  }, [lt.rows]);

  return (
    <>
      <PageHead eyebrow={`Results through ${fmt.dayYear(manifest?.data_through)}`} title="Club football, measured honestly"
        lead="Ratings, forecasts, season odds and pitch-level analysis for Europe's leagues, built from public data. Every model is scored in the open against the closing betting line, and when we lose, it says so." />

      <div className="tiles" style={{ marginBottom: 16 }}>
        <Tile label="Our forecast error (RPS)" value={fmt.n(rps["elo"], 4)} delta={`${fmt.n(wf.rows[0]?.n)} test matches since 2021-22`} />
        <Tile label="Closing betting line" value={fmt.n(rps["closing line"], 4)} delta={`the market still leads by ${fmt.n(rps["elo"] - rps["closing line"], 4)}`} tone="down" />
        <Tile label="Factors that beat the line" value={tested ? `${(facN["beats the market"] ?? 0) + (facN["beats the market (no holdout data)"] ?? 0)} of ${tested}` : "–"} delta={<Link to="/factors">see the hidden-factors study</Link>} />
        <Tile label="Matches in the database" value={fmt.compact(48543)} delta="results, odds and stats since 2012-13" />
      </div>

      <div className="grid">
        <div className="c8">
          <Card title="Latest results" sub="With the closing market's pre-match odds (home, draw, away) and each side's expected goals from shots."
                right={<Link className="btn" to="/matches">All matches</Link>}>
            <Loading state={recent} />
            {upset && (
              <div className="callout" style={{ marginBottom: 12 }}>
                <b>Upset of the week:</b> <ClubLink id={upset.home_club} name={upset.home_team} /> {fmt.n(upset.home_goals)}–{fmt.n(upset.away_goals)} <ClubLink id={upset.away_club} name={upset.away_team} />.
                The market gave that result {fmt.pct(upset.p_res)} before kickoff. <MatchLink id={upset.match_id}>Match centre →</MatchLink>
              </div>
            )}
            <div className="table-wrap" style={{ maxHeight: 520 }}>
              <table className="data">
                <tbody>
                  {recent.rows.slice(0, 24).map((m) => (
                    <tr key={m.match_id}>
                      <td className="muted xs">{LEAGUES[m.competition_id]?.split(" ")[0]}</td>
                      <td className="r"><ClubLink id={m.home_club} name={m.home_team} bold={m.home_goals > m.away_goals} /></td>
                      <td className="c"><MatchLink id={m.match_id}><b className="num">{fmt.n(m.home_goals)}–{fmt.n(m.away_goals)}</b></MatchLink></td>
                      <td><ClubLink id={m.away_club} name={m.away_team} bold={m.away_goals > m.home_goals} /></td>
                      <td className="r xs muted num">{m.proxy_home_xg != null ? `${fmt.n(m.home_xg ?? m.proxy_home_xg, 1)}–${fmt.n(m.away_xg ?? m.proxy_away_xg, 1)} xG` : ""}</td>
                      <td style={{ width: 150 }}>{m.mkt_h != null && <OutcomeBar thin h={m.mkt_h} d={m.mkt_d} a={m.mkt_a} />}</td>
                      <td className="r xs">{m.p_res != null && m.p_res < 0.25 ? <span className="pill bad">upset {fmt.pct(m.p_res)}</span> : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
        <div className="c4 stack" style={{ gap: 16 }}>
          <Card title="Title races" sub="Three likeliest champions per league, from 10,000 simulated seasons.">
            <Loading state={race} />
            {races.map(({ c, rows }) => (
              <div key={c} style={{ marginBottom: 10 }}>
                <Link to={`/league?league=${c}`} className="eyebrow">{LEAGUES[c]}</Link>
                {rows.map((r) => (
                  <div key={r.club_id} className="row between" style={{ gap: 8, marginTop: 3 }}>
                    <ClubLink id={r.club_id} name={r.name} /><ProbBar p={r.p_title} width={70} />
                  </div>
                ))}
              </div>
            ))}
          </Card>
          <Card title="Biggest movers" sub="Change in Elo rating over the last six weeks of matches.">
            <table className="data"><tbody>
              {movers.rows.map((r) => (
                <tr key={r.club}><td><ClubLink id={r.club} name={r.name} /></td><td className="r num">{fmt.n(r.e1)}</td>
                  <td className="r num" style={{ color: r.delta >= 0 ? "var(--up-text)" : "var(--critical)" }}>{r.delta >= 0 ? "▲" : "▼"} {fmt.n(Math.abs(r.delta))}</td></tr>
              ))}
            </tbody></table>
          </Card>
        </div>
      </div>

      <section className="section">
        <h2>Tools</h2>
        <div className="grid">
          {TOOLS.map(([to, icon, title, sub]) => (
            <Link key={to} to={to} className="card link c4">
              <div className="row" style={{ gap: 10 }}><span style={{ color: "var(--accent)" }}><Icon name={icon} size={22} /></span><p className="fig-title">{title}</p></div>
              <p className="small ink2" style={{ margin: "6px 0 0" }}>{sub}</p>
            </Link>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="grid">
          <div className="c12">
            {ltPlot && <Figure title="The Eredivisie and Primeira Liga sit furthest below the Premier League"
              subtitle="How much more a Premier League-strength side would score per match in each league, estimated from players who moved between leagues. Lines: 90% intervals."
              source="Transfermarkt minutes and results" plot={ltPlot} alt="League translation factors"
              table={{ rows: lt.rows, cols: [["league", "League", (v) => LEAGUES[v]], ["goals_multiplier_vs_pl", "×", (v) => v.toFixed(2)], ["movers", "Players"]] }} />}
          </div>
        </div>
      </section>
    </>
  );
}
