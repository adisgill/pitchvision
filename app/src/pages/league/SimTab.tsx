import * as Plot from "@observablehq/plot";
import { useEffect, useMemo, useState } from "react";
import { lit, useQuery } from "../../db";
import { css, fmt, inkOn, LEAGUES, seq } from "../../lib/format";
import { remainingFixtures, simulateSeason, SimResult, SimTeam } from "../../lib/models";
import { Figure } from "../../ui/Figure";
import { Card, ClubLink, Empty, Legend, Loading, ProbBar, Tile, useDebounced, useTip } from "../../ui/kit";
import { computeTable, MATCH_COLS } from "./shared";

/** Zones as in rules/leagues.toml: top = the "top4" zone, europe, direct relegation. */
const RULES: Record<string, { top: number; topLabel: string; eur: number; eurLabel: string; rel: number }> = {
  GB1: { top: 4, topLabel: "Top four", eur: 7, eurLabel: "Europe", rel: 3 },
  ES1: { top: 4, topLabel: "Top four", eur: 7, eurLabel: "Europe", rel: 3 },
  IT1: { top: 4, topLabel: "Top four", eur: 7, eurLabel: "Europe", rel: 3 },
  L1: { top: 4, topLabel: "Top four", eur: 7, eurLabel: "Europe", rel: 2 },
  FR1: { top: 4, topLabel: "Top four", eur: 6, eurLabel: "Europe", rel: 2 },
  NL1: { top: 2, topLabel: "Top two", eur: 5, eurLabel: "Europe", rel: 2 },
  PO1: { top: 2, topLabel: "Top two", eur: 5, eurLabel: "Europe", rel: 2 },
  GB2: { top: 2, topLabel: "Automatic promotion", eur: 6, eurLabel: "Top six", rel: 3 },
};
const RUNS = 4000;
const pctChange = (d: number) => `${d >= 0 ? "+" : "−"}${Math.abs((Math.exp(d) - 1) * 100).toFixed(0)}%`;

function quantile(dist: number[], q: number) {
  let c = 0;
  for (let i = 0; i < dist.length; i++) { c += dist[i]; if (c >= q) return i; }
  return dist.length - 1;
}

export default function SimTab({ league, season }: { league: string; season: number }) {
  const rule = RULES[league];
  const ratings = useQuery(rule ? `select club_id, name, competition_id, dc_att, dc_dfn, dc_home, dc_gd, as_of from team_ratings
                                   where competition_id = ${lit(league)} and current` : null);
  const ms = useQuery(rule ? `select ${MATCH_COLS} from matches where competition_id = ${lit(league)} and season = ${season}` : null);
  const official = useQuery(rule ? `select * from season_sim where competition_id = ${lit(league)} and season = ${season}` : null);
  // the real schedule (FotMob) when we have it: every fixture of the league-season
  const sched = useQuery(rule ? `select competition_id, home_club, away_club, finished, kickoff_utc from fixtures
                                 where competition_id = ${lit(league)} and season = ${season} and not cancelled` : null);
  const [adj, setAdj] = useState<Record<string, number>>({});
  useEffect(() => setAdj({}), [league]);
  const dAdj = useDebounced(adj, 220);
  const [out, setOut] = useState<{ res: SimResult[]; ms: number; key: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const tip = useTip();

  const setup = useMemo(() => {
    if (!rule || !ratings.rows.length || !ms.rows.length) return null;
    if (ms.rows[0].competition_id !== league || ratings.rows[0].competition_id !== league) return null; // stale rows from the previous league
    const table = computeTable(ms.rows);
    const tBy = new Map(table.map((t) => [t.club_id, t]));
    const clubs = new Set<string>([...ms.rows.map((m) => m.home_club), ...ms.rows.map((m) => m.away_club)]);
    const rated = ratings.rows.filter((r) => clubs.has(r.club_id));
    if (rated.length < clubs.size) return { error: `Ratings are missing for ${clubs.size - rated.length} clubs this season.` };
    const played = ms.rows.filter((m) => m.played).map((m) => ({ h: m.home_club, a: m.away_club }));
    const ids = rated.map((r) => r.club_id);
    const schedRows = sched.rows.filter((f) => f.competition_id === league);
    let fixtures, source: "schedule" | "inferred", skipped = 0;
    if (schedRows.length) {
      // remaining = scheduled pairs not yet in our results (covers results the feed hasn't posted yet)
      const done = new Set(played.map((p) => `${p.h}|${p.a}`));
      const ok = new Set(ids);
      const rem = schedRows.filter((f) => !done.has(`${f.home_club}|${f.away_club}`));
      fixtures = rem.filter((f) => ok.has(f.home_club) && ok.has(f.away_club)).map((f) => ({ h: f.home_club, a: f.away_club }));
      skipped = rem.length - fixtures.length;
      source = "schedule";
    } else {
      fixtures = remainingFixtures(ids, played);
      source = "inferred";
    }
    const home = Number(rated[0].dc_home);
    return { table, tBy, rated, fixtures, home, ids, played: played.length, source, skipped };
  }, [ratings.rows, ms.rows, sched.rows, rule, league]);

  useEffect(() => {
    if (!rule || !setup || "error" in setup) return;
    setBusy(true);
    const id = window.setTimeout(() => {
      const t0 = performance.now();
      const teams: SimTeam[] = setup.rated.map((r) => {
        const t = setup.tBy.get(r.club_id);
        const d = dAdj[r.club_id] ?? 0;
        return { id: r.club_id, name: r.name ?? t?.name ?? r.club_id, att: r.dc_att + d, dfn: r.dc_dfn - d,
                 pts: t?.pts ?? 0, gf: t?.gf ?? 0, ga: t?.ga ?? 0, played: t?.p ?? 0 };
      });
      const res = simulateSeason(teams, setup.fixtures, setup.home, RUNS, rule.rel);
      setOut({ res, ms: performance.now() - t0, key: league });
      setBusy(false);
    }, 10);
    return () => window.clearTimeout(id);
  }, [setup, dAdj, league]);

  if (!rule) return <Empty>The simulator covers the European leagues with a single table; MLS (two conferences and play-offs) isn't simulated.</Empty>;
  if (setup && "error" in setup) return <Empty>{setup.error}</Empty>;
  const offBy = new Map(official.rows.map((r) => [r.club_id, r]));
  const res = out?.key === league ? out.res : [];
  const n = res.length;
  const rows = res.map((r) => {
    const sum = (a: number, b: number) => r.pos.slice(a, b).reduce((x, y) => x + y, 0);
    const o = offBy.get(r.id);
    const t = setup && !("error" in setup) ? setup.tBy.get(r.id) : undefined;
    return { ...r, now: t?.pts ?? 0, p: t?.p ?? 0, pTopN: sum(0, rule.top), pEur: sum(0, rule.eur), pRel: sum(n - rule.rel, n),
             lo: quantile(r.ptsDist, 0.1), hi: quantile(r.ptsDist, 0.9), off: o, adj: adj[r.id] ?? 0,
             dTitle: o ? r.pTitle - o.p_title : null, dRel: o ? sum(n - rule.rel, n) - o.p_relegation : null };
  });
  const changed = Object.values(adj).some((v) => v !== 0);
  const fav = rows[0] ? [...rows].sort((a, b) => b.pTitle - a.pTitle)[0] : null;

  const ptsPlot = rows.length ? (width: number) => ({
    width, height: rows.length * 22 + 50, marginLeft: 118, marginRight: 20,
    x: { label: "Final points →", grid: true }, y: { label: null, domain: rows.map((r) => r.name) },
    marks: [
      Plot.link(rows, { y: "name", x1: "lo", x2: "hi", stroke: css("--seq-300"), strokeWidth: 6, strokeLinecap: "round" }),
      Plot.dot(rows.filter((r) => r.off), { y: "name", x: (d: any) => d.off.exp_points, symbol: "diamond", r: 4, stroke: css("--muted"), fill: css("--surface"), strokeWidth: 1.5 }),
      Plot.dot(rows, { y: "name", x: "expPts", r: 4.5, fill: css("--s1"), stroke: css("--surface"), strokeWidth: 2 }),
      Plot.tip(rows, Plot.pointerY({ y: "name", x: "expPts", title: (d: any) =>
        `${d.name}\n${fmt.n(d.expPts, 1)} expected points (80%: ${d.lo}–${d.hi})\nofficial sim: ${d.off ? fmt.n(d.off.exp_points, 1) : "–"}\nnow ${d.now} from ${d.p}` })),
    ],
  }) : undefined;

  return (
    <>
      <Loading state={ratings} />
      <div className="tiles" style={{ marginBottom: 16 }}>
        <Tile label="Favourite" value={fav ? `${fav.name} ${fmt.pct(fav.pTitle)}` : "–"} delta={changed ? "with your changes" : "with current ratings"} />
        <Tile label="Matches left" value={setup && !("error" in setup) ? fmt.n(setup.fixtures.length) : "–"}
              delta={setup && !("error" in setup) ? `${setup.played} played` : undefined} />
        <Tile label="Simulated seasons" value={fmt.n(RUNS)} delta={out ? `${busy ? "re-running…" : `ran in ${fmt.n(out.ms, 0)} ms in your browser`}` : "running…"} />
        <Tile label="Ratings as of" value={fmt.dayYear(ratings.rows.reduce((m: any, r) => (!m || r.as_of > m ? r.as_of : m), null))} delta="Dixon-Coles, 1-year half-life" />
      </div>
      <div className="callout" style={{ marginBottom: 16 }}>
        Drag a slider to make a team better or worse: +10% means it scores 10% more and concedes 10% less against everyone. Use it for an injury crisis,
        a new signing or a hunch, and watch every zone's odds move. This quick simulator ranks on points, goal difference and goals scored only and holds
        strengths fixed; the official numbers (◇ and the "vs official" column) come from the pipeline's 10,000 runs with the league's real tiebreakers and
        strength uncertainty.{" "}
        {setup && !("error" in setup) && (setup.source === "schedule"
          ? <>Remaining games are the league's actual schedule ({fmt.n(setup.fixtures.length)} fixtures){setup.skipped ? `; ${setup.skipped} skipped because a club has no current rating` : ""}.</>
          : <>No schedule loaded for this league-season, so the remaining games are inferred as the unplayed half of the double round-robin.</>)}
      </div>
      <div className="grid">
        <div className="c7">
          <Card title={`${LEAGUES[league]}: odds for every zone`} sub="Sorted by expected points. Δ = your scenario minus the official simulation."
                right={changed ? <button className="btn" onClick={() => setAdj({})}>Reset all</button> : undefined}>
            <div className={busy ? "refetch" : ""}>
              <div className="table-wrap" style={{ maxHeight: 820 }}>
                <table className="data">
                  <thead><tr>
                    <th>Team</th><th style={{ minWidth: 150 }}>Strength</th><th className="r">Exp. pts</th><th>Title</th>
                    <th>{rule.topLabel}</th><th>{rule.eurLabel}</th><th>Relegated</th><th className="r" title="Title probability minus the official simulation's, in percentage points">Δ title</th>
                  </tr></thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} className={r.adj ? "hl" : ""}>
                        <td><ClubLink id={r.id} name={r.name} /></td>
                        <td>
                          <span className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                            <input type="range" min={-0.4} max={0.4} step={0.02} value={r.adj} style={{ width: 90 }}
                                   aria-label={`${r.name} strength`} onChange={(e) => setAdj((a) => ({ ...a, [r.id]: Number(e.target.value) }))} />
                            <span className="num xs" style={{ width: 36, color: r.adj ? "var(--text)" : "var(--muted)" }}>{pctChange(r.adj)}</span>
                          </span>
                        </td>
                        <td className="r">{fmt.n(r.expPts, 1)} <span className="muted xs">{r.lo}–{r.hi}</span></td>
                        <td><ProbBar p={r.pTitle} width={44} /></td>
                        <td><ProbBar p={r.pTopN} width={44} /></td>
                        <td><ProbBar p={r.pEur} width={44} /></td>
                        <td><ProbBar p={r.pRel} width={44} /></td>
                        <td className="r" style={{ color: r.dTitle == null || Math.abs(r.dTitle) < 0.005 ? "var(--muted)" : undefined }}>
                          {r.dTitle == null ? "–" : `${fmt.signed(100 * r.dTitle, 0)} pp`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </Card>
        </div>
        <div className="c5">
          {ptsPlot && (
            <Figure title="Where each team's points total could land" subtitle="Dot: expected final points in your scenario; bar: 80% of simulated seasons; ◇: the official simulation."
                    source="football-data.co.uk results, Dixon-Coles ratings" plot={ptsPlot} stale={busy} alt="Expected final points with 80% ranges"
                    right={<Legend items={[{ label: "Your scenario", color: "var(--s1)" }, { label: "80% range", color: "var(--seq-300)", kind: "line" }]} />}
                    table={{ rows, cols: [["name", "Team"], ["expPts", "Exp. points", (v) => fmt.n(v, 1)], ["lo", "10th pct"], ["hi", "90th pct"]] }} />
          )}
        </div>
        {rows.length > 0 && (
          <div className="c12">
            <Card title="Finishing-position probabilities" sub="Each cell: share of simulated seasons a team finishes in that place. Darker = likelier. Hover for the exact share.">
              <div style={{ overflowX: "auto" }} className={busy ? "refetch" : ""}>
                <svg viewBox={`0 0 ${130 + n * 34} ${rows.length * 24 + 28}`} style={{ width: "100%", minWidth: 640, height: "auto" }} role="img" aria-label="Position probability grid">
                  {Array.from({ length: n }, (_, j) => (
                    <text key={j} x={130 + j * 34 + 17} y={14} textAnchor="middle" fontSize={11} fill="var(--muted)">{j + 1}</text>
                  ))}
                  {rows.map((r, i) => (
                    <g key={r.id}>
                      <text x={124} y={28 + i * 24 + 15} textAnchor="end" fontSize={12} fill="var(--text)">{r.name}</text>
                      {r.pos.map((p, j) => {
                        const fill = seq(Math.sqrt(p));
                        return (
                          <g key={j}>
                            <rect x={130 + j * 34 + 1} y={28 + i * 24 + 1} width={32} height={22} rx={4} fill={p > 0 ? fill : "var(--surface-2)"} fillOpacity={p > 0 ? 0.2 + 0.8 * Math.sqrt(p) : 1}
                                  onPointerMove={(e) => tip.show(e, <><b>{fmt.pct(p, 1)}</b><div className="muted">{r.name} finish {j + 1}</div></>)} onPointerLeave={tip.hide} />
                            {p >= 0.08 && <text x={130 + j * 34 + 17} y={28 + i * 24 + 16} textAnchor="middle" fontSize={10.5} fontWeight={600}
                                                fill={Math.sqrt(p) > 0.6 ? inkOn(fill) : "var(--text)"} pointerEvents="none">{Math.round(p * 100)}</text>}
                          </g>
                        );
                      })}
                    </g>
                  ))}
                </svg>
              </div>
              {tip.node}
            </Card>
          </div>
        )}
      </div>
    </>
  );
}
