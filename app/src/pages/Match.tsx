import * as Plot from "@observablehq/plot";
import { useMemo } from "react";
import { useParams } from "react-router-dom";
import { ClubLink, css, Figure, fmt, LEAGUES, Loading, Pitch, seasonLabel } from "../components";
import { lit, useQuery } from "../db";

export default function Match() {
  const id = decodeURIComponent(useParams().id ?? "");
  const m0 = useQuery(`select * from matches where match_id = ${lit(id)}`);
  const tl = useQuery(`select * from timelines where match_id = ${lit(id)} order by minute`);
  const ev = useQuery(`select * from matches_a where canonical_match_id = ${lit(id)}`);
  const a = ev.rows[0];
  const shots = useQuery(a?.provider === "wyscout"
    ? `select s.*, p.name from shots_wy s left join players p using (player_id) where match_id = ${a.match_id} order by period, time_s`
    : null);
  const m = m0.rows[0];

  const wp = useMemo(() => {
    if (!tl.rows.length || !m) return undefined;
    const long = tl.rows.flatMap((r) => [
      { minute: r.minute, p: r.p_home, k: m.home_team }, { minute: r.minute, p: r.p_draw, k: "Draw" },
      { minute: r.minute, p: r.p_away, k: m.away_team }]);
    const goals = tl.rows.filter((r, i) => i > 0 && r.gd !== tl.rows[i - 1].gd);
    return (width: number) => ({
      width, height: 280, x: { label: "Minute", domain: [0, 95] }, y: { label: "Win probability", domain: [0, 1], tickFormat: "%", grid: true },
      color: { domain: [m.home_team, "Draw", m.away_team], range: [css("--cat-1"), css("--neutral"), css("--cat-2")], legend: true },
      marks: [
        Plot.areaY(long, { x: "minute", y: "p", fill: "k", order: [m.home_team, "Draw", m.away_team], fillOpacity: 0.75, curve: "step-after",
                           title: (d: any) => `${d.minute}': ${d.k} ${fmt.pct(d.p)}` }),
        Plot.ruleX(goals, { x: "minute", stroke: css("--text"), strokeDasharray: "2 2" }),
        Plot.text(goals, { x: "minute", y: 1, dy: -6, text: () => "⚽", fontSize: 11 }),
      ],
    });
  }, [tl.rows, m]);

  const race = useMemo(() => {
    if (!shots.rows.length || !m) return undefined;
    const t = (s: any) => (s.period === 2 ? 45 : 0) + s.time_s / 60;
    const series = [m.home_club, m.away_club].flatMap((club) => {
      let c = 0;
      const pts = [{ minute: 0, xg: 0, club }];
      for (const s of shots.rows.filter((s) => s.club_id === club)) { c += s.xg; pts.push({ minute: t(s), xg: c, club }); }
      pts.push({ minute: 95, xg: c, club });
      return pts;
    });
    const lab = (c: string) => (c === m.home_club ? m.home_team : m.away_team);
    return (width: number) => ({
      width, height: 240, x: { label: "Minute", domain: [0, 95] }, y: { label: "Cumulative xG", grid: true },
      color: { domain: [m.home_team, m.away_team], range: [css("--cat-1"), css("--cat-2")], legend: true },
      marks: [
        Plot.line(series, { x: "minute", y: "xg", stroke: (d: any) => lab(d.club), curve: "step-after", strokeWidth: 2 }),
        Plot.dot(shots.rows.filter((s) => s.goal), { x: t, y: (s: any) => series.find((p) => p.club === s.club_id && Math.abs(p.minute - t(s)) < 1e-9)?.xg,
                                                     fill: (s: any) => lab(s.club_id), r: 5, title: (s: any) => `Goal: ${s.name ?? ""} (${fmt.n(s.xg, 2)} xG)` }),
      ],
    });
  }, [shots.rows, m]);

  if (!m) return <Loading state={m0.loading || m0.error ? m0 : { loading: false, error: "match not found" }} />;
  const probs: [string, number, number, number][] = [
    ["Market (closing)", m.mkt_h, m.mkt_d, m.mkt_a], ["Elo model", m.elo_h, m.elo_d, m.elo_a]];
  return (
    <>
      <p className="small muted" style={{ margin: 0 }}>{LEAGUES[m.competition_id]} {seasonLabel(m.season, m.competition_id)} · {fmt.date(m.match_date)}{m.referee ? ` · referee ${m.referee}` : ""}</p>
      <h1><ClubLink id={m.home_club} name={m.home_team} /> {fmt.n(m.home_goals)}–{fmt.n(m.away_goals)} <ClubLink id={m.away_club} name={m.away_team} /></h1>
      <div className="grid">
        <div className="span-4 card">
          <p className="figure-title">Before kickoff</p>
          <table className="data">
            <thead><tr><th></th><th className="r">Home</th><th className="r">Draw</th><th className="r">Away</th></tr></thead>
            <tbody>{probs.map(([l, h, d, aw]) => (
              <tr key={l}><td>{l}</td><td className="r">{fmt.pct(h)}</td><td className="r">{fmt.pct(d)}</td><td className="r">{fmt.pct(aw)}</td></tr>))}
            </tbody>
          </table>
          <p className="figure-title" style={{ marginTop: "1rem" }}>Match stats</p>
          <table className="data"><tbody>
            <tr><td>Shots (on target)</td><td className="r">{fmt.n(m.home_shots)} ({fmt.n(m.home_sot)})</td><td className="r">{fmt.n(m.away_shots)} ({fmt.n(m.away_sot)})</td></tr>
            {m.home_xg != null && <tr><td>xG (published)</td><td className="r">{fmt.n(m.home_xg, 2)}</td><td className="r">{fmt.n(m.away_xg, 2)}</td></tr>}
            {a && <tr><td>xG (our model, {a.provider})</td><td className="r">{fmt.n(a.xg_home, 2)}</td><td className="r">{fmt.n(a.xg_away, 2)}</td></tr>}
            <tr><td>Proxy xG (shots model)</td><td className="r">{fmt.n(m.proxy_home_xg, 2)}</td><td className="r">{fmt.n(m.proxy_away_xg, 2)}</td></tr>
          </tbody></table>
        </div>
        <div className="span-8">
          {wp ? (
            <Figure title="How the win probability moved"
                    subtitle="From the score, minute, red cards and pre-match strength. Dashed lines: goals."
                    source="football-data.co.uk, Transfermarkt events" plot={wp} alt="Win probability over the match" />
          ) : (
            <div className="card small muted">Minute-by-minute win probability is published for 2023-24 to 2025-26 matches.</div>
          )}
        </div>
        {shots.rows.length > 0 && (
          <>
            <div className="span-6 card">
              <p className="figure-title">Shot map</p>
              <p className="figure-sub">Both teams attacking right; {m.home_team} blue, {m.away_team} orange. Size = xG, filled = goal.</p>
              <Pitch>
                {shots.rows.map((s, i) => {
                  const home = s.club_id === m.home_club;
                  const col = home ? "var(--cat-1)" : "var(--cat-2)";
                  return (
                    <circle key={i} cx={s.x} cy={s.y} r={0.8 + 3.2 * Math.sqrt(s.xg)} fill={s.goal ? col : "none"} stroke={col} strokeWidth={0.4}
                            fillOpacity={0.85}>
                      <title>{`${s.name ?? ""} ${(s.period === 2 ? 45 : 0) + Math.floor(s.time_s / 60)}' · ${s.xg.toFixed(2)} xG · ${s.body}, ${s.situation}${s.goal ? " · GOAL" : ""}`}</title>
                    </circle>
                  );
                })}
              </Pitch>
              <p className="small muted">Wyscout public dataset (CC BY 4.0), xG from our model.</p>
            </div>
            <div className="span-6">{race && <Figure title="xG race" subtitle="Cumulative expected goals; dots are goals." source="Wyscout public dataset" plot={race} alt="Cumulative xG over the match" />}</div>
          </>
        )}
      </div>
    </>
  );
}
