import * as Plot from "@observablehq/plot";
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Row, useManifest, useQuery } from "../db";
import { css, fmt, LEAGUES, SHORT, SIM_LEAGUES } from "../lib/format";
import { forecast, sinceSql, useRatings, useUpcoming } from "./match/upcoming";
import { Figure } from "../ui/Figure";
import { Loading, OutcomeBar, Tile } from "../ui/kit";

const TOOLS: [string, string, string][] = [
  ["/predict", "Match predictor", "Any two clubs, every score, every market, computed live in your browser."],
  ["/league?tab=simulator", "What-if simulator", "Drag a team's strength and re-run 10,000 seasons."],
  ["/matchup", "Pitch matchup", "Where one team's attack meets the other's leaks, zone by zone."],
  ["/recruit", "Recruitment", "Role fits, like-for-like replacements and value for money."],
  ["/report", "Opposition report", "A printable dossier on the next opponent."],
  ["/insights", "What wins", "Which match stats actually predict future points."],
  ["/factors", "Hidden factors", "Overlooked factors tested against the closing line."],
  ["/lab", "Model lab", "Win probability, expected threat and score matrices to play with."],
];

const dayKey = (d: Date) => d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" });
const timeOf = (d: Date) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

/** Model vs market on one scale: forecast error (RPS) as positions on a strip, lower = better. */
function Duel({ rows, n }: { rows: { name: string; v: number; color: string; strong?: boolean }[]; n?: number }) {
  if (!rows.length) return null;
  const vs = rows.map((r) => r.v);
  const lo = Math.min(...vs) - 0.002, hi = Math.max(...vs) + 0.002;
  const x = (v: number) => 4 + ((v - lo) / (hi - lo)) * 92;
  return (
    <div className="duel">
      <div className="row between">
        <span className="eyebrow">Forecast error · RPS · lower is better</span>
        <Link className="xs" to="/accuracy">How we're scored →</Link>
      </div>
      {rows.map((r, i) => (
        <div key={r.name} className="duel-row" style={{ gridTemplateColumns: "128px 1fr 64px" }}>
          <span className="nm" style={r.strong ? { color: "var(--text)", fontWeight: 600 } : undefined}>{r.name}</span>
          <div style={{ position: "relative", height: 18 }}>
            <div style={{ position: "absolute", left: 0, right: 0, top: 8, height: 2, background: "var(--surface-3)" }} />
            <div style={{ position: "absolute", left: `${x(r.v)}%`, top: 2, width: 14, height: 14, marginLeft: -7, borderRadius: "50%",
                          background: r.color, boxShadow: "0 0 0 2px var(--surface)", animation: `rise 0.6s var(--ease) ${i * 0.1}s both` }} />
          </div>
          <span className="v">{r.v.toFixed(4)}</span>
        </div>
      ))}
      <p className="xs muted" style={{ margin: "10px 0 0" }}>The same {fmt.n(n)} matches from 2021-22 to 2025-26 for every model, each forecast fitted only on earlier seasons.</p>
    </div>
  );
}

function Board({ rows }: { rows: Row[] }) {
  const R = useRatings();
  const days = useMemo(() => {
    const g = new Map<string, Row[]>();
    rows.forEach((f) => { const k = dayKey(new Date(f.kickoff_utc)); if (!g.has(k)) g.set(k, []); g.get(k)!.push(f); });
    return [...g.entries()].slice(0, 3);
  }, [rows]);
  return (
    <div className="board">
      {days.map(([day, fs]) => [
        <div key={day} className="board-day"><b>{day}</b><span className="eyebrow">{fs.length} fixtures</span></div>,
        ...fs.map((f) => {
          const p = R.ready ? forecast(f, R) : null;
          const d = new Date(f.kickoff_utc);
          const to = f.home_club && f.away_club ? `/predict?h=${encodeURIComponent(f.home_club)}&a=${encodeURIComponent(f.away_club)}` : "/matches?view=upcoming";
          const favH = p && p.h >= p.a, favA = p && p.a > p.h;
          return (
            <Link key={f.fm_match_id} to={to} className="fx spot" aria-label={`${f.home_name} v ${f.away_name}`}>
              <div className="fx-top"><span>{timeOf(d)}</span><span title={LEAGUES[f.competition_id]}>{SHORT[f.competition_id] ?? f.competition_id}</span></div>
              <div className={`fx-team ${favH ? "fav" : ""}`}><span className="n">{f.home_name}</span><span className="p">{p ? fmt.pct(p.h) : "–"}</span></div>
              <div className={`fx-team ${favA ? "fav" : ""}`}><span className="n">{f.away_name}</span><span className="p">{p ? fmt.pct(p.a) : "–"}</span></div>
              {p && <OutcomeBar thin h={p.h} d={p.d} a={p.a} labels={[f.home_name, "Draw", f.away_name]} />}
              {p && <div className="fx-more"><span>draw {fmt.pct(p.d)} · xG {fmt.n(p.lh, 1)}–{fmt.n(p.la, 1)}</span><span>likeliest {p.top.h}–{p.top.a}</span></div>}
            </Link>
          );
        }),
      ])}
    </div>
  );
}

export default function Home() {
  const manifest = useManifest();
  const upg = useQuery(`select model, rps, n from upgrade_eval where league = 'all' and study like 'core%'`);
  const led = useQuery(`select count(*) as n from ledger`);
  // football-data results (with odds), plus anything FotMob has already that football-data
  // hasn't posted yet, so the newest results always show
  const recent = useQuery(`
    select * from (
      select match_id, fm_id, competition_id, kickoff_utc, home_club, away_club, home_team, away_team, home_goals, away_goals,
             coalesce(home_xg, fm_xh, proxy_home_xg) xh, coalesce(away_xg, fm_xa, proxy_away_xg) xa, mkt_h, mkt_d, mkt_a, p_res
      from (select m.*, t.fm_match_id fm_id, t.home_expected_goals fm_xh, t.away_expected_goals fm_xa,
                   case when m.home_goals > m.away_goals then m.mkt_h when m.home_goals < m.away_goals then m.mkt_a else m.mkt_d end p_res
            from matches m left join fm_team_match t using (match_id)
            where m.played and m.match_date >= (select max(match_date) from matches where played) - interval 6 day)
      union all
      select null, f.fm_match_id, f.competition_id, f.kickoff_utc, f.home_club, f.away_club,
             coalesce(hc.name, f.home_name), coalesce(ac.name, f.away_name), f.home_goals, f.away_goals,
             null, null, null, null, null, null
      from fixtures f left join clubs hc on hc.club_id = f.home_club left join clubs ac on ac.club_id = f.away_club
      where f.finished and not f.cancelled and f.match_id is null and f.kickoff_utc >= current_date - interval 9 day
    ) order by kickoff_utc desc nulls last, competition_id limit 24`);
  const race = useQuery(`select competition_id, club_id, name, p_title, p_relegation, exp_points from season_sim
                         qualify row_number() over (partition by competition_id order by p_title desc) <= 4`);
  const movers = useQuery(`
    with t as (select home_club as club, home_team as name, match_date as d, elo_home as elo from matches where elo_home is not null
               union all select away_club, away_team, match_date, elo_away from matches where elo_away is not null),
    last as (select club, arg_max(name, d) as name, max(d) as d1, arg_max(elo, d) as e1 from t group by club
             having max(d) >= (select max(match_date) from matches where played) - interval 21 day),
    prev as (select t.club, arg_max(t.elo, t.d) as e0 from t join last using (club) where t.d <= last.d1 - interval 42 day group by t.club)
    select last.club, name, e1, e1 - e0 as delta from last join prev using (club) order by abs(e1 - e0) desc limit 10`);
  const fac = useQuery(`select verdict, count(*) n from matchup_factors group by 1`);
  const lt = useQuery(`select * from league_translation order by log_factor`);
  const up = useUpcoming(`f.kickoff_utc < ${sinceSql(-24 * 7)}`, 160);

  const urps = Object.fromEntries(upg.rows.map((r) => [r.model, r.rps]));
  const duel = [
    urps["upgraded: days ahead"] != null && { name: "pitchvision", v: urps["upgraded: days ahead"], color: "var(--s1)", strong: true },
    urps["our model (current)"] != null && { name: "Ratings only", v: urps["our model (current)"], color: "var(--muted)" },
    urps["elo"] != null && { name: "Elo", v: urps["elo"], color: "var(--axis)" },
    urps["closing line"] != null && { name: "Closing line", v: urps["closing line"], color: "var(--text)" },
  ].filter(Boolean) as { name: string; v: number; color: string; strong?: boolean }[];
  const facN = Object.fromEntries(fac.rows.map((r) => [r.verdict, r.n]));
  const tested = fac.rows.reduce((a, r) => a + r.n, 0);
  const races = SIM_LEAGUES.map((c) => ({ c, rows: race.rows.filter((r) => r.competition_id === c).sort((a, b) => b.p_title - a.p_title) })).filter((x) => x.rows.length);
  const maxMove = Math.max(1, ...movers.rows.map((r) => Math.abs(r.delta)));

  const ltPlot = useMemo(() => {
    if (!lt.rows.length) return undefined;
    return (width: number) => ({
      width, height: 260, marginLeft: 110,
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
      <div className="home-hero">
        <div>
          <div className="eyebrow">Results through {fmt.dayYear(manifest?.data_through)} · {Object.keys(LEAGUES).length} competitions</div>
          <h1>Every match,<br /><em>measured.</em></h1>
          <p className="lead">Ratings, forecasts, season odds and pitch-level analysis for Europe's leagues, built from public data.
            Every model is scored in the open against the closing betting line, and when we lose, it says so.</p>
          <div className="row" style={{ marginTop: 16 }}>
            <Link className="btn primary" to="/predict">Open the predictor</Link>
            <Link className="btn" to="/matches?view=upcoming">All fixtures</Link>
          </div>
        </div>
        <Duel rows={duel} n={upg.rows[0]?.n} />
      </div>

      <div className="tiles">
        <Tile label="Fixtures, next 7 days" value={fmt.n(up.rows.length)} delta="each with a pre-match forecast" />
        <Tile label="Forecasts in the public ledger" value={fmt.n(led.rows[0]?.n)} delta={<Link to="/accuracy">append-only, committed daily</Link>} />
        <Tile label="Hidden factors that beat the line" value={tested ? `${(facN["beats the market"] ?? 0) + (facN["beats the market (no holdout data)"] ?? 0)} of ${tested}` : "–"} delta={<Link to="/factors">the honest answer</Link>} />
        <Tile label="Matches in the database" value={fmt.compact(48543)} delta="results, odds and stats since 2012-13" />
      </div>

      {up.rows.length > 0 && (
        <section className="section">
          <h2>Matchday board <Link className="btn" style={{ marginLeft: "auto", fontFamily: "var(--font)", textTransform: "none", fontSize: "0.84rem", letterSpacing: 0 }} to="/matches?view=upcoming">All {up.rows.length} fixtures →</Link></h2>
          <p className="small ink2" style={{ marginTop: -6 }}>Our upgraded forecast for every fixture (kick-off in your local time). The marked side is our favourite; hover for the draw, expected goals and likeliest score, click for the full predictor.</p>
          <Board rows={up.rows} />
        </section>
      )}

      <section className="section">
        <h2>Latest results</h2>
        <Loading state={recent} />
        <div className="results">
          {recent.rows.map((m) => {
            const body = (
              <>
                <span className="h" style={{ fontWeight: m.home_goals > m.away_goals ? 650 : 400 }}>{m.home_team}</span>
                <span className="s">{fmt.n(m.home_goals)}–{fmt.n(m.away_goals)}</span>
                <span className="a" style={{ fontWeight: m.away_goals > m.home_goals ? 650 : 400 }}>{m.away_team}</span>
                <span className="meta">
                  <span>{SHORT[m.competition_id] ?? m.competition_id} · {fmt.day(m.kickoff_utc)}</span>
                  <span>{m.xh != null ? `xG ${fmt.n(m.xh, 1)}–${fmt.n(m.xa, 1)}` : ""}{m.p_res != null ? ` · market gave it ${fmt.pct(m.p_res)}` : ""}</span>
                </span>
                {m.mkt_h != null && <div style={{ gridColumn: "1 / -1" }}><OutcomeBar thin h={m.mkt_h} d={m.mkt_d} a={m.mkt_a} labels={[m.home_team, "Draw", m.away_team]} /></div>}
              </>
            );
            const cls = `res ${m.p_res != null && m.p_res < 0.25 ? "upset" : ""}`;
            return m.match_id
              ? <Link key={m.match_id} to={`/match/${encodeURIComponent(m.match_id)}`} className={cls} style={{ borderRadius: 0 }}>{body}</Link>
              : <div key={`fm-${m.fm_id}`} className={cls} title="Result from FotMob; odds and match centre follow when football-data posts it">{body}</div>;
          })}
        </div>
      </section>

      <section className="section">
        <h2>Title races</h2>
        <p className="small ink2" style={{ marginTop: -6 }}>Chance of winning the league, from 10,000 simulated finishes of the season.</p>
        <Loading state={race} />
        <div className="races">
          {races.map(({ c, rows }) => (
            <div key={c} className="race">
              <h3><Link to={`/league?league=${c}`}>{LEAGUES[c]}</Link><span className="eyebrow">P(title)</span></h3>
              {rows.map((r, i) => (
                <div key={r.club_id} className="race-row">
                  <Link className="n" to={`/team/${encodeURIComponent(r.club_id)}`} style={{ fontWeight: i === 0 ? 650 : 400 }}>{r.name}</Link>
                  <span className="p">{r.p_title > 0 && r.p_title < 0.005 ? "<1%" : fmt.pct(r.p_title)}</span>
                  <span className="t"><span style={{ width: `${100 * r.p_title}%`, background: i === 0 ? "var(--s1)" : "var(--seq-300)", animationDelay: `${i * 0.08}s` }} /></span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <h2>Momentum</h2>
        <div className="grid">
          <div className="c5">
            <div className="card" style={{ height: "100%" }}>
              <p className="fig-title">Biggest movers</p>
              <p className="fig-sub">Change in Elo rating over the last six weeks of matches. Current rating on the left.</p>
              <Loading state={movers} />
              <div className="movers">
                {movers.rows.map((r, i) => {
                  const w = (Math.abs(r.delta) / maxMove) * 50;
                  return (
                    <div key={r.club} className="mover">
                      <Link to={`/team/${encodeURIComponent(r.club)}`} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</Link>
                      <span className="e">{fmt.n(r.e1)}</span>
                      <span className="dv" title={`${fmt.signed(r.delta, 0)} Elo`}>
                        <span style={{ left: r.delta >= 0 ? "50%" : `${50 - w}%`, width: `${w}%`, background: r.delta >= 0 ? "var(--pos)" : "var(--neg)",
                                       transformOrigin: r.delta >= 0 ? "left" : "right", animationDelay: `${i * 0.05}s` }} />
                        <i style={r.delta >= 0 ? { right: `${Math.max(0, 50 - w) - 2}%`, transform: "translateX(100%)" } : { left: `${Math.max(0, 50 - w) - 2}%`, transform: "translateX(-100%)" }}>
                          {fmt.signed(r.delta, 0)}</i>
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="c7">
            {ltPlot && <Figure title="The Eredivisie and Primeira Liga sit furthest below the Premier League"
              subtitle="How much more a Premier League-strength side would score per match in each league, estimated from players who moved between leagues. Lines: 90% intervals."
              source="Transfermarkt minutes and results" plot={ltPlot} alt="League translation factors"
              table={{ rows: lt.rows, cols: [["league", "League", (v) => LEAGUES[v]], ["goals_multiplier_vs_pl", "×", (v) => v.toFixed(2)], ["movers", "Players"]] }} />}
          </div>
        </div>
      </section>

      <section className="section">
        <h2>Tools</h2>
        <div className="toolgrid">
          {TOOLS.map(([to, title, sub], i) => (
            <Link key={to} to={to} className="tool spot">
              <span className="ix">{String(i + 1).padStart(2, "0")}</span>
              <b>{title}</b>
              <span className="ar">→</span>
              <p>{sub}</p>
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}
