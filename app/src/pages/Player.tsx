// Player hub: who they are, how good they are against their peers, what they're worth,
// their on-pitch impact, where on the pitch they do it, and who they resemble.
import { useParams } from "react-router-dom";
import { lit, useQuery } from "../db";
import { ageOn, fmt, LEAGUES, POSITION_NAMES, seasonLabel } from "../lib/format";
import { ClubLink, Loading, PageHead, Tabs, Tile, useParam } from "../ui/kit";
import Impact from "./player/Impact";
import Overview from "./player/Overview";
import PitchTab from "./player/PitchTab";
import Similar from "./player/Similar";
import Value from "./player/Value";

export default function Player() {
  const id = decodeURIComponent(useParams().id ?? "");
  const [tab, setTab] = useParam("tab", "overview");
  const bio = useQuery(`select p.*, k.name current_club from players p left join clubs k on k.club_id = p.current_club_id
                        where p.player_id = ${lit(id)}`);
  const c = useQuery(`select c.*, k.name club from players_c c left join clubs k using (club_id)
                      where player_id = ${lit(id)} order by season desc`);
  const a = useQuery(`select a.provider, a.competition_id, a.season, a.minutes, a.position_group, a.role, a.npxg_p90, a.xa_p90, a.vaep_p90
                      from players_a a where player_id = ${lit(id)} order by season desc`);
  const p = bio.rows[0];
  const last = c.rows[0];
  const career = c.rows.reduce((acc, r) => ({ g: acc.g + (r.goals ?? 0), a: acc.a + (r.assists ?? 0), m: acc.m + (r.minutes ?? 0) }), { g: 0, a: 0, m: 0 });
  const pos = last?.position_group ?? a.rows[0]?.position_group;
  const hasEvent = a.rows.length > 0;
  const age = ageOn(p?.date_of_birth);

  if (!bio.loading && !p) return <><PageHead title="Player not found" lead={`No player with id ${id}.`} /></>;
  const tabs: [string, string][] = [["overview", "Overview"], ["value", "Value"], ["impact", "Impact"],
    ...(hasEvent ? [["pitch", "Pitch map"] as [string, string]] : []), ["similar", hasEvent ? "Similar & role" : "Similar"]];

  return (
    <>
      <Loading state={bio} />
      {p && (
        <PageHead
          eyebrow={[pos ? POSITION_NAMES[pos] : p.position, p.sub_position && p.sub_position !== p.position ? p.sub_position : null].filter(Boolean).join(" · ")}
          title={p.name}
          lead={<span className="row" style={{ gap: "0.4rem 1rem" }}>
            {p.current_club_id && p.current_club && <span>Club <ClubLink id={p.current_club_id} name={p.current_club} bold /></span>}
            {age != null && <span>Age {age}</span>}
            {p.nationality && <span>{p.nationality}</span>}
            {p.foot && <span>{p.foot}-footed</span>}
            {p.height_in_cm && <span>{p.height_in_cm} cm</span>}
            {p.international_caps != null && <span>{p.international_caps} caps</span>}
            {p.contract_expiration_date && <span>Contract to {fmt.dayYear(p.contract_expiration_date)}</span>}
          </span>} />
      )}
      {p && (
        <div className="tiles" style={{ marginBottom: 6 }}>
          <Tile label="Market value (Transfermarkt)" value={fmt.eur(p.market_value_in_eur)} delta={p.last_season ? `as of ${seasonLabel(p.last_season)}` : undefined} />
          {last && <Tile label={`${seasonLabel(last.season)} · ${LEAGUES[last.competition_id] ?? last.competition_id}`}
                         value={`${fmt.n(last.goals)} G · ${fmt.n(last.assists)} A`} delta={`${fmt.n(last.minutes)} minutes, ${fmt.pct(last.minutes_share)} of team minutes`} />}
          {c.rows.length > 0 && <Tile label="Top-league career (since 2012-13)" value={`${fmt.n(career.g)} G · ${fmt.n(career.a)} A`}
                                      delta={`${fmt.n(career.m)} minutes over ${c.rows.length} seasons`} />}
          {hasEvent && <Tile label={`Event data · ${seasonLabel(a.rows[0].season, a.rows[0].competition_id)}`}
                             value={`${fmt.n(a.rows[0].npxg_p90, 2)} npxG · ${fmt.n(a.rows[0].xa_p90, 2)} xA`}
                             delta={`per 90${a.rows[0].role ? ` · ${a.rows[0].role}` : ""}`} />}
        </div>
      )}
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === "overview" && <Overview id={id} seasonsC={c.rows} seasonsA={a.rows} />}
      {tab === "value" && <Value id={id} name={p?.name ?? id} />}
      {tab === "impact" && <Impact id={id} />}
      {tab === "pitch" && hasEvent && <PitchTab id={id} seasonsA={a.rows} name={p?.name ?? id} />}
      {tab === "similar" && <Similar id={id} seasonsA={a.rows} />}
    </>
  );
}
