// Match predictor: any two rated clubs, live Dixon-Coles score matrix, every derived market,
// head-to-head history and recent form.
import * as Plot from "@observablehq/plot";
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { lit, Row, useQuery } from "../db";
import { css, fmt, LEAGUES, result } from "../lib/format";
import { rates, scoreMatrix, summarise } from "../lib/models";
import { ScoreMatrix } from "../ui/charts";
import { Figure } from "../ui/Figure";
import {
  Card, ClubLink, EntityPicker, Field, FormStrip, Loading, MatchLink, OutcomeBar, PageHead, Seg, Sparkline, Tile, useParam,
} from "../ui/kit";

const pctChange = (d: number) => `${d >= 0 ? "+" : "−"}${Math.abs((Math.exp(d) - 1) * 100).toFixed(0)}%`;

export default function Predict() {
  const ratings = useQuery(`select club_id, name, competition_id, dc_att, dc_dfn, dc_home, dc_gd, mkt_gd, elo, as_of
                            from team_ratings where current`);
  const lt = useQuery(`select league, log_factor from league_translation`);
  const rhoQ = useQuery(`with s as (select competition_id, max(season) ms from matches where rho is not null group by 1)
                         select m.competition_id, median(m.rho) rho from matches m join s on m.competition_id = s.competition_id and m.season = s.ms
                         group by 1`);
  const byId = useMemo(() => new Map(ratings.rows.map((r) => [r.club_id, r])), [ratings.rows]);
  const defaults = useMemo(() => ratings.rows.filter((r) => r.competition_id === "GB1").sort((a, b) => b.dc_gd - a.dc_gd), [ratings.rows]);
  const [hP, setH] = useParam("h", "");
  const [aP, setA] = useParam("a", "");
  const [neutral, setNeutral] = useParam("neutral", "0");
  const [shP, setSh] = useParam("sh", "0");
  const [saP, setSa] = useParam("sa", "0");
  const hId = hP || defaults[0]?.club_id || "", aId = aP || defaults[1]?.club_id || "";
  const H = byId.get(hId), A = byId.get(aId);
  const sh = Number(shP), sa = Number(saP);

  const model = useMemo(() => {
    if (!H || !A) return null;
    const f = new Map(lt.rows.map((r) => [r.league, r.log_factor]));
    f.set("GB1", 0);
    const cross = H.competition_id !== A.competition_id;
    const fh = f.get(H.competition_id), fa = f.get(A.competition_id);
    const adjustable = !cross || (fh != null && fa != null);
    const tf = (team: Row, k: number | undefined, s: number) => ({
      att: team.dc_att - (cross && adjustable ? (k ?? 0) / 2 : 0) + s,
      dfn: team.dc_dfn + (cross && adjustable ? (k ?? 0) / 2 : 0) - s,
    });
    const home = Number(H.dc_home);
    const { lh, la } = rates(tf(H, fh, sh), tf(A, fa, sa), home, neutral === "1");
    const rho = Number(rhoQ.rows.find((r) => r.competition_id === H.competition_id)?.rho ?? -0.05);
    const m = scoreMatrix(lh, la, rho);
    const s = summarise(m);
    let homeNil = 0, awayNil = 0;
    m.forEach((row, i) => row.forEach((p, j) => { if (i > 0 && j === 0) homeNil += p; if (j > 0 && i === 0) awayNil += p; }));
    return { lh, la, rho, m, s, cross, adjustable, homeNil, awayNil, home };
  }, [H, A, lt.rows, rhoQ.rows, sh, sa, neutral]);

  const h2h = useQuery(H && A ? `select * from matches where played and ((home_club = ${lit(hId)} and away_club = ${lit(aId)})
                                 or (home_club = ${lit(aId)} and away_club = ${lit(hId)})) order by match_date desc limit 10` : null);
  const recent = useQuery(H && A ? `select * from (
      select *, row_number() over (partition by side order by kickoff_utc desc nulls last, match_date desc) k from (
        select *, ${lit(hId)} side from matches where played and (home_club = ${lit(hId)} or away_club = ${lit(hId)})
        union all
        select *, ${lit(aId)} side from matches where played and (home_club = ${lit(aId)} or away_club = ${lit(aId)})))
      where k <= 20` : null);

  const gdPlot = useMemo(() => {
    if (!model) return undefined;
    const d = [...model.s.gd.entries()].filter(([g]) => g >= -5 && g <= 5).map(([g, p]) => ({ g, p }));
    return (width: number) => ({
      width, height: 220, x: { label: `← ${A?.name} win by · ${H?.name} win by →`, type: "band" as const, domain: d.map((x) => x.g).sort((a, b) => a - b), tickFormat: (g: number) => (g > 0 ? `+${g}` : String(g)) },
      y: { label: null, tickFormat: "%", grid: true },
      marks: [
        Plot.barY(d, { x: "g", y: "p", fill: (r: any) => (r.g > 0 ? css("--s1") : r.g < 0 ? css("--s2") : css("--muted")), insetLeft: 6, insetRight: 6, rx: 4 }),
        Plot.tip(d, Plot.pointerX({ x: "g", y: "p", title: (r: any) => `${r.g === 0 ? "Draw" : r.g > 0 ? `${H?.name} by ${r.g}` : `${A?.name} by ${-r.g}`}: ${fmt.pct(r.p, 1)}` })),
      ],
    });
  }, [model, H, A]);
  const totPlot = useMemo(() => {
    if (!model) return undefined;
    const d = [...model.s.total.entries()].filter(([t]) => t <= 8).map(([t, p]) => ({ t, p })).sort((a, b) => a.t - b.t);
    return (width: number) => ({
      width, height: 220, x: { label: "Total goals", type: "band" as const }, y: { label: null, tickFormat: "%", grid: true },
      marks: [
        Plot.barY(d, { x: "t", y: "p", fill: css("--s1"), insetLeft: 6, insetRight: 6, rx: 4 }),
        Plot.tip(d, Plot.pointerX({ x: "t", y: "p", title: (r: any) => `${r.t} goals: ${fmt.pct(r.p, 1)}` })),
      ],
    });
  }, [model]);

  const form = (id: string): Row[] => recent.rows.filter((r) => r.side === id).map((m) => {
    const home = m.home_club === id;
    const gf = home ? m.home_goals : m.away_goals, ga = home ? m.away_goals : m.home_goals;
    return { ...m, r: result(gf, ga), gf, ga, opp: home ? m.away_team : m.home_team, oppId: home ? m.away_club : m.home_club, ha: home ? "H" : "A",
             elo: home ? m.elo_home : m.elo_away };
  });
  const fh = form(hId), fa = form(aId);
  const s = model?.s;
  const h2hRec = h2h.rows.reduce((acc, m) => {
    const hHome = m.home_club === hId;
    const gf = hHome ? m.home_goals : m.away_goals, ga = hHome ? m.away_goals : m.home_goals;
    acc[result(gf, ga)]++;
    return acc;
  }, { W: 0, D: 0, L: 0 } as Record<string, number>);

  const fav = s && H && A ? (s.home >= s.away ? { n: H.name, p: s.home } : { n: A.name, p: s.away }) : null;
  return (
    <>
      <PageHead eyebrow="Match predictor"
                title={fav && H && A ? `${fav.n} win ${fmt.pct(fav.p)} of the time` : "Pick any two teams"}
                lead="Any two rated clubs, home, away or on neutral ground. Every probability updates as you change the matchup or nudge a side's strength." />
      <Loading state={ratings} />
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="filters" style={{ margin: 0, alignItems: "flex-end" }}>
          <Field label="Home team"><EntityPicker kind="team" value={H?.name} placeholder="Home team" onPick={(e) => setH(e.id)} /></Field>
          <button className="btn" aria-label="Swap teams" onClick={() => { const p = new URLSearchParams(window.location.hash.split("?")[1] ?? ""); p.set("h", aId); p.set("a", hId); window.location.hash = `#/predict?${p}`; }}>⇄ Swap</button>
          <Field label="Away team"><EntityPicker kind="team" value={A?.name} placeholder="Away team" onPick={(e) => setA(e.id)} /></Field>
          <Field label="Venue"><Seg value={neutral} onChange={(v) => setNeutral(v)} label="Venue" options={[["0", "Home ground"], ["1", "Neutral"]]} /></Field>
        </div>
        {(hP && !H) || (aP && !A) ? <p className="error" style={{ marginTop: 10 }}>That team has no current rating (only clubs in the eight covered leagues this season are rated).</p> : null}
        {H && A && (
          <div className="grid" style={{ marginTop: 14 }}>
            {[{ t: H, v: sh, set: setSh, side: "Home" }, { t: A, v: sa, set: setSa, side: "Away" }].map(({ t, v, set, side }) => (
              <div className="c6" key={side}>
                <Field label={`${t.name}: adjust strength (injuries, form, a hunch)`}>
                  <div className="row" style={{ gap: 10, flexWrap: "nowrap" }}>
                    <input type="range" min={-0.3} max={0.3} step={0.02} value={v} onChange={(e) => set(e.target.value === "0" ? null : e.target.value)} aria-label={`${t.name} strength adjustment`} />
                    <span className="num small" style={{ width: 44, color: v ? "var(--text)" : "var(--muted)" }}>{pctChange(v)}</span>
                    {v !== 0 && <button className="btn ghost xs" onClick={() => set(null)}>Reset</button>}
                  </div>
                </Field>
                <div className="xs muted">{LEAGUES[t.competition_id]} · rating as of {fmt.dayYear(t.as_of)} · Elo {fmt.n(t.elo)}</div>
              </div>
            ))}
          </div>
        )}
        {model?.cross && (
          <p className="callout" style={{ marginTop: 12, marginBottom: 0 }}>
            {model.adjustable ? <>Cross-league matchup: both sides are put on a Premier League scale with the league-translation factors
              (estimated from players who moved between leagues). Approximate: league strength varies by season and by team.</>
              : <>Cross-league matchup involving a league without a translation factor ({[H, A].filter((t) => t && !["GB1", "ES1", "L1", "IT1", "FR1", "NL1", "PO1"].includes(t.competition_id)).map((t) => LEAGUES[t!.competition_id]).join(", ")}):
                ratings are compared unadjusted, which overrates the weaker league's sides. Treat with care.</>}
          </p>
        )}
      </div>

      {model && s && H && A && (
        <>
          <div className="tiles" style={{ marginBottom: 16 }}>
            <Tile label={`${H.name} expected goals`} value={fmt.n(model.lh, 2)} />
            <Tile label={`${A.name} expected goals`} value={fmt.n(model.la, 2)} />
            <Tile label="Most likely score" value={`${s.top[0].h}–${s.top[0].a}`} delta={`${fmt.pct(s.top[0].p, 1)} · fair odds ${fmt.odds(s.top[0].p)}`} />
            <Tile label="Both teams score" value={fmt.pct(s.btts)} delta={`over 2.5 goals ${fmt.pct(s.over25)}`} />
          </div>
          <div className="grid">
            <div className="c7">
              <Card title="Result" sub="Win / draw / win, with fair (no-margin) decimal odds.">
                <OutcomeBar h={s.home} d={s.draw} a={s.away} labels={[H.name, "Draw", A.name]} />
                <div className="row between small" style={{ marginTop: 8 }}>
                  <span><span className="dot" style={{ background: "var(--s1)" }} /> {H.name} <b>{fmt.pct(s.home, 1)}</b> <span className="muted">@ {fmt.odds(s.home)}</span></span>
                  <span><span className="dot" style={{ background: "var(--muted)" }} /> Draw <b>{fmt.pct(s.draw, 1)}</b> <span className="muted">@ {fmt.odds(s.draw)}</span></span>
                  <span><span className="dot" style={{ background: "var(--s2)" }} /> {A.name} <b>{fmt.pct(s.away, 1)}</b> <span className="muted">@ {fmt.odds(s.away)}</span></span>
                </div>
                <table className="data" style={{ marginTop: 16 }}>
                  <thead><tr><th>Market</th><th className="r">Probability</th><th className="r">Fair odds</th></tr></thead>
                  <tbody>
                    {([
                      [`${H.name} or draw`, s.home + s.draw], [`${A.name} or draw`, s.away + s.draw], ["Either team wins", s.home + s.away],
                      ["Both teams score", s.btts], ["Over 1.5 goals", s.over15], ["Over 2.5 goals", s.over25], ["Over 3.5 goals", s.over35],
                      [`${H.name} clean sheet`, s.cleanHome], [`${A.name} clean sheet`, s.cleanAway],
                      [`${H.name} win to nil`, model.homeNil], [`${A.name} win to nil`, model.awayNil],
                    ] as [string, number][]).map(([l, p]) => (
                      <tr key={l}><td>{l}</td><td className="r">{fmt.pct(p, 1)}</td><td className="r muted">{fmt.odds(p)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            </div>
            <div className="c5">
              <Card title="Every scoreline" sub={`Probability of each score, in %. ${H.name} goals down the side, ${A.name} across. Hover for fair odds.`}>
                <ScoreMatrix m={model.m} home={H.name} away={A.name} />
                <div className="small" style={{ marginTop: 10 }}>
                  <div className="eyebrow" style={{ marginBottom: 4 }}>Likeliest scores</div>
                  <div className="row" style={{ gap: 6 }}>
                    {s.top.slice(0, 6).map((c) => <span key={`${c.h}-${c.a}`} className="pill">{c.h}–{c.a} · {fmt.pct(c.p, 1)}</span>)}
                  </div>
                </div>
              </Card>
            </div>
            <div className="c6">
              {gdPlot && <Figure title="Winning margin" subtitle="Probability of each goal difference (blue: home win, orange: away win, grey: draw)."
                                 source="Dixon-Coles model" plot={gdPlot} alt="Goal difference distribution"
                                 table={{ rows: [...s.gd.entries()].sort((a, b) => a[0] - b[0]).map(([g, p]) => ({ g, p })), cols: [["g", "Goal difference"], ["p", "Probability", (v) => fmt.pct(v, 1)]] }} />}
            </div>
            <div className="c6">
              {totPlot && <Figure title="Total goals" subtitle={`Expected total ${fmt.n(model.lh + model.la, 2)} goals.`} source="Dixon-Coles model" plot={totPlot} alt="Total goals distribution"
                                  table={{ rows: [...s.total.entries()].sort((a, b) => a[0] - b[0]).map(([t, p]) => ({ t, p })), cols: [["t", "Total goals"], ["p", "Probability", (v) => fmt.pct(v, 1)]] }} />}
            </div>
            {[{ t: H, f: fh }, { t: A, f: fa }].map(({ t, f }) => (
              <div className="c6" key={t.club_id}>
                <Card title={<><ClubLink id={t.club_id} name={t.name} />: recent form</>}
                      right={<span className="row xs muted" style={{ gap: 6 }}>Elo, last 20 <Sparkline values={[...f].reverse().map((x) => x.elo).filter((x) => x != null)} /></span>}>
                  <div style={{ marginBottom: 8 }}><FormStrip results={f.slice(0, 5).reverse().map((x) => x.r)} /></div>
                  <table className="data"><tbody>
                    {f.slice(0, 5).map((m) => (
                      <tr key={m.match_id}>
                        <td className="muted small">{fmt.day(m.match_date)}</td>
                        <td><span className={`pill ${m.r === "W" ? "good" : m.r === "L" ? "bad" : ""}`}>{m.r}</span></td>
                        <td><MatchLink id={m.match_id}>{m.gf}–{m.ga}</MatchLink></td>
                        <td>{m.ha === "H" ? "vs" : "at"} <ClubLink id={m.oppId} name={m.opp} /></td>
                      </tr>
                    ))}
                  </tbody></table>
                </Card>
              </div>
            ))}
            <div className="c12">
              <Card title={h2h.rows.length ? `Head to head: ${H.name} ${h2hRec.W}, draws ${h2hRec.D}, ${A.name} ${h2hRec.L}` : "Head to head"}
                    sub="League meetings since 2012-13, newest first, with the closing market's pre-match odds.">
                {h2h.rows.length ? (
                  <table className="data">
                    <thead><tr><th>Date</th><th className="r">Home</th><th className="c">Score</th><th>Away</th><th style={{ minWidth: 160 }}>Market before kickoff</th></tr></thead>
                    <tbody>
                      {h2h.rows.map((m) => (
                        <tr key={m.match_id}>
                          <td className="muted small">{fmt.dayYear(m.match_date)}</td>
                          <td className="r">{m.home_team}</td>
                          <td className="c"><MatchLink id={m.match_id}><b>{m.home_goals}–{m.away_goals}</b></MatchLink></td>
                          <td>{m.away_team}</td>
                          <td>{m.mkt_h != null ? <OutcomeBar h={m.mkt_h} d={m.mkt_d} a={m.mkt_a} thin labels={[m.home_team, "Draw", m.away_team]} /> : <span className="muted">–</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : <p className="muted small">No league meetings in the data (they haven't shared a league since 2012-13).</p>}
              </Card>
            </div>
            <div className="c12">
              <div className="callout">
                <b>How this works.</b> Each team has an attack and a defence rating from a Dixon-Coles model fitted on its league's last three years of
                results (1-year half-life, goals blended with shot-based expected goals), plus a home-advantage term and a low-score correction (ρ = {fmt.n(model.rho, 3)}).
                Expected goals multiply out to a full score matrix, and every market above is read off it. As forecasts, these ratings trail the closing
                betting line by about 0.0065 RPS: they don't know about injuries, line-ups or news. <Link to="/accuracy">See how they score</Link>.
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
