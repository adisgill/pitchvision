import { useSearchParams } from "react-router-dom";
import { ClubLink, Col, DataTable, fmt, LEAGUES, Loading, PlayerLink, RatingBar, seasonLabel, Select } from "../components";
import { lit, useQuery } from "../db";

const POS = ["all", "GK", "CB", "FB", "DM", "CM", "AM", "W", "ST"];
const C_LEAGUES = ["GB1", "ES1", "L1", "IT1", "FR1", "NL1", "PO1"];

export default function Players() {
  const [params, setParams] = useSearchParams();
  const tier = params.get("tier") ?? "c";
  const set = (k: string, v: string) => { const p = new URLSearchParams(params); p.set(k, v); setParams(p); };
  return (
    <>
      <h1>Players</h1>
      <div className="controls">
        <button className="toggle" aria-pressed={tier === "c"} onClick={() => set("tier", "c")}
                style={{ fontWeight: tier === "c" ? 650 : 400 }}>Every league season (box score)</button>
        <button className="toggle" aria-pressed={tier === "a"} onClick={() => set("tier", "a")}
                style={{ fontWeight: tier === "a" ? 650 : 400 }}>Event-data seasons (deep)</button>
      </div>
      {tier === "c" ? <TierC params={params} set={set} /> : <TierA params={params} set={set} />}
    </>
  );
}

type P = { params: URLSearchParams; set: (k: string, v: string) => void };

function TierC({ params, set }: P) {
  const league = params.get("league") ?? "GB1";
  const season = Number(params.get("season") ?? 2025);
  const pos = params.get("pos") ?? "all";
  const rows = useQuery(`
    select c.*, p.name, k.name club, r.rapm, r.prior_dominated
    from players_c c join players p using (player_id) left join clubs k on k.club_id = c.club_id
    left join rapm r on r.player_id = c.player_id and r.season = c.season
    where c.competition_id = ${lit(league)} and c.season = ${season} and c.qualified
    ${pos === "all" ? "" : `and c.position_group = ${lit(pos)}`}
    order by c.scoring_rating desc nulls last`);
  return (
    <>
      <div className="controls">
        <Select label="League" value={league} onChange={(v) => set("league", v)} options={C_LEAGUES.map((k) => [k, LEAGUES[k]])} />
        <Select label="Season" value={String(season)} onChange={(v) => set("season", v)}
                options={Array.from({ length: 14 }, (_, i) => 2025 - i).map((s) => [String(s), seasonLabel(s)])} />
        <Select label="Position" value={pos} onChange={(v) => set("pos", v)} options={POS.map((p) => [p, p === "all" ? "All" : p])} />
      </div>
      <p className="small muted">Players with enough minutes to rate. Ratings: 50 = position average in that league season, 10 points = one standard deviation, shrunk toward
        average for small samples. RAPM is per 90; "prior" = mostly the box-score prior rather than on-pitch data. {rows.rows.length} players.</p>
      <Loading state={rows} />
      <div className="card">
        <DataTable rows={rows.rows} initialSort={{ key: "scoring_rating", desc: true }} cols={[
          { key: "name", label: "Player", fmt: (v, r) => <PlayerLink id={r.player_id} name={v} /> },
          { key: "club", label: "Club", fmt: (v, r) => <ClubLink id={r.club_id} name={v ?? r.club_id} /> },
          { key: "position_group", label: "Pos" },
          { key: "minutes", label: "Min", num: true, fmt: (v) => fmt.n(v) },
          { key: "np_goals_p90", label: "npG/90", num: true, fmt: (v) => fmt.n(v, 2) },
          { key: "assists_p90", label: "A/90", num: true, fmt: (v) => fmt.n(v, 2) },
          { key: "scoring_rating", label: "Scoring", fmt: (v) => <RatingBar v={v} /> },
          { key: "creation_rating", label: "Creation", fmt: (v) => <RatingBar v={v} /> },
          { key: "availability_rating", label: "Availability", fmt: (v) => <RatingBar v={v} /> },
          { key: "discipline_rating", label: "Discipline", fmt: (v) => <RatingBar v={v} /> },
          { key: "rapm", label: "RAPM", num: true, fmt: (v, r) => v == null ? "–" : <>{fmt.signed(v)}{r.prior_dominated ? <span className="pill">prior</span> : null}</> },
        ]} />
      </div>
    </>
  );
}

const A_COLS: Record<string, [string, string][]> = {
  GK: [["shot_stopping_rating", "Shot stopping"], ["claiming_sweeping_rating", "Claiming"], ["distribution_rating", "Distribution"]],
  default: [["finishing_rating", "Finishing"], ["creation_rating", "Creation"], ["progression_rating", "Progression"],
            ["ball_security_rating", "Ball security"], ["defending_rating", "Defending"], ["duels_rating", "Duels"]],
};

function TierA({ params, set }: P) {
  const sets = useQuery(`select provider, competition_id, season, count(*) n from players_a group by all order by season desc, competition_id`);
  const ds = params.get("ds") ?? "statsbomb:GB1:2015";
  const [provider, comp, season] = ds.split(":");
  const pos = params.get("pos") ?? "ST";
  const rows = useQuery(`
    select a.*, p.name, k.name club from players_a a left join players p using (player_id) left join clubs k on k.club_id = a.club_id
    where a.provider = ${lit(provider)} and a.competition_id = ${lit(comp)} and a.season = ${Number(season)} and a.qualified
    ${pos === "all" ? "" : `and a.position_group = ${lit(pos)}`} order by a.vaep_p90 desc nulls last`);
  const ratingCols: Col[] = (A_COLS[pos] ?? A_COLS.default).map(([k, l]) => ({ key: k, label: l, fmt: (v: any) => <RatingBar v={v} /> }));
  return (
    <>
      <div className="controls">
        <Select label="Dataset" value={ds} onChange={(v) => set("ds", v)}
                options={sets.rows.map((r) => [`${r.provider}:${r.competition_id}:${r.season}`,
                  `${LEAGUES[r.competition_id] ?? r.competition_id} ${seasonLabel(r.season, r.competition_id)} (${r.provider === "statsbomb" ? "StatsBomb" : "Wyscout"})`])} />
        <Select label="Position" value={pos} onChange={(v) => set("pos", v)} options={POS.map((p) => [p, p === "all" ? "All" : p])} />
      </div>
      <p className="small muted">Event-data ratings use only the dimensions that proved stable (split-half reliability) for each position.
        xG, xA and VAEP come from our own models, fitted out of sample.</p>
      <Loading state={rows} />
      <div className="card">
        <DataTable rows={rows.rows} initialSort={{ key: "vaep_p90", desc: true }} cols={[
          { key: "name", label: "Player", fmt: (v, r) => <PlayerLink id={r.player_id} name={v ?? r.player_id} /> },
          { key: "club", label: "Club", fmt: (v, r) => (r.club_id ? <ClubLink id={r.club_id} name={v ?? r.club_id} /> : "–") },
          { key: "position_group", label: "Pos" },
          { key: "role", label: "Role" },
          { key: "minutes", label: "Min", num: true, fmt: (v) => fmt.n(v) },
          { key: "npxg_p90", label: "npxG/90", num: true, fmt: (v) => fmt.n(v, 2) },
          { key: "xa_p90", label: "xA/90", num: true, fmt: (v) => fmt.n(v, 2) },
          { key: "vaep_p90", label: "VAEP/90", num: true, fmt: (v) => fmt.n(v, 2) },
          ...ratingCols,
        ]} />
      </div>
    </>
  );
}
