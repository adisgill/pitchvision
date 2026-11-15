import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { lit, useQuery } from "../db";
import { fmt, LEAGUES, seasonLabel } from "../lib/format";
import { FormStrip, Loading, PageHead, Tabs, Tile, useParam } from "../ui/kit";
import { resultLetter } from "./match/shared";
import Overview from "./team/Overview";
import Squad from "./team/Squad";
import PitchTab from "./team/PitchTab";
import Results from "./team/Results";
import TransfersTab from "./team/TransfersTab";
import ManagersTab from "./team/ManagersTab";

const TABS: [string, string][] = [["overview", "Overview"], ["squad", "Squad"], ["pitch", "Pitch map"], ["results", "Results"],
  ["transfers", "Transfers"], ["managers", "Managers"]];

export default function Team() {
  const id = decodeURIComponent(useParams().id ?? "");
  const [tab, setTab] = useParam("tab", "overview");
  const club = useQuery(`select * from clubs where club_id = ${lit(id)}`);
  const rating = useQuery(`select * from team_ratings where club_id = ${lit(id)} order by as_of desc limit 1`);
  const recent = useQuery(`select * from matches where played and (home_club = ${lit(id)} or away_club = ${lit(id)})
                           order by match_date desc limit 10`);
  const table = useQuery(`select * from xpoints where club_id = ${lit(id)} order by season desc limit 1`);
  const c = club.rows[0];
  const r = rating.rows[0];
  const last = recent.rows[0];
  const name = c?.name ?? r?.name ?? (last ? (last.home_club === id ? last.home_team : last.away_team) : id);
  const league = c?.league ?? last?.competition_id;
  const form = useMemo(() => recent.rows.slice(0, 5).reverse().map((m) =>
    m.home_club === id ? resultLetter(m.home_goals, m.away_goals) : resultLetter(m.away_goals, m.home_goals)), [recent.rows, id]);
  const t = table.rows[0];

  return (
    <>
      <PageHead
        eyebrow={<>{league ? <Link to={`/league?league=${league}`}>{LEAGUES[league] ?? league}</Link> : "Club"}{c?.stadium ? ` · ${c.stadium}${c.capacity ? ` (${fmt.n(c.capacity)})` : ""}` : ""}</>}
        title={name}
        lead={last ? <>Last match: {last.home_team} {last.home_goals}–{last.away_goals} {last.away_team}, {fmt.dayYear(last.match_date)}. {form.length > 0 && <FormStrip results={form} />}</> : undefined} />
      <Loading state={club} />
      <div className="tiles" style={{ marginBottom: 8 }}>
        {r && <Tile label="Goals-model strength" value={fmt.signed(r.dc_gd)} delta={`expected goal difference per match vs an average ${LEAGUES[r.competition_id] ?? ""} side`} />}
        {r && r.mkt_gd != null && <Tile label="Market strength" value={fmt.signed(r.mkt_gd)} delta="same scale, from closing odds" />}
        {r && r.elo != null && <Tile label="Elo" value={fmt.n(r.elo)} delta={r.elo_rank ? `#${fmt.n(r.elo_rank)} in the league` : undefined} />}
        {t && <Tile label={`${seasonLabel(t.season, t.competition_id)} points`} value={`${t.points}`}
                    delta={`${fmt.signed(t.points - t.xpoints, 1)} vs expected (${fmt.n(t.xpoints, 1)} xPts) · ${fmt.n(t.position)}${["st", "nd", "rd"][t.position - 1] ?? "th"}`}
                    tone={t.points >= t.xpoints ? "up" : "down"} />}
      </div>
      <Tabs tabs={TABS} value={tab} onChange={(v) => setTab(v)} />
      {tab === "overview" && <Overview id={id} name={name} />}
      {tab === "squad" && <Squad id={id} name={name} />}
      {tab === "pitch" && <PitchTab id={id} name={name} />}
      {tab === "results" && <Results id={id} name={name} />}
      {tab === "transfers" && <TransfersTab id={id} name={name} />}
      {tab === "managers" && <ManagersTab id={id} name={name} />}
    </>
  );
}
