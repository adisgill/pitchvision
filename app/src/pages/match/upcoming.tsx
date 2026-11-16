// Upcoming fixtures (FotMob schedule) with our forecast: the pipeline's upgraded model
// (Dixon-Coles + form, shot dominance, xG form and injuries; walk-forward tested) where it
// has the fixture, otherwise plain Dixon-Coles computed in the browser from current ratings.
import { Fragment, useMemo } from "react";
import { Link } from "react-router-dom";
import { Row, useQuery } from "../../db";
import { fmt, LEAGUES, SHORT } from "../../lib/format";
import { rates, scoreMatrix, summarise } from "../../lib/models";
import { ClubLink, OutcomeBar } from "../../ui/kit";

export type Forecast = { h: number; d: number; a: number; lh: number; la: number; top: { h: number; a: number; p: number } };

/** SQL timestamp literal for "now minus ``hours``" (fixtures are stored as naive UTC). */
export const sinceSql = (hours = 3) =>
  `timestamp '${new Date(Date.now() - hours * 3.6e6).toISOString().slice(0, 19).replace("T", " ")}'`;

/** Fixtures matching ``where`` (alias f) that haven't been played, soonest first. */
export function useUpcoming(where: string, limit = 400) {
  return useQuery(`select f.*, u.up_lh, u.up_la, u.rho as up_rho from fixtures f
    left join upcoming_forecasts u on u.fm_match_id = f.fm_match_id
    where not f.finished and not f.cancelled and f.kickoff_utc >= ${sinceSql()} and (${where})
    order by f.kickoff_utc, f.competition_id limit ${limit}`);
}

/** Current Dixon-Coles ratings per club and the low-score correction per league. */
export function useRatings() {
  const r = useQuery(`select club_id, competition_id, dc_att, dc_dfn, dc_home from team_ratings where current`);
  const rho = useQuery(`select competition_id, median(rho) as rho from matches where rho is not null and season >= 2025 group by 1`);
  return useMemo(() => ({
    clubs: new Map(r.rows.map((x) => [x.club_id, x])),
    rho: new Map(rho.rows.map((x) => [x.competition_id, x.rho])),
    ready: !r.loading && !rho.loading,
  }), [r.rows, rho.rows, r.loading, rho.loading]);
}

export function forecast(f: Row, R: ReturnType<typeof useRatings>): Forecast | null {
  if (f.up_lh != null && f.up_la != null) {
    const s = summarise(scoreMatrix(f.up_lh, f.up_la, f.up_rho ?? -0.05));
    return { h: s.home, d: s.draw, a: s.away, lh: f.up_lh, la: f.up_la, top: s.top[0] };
  }
  const h = R.clubs.get(f.home_club), a = R.clubs.get(f.away_club);
  if (!h || !a) return null;
  // the home side's league sets home advantage; both ratings are on their own league's scale
  const home = h.competition_id === f.competition_id ? h.dc_home : a.dc_home;
  const { lh, la } = rates({ att: h.dc_att, dfn: h.dc_dfn }, { att: a.dc_att, dfn: a.dc_dfn }, home);
  const s = summarise(scoreMatrix(lh, la, R.rho.get(f.competition_id) ?? -0.05));
  return { h: s.home, d: s.draw, a: s.away, lh, la, top: s.top[0] };
}

const dayKey = (d: Date) => d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
const timeOf = (d: Date) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

/** Fixtures grouped by day (or round) with our forecast, most likely score and a Predict link. */
export function UpcomingTable({ rows, group = "day", league = true, maxHeight }: {
  rows: Row[]; group?: "day" | "round"; league?: boolean; maxHeight?: number;
}) {
  const R = useRatings();
  const groups = useMemo(() => {
    const g = new Map<string, Row[]>();
    rows.forEach((f) => {
      const k = group === "round" ? `Round ${f.round}` : dayKey(new Date(f.kickoff_utc));
      if (!g.has(k)) g.set(k, []);
      g.get(k)!.push(f);
    });
    return [...g.entries()];
  }, [rows, group]);
  const cols = league ? 7 : 6;
  return (
    <div className="table-wrap" style={maxHeight ? { maxHeight } : undefined}>
      <table className="data">
        <thead>
          <tr>
            <th>Kick-off</th>{league && <th>League</th>}<th className="r">Home</th><th></th><th>Away</th>
            <th style={{ minWidth: 130 }} title="Our Dixon-Coles forecast: home / draw / away">Our forecast H / D / A</th>
            <th className="r" title="Most likely score and its probability">Likeliest</th>
          </tr>
        </thead>
        <tbody>
          {groups.map(([k, fs]) => (
            <Fragment key={k}>
              <tr><td colSpan={cols + 1} style={{ background: "var(--surface-2)" }} className="eyebrow">{k}</td></tr>
              {fs.map((f) => {
                const p = R.ready ? forecast(f, R) : null;
                const d = new Date(f.kickoff_utc);
                return (
                  <tr key={f.fm_match_id}>
                    <td className="muted small num">{group === "round" ? `${fmt.day(d)} ${timeOf(d)}` : timeOf(d)}</td>
                    {league && <td className="muted xs" title={LEAGUES[f.competition_id]}>{SHORT[f.competition_id] ?? f.competition_id}</td>}
                    <td className="r">{f.home_club ? <ClubLink id={f.home_club} name={f.home_name} /> : f.home_name}</td>
                    <td className="c muted xs">v</td>
                    <td>{f.away_club ? <ClubLink id={f.away_club} name={f.away_name} /> : f.away_name}</td>
                    <td>
                      {p ? (
                        <div style={{ minWidth: 120 }} title={`${f.home_name} ${fmt.pct(p.h)} · draw ${fmt.pct(p.d)} · ${f.away_name} ${fmt.pct(p.a)} (expected goals ${fmt.n(p.lh, 2)}–${fmt.n(p.la, 2)})`}>
                          <OutcomeBar thin h={p.h} d={p.d} a={p.a} labels={[f.home_name, "Draw", f.away_name]} />
                          <div className="xs muted num" style={{ marginTop: 2 }}>{fmt.pct(p.h)} · {fmt.pct(p.d)} · {fmt.pct(p.a)}</div>
                        </div>
                      ) : <span className="muted xs">{R.ready ? "no rating" : "…"}</span>}
                    </td>
                    <td className="r small">
                      {p && <span className="num">{p.top.h}–{p.top.a} <span className="muted xs">{fmt.pct(p.top.p)}</span></span>}{" "}
                      {f.home_club && f.away_club && (
                        <Link className="pill accent" to={`/predict?h=${encodeURIComponent(f.home_club)}&a=${encodeURIComponent(f.away_club)}`}>Predict</Link>
                      )}
                    </td>
                  </tr>
                );
              })}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
