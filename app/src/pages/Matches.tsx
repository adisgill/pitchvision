import * as Plot from "@observablehq/plot";
import { Fragment, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { lit, Row, useQuery } from "../db";
import { css, fmt, LEAGUES, seasonLabel, SIM_LEAGUES } from "../lib/format";
import { Figure } from "../ui/Figure";
import {
  ClubLink, DataTable, Empty, Field, LeagueSelect, Loading, MatchLink, OutcomeBar, PageHead, SeasonSelect, Seg, Tile, useDebounced, useParam,
} from "../ui/kit";
import { dcProbs, surprise, tvd } from "./match/shared";
import { UpcomingTable, useUpcoming } from "./match/upcoming";

type View = "upcoming" | "all" | "upsets" | "dominant" | "goals" | "disagree";
const VIEWS: [View, string][] = [["all", "By round"], ["upsets", "Biggest upsets"], ["dominant", "Most dominant"],
  ["goals", "Highest scoring"], ["disagree", "Model vs market"]];

export default function Matches() {
  const [league, setLeague] = useParam("league", "GB1");
  const seasons = useQuery(`select distinct season from matches where competition_id = ${lit(league)} and played order by season desc`);
  const latest = seasons.rows[0]?.season ?? 2026;
  const [seasonP, setSeason] = useParam("season", "");
  const season = Number(seasonP || latest);
  const [q, setQ] = useParam("q", "");
  const dq = useDebounced(q, 200);
  const [viewP, setView] = useParam("view", "");
  const up = useUpcoming(`f.competition_id = ${lit(league)} and f.season = ${season}`);
  const view: View = (viewP || (up.rows.length ? "upcoming" : "all")) as View;
  const views: [View, string][] = up.rows.length ? [["upcoming", `Upcoming (${up.rows.length})`], ...VIEWS] : VIEWS;
  const nav = useNavigate();

  const res = useQuery(`select * from matches where competition_id = ${lit(league)} and season = ${season} and played
    ${dq.trim() ? `and (home_team ilike ${lit(`%${dq.trim()}%`)} or away_team ilike ${lit(`%${dq.trim()}%`)})` : ""}
    order by kickoff_utc desc nulls last, match_date desc, match_id`);

  const rows = useMemo(() => res.rows.map((m): Row => {
    const dc = dcProbs(m);
    const mk = m.mkt_h != null ? { h: m.mkt_h, d: m.mkt_d, a: m.mkt_a } : null;
    const xh = m.home_xg ?? m.proxy_home_xg, xa = m.away_xg ?? m.proxy_away_xg;
    return { ...m, dc, surprise: surprise(m), disagree: tvd(dc, mk), xh, xa, xgd: xh != null ? Math.abs(xh - xa) : null,
             total: m.home_goals + m.away_goals, xgSource: m.home_xg != null ? "xG" : "shot-based xG" };
  }), [res.rows]);

  const stats = useMemo(() => {
    const n = rows.length;
    if (!n) return null;
    const hw = rows.filter((r) => r.home_goals > r.away_goals).length, dr = rows.filter((r) => r.home_goals === r.away_goals).length;
    const fav = rows.filter((r) => r.mkt_h != null);
    const favWon = fav.filter((r) => {
      const best = Math.max(r.mkt_h, r.mkt_d, r.mkt_a);
      const res = r.home_goals > r.away_goals ? r.mkt_h : r.home_goals < r.away_goals ? r.mkt_a : r.mkt_d;
      return res === best;
    }).length;
    const upset = [...rows].filter((r) => r.surprise != null).sort((a, b) => b.surprise - a.surprise)[0];
    return { n, hw: hw / n, dr: dr / n, aw: 1 - (hw + dr) / n, gpg: rows.reduce((a, r) => a + r.total, 0) / n,
             favWon: fav.length ? favWon / fav.length : null, upset };
  }, [rows]);

  // calibration this season: market's probability bucket for every outcome vs how often it happened
  const calib = useMemo(() => {
    const pts: { p: number; hit: number }[] = [];
    rows.forEach((r) => {
      if (r.mkt_h == null) return;
      const o = r.home_goals > r.away_goals ? 0 : r.home_goals === r.away_goals ? 1 : 2;
      [r.mkt_h, r.mkt_d, r.mkt_a].forEach((p, i) => pts.push({ p, hit: i === o ? 1 : 0 }));
    });
    const bins = Array.from({ length: 10 }, (_, i) => {
      const b = pts.filter((x) => x.p >= i / 10 && x.p < (i + 1) / 10);
      return { bin: `${i * 10}–${(i + 1) * 10}%`, mid: (i + 0.5) / 10, n: b.length, pred: b.length ? b.reduce((a, x) => a + x.p, 0) / b.length : null,
               obs: b.length ? b.reduce((a, x) => a + x.hit, 0) / b.length : null };
    }).filter((b) => b.n >= 5);
    return bins;
  }, [rows]);

  const calibPlot = useMemo(() => {
    if (calib.length < 3) return undefined;
    return (width: number) => ({
      width, height: 240, marginLeft: 44, x: { label: "Market probability →", domain: [0, 1], tickFormat: "%" },
      y: { label: "↑ How often it happened", domain: [0, 1], tickFormat: "%", grid: true },
      marks: [
        Plot.line([[0, 0], [1, 1]], { stroke: css("--axis") }),
        Plot.line(calib, { x: "pred", y: "obs", stroke: css("--s1"), strokeWidth: 2 }),
        Plot.dot(calib, { x: "pred", y: "obs", r: (d: any) => 3 + Math.sqrt(d.n) / 4, fill: css("--s1"), stroke: css("--surface"), strokeWidth: 2 }),
        Plot.tip(calib, Plot.pointer({ x: "pred", y: "obs", title: (d: any) => `Priced at ${fmt.pct(d.pred)}\nHappened ${fmt.pct(d.obs)}\n${d.n} outcomes` })),
      ],
    });
  }, [calib]);

  const ranked = useMemo(() => {
    const by: Record<string, (r: Row) => number | null> = {
      upsets: (r) => r.surprise, dominant: (r) => r.xgd, goals: (r) => r.total, disagree: (r) => r.disagree,
    };
    const f = by[view];
    if (!f) return [];
    return rows.filter((r) => f(r) != null).sort((a, b) => (f(b) as number) - (f(a) as number)).slice(0, 60);
  }, [rows, view]);

  const rounds = useMemo(() => {
    const g = new Map<string, Row[]>();
    rows.forEach((r) => { const k = r.round ?? fmt.date(r.match_date); if (!g.has(k)) g.set(k, []); g.get(k)!.push(r); });
    return [...g.entries()];
  }, [rows]);

  return (
    <>
      <PageHead eyebrow={`${LEAGUES[league]} · ${seasonLabel(season, league)}`}
                title={stats ? (stats.favWon != null ? `The betting favourite won ${fmt.pct(stats.favWon)} of matches` : `${stats.n} matches played`) : "Matches"}
                lead="Every result with the closing market's and our models' pre-match odds, how surprising it was, and how hard the winner had to work for it." />
      <div className="filters">
        <LeagueSelect value={league} onChange={(v) => { setLeague(v); setSeason(null); }} leagues={[...SIM_LEAGUES, "MLS1"]} />
        {seasons.rows.length > 0 && <SeasonSelect value={season} onChange={(v) => setSeason(String(v))} seasons={seasons.rows.map((r) => r.season)} comp={league} />}
        <Field label="Team"><input type="search" placeholder="Filter by team" value={q} onChange={(e) => setQ(e.target.value || null)} /></Field>
        <Field label="View"><Seg options={views} value={view} onChange={(v) => setView(v)} label="View" /></Field>
      </div>
      <Loading state={res} />
      {stats && (
        <div className="tiles" style={{ marginBottom: 16 }}>
          <Tile label="Matches played" value={fmt.n(stats.n)} delta={`${fmt.n(stats.gpg, 2)} goals per match`} />
          <Tile label="Home / draw / away" value={`${fmt.pct(stats.hw)} · ${fmt.pct(stats.dr)} · ${fmt.pct(stats.aw)}`}>
            <div style={{ marginTop: 8 }}><OutcomeBar h={stats.hw} d={stats.dr} a={stats.aw} thin /></div>
          </Tile>
          {stats.upset && (
            <Tile label="Biggest upset (by the market)" value={<MatchLink id={stats.upset.match_id}>{stats.upset.home_team} {stats.upset.home_goals}–{stats.upset.away_goals} {stats.upset.away_team}</MatchLink>}
                  delta={`The result was priced at ${fmt.pct(Math.exp(-stats.upset.surprise), 1)}`} />
          )}
        </div>
      )}
      <div className="grid">
        <div className="c8">
          <div className="card">
            {view === "upcoming" ? (
              up.rows.length ? (
                <>
                  <p className="fig-title">Fixtures still to play</p>
                  <p className="fig-sub">From the league schedule, kick-off in your local time, with our Dixon-Coles forecast from current ratings. Predict opens every score and market.</p>
                  <UpcomingTable rows={up.rows} group="round" league={false} maxHeight={900} />
                </>
              ) : <Empty>No upcoming fixtures loaded for this league-season yet.</Empty>
            ) : view === "all" ? (
              rows.length ? (
                <div className="table-wrap" style={{ maxHeight: 900 }}>
                  <table className="data">
                    <thead><tr><th>Date</th><th className="r">Home</th><th className="c">Score</th><th>Away</th><th className="r">xG</th><th style={{ minWidth: 130 }}>Market H / D / A</th><th className="r" title="−log of the market's probability for the result">Surprise</th></tr></thead>
                    <tbody>
                      {rounds.map(([rd, ms]) => (
                        <Fragment key={rd}>
                          <tr><td colSpan={7} style={{ background: "var(--surface-2)" }} className="eyebrow">{rd}</td></tr>
                          {ms.map((m) => <MatchRow key={m.match_id} m={m} onClick={() => nav(`/match/${encodeURIComponent(m.match_id)}`)} />)}
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : !res.loading && <Empty>No matches found.</Empty>
            ) : (
              <DataTable rows={ranked} rank onRow={(r) => nav(`/match/${encodeURIComponent(r.match_id)}`)} cols={[
                { key: "match_date", label: "Date", fmt: (v) => fmt.day(v) },
                { key: "home_team", label: "Match", sortable: false, fmt: (_v, r) => <span><b>{r.home_team}</b> {r.home_goals}–{r.away_goals} <b>{r.away_team}</b></span> },
                { key: "xh", label: "xG", num: true, fmt: (v, r) => v == null ? "–" : `${fmt.n(v, 1)}–${fmt.n(r.xa, 1)}` },
                { key: "mkt_h", label: "Market H/D/A", sortable: false, fmt: (_v, r) => r.mkt_h == null ? "–" : <div style={{ width: 120 }}><OutcomeBar h={r.mkt_h} d={r.mkt_d} a={r.mkt_a} thin /></div> },
                view === "disagree"
                  ? { key: "disagree", label: "Model–market gap", num: true, fmt: (v, r) => <span title={`Ours ${fmt.pct(r.dc?.h)}/${fmt.pct(r.dc?.d)}/${fmt.pct(r.dc?.a)} vs market ${fmt.pct(r.mkt_h)}/${fmt.pct(r.mkt_d)}/${fmt.pct(r.mkt_a)}`}>{fmt.pct(v)}</span> }
                  : view === "dominant" ? { key: "xgd", label: "xG margin", num: true, fmt: (v) => fmt.n(v, 2) }
                  : view === "goals" ? { key: "total", label: "Goals", num: true }
                  : { key: "surprise", label: "Surprise", num: true, fmt: (v) => <span title={`Priced at ${fmt.pct(Math.exp(-v), 1)}`}>{fmt.n(v, 2)}</span> },
              ]} />
            )}
            <p className="xs muted" style={{ marginTop: 8 }}>
              xG: published expected goals where football-data.co.uk carries them (2026-27 onward), otherwise our shot-based estimate from shots and shots on target.
              Market: closing odds with the bookmaker margin removed. Model–market gap: half the summed absolute difference between our Dixon-Coles and the market's 1X2.
            </p>
          </div>
        </div>
        <div className="c4 stack" style={{ gap: 16 }}>
          {calibPlot && (
            <Figure title="Were the odds honest this season?" subtitle="Every home, draw and away price grouped by probability, against how often it came in. On the diagonal = calibrated."
                    source="football-data.co.uk closing odds" plot={calibPlot}
                    table={{ rows: calib, cols: [["bin", "Priced"], ["n", "Outcomes"], ["pred", "Avg price", (v) => fmt.pct(v)], ["obs", "Happened", (v) => fmt.pct(v)]] }} />
          )}
          <TeamTable rows={rows} />
        </div>
      </div>
    </>
  );
}

function MatchRow({ m, onClick }: { m: Row; onClick: () => void }) {
  const hw = m.home_goals > m.away_goals, aw = m.away_goals > m.home_goals;
  return (
    <tr onClick={onClick} style={{ cursor: "pointer" }}>
      <td className="muted small">{fmt.day(m.match_date)}</td>
      <td className="r" style={{ fontWeight: hw ? 650 : 400 }} onClick={(e) => e.stopPropagation()}><ClubLink id={m.home_club} name={m.home_team} /></td>
      <td className="c"><MatchLink id={m.match_id}><b className="num">{m.home_goals}–{m.away_goals}</b></MatchLink></td>
      <td style={{ fontWeight: aw ? 650 : 400 }} onClick={(e) => e.stopPropagation()}><ClubLink id={m.away_club} name={m.away_team} /></td>
      <td className="r small muted" title={m.xgSource}>{m.xh != null ? `${fmt.n(m.xh, 1)}–${fmt.n(m.xa, 1)}` : "–"}</td>
      <td>{m.mkt_h != null ? <div style={{ minWidth: 120 }} title={`Market ${fmt.pct(m.mkt_h)} / ${fmt.pct(m.mkt_d)} / ${fmt.pct(m.mkt_a)}${m.elo_h != null ? ` · Elo ${fmt.pct(m.elo_h)} / ${fmt.pct(m.elo_d)} / ${fmt.pct(m.elo_a)}` : ""}`}>
        <OutcomeBar h={m.mkt_h} d={m.mkt_d} a={m.mkt_a} thin /></div> : <span className="muted">–</span>}</td>
      <td className="r">{m.surprise != null ? <span className={m.surprise > 1.4 ? "pill bad" : "num small"}>{fmt.n(m.surprise, 2)}</span> : "–"}</td>
    </tr>
  );
}

/** League table built from the filtered results, with points vs the market's expected points. */
function TeamTable({ rows }: { rows: Row[] }) {
  const t = useMemo(() => {
    const m = new Map<string, any>();
    const add = (id: string, name: string, gf: number, ga: number, xp: number | null) => {
      const r = m.get(id) ?? { id, name, p: 0, pts: 0, gd: 0, xpts: 0, xn: 0 };
      r.p++; r.gd += gf - ga; r.pts += gf > ga ? 3 : gf === ga ? 1 : 0;
      if (xp != null) { r.xpts += xp; r.xn++; }
      m.set(id, r);
    };
    rows.forEach((r) => {
      add(r.home_club, r.home_team, r.home_goals, r.away_goals, r.mkt_h != null ? 3 * r.mkt_h + r.mkt_d : null);
      add(r.away_club, r.away_team, r.away_goals, r.home_goals, r.mkt_a != null ? 3 * r.mkt_a + r.mkt_d : null);
    });
    return [...m.values()].map((r) => ({ ...r, vs: r.xn === r.p ? r.pts - r.xpts : null })).sort((a, b) => b.pts - a.pts || b.gd - a.gd);
  }, [rows]);
  if (!t.length) return null;
  return (
    <div className="card">
      <p className="fig-title">Table from these results</p>
      <p className="fig-sub">"vs odds": points minus the points the closing market expected from the same matches.</p>
      <DataTable rows={t} rank maxHeight={520} cols={[
        { key: "name", label: "Team", fmt: (v, r) => <ClubLink id={r.id} name={v} /> },
        { key: "p", label: "P", num: true },
        { key: "gd", label: "GD", num: true, fmt: (v) => fmt.signed(v, 0) },
        { key: "pts", label: "Pts", num: true },
        { key: "vs", label: "vs odds", num: true, fmt: (v) => v == null ? "–" : <span style={{ color: v >= 0 ? "var(--up-text)" : "var(--critical)" }}>{fmt.signed(v, 1)}</span> },
      ]} />
    </div>
  );
}
