// The broadcast ticker under the masthead: the 14 latest results and the next 14 fixtures with our
// favourite, scrolling continuously (paused on hover; static under reduced motion).
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "../db";
import { SHORT } from "../lib/format";
import { scoreMatrix, summarise } from "../lib/models";
import { sinceSql } from "../pages/match/upcoming";

const time = (d: Date) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
const wday = (d: Date) => d.toLocaleDateString("en-GB", { weekday: "short" });

export default function Ticker() {
  const q = useQuery(`
    select f.fm_match_id, f.match_id, f.competition_id, f.kickoff_utc, f.home_club, f.away_club, f.finished,
           coalesce(hc.name, f.home_name) home, coalesce(ac.name, f.away_name) away, f.home_goals, f.away_goals,
           u.up_lh, u.up_la, u.rho up_rho
    from fixtures f
    left join clubs hc on hc.club_id = f.home_club left join clubs ac on ac.club_id = f.away_club
    left join upcoming_forecasts u on u.fm_match_id = f.fm_match_id
    where f.fm_match_id in (
      (select fm_match_id from fixtures where finished and not cancelled order by kickoff_utc desc limit 14)
      union all
      (select fm_match_id from fixtures where not finished and not cancelled and kickoff_utc >= ${sinceSql(3)} order by kickoff_utc limit 14))
    order by f.kickoff_utc`);
  const items = useMemo(() => q.rows.map((f) => {
    const d = new Date(f.kickoff_utc);
    if (f.finished) return { f, d, kind: "res" as const };
    let fav: string | null = null;
    if (f.up_lh != null && f.up_la != null) {
      const s = summarise(scoreMatrix(f.up_lh, f.up_la, f.up_rho ?? -0.05));
      const [p, who] = s.home >= s.away ? [s.home, f.home] : [s.away, f.away];
      fav = `${who.split(" ").slice(-1)[0]} ${Math.round(p * 100)}%`;
    }
    return { f, d, kind: "fx" as const, fav };
  }), [q.rows]);
  if (!items.length) return <div className="ticker" aria-hidden="true" />;
  const one = items.map(({ f, d, kind, fav }: any, i) => {
    const body = (
      <>
        <span className="lg">{SHORT[f.competition_id] ?? f.competition_id}</span>
        {kind === "res" ? (
          <>
            <span className={f.home_goals > f.away_goals ? "w" : ""}>{f.home}</span>
            <span className="sc">{f.home_goals}–{f.away_goals}</span>
            <span className={f.away_goals > f.home_goals ? "w" : ""}>{f.away}</span>
          </>
        ) : (
          <>
            <span className="ko">{wday(d)} {time(d)}</span>
            <span>{f.home} v {f.away}</span>
            {fav && <span className="fav">{fav}</span>}
          </>
        )}
      </>
    );
    const to = f.match_id ? `/match/${encodeURIComponent(f.match_id)}`
      : f.home_club && f.away_club ? `/predict?h=${encodeURIComponent(f.home_club)}&a=${encodeURIComponent(f.away_club)}` : null;
    return to ? <Link key={i} className="it" to={to} tabIndex={-1}>{body}</Link> : <span key={i} className="it">{body}</span>;
  });
  return (
    <div className="ticker" role="region" aria-label="Latest results and upcoming fixtures">
      <div className="tag"><i />Live board</div>
      <div className="lane">
        <div className="track" style={{ ["--dur" as any]: `${Math.max(40, items.length * 4)}s` }}>
          {one}
          <span aria-hidden="true" style={{ display: "contents" }}>{one}</span>
        </div>
      </div>
    </div>
  );
}
