import { Link } from "react-router-dom";
import { lit, Row, useQuery } from "../../db";
import { fmt, LEAGUES, POSITION_NAMES, seasonLabel } from "../../lib/format";
import { Card, Empty, PlayerLink } from "../../ui/kit";
import { dsLabel, traits } from "./shared";

export default function Similar({ id, seasonsA }: { id: string; seasonsA: Row[] }) {
  const sim = useQuery(`select s.*, p.name from similar_players s left join players p on p.player_id = s.similar_id
                        where s.player_id = ${lit(id)} order by s.season desc, s.rank`);
  const roles = useQuery(`select a.provider, a.competition_id, a.season, a.position_group, a.role, a.role_probability, c.high, c.low, c.players
                          from players_a a left join role_clusters c on c.provider = a.provider and c.position_group = a.position_group and c.role = a.role
                          where a.player_id = ${lit(id)} order by a.season desc`);
  const bySeason = new Map<string, Row[]>();
  sim.rows.forEach((r) => { const k = `${r.competition_id}:${r.season}`; if (!bySeason.has(k)) bySeason.set(k, []); bySeason.get(k)!.push(r); });

  if (!seasonsA.length) return <Empty>Similarity and roles come from event data, which doesn't cover this player's seasons.</Empty>;
  return (
    <div className="grid">
      <div className="c5">
        <div className="stack">
          {roles.rows.map((r) => (
            <Card key={`${r.provider}${r.season}`} title={r.role ? <>{r.role[0].toUpperCase() + r.role.slice(1)}</> : "No role assigned"}
                  sub={`${seasonLabel(r.season, r.competition_id)} ${LEAGUES[r.competition_id] ?? r.competition_id} · ${dsLabel(r.provider)} · ${POSITION_NAMES[r.position_group] ?? r.position_group}`}>
              {r.role && (
                <>
                  <div className="row" style={{ gap: 8, marginBottom: 8 }}>
                    <span className="small ink2">Fit</span>
                    <span className="bar" style={{ flex: 1 }}><span style={{ width: `${100 * (r.role_probability ?? 0)}%` }} /></span>
                    <span className="small num">{fmt.pct(r.role_probability)}</span>
                  </div>
                  <p className="small ink2" style={{ marginBottom: 4 }}>Players in this role ({r.players ?? "–"} in the data) do more:</p>
                  <div className="row" style={{ gap: 6, marginBottom: 8 }}>{traits(r.high).map((t) => <span key={t} className="pill accent">{t}</span>)}</div>
                  <p className="small ink2" style={{ marginBottom: 4 }}>…and less:</p>
                  <div className="row" style={{ gap: 6 }}>{traits(r.low).map((t) => <span key={t} className="pill">{t}</span>)}</div>
                </>
              )}
            </Card>
          ))}
          <p className="xs muted">Roles are clusters (Gaussian mixture) of where and how players act, per position group; the fit is the cluster's probability for this player.</p>
        </div>
      </div>
      <div className="c7">
        {sim.rows.length ? [...bySeason.entries()].map(([k, rows]) => {
          const [comp, season] = k.split(":");
          return (
            <Card key={k} title={`Most similar to his ${seasonLabel(Number(season), comp)} season`}
                  sub="Cosine similarity of style features (where on the pitch he acts and what he does there), across every event-data season.">
              <table className="data">
                <thead><tr><th>#</th><th>Player</th><th>Season</th><th className="r">Similarity</th><th>What they share</th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={`${r.similar_id}${r.similar_season}`}>
                      <td className="muted">{r.rank}</td>
                      <td><PlayerLink id={r.similar_id} name={r.name ?? r.similar_id} /></td>
                      <td className="small muted">{seasonLabel(r.similar_season, r.similar_competition_id)} {LEAGUES[r.similar_competition_id] ?? r.similar_competition_id}</td>
                      <td className="r"><span className="row" style={{ gap: 6, justifyContent: "flex-end" }}>
                        <span className="bar" style={{ width: 50, minWidth: 50 }}><span style={{ width: `${100 * r.similarity}%` }} /></span>{fmt.n(r.similarity, 2)}</span></td>
                      <td className="small ink2" style={{ whiteSpace: "normal", minWidth: 200 }}>{traits(r.shared_traits).join(" · ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="xs muted" style={{ marginTop: 8 }}><Link to={`/compare?p=${encodeURIComponent([id, ...rows.slice(0, 2).map((r) => r.similar_id)].join(","))}`}>Compare with the top two →</Link></p>
            </Card>
          );
        }) : <Empty>No similar players computed.</Empty>}
      </div>
    </div>
  );
}
