import { useSearchParams } from "react-router-dom";
import { DataTable, fmt, LEAGUES, Loading, seasonLabel, Select } from "../components";
import { lit, useQuery } from "../db";

export default function Referees() {
  const [params, setParams] = useSearchParams();
  const league = params.get("league") ?? "GB1";
  const seasons = useQuery(`select distinct season from referees where competition_id = ${lit(league)} order by season desc`);
  const season = Number(params.get("season") ?? seasons.rows[0]?.season ?? 2025);
  const set = (k: string, v: string) => { const p = new URLSearchParams(params); p.set(k, v); if (k === "league") p.delete("season"); setParams(p); };
  const rows = useQuery(`select * from referees where competition_id = ${lit(league)} and season = ${season} order by matches desc`);
  const rel = useQuery(`select * from referee_reliability`);
  const k = Object.fromEntries(rel.rows.map((r) => [r.metric, r.k_matches]));
  const vs = (key: string, d = 2) => (v: any, r: any) =>
    v == null ? "–" : <>{fmt.n(v, d)} <span className="muted small">({fmt.signed(v - r[`${key}_league_pm`], d)})</span></>;
  return (
    <>
      <h1>Referees</h1>
      <div className="controls">
        <Select label="League" value={league} onChange={(v) => set("league", v)} options={["GB1", "GB2", "ES1", "L1", "IT1", "FR1", "NL1", "PO1"].map((k) => [k, LEAGUES[k]])} />
        <Select label="Season" value={String(season)} onChange={(v) => set("season", v)}
                options={seasons.rows.map((r) => [String(r.season), seasonLabel(r.season)])} />
      </div>
      <div className="card" style={{ marginBottom: "1rem" }}>
        <p className="figure-title">Most of what looks like a referee's "style" is noise</p>
        <p className="figure-sub" style={{ marginBottom: 0 }}>
          Rates are per match, shrunk toward the league average by how much each one really varies between referees
          (in brackets: difference from the league). A referee needs about {fmt.n(k.fouls, 0)} matches before half of their
          foul rate is signal, {fmt.n(k.yellows, 0)} for yellows, {fmt.n(k.reds, 0)} for reds, {fmt.n(k.pen_goals, 0)} for
          penalties and {fmt.n(k.home_bias, 0)} for home bias. No referee officiates that many in a season, so penalty and home-bias
          numbers are close to the league average by design.
        </p>
      </div>
      <Loading state={rows} />
      <div className="card">
        <DataTable rows={rows.rows} initialSort={{ key: "matches", desc: true }} cols={[
          { key: "referee", label: "Referee" },
          { key: "matches", label: "Matches", num: true },
          { key: "yellows_pm_shrunk", label: "Yellows", num: true, fmt: vs("yellows") },
          { key: "reds_pm_shrunk", label: "Reds", num: true, fmt: vs("reds", 3) },
          { key: "fouls_pm_shrunk", label: "Fouls", num: true, fmt: vs("fouls", 1) },
          { key: "pen_goals_pm_shrunk", label: "Penalty goals", num: true, fmt: vs("pen_goals", 3) },
          { key: "home_bias_pm_shrunk", label: "Home card bias", num: true, fmt: vs("home_bias") },
        ]} />
      </div>
    </>
  );
}
