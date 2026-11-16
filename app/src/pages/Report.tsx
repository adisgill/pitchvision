// Opposition report: the pre-match dossier an analyst prints for the coaching staff.
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { lit, Row, useQuery } from "../db";
import { fmt, LEAGUES, seasonLabel } from "../lib/format";
import { rates, scoreMatrix, summarise } from "../lib/models";
import {
  Card, ClubLink, EntityPicker, Field, FormStrip, Loading, MatchLink, OutcomeBar, PageHead, Select, Tile, useParam,
} from "../ui/kit";
import { pts, result, teamMatchSql } from "./report/data";
import {
  CreateConcede, Fingerprint, GameState, LikelyXI, SetPieces, Trend, WhatMatters,
} from "./report/sections";

const nowLit = () => `TIMESTAMP '${new Date().toISOString().slice(0, 19).replace("T", " ")}'`;

export default function Report() {
  const [team, setTeam] = useParam("team", "tm-11");
  const [oppP, setOpp] = useParam("opp", "");
  const [seasonP, setSeason] = useParam("season", "");

  const club = useQuery(`select * from clubs where club_id = ${lit(team)}`);
  const seasons = useQuery(`select distinct season, competition_id from fm_zones_team where club_id = ${lit(team)} order by season desc`);
  const cur = seasons.rows.find((r) => String(r.season) === seasonP) ?? seasons.rows[0];
  const season: number | null = cur ? Number(cur.season) : null;
  const comp: string | null = cur?.competition_id ?? null;
  const ready = season != null && comp != null;

  const tm = useQuery(ready ? teamMatchSql(comp!, season!) : null);
  const games = useQuery(ready ? `select match_id, match_date, kickoff_utc, home_club, away_club, home_team, away_team, home_goals, away_goals
      from matches where competition_id = ${lit(comp!)} and season = ${season} and played order by match_date` : null);
  const next = useQuery(`select * from fixtures where not finished and not cancelled and (home_club = ${lit(team)} or away_club = ${lit(team)})
      and kickoff_utc >= ${nowLit()} order by kickoff_utc limit 1`);
  const nextFx = next.rows[0];
  const opp = oppP === "none" ? null : oppP || (nextFx ? (nextFx.home_club === team ? nextFx.away_club : nextFx.home_club) : null);

  const ratings = useQuery(`select * from team_ratings where club_id in (${lit(team)}${opp ? `, ${lit(opp)}` : ""})
      qualify row_number() over (partition by club_id order by as_of desc) = 1`);
  const oppClub = useQuery(opp ? `select * from clubs where club_id = ${lit(opp)}` : null);
  const rho = useQuery(ready ? `select median(rho) as rho from matches where competition_id = ${lit(comp!)} and rho is not null
      and season = (select max(season) from matches where competition_id = ${lit(comp!)} and rho is not null)` : null);
  const h2h = useQuery(opp ? `select * from matches where played and ((home_club = ${lit(team)} and away_club = ${lit(opp)})
      or (home_club = ${lit(opp)} and away_club = ${lit(team)})) order by match_date desc limit 6` : null);

  const name = club.rows[0]?.name ?? team;
  const oppName = oppClub.rows[0]?.name ?? opp ?? "";
  const mine = useMemo(() => tm.rows.filter((r) => r.club_id === team).sort((a, b) => +new Date(a.match_date) - +new Date(b.match_date)), [tm.rows, team]);

  // league table from every played match (not only FotMob-covered ones)
  const table = useMemo(() => {
    const t = new Map<string, { club: string; p: number; pts: number; gd: number; gf: number; res: string[] }>();
    const get = (c: string) => { if (!t.has(c)) t.set(c, { club: c, p: 0, pts: 0, gd: 0, gf: 0, res: [] }); return t.get(c)!; };
    games.rows.forEach((g) => {
      const h = get(g.home_club), a = get(g.away_club);
      h.p++; a.p++; h.pts += pts(g.home_goals, g.away_goals); a.pts += pts(g.away_goals, g.home_goals);
      h.gd += g.home_goals - g.away_goals; a.gd += g.away_goals - g.home_goals; h.gf += g.home_goals; a.gf += g.away_goals;
      h.res.push(result(g.home_goals, g.away_goals)); a.res.push(result(g.away_goals, g.home_goals));
    });
    return [...t.values()].sort((x, y) => y.pts - x.pts || y.gd - x.gd || y.gf - x.gf);
  }, [games.rows]);
  const pos = table.findIndex((r) => r.club === team);
  const me = table[pos];
  const manager = [...mine].reverse().find((r) => r.manager)?.manager;
  const rt = ratings.rows.find((r) => r.club_id === team);
  const rtOpp = opp ? ratings.rows.find((r) => r.club_id === opp) : undefined;

  // matchup forecast: venue from the scheduled fixture if there is one, else this team at home
  const forecast = useMemo(() => {
    if (!rt || !rtOpp || rt.dc_att == null || rtOpp.dc_att == null) return null;
    const fx = nextFx && ((nextFx.home_club === team && nextFx.away_club === opp) || (nextFx.home_club === opp && nextFx.away_club === team)) ? nextFx : null;
    const teamHome = fx ? fx.home_club === team : true;
    const H = teamHome ? rt : rtOpp, A = teamHome ? rtOpp : rt;
    const { lh, la } = rates({ att: H.dc_att, dfn: H.dc_dfn }, { att: A.dc_att, dfn: A.dc_dfn }, H.dc_home ?? 0.25);
    const s = summarise(scoreMatrix(lh, la, rho.rows[0]?.rho ?? -0.05));
    return { teamHome, fixture: fx, lh, la, s, crossLeague: H.competition_id !== A.competition_id };
  }, [rt, rtOpp, nextFx, team, opp, rho.rows]);

  const print = () => window.print();
  return (
    <div className="report-root">
      <style>{`
        @media print {
          .report-root .no-print { display: none !important; }
          .report-root .card, .report-root .tile { break-inside: avoid; page-break-inside: avoid; box-shadow: none; }
          .report-root .grid { gap: 10px; }
          .main { padding: 0 !important; max-width: none !important; }
          .footer, .banner { display: none !important; }
          body { background: #fff !important; }
        }
        .report-root .rp-section { margin-top: 1.4rem; }
        .report-root .rp-section > h2 { margin-bottom: 0.6rem; }
      `}</style>
      <PageHead eyebrow={<>Opposition report{comp ? ` · ${LEAGUES[comp] ?? comp} ${seasonLabel(season!, comp)}` : ""}</>}
        title={opp ? <>{name} <span className="muted" style={{ fontWeight: 400 }}>vs</span> {oppName}</> : name}
        lead={<>A pre-match dossier on <ClubLink id={team} name={name} />: how they play, how they create and concede, set pieces, game state and the likely XI,
          from FotMob/Opta match data (2024-25 onward) and our models.</>}
        right={<div className="row no-print"><button className="btn primary" onClick={print}>Print / save as PDF</button></div>} />

      <div className="filters no-print">
        <Field label="Team (to scout)"><EntityPicker kind="team" value={name} placeholder="Search a team" onPick={(e) => { setTeam(e.id); setSeason(null); setOpp(null); }} /></Field>
        <Field label="Opponent (matchup)"><EntityPicker kind="team" value={oppName} placeholder="Next opponent by default" onPick={(e) => setOpp(e.id)} /></Field>
        <Select label="Matchup" value={oppP === "none" ? "none" : "on"} onChange={(v) => setOpp(v === "none" ? "none" : null)}
                options={[["on", "With opponent"], ["none", "General report"]]} />
        {seasons.rows.length > 0 && (
          <Select label="Season" value={String(season)} onChange={(v) => setSeason(v)}
                  options={seasons.rows.map((r) => [String(r.season), `${seasonLabel(r.season, r.competition_id)} · ${LEAGUES[r.competition_id] ?? r.competition_id}`])} />
        )}
      </div>
      <Loading state={seasons} />
      {!seasons.loading && !seasons.rows.length && (
        <Card title="No FotMob coverage for this club" sub="Reports need FotMob/Opta match data, which covers the nine leagues from 2024-25 onward. Pick another team." />
      )}

      {ready && (
        <>
          <div className="tiles">
            <Tile label="League position" value={pos >= 0 ? `${pos + 1}${["st", "nd", "rd"][pos] ?? "th"}` : "–"} delta={me ? `${me.pts} pts from ${me.p} · GD ${fmt.signed(me.gd, 0)}` : undefined} />
            <Tile label="Form (last 5)" value={me ? <FormStrip results={me.res.slice(-5)} /> : "–"} delta={manager ? `Manager: ${manager}` : undefined} />
            <Tile label="Strength (goals model)" value={rt ? fmt.signed(rt.dc_gd) : "–"} delta={rt ? `GD per match vs average · Elo ${fmt.n(rt.elo)}` : undefined} />
            <Tile label="Market view" value={rt ? fmt.signed(rt.mkt_gd) : "–"} delta="GD per match vs average, from closing odds" />
            <Tile label="Next match" value={nextFx ? (nextFx.home_club === team ? `vs ${nextFx.away_name}` : `at ${nextFx.home_name}`) : "–"}
                  delta={nextFx ? new Date(nextFx.kickoff_utc).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "no fixture scheduled"} />
          </div>

          {opp && (
            <section className="rp-section">
              <div className="grid">
                <div className="c6">
                  <Card title={forecast ? `Our forecast: ${name} ${fmt.pct(forecast.teamHome ? forecast.s.home : forecast.s.away)} to win` : "Matchup forecast"}
                        sub={forecast ? <>Dixon-Coles from current ratings{forecast.fixture ? ", at the scheduled venue" : `, ${name} at home (no scheduled fixture)`}.
                          Expected goals {forecast.lh.toFixed(2)}–{forecast.la.toFixed(2)}; most likely score {forecast.s.top[0].h}–{forecast.s.top[0].a}.
                          {forecast.crossLeague ? " Cross-league: no league-strength adjustment applied here, use the Match predictor for that." : ""}</> : "No current rating for one of the teams."}
                        right={<Link className="btn no-print" to={`/predict?h=${encodeURIComponent(forecast?.teamHome === false ? opp : team)}&a=${encodeURIComponent(forecast?.teamHome === false ? team : opp)}`}>Full predictor</Link>}>
                    {forecast && <OutcomeBar h={forecast.s.home} d={forecast.s.draw} a={forecast.s.away}
                      labels={forecast.teamHome ? [name, "Draw", oppName] : [oppName, "Draw", name]} />}
                  </Card>
                </div>
                <div className="c6">
                  <Card title="Head-to-head" sub={h2h.rows.length ? `Last ${h2h.rows.length} meetings in our data.` : "No meetings in our data."}>
                    <table className="data"><tbody>
                      {h2h.rows.map((m) => (
                        <tr key={m.match_id}>
                          <td className="muted small">{fmt.dayYear(m.match_date)}</td>
                          <td className="r">{m.home_team}</td>
                          <td className="c"><MatchLink id={m.match_id}><b className="num">{fmt.n(m.home_goals)}–{fmt.n(m.away_goals)}</b></MatchLink></td>
                          <td>{m.away_team}</td>
                        </tr>
                      ))}
                    </tbody></table>
                  </Card>
                </div>
              </div>
            </section>
          )}

          <Loading state={tm} />
          {mine.length > 0 ? (
            <>
              <Fingerprint rows={tm.rows} team={team} name={name} matches={mine.length} />
              <CreateConcede team={team} name={name} comp={comp!} season={season!} />
              <GameState team={team} name={name} comp={comp!} season={season!} mine={mine} />
              <LikelyXI team={team} name={name} comp={comp!} season={season!} />
              <SetPieces rows={tm.rows} team={team} name={name} comp={comp!} season={season!} />
              <Trend mine={mine} name={name} />
              <WhatMatters />
            </>
          ) : !tm.loading && (
            <Card title="No FotMob match stats yet for this team-season" sub="Pick an earlier season above." />
          )}
          <p className="xs muted" style={{ marginTop: 18 }}>
            Coverage: FotMob/Opta team and player data from 2024-25 for the nine leagues; matches appear once linked to our results feed.
            Physical data (distance, sprints) exists only where FotMob publishes it. Ratings and forecasts: pitchvision models.
          </p>
        </>
      )}
    </div>
  );
}

export type ReportRow = Row;
