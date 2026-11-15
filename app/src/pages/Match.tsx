import * as Plot from "@observablehq/plot";
import { useMemo } from "react";
import { useParams } from "react-router-dom";
import { lit, Row, useQuery } from "../db";
import { css, fmt, LEAGUES, seasonLabel } from "../lib/format";
import { scoreMatrix, summarise, WpParams } from "../lib/models";
import { Figure } from "../ui/Figure";
import { Card, ClubLink, Empty, Legend, Loading, MatchLink, OutcomeBar, PlayerLink } from "../ui/kit";
import { LineupPitch, Pitch, ShotLayer } from "../ui/pitch";
import { computeWp, WpPoint } from "./match/shared";
import { WinProbChart, wpTitle } from "./match/WinProbChart";
import { ScoreGrid, StatBars, Timeline } from "./match/parts";

export default function Match() {
  const id = decodeURIComponent(useParams().id ?? "");
  const mq = useQuery(`select m.*, ch.capacity from matches m left join clubs ch on ch.club_id = m.home_club where m.match_id = ${lit(id)}`);
  const ev = useQuery(`select e.*, p.name, pi.name in_name, pa.name assist_name from match_events e
    left join players p on p.player_id = e.player_id left join players pi on pi.player_id = e.player_in_id
    left join players pa on pa.player_id = e.assist_id
    where e.match_id = ${lit(id)} and e.type <> 'shootout' order by e.minute, e.type`);
  const lu = useQuery(`select l.*, p.name from match_lineups l left join players p using (player_id) where l.match_id = ${lit(id)}`);
  const tl = useQuery(`select * from timelines where match_id = ${lit(id)} order by minute`);
  const wpp = useQuery(`select term, coef from wp_params`);
  const ea = useQuery(`select * from matches_a where canonical_match_id = ${lit(id)}`);
  const a = ea.rows[0]?.canonical_match_id === id ? ea.rows[0] : undefined;
  const shots = useQuery(a?.provider === "wyscout"
    ? `select s.*, p.name from shots_wy s left join players p using (player_id) where s.match_id = ${Number(a.match_id)} order by period, time_s` : null);
  const m = mq.rows[0]?.match_id === id ? mq.rows[0] : undefined;
  const h2h = useQuery(m ? `select match_id, match_date, home_club, away_club, home_team, away_team, home_goals, away_goals, competition_id, season
    from matches where played and match_id <> ${lit(id)} and ((home_club = ${lit(m.home_club)} and away_club = ${lit(m.away_club)})
    or (home_club = ${lit(m.away_club)} and away_club = ${lit(m.home_club)})) order by match_date desc limit 8` : null);

  const wp: WpPoint[] | null = useMemo(() => {
    if (!m) return null;
    // the browser model reproduces the pipeline exactly (models.test.ts) and also tracks red
    // cards and the 90th minute, so prefer it whenever the events are here
    const hasEvents = !ev.loading && ev.rows.some((e) => e.type === "goals") === (m.home_goals + m.away_goals > 0);
    if (m.lh != null && wpp.rows.length && hasEvents) return computeWp(m.lh, m.la, wpp.rows as WpParams, ev.rows, m.home_club);
    if (tl.rows.length && tl.rows[0].match_id === id) {
      const pts: WpPoint[] = tl.rows.map((r) => ({ minute: r.minute, gd: r.gd, redD: 0, p_home: r.p_home, p_draw: r.p_draw, p_away: r.p_away }));
      const gd = m.home_goals - m.away_goals;
      if (pts[pts.length - 1].minute < 90) pts.push({ minute: 90, gd, redD: 0, p_home: gd > 0 ? 1 : 0, p_draw: gd === 0 ? 1 : 0, p_away: gd < 0 ? 1 : 0 });
      return pts;
    }
    return null;
  }, [m, tl.rows, wpp.rows, ev.rows, ev.loading]);

  const dc = useMemo(() => (m?.lh != null ? scoreMatrix(m.lh, m.la, m.rho ?? 0) : null), [m]);
  const dcs = dc ? summarise(dc) : null;

  if (!m) return <Loading state={mq.loading || mq.error ? mq : { loading: false, error: "match not found" }} />;

  const goals = ev.rows.filter((e) => e.type === "goals");
  const reds = ev.rows.filter((e) => e.type === "cards" && e.card !== "yellow");
  const res = m.home_goals > m.away_goals ? 0 : m.home_goals === m.away_goals ? 1 : 2;
  const forecasts: { name: string; p: [number, number, number] | null; note: string }[] = [
    { name: "Closing market", p: m.mkt_h != null ? [m.mkt_h, m.mkt_d, m.mkt_a] : null, note: "de-vigged closing odds" },
    { name: "Dixon-Coles (ours)", p: dcs ? [dcs.home, dcs.draw, dcs.away] : null, note: dcs ? `expected goals ${fmt.n(m.lh, 2)}–${fmt.n(m.la, 2)}` : "" },
    { name: "Elo (ours)", p: m.elo_h != null ? [m.elo_h, m.elo_d, m.elo_a] : null, note: m.elo_home != null ? `ratings ${fmt.n(m.elo_home)} v ${fmt.n(m.elo_away)}` : "" },
  ];
  const best = forecasts.filter((f) => f.p).sort((x, y) => y.p![res] - x.p![res])[0];
  const actualP = dc ? dc[Math.min(m.home_goals, 10)][Math.min(m.away_goals, 10)] : null;
  const rank = dc && actualP != null ? dc.flat().filter((p) => p > actualP).length + 1 : null;

  const starters = (club: string) => lu.rows.filter((l) => l.club_id === club && l.starter)
    .map((l) => ({ name: l.name ?? "?", group: l.position_group, shirt: l.shirt, id: l.player_id, captain: l.captain }));
  const bench = (club: string) => lu.rows.filter((l) => l.club_id === club && !l.starter);
  const subOn = new Map(ev.rows.filter((e) => e.type === "substitutions").map((e) => [e.player_in_id, e.minute]));
  const subOff = new Map(ev.rows.filter((e) => e.type === "substitutions").map((e) => [e.player_id, e.minute]));

  return (
    <>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="eyebrow" style={{ textAlign: "center" }}>{LEAGUES[m.competition_id]} · {seasonLabel(m.season, m.competition_id)}{m.round ? ` · ${m.round}` : ""} · {fmt.dayYear(m.match_date)}</div>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto minmax(0,1fr)", gap: 16, alignItems: "center", margin: "14px 0 10px" }}>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: "clamp(1.1rem, 3.2vw, 1.9rem)", fontWeight: 700, letterSpacing: "-0.02em" }}><ClubLink id={m.home_club} name={m.home_team} /></div>
            <div className="small muted">{m.home_manager ?? ""}{m.home_formation ? ` · ${m.home_formation}` : ""}</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div className="hero-num" style={{ fontSize: "clamp(2rem, 7vw, 3.4rem)" }}>{fmt.n(m.home_goals)}–{fmt.n(m.away_goals)}</div>
            {m.home_goals_ht != null && <div className="small muted">HT {m.home_goals_ht}–{m.away_goals_ht}</div>}
          </div>
          <div>
            <div style={{ fontSize: "clamp(1.1rem, 3.2vw, 1.9rem)", fontWeight: 700, letterSpacing: "-0.02em" }}><ClubLink id={m.away_club} name={m.away_team} /></div>
            <div className="small muted">{m.away_manager ?? ""}{m.away_formation ? ` · ${m.away_formation}` : ""}</div>
          </div>
        </div>
        <div className="row small muted" style={{ justifyContent: "center", gap: "0.4rem 1.2rem" }}>
          {m.stadium && <span>{m.stadium}</span>}
          {m.attendance != null && <span>{fmt.n(m.attendance)} attendance{m.capacity ? ` (${fmt.pct(m.attendance / m.capacity)} full)` : ""}</span>}
          {m.referee && <span>Referee {m.referee}</span>}
        </div>
        {goals.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 12 }} className="small">
            {[m.home_club, m.away_club].map((c, side) => (
              <div key={c} style={{ textAlign: side === 0 ? "right" : "left" }}>
                {goals.filter((g) => g.club_id === c).map((g, i) => (
                  <div key={i}>{g.name ?? "?"} {g.minute}'{g.is_penalty ? " (pen)" : ""}{g.is_own_goal ? " (og)" : ""}</div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid">
        <div className="c7">
          {wp ? (
            <WpFigure wp={wp} home={m.home_team} away={m.away_team} goals={goals} reds={reds} homeId={m.home_club} source="computed" />
          ) : (
            <Card title="Win probability"><Empty>{m.lh == null ? "No pre-match model for this match (our forecasts start in 2017-18), so no in-game probabilities." : "Loading…"}</Empty></Card>
          )}
        </div>
        <div className="c5">
          <Card title={best ? `${best.name} gave the result the best chance (${fmt.pct(best.p![res])})` : "Before kickoff"}
                sub="Home / draw / away before kickoff, and the probability each gave to what happened.">
            <div className="stack" style={{ gap: 12 }}>
              {forecasts.map((f) => (
                <div key={f.name}>
                  <div className="row between small" style={{ marginBottom: 4 }}>
                    <b>{f.name}</b>
                    <span className="muted">{f.p ? `result ${fmt.pct(f.p[res])} · fair odds ${fmt.odds(f.p[0])} / ${fmt.odds(f.p[1])} / ${fmt.odds(f.p[2])}` : "not available"}</span>
                  </div>
                  {f.p ? <OutcomeBar h={f.p[0]} d={f.p[1]} a={f.p[2]} labels={[m.home_team, "Draw", m.away_team]} /> : <div className="segbar thin" style={{ background: "var(--surface-3)", borderRadius: 4 }} />}
                  {f.note && <div className="xs muted" style={{ marginTop: 2 }}>{f.note}</div>}
                </div>
              ))}
            </div>
          </Card>
        </div>

        <div className="c12">
          <Card title="How the match unfolded" sub={ev.rows.length ? "Goals, cards and substitutions by minute (Transfermarkt folds added time into 45' and 90'). Hover for details." : undefined}>
            {ev.rows.length ? <Timeline events={ev.rows} homeId={m.home_club} homeName={m.home_team} awayName={m.away_team} />
              : <Empty>No event data for this match (Transfermarkt events run to July 2026).</Empty>}
          </Card>
        </div>

        {dc && (
          <div className="c5">
            <Card title={`Our model rated ${m.home_goals}–${m.away_goals} at ${fmt.pct(actualP, 1)}${rank ? `, the #${rank} likeliest score` : ""}`}
                  sub={`Dixon-Coles score probabilities before kickoff (%, outlined: the actual score). Over 2.5 goals ${fmt.pct(dcs!.over25)}, both teams to score ${fmt.pct(dcs!.btts)}.`}>
              <ScoreGrid m={dc} home={m.home_team} away={m.away_team} actual={[m.home_goals, m.away_goals]} />
            </Card>
          </div>
        )}
        <div className={dc ? "c7" : "c12"}>
          <Card title="Match stats">
            <Legend items={[{ label: m.home_team, color: "var(--s1)", kind: "rect" }, { label: m.away_team, color: "var(--s2)", kind: "rect" }]} />
            <StatBars rows={[
              ...(m.home_xg != null ? [{ label: "xG (published)", h: m.home_xg, a: m.away_xg, d: 2 }] : []),
              ...(a ? [{ label: `xG (our model, ${a.provider === "wyscout" ? "Wyscout" : "StatsBomb"} events)`, h: a.xg_home, a: a.xg_away, d: 2 }] : []),
              { label: "Shot-based xG", h: m.proxy_home_xg, a: m.proxy_away_xg, d: 2 },
              { label: "Shots", h: m.home_shots, a: m.away_shots },
              { label: "Shots on target", h: m.home_sot, a: m.away_sot },
              { label: "Corners", h: m.home_corners, a: m.away_corners },
              { label: "Fouls", h: m.home_fouls, a: m.away_fouls },
              { label: "Yellow cards", h: m.home_yellows, a: m.away_yellows },
              { label: "Red cards", h: m.home_reds, a: m.away_reds },
            ]} />
            {a && a.p_home != null && (
              <div style={{ marginTop: 14 }}>
                <div className="small" style={{ marginBottom: 4 }}><b>Deserved result</b> <span className="muted">— chance of each outcome had every shot been converted at its xG</span></div>
                <OutcomeBar h={a.p_home} d={a.p_draw} a={a.p_away} labels={[m.home_team, "Draw", m.away_team]} />
              </div>
            )}
          </Card>
        </div>

        {a?.provider === "wyscout" && shots.rows.length > 0 && shots.rows[0].match_id === Number(a.match_id) && <ShotSection shots={shots.rows} m={m} />}

        <div className="c12">
          <Card title="Line-ups" sub={lu.rows.length ? "Starting XIs by position group (Transfermarkt gives groups, not exact spots). (C) captain; ↑/↓ minute subbed on/off." : undefined}>
            {lu.rows.length ? (
              <div className="grid">
                <div className="c8"><LineupPitch home={starters(m.home_club)} away={starters(m.away_club)} /></div>
                <div className="c4">
                  {[m.home_club, m.away_club].map((c, side) => (
                    <div key={c} style={{ marginBottom: 14 }}>
                      <div className="row small" style={{ gap: 6, marginBottom: 4 }}><span className="dot" style={{ background: side ? "var(--s2)" : "var(--s1)" }} /><b>{side ? m.away_team : m.home_team}</b></div>
                      <div className="small">
                        {starters(c).sort((x, y) => (x.shirt ?? 99) - (y.shirt ?? 99)).map((p) => (
                          <div key={p.id} className="row" style={{ gap: 6 }}>
                            <span className="muted num" style={{ width: 20, textAlign: "right" }}>{p.shirt ?? ""}</span>
                            <PlayerLink id={p.id} name={p.name} />{p.captain ? " (C)" : ""}
                            <span className="muted xs">{p.group}{subOff.has(p.id) ? ` ↓${subOff.get(p.id)}'` : ""}</span>
                          </div>
                        ))}
                        <div className="xs muted" style={{ marginTop: 4 }}>Bench: {bench(c).map((b, i) => (
                          <span key={b.player_id}>{i ? ", " : ""}<PlayerLink id={b.player_id} name={b.name ?? "?"} />{subOn.has(b.player_id) ? ` ↑${subOn.get(b.player_id)}'` : ""}</span>
                        ))}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : <Empty>No line-up data for this match.</Empty>}
          </Card>
        </div>

        {h2h.rows.length > 0 && (
          <div className="c12">
            <Card title="Previous meetings">
              <table className="data"><tbody>
                {h2h.rows.map((r) => (
                  <tr key={r.match_id}>
                    <td className="muted small">{fmt.dayYear(r.match_date)}</td>
                    <td className="small muted">{LEAGUES[r.competition_id]}</td>
                    <td className="r">{r.home_team}</td>
                    <td className="c"><MatchLink id={r.match_id}><b className="num">{r.home_goals}–{r.away_goals}</b></MatchLink></td>
                    <td>{r.away_team}</td>
                  </tr>
                ))}
              </tbody></table>
            </Card>
          </div>
        )}
      </div>
    </>
  );
}

function WpFigure({ wp, home, away, goals, reds, homeId, source }: { wp: WpPoint[]; home: string; away: string; goals: Row[]; reds: Row[]; homeId: string; source: string }) {
  return (
    <Figure title={wpTitle(wp, home, away)}
            subtitle={<>Each team's chance of winning, minute by minute, from the score, the clock, red cards and pre-match strength
              ({source === "stored" ? "from the pipeline" : "computed live in your browser with the pipeline's model"}). Hover anywhere for the exact numbers.</>}
            source="football-data.co.uk, Transfermarkt events" alt="Win probability over the match"
            table={{ rows: wp.filter((r) => r.minute % 5 === 0 || r.minute === 90), cols: [["minute", "Minute"], ["gd", "Margin"], ["p_home", home, (v) => fmt.pct(v)], ["p_draw", "Draw", (v) => fmt.pct(v)], ["p_away", away, (v) => fmt.pct(v)]] }}>
      <WinProbChart wp={wp} home={home} away={away} goals={goals} reds={reds} homeId={homeId} />
    </Figure>
  );
}

function ShotSection({ shots, m }: { shots: Row[]; m: Row }) {
  const t = (s: Row) => (s.period === 2 ? 45 : 0) + s.time_s / 60;
  const race = useMemo(() => {
    const series = [m.home_club, m.away_club].flatMap((club) => {
      let c = 0;
      const pts = [{ minute: 0, xg: 0, club, goal: false, name: "" }];
      shots.filter((s) => s.club_id === club).forEach((s) => { c += s.xg; pts.push({ minute: t(s), xg: c, club, goal: !!s.goal, name: s.name ?? "" }); });
      pts.push({ minute: 95, xg: c, club, goal: false, name: "" });
      return pts;
    });
    const lab = (c: string) => (c === m.home_club ? m.home_team : m.away_team);
    return { series: series.map((p) => ({ ...p, team: lab(p.club) })), lab };
  }, [shots, m]);
  const plot = useMemo(() => (width: number) => ({
    width, height: 280, marginLeft: 40, x: { label: "Minute →", domain: [0, 95] }, y: { label: "↑ Cumulative xG", grid: true },
    color: { domain: [m.home_team, m.away_team], range: [css("--s1"), css("--s2")], legend: true },
    marks: [
      Plot.line(race.series, { x: "minute", y: "xg", stroke: "team", curve: "step-after", strokeWidth: 2 }),
      Plot.dot(race.series.filter((p) => p.goal), { x: "minute", y: "xg", fill: "team", r: 5, stroke: css("--surface"), strokeWidth: 2 }),
      Plot.tip(race.series.filter((p) => p.name), Plot.pointer({ x: "minute", y: "xg", title: (d: any) => `${d.team} ${fmt.n(d.xg, 2)} xG at ${Math.floor(d.minute)}'\n${d.name}${d.goal ? " — goal" : ""}` })),
    ],
  }), [race, m]);
  const total = (club: string) => shots.filter((s) => s.club_id === club).reduce((a, s) => a + s.xg, 0);
  return (
    <>
      <div className="c6">
        <Card title="Shot map" sub={`${m.home_team} attack right, ${m.away_team} attack left. Circle area = xG; filled = goal. Hover a shot.`}
              foot="Wyscout public dataset (CC BY 4.0) · xG from our model">
          <Pitch label="Shot map">
            <ShotLayer shots={shots.map((s) => {
              const home = s.club_id === m.home_club;
              return { x: home ? s.x : 105 - s.x, y: home ? s.y : 68 - s.y, xg: s.xg, goal: !!s.goal, side: home ? 0 : 1,
                       label: `${s.name ?? ""}` , ...{ raw: s } } as any;
            })} tipFn={(s: any) => <><b>{s.xg.toFixed(2)} xG</b>{s.goal ? " · goal" : ""}<div className="muted">{s.raw.name ?? ""} · {Math.floor(t(s.raw))}' · {s.raw.body}, {s.raw.situation}</div></>} />
          </Pitch>
          <Legend items={[{ label: `${m.home_team} ${fmt.n(total(m.home_club), 2)} xG`, color: "var(--s1)" }, { label: `${m.away_team} ${fmt.n(total(m.away_club), 2)} xG`, color: "var(--s2)" }]} />
        </Card>
      </div>
      <div className="c6">
        <Figure title="xG race" subtitle="Cumulative expected goals through the match; dots are goals." source="Wyscout public dataset" plot={plot}
                alt="Cumulative xG over the match"
                table={{ rows: shots.map((s) => ({ ...s, minute: Math.floor(t(s)) })), cols: [["minute", "Min"], ["name", "Player"], ["xg", "xG", (v) => fmt.n(v, 2)], ["goal", "Goal", (v) => (v ? "yes" : "")]] }} />
      </div>
    </>
  );
}
