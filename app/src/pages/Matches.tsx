import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ClubLink, DataTable, fmt, LEAGUES, Loading, seasonLabel, Select } from "../components";
import { lit, useQuery } from "../db";

const M_LEAGUES = ["GB1", "ES1", "L1", "IT1", "FR1", "GB2", "NL1", "PO1", "MLS1"];

export default function Matches() {
  const [params, setParams] = useSearchParams();
  const league = params.get("league") ?? "GB1";
  const seasons = useQuery(`select distinct season from matches where competition_id = ${lit(league)} order by season desc`);
  const season = Number(params.get("season") ?? seasons.rows[0]?.season ?? 2026);
  const [q, setQ] = useState("");
  const rows = useQuery(`select * from matches where competition_id = ${lit(league)} and season = ${season}
                         ${q.trim() ? `and (home_team ilike ${lit(`%${q.trim()}%`)} or away_team ilike ${lit(`%${q.trim()}%`)})` : ""}
                         order by kickoff_utc desc`);
  const set = (k: string, v: string) => { const p = new URLSearchParams(params); p.set(k, v); if (k === "league") p.delete("season"); setParams(p); };
  return (
    <>
      <h1>Matches</h1>
      <div className="controls">
        <Select label="League" value={league} onChange={(v) => set("league", v)} options={M_LEAGUES.map((k) => [k, LEAGUES[k]])} />
        <Select label="Season" value={String(season)} onChange={(v) => set("season", v)}
                options={seasons.rows.map((r) => [String(r.season), seasonLabel(r.season, league)])} />
        <input type="search" placeholder="Filter by team" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter by team" />
      </div>
      <p className="small muted">Pre-match odds: the closing market (vig removed) and our Elo model, both home / draw / away.
        "Surprise" is how unlikely the result was by the market (−log probability). Click a score for the match page.</p>
      <Loading state={rows} />
      <div className="card">
        <DataTable rows={rows.rows.map((m) => ({ ...m, surprise: surprise(m) }))} initialSort={{ key: "kickoff_utc", desc: true }} cols={[
          { key: "kickoff_utc", label: "Date", fmt: (v) => fmt.date(v) },
          { key: "home_team", label: "Home", fmt: (v, r) => <ClubLink id={r.home_club} name={v} /> },
          { key: "home_goals", label: "Score", fmt: (v, r) => <Link to={`/match/${encodeURIComponent(r.match_id)}`}><b>{fmt.n(v)}–{fmt.n(r.away_goals)}</b></Link> },
          { key: "away_team", label: "Away", fmt: (v, r) => <ClubLink id={r.away_club} name={v} /> },
          { key: "home_xg", label: "xG", num: true, fmt: (v, r) => v == null ? "–" : `${fmt.n(v, 1)}–${fmt.n(r.away_xg, 1)}` },
          { key: "mkt_h", label: "Market H/D/A", num: true, fmt: (v, r) => `${fmt.pct(v)} / ${fmt.pct(r.mkt_d)} / ${fmt.pct(r.mkt_a)}` },
          { key: "elo_h", label: "Elo H/D/A", num: true, fmt: (v, r) => `${fmt.pct(v)} / ${fmt.pct(r.elo_d)} / ${fmt.pct(r.elo_a)}` },
          { key: "surprise", label: "Surprise", num: true, fmt: (v) => fmt.n(v, 2) },
        ]} />
      </div>
    </>
  );
}

function surprise(m: any) {
  if (m.home_goals == null || m.mkt_h == null) return null;
  const p = m.home_goals > m.away_goals ? m.mkt_h : m.home_goals < m.away_goals ? m.mkt_a : m.mkt_d;
  return -Math.log(p);
}
