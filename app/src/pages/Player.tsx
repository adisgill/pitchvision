import * as Plot from "@observablehq/plot";
import { useMemo } from "react";
import { useParams } from "react-router-dom";
import { ClubLink, css, DataTable, Figure, fmt, LEAGUES, Loading, PlayerLink, RatingBar, seasonLabel } from "../components";
import { lit, useQuery } from "../db";

const A_RATINGS: [string, string][] = [
  ["finishing_rating", "Finishing"], ["creation_rating", "Creation"], ["progression_rating", "Progression"],
  ["ball_security_rating", "Ball security"], ["defending_rating", "Defending"], ["duels_rating", "Duels"],
  ["shot_stopping_rating", "Shot stopping"], ["claiming_sweeping_rating", "Claiming / sweeping"], ["distribution_rating", "Distribution"],
];

export default function Player() {
  const id = decodeURIComponent(useParams().id ?? "");
  const bio = useQuery(`select * from players where player_id = ${lit(id)}`);
  const seasons = useQuery(`select c.*, k.name club from players_c c left join clubs k using (club_id)
                            where player_id = ${lit(id)} order by season desc`);
  const rapm = useQuery(`select * from rapm where player_id = ${lit(id)} order by season`);
  const mkt = useQuery(`select * from market where player_id = ${lit(id)} order by season`);
  const proj = useQuery(`select * from age_projection where player_id = ${lit(id)}
                         and season = (select max(season) from age_projection where player_id = ${lit(id)}) order by metric, horizon`);
  const ev = useQuery(`select a.*, k.name club from players_a a left join clubs k using (club_id)
                       where player_id = ${lit(id)} order by season desc`);
  const sim = useQuery(`select s.*, p.name from similar_players s left join players p on p.player_id = s.similar_id
                        where s.player_id = ${lit(id)} order by s.season desc, rank limit 10`);
  const p = bio.rows[0];

  const rapmPlot = useMemo(() => {
    if (!rapm.rows.length) return undefined;
    return (width: number) => ({
      width, height: 240, y: { label: "Goal difference per 90 vs average", grid: true }, x: { label: null, tickFormat: (d: number) => seasonLabel(d) },
      marks: [
        Plot.ruleY([0], { stroke: css("--line") }),
        Plot.line(rapm.rows, { x: "season", y: "prior", stroke: css("--neutral"), strokeDasharray: "4 3" }),
        Plot.line(rapm.rows, { x: "season", y: "rapm", stroke: css("--good"), strokeWidth: 2 }),
        Plot.dot(rapm.rows, { x: "season", y: "rapm", r: (d: any) => 2 + 5 * d.data_weight, fill: css("--good"),
                              title: (d: any) => `${seasonLabel(d.season)}: RAPM ${fmt.signed(d.rapm)} (prior ${fmt.signed(d.prior)}); ${fmt.pct(d.data_weight)} of the estimate from on-pitch data, ${fmt.n(d.exposure_90s, 0)} 90s` }),
      ],
    });
  }, [rapm.rows]);

  const mktPlot = useMemo(() => {
    const rows = mkt.rows.filter((r) => r.value_eur != null);
    if (!rows.length) return undefined;
    return (width: number) => ({
      width, height: 240, y: { label: "€ (log)", type: "log" as const, grid: true, tickFormat: (v: number) => fmt.eur(v) },
      x: { label: null, tickFormat: (d: number) => seasonLabel(d) },
      marks: [
        Plot.areaY(rows, { x: "season", y1: "model_lo", y2: "model_hi", fill: css("--neutral"), fillOpacity: 0.18 }),
        Plot.line(rows, { x: "season", y: "model_value", stroke: css("--neutral"), strokeDasharray: "4 3" }),
        Plot.line(rows, { x: "season", y: "value_eur", stroke: css("--cat-2"), strokeWidth: 2 }),
        Plot.dot(rows, { x: "season", y: "value_eur", fill: css("--cat-2"), r: 3.5,
                         title: (d: any) => `${seasonLabel(d.season)}: Transfermarkt ${fmt.eur(d.value_eur)}, model ${fmt.eur(d.model_value)} (80%: ${fmt.eur(d.model_lo)}–${fmt.eur(d.model_hi)})` }),
      ],
    });
  }, [mkt.rows]);

  const age = p?.date_of_birth ? Math.floor((Date.now() - new Date(p.date_of_birth).getTime()) / 3.156e10) : null;
  return (
    <>
      <Loading state={bio} />
      <h1>{p?.name ?? id}</h1>
      {p && (
        <p className="muted" style={{ marginTop: 0 }}>
          {[p.position, p.nationality, age != null ? `age ${age}` : null, p.foot ? `${p.foot} foot` : null,
            p.height_in_cm ? `${p.height_in_cm} cm` : null].filter(Boolean).join(" · ")}
        </p>
      )}
      <div className="grid">
        {seasons.rows.length > 0 && (
          <div className="span-12 card">
            <p className="figure-title">Season by season</p>
            <p className="figure-sub">Box-score ratings: 50 is the average player at the position in that league season, and every 10 points is one standard deviation (so 70 is roughly top 2–3%). Small samples are shrunk toward average. Available for every player in the top leagues.</p>
            <DataTable rows={seasons.rows} initialSort={{ key: "season", desc: true }} cols={[
              { key: "season", label: "Season", fmt: (v, r) => `${seasonLabel(v, r.competition_id)}` },
              { key: "competition_id", label: "League", fmt: (v) => LEAGUES[v] ?? v },
              { key: "club", label: "Club", fmt: (v, r) => <ClubLink id={r.club_id} name={v ?? r.club_id} /> },
              { key: "position_group", label: "Pos" },
              { key: "minutes", label: "Min", num: true, fmt: (v) => fmt.n(v) },
              { key: "goals", label: "G", num: true, fmt: (v) => fmt.n(v) },
              { key: "assists", label: "A", num: true, fmt: (v) => fmt.n(v) },
              { key: "scoring_rating", label: "Scoring", fmt: (v) => <RatingBar v={v} /> },
              { key: "creation_rating", label: "Creation", fmt: (v) => <RatingBar v={v} /> },
              { key: "availability_rating", label: "Availability", fmt: (v) => <RatingBar v={v} /> },
              { key: "discipline_rating", label: "Discipline", fmt: (v) => <RatingBar v={v} /> },
            ]} />
          </div>
        )}
        <div className="span-6">
          {rapmPlot && (
            <Figure title="On-pitch impact (RAPM)"
                    subtitle={<>Goal difference per 90 while on the pitch, adjusted for team-mates and opponents (blue), against the box-score prior it is shrunk toward (dashed). Bigger dots = more of the estimate comes from on-pitch data. In our tests RAPM barely beats the prior alone (r 0.82 vs 0.82), so read this as a weak signal.</>}
                    source="Transfermarkt lineups and substitutions" plot={rapmPlot} alt="RAPM by season" />
          )}
        </div>
        <div className="span-6">
          {mktPlot && (
            <Figure title="Market value vs what the model expects"
                    subtitle="Transfermarkt value (orange) against a model from age, minutes, output, league and position (dashed; band = 80% interval, which holds 80% of players out of sample)."
                    source="Transfermarkt" plot={mktPlot} alt="Market value against model value by season" />
          )}
        </div>
        {proj.rows.length > 0 && (
          <div className="span-6 card">
            <p className="figure-title">Age projection from {seasonLabel(proj.rows[0].season)}</p>
            <p className="figure-sub">Average ageing curve for the position applied to this player's level, with an 80% band. Not a scouting forecast.</p>
            <table className="data">
              <thead><tr><th>Metric</th><th className="r">Now</th><th className="r">+1 yr</th><th className="r">+2 yrs</th><th className="r">+3 yrs</th></tr></thead>
              <tbody>
                {["minutes_share", "np90"].map((m) => {
                  const rs = proj.rows.filter((r) => r.metric === m);
                  if (!rs.length) return null;
                  const f = (v: number) => (m === "minutes_share" ? fmt.pct(v) : fmt.n(v, 2));
                  return (
                    <tr key={m}>
                      <td>{m === "minutes_share" ? "Share of minutes" : "Non-pen goals / 90"}</td>
                      <td className="r">{f(rs[0].now)}</td>
                      {rs.map((r) => <td key={r.horizon} className="r">{f(r.proj)} <span className="muted small">({f(r.lo)}–{f(r.hi)})</span></td>)}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {ev.rows.length > 0 && (
          <div className="span-12 card">
            <p className="figure-title">Event-data ratings</p>
            <p className="figure-sub">Only for seasons covered by the free StatsBomb and Wyscout datasets. Same scale (50 = position average, 10 points = one standard deviation); only the dimensions that are stable for a position are shown.</p>
            <DataTable rows={ev.rows} cols={[
              { key: "season", label: "Season", fmt: (v, r) => `${seasonLabel(v, r.competition_id)} ${LEAGUES[r.competition_id] ?? r.competition_id}` },
              { key: "club", label: "Club", fmt: (v, r) => (r.club_id ? <ClubLink id={r.club_id} name={v ?? r.club_id} /> : "–") },
              { key: "role", label: "Role", fmt: (v, r) => v ? <>{v} <span className="muted small">{fmt.pct(r.role_probability)}</span></> : "–" },
              { key: "minutes", label: "Min", num: true, fmt: (v) => fmt.n(v) },
              { key: "npxg_p90", label: "npxG/90", num: true, fmt: (v) => fmt.n(v, 2) },
              { key: "xa_p90", label: "xA/90", num: true, fmt: (v) => fmt.n(v, 2) },
              { key: "vaep_p90", label: "VAEP/90", num: true, fmt: (v) => fmt.n(v, 2) },
              ...A_RATINGS.filter(([k]) => ev.rows.some((r) => r[k] != null))
                .map(([k, l]) => ({ key: k, label: l, fmt: (v: any) => <RatingBar v={v} /> })),
            ]} />
          </div>
        )}
        {sim.rows.length > 0 && (
          <div className="span-6 card">
            <p className="figure-title">Most similar player-seasons</p>
            <p className="figure-sub">By where on the pitch they act and what they do (cosine similarity over event-data style features), from {seasonLabel(sim.rows[0].season)}.</p>
            <table className="data"><tbody>
              {sim.rows.map((r) => (
                <tr key={`${r.similar_id}-${r.similar_season}`}>
                  <td><PlayerLink id={r.similar_id} name={r.name ?? r.similar_id} /></td>
                  <td className="small muted">{seasonLabel(r.similar_season)} {LEAGUES[r.similar_competition_id] ?? r.similar_competition_id}</td>
                  <td className="r num">{fmt.n(r.similarity, 2)}</td>
                </tr>
              ))}
            </tbody></table>
          </div>
        )}
      </div>
    </>
  );
}
