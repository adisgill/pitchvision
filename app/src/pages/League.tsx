// League hub: table, title race, live simulator, ratings, team stats and cross-league trends.
import { lazy, Suspense } from "react";
import { useSearchParams } from "react-router-dom";
import { lit, useQuery } from "../db";
import { LEAGUES, seasonLabel, SIM_LEAGUES } from "../lib/format";
import { LeagueSelect, PageHead, SeasonSelect, Tabs, useParam } from "../ui/kit";
import TableTab from "./league/TableTab";

const RaceTab = lazy(() => import("./league/RaceTab"));
const SimTab = lazy(() => import("./league/SimTab"));
const RatingsTab = lazy(() => import("./league/RatingsTab"));
const StatsTab = lazy(() => import("./league/StatsTab"));
const TrendsTab = lazy(() => import("./league/TrendsTab"));

const TABS: [string, string][] = [
  ["table", "Table"], ["race", "Race"], ["simulator", "Simulator"], ["ratings", "Ratings"], ["stats", "Team stats"], ["trends", "Trends"],
];

export default function League() {
  const [league] = useParam("league", "GB1");
  const [tab, setTab] = useParam("tab", "table");
  const seasons = useQuery(`select distinct season from matches where competition_id = ${lit(league)} order by season desc`);
  const latest = Number(seasons.rows[0]?.season ?? 2026);
  const [seasonP, setSeason] = useParam("season", "");
  const season = seasonP ? Number(seasonP) : latest;
  const seasonOnly = tab === "simulator" || tab === "trends";
  const [params, setParams] = useSearchParams();
  const changeLeague = (v: string) => {
    const p = new URLSearchParams(params);
    if (v === "GB1") p.delete("league"); else p.set("league", v);
    p.delete("season");
    setParams(p, { replace: true });
  };
  return (
    <>
      <PageHead
        eyebrow={tab === "trends" ? "All leagues, 2012-13 onward" : `${LEAGUES[league] ?? league} · ${seasonLabel(season, league)}`}
        title={tab === "trends" ? "How the game has changed" : LEAGUES[league] ?? league}
        lead={{
          table: "The table as it stands, with expected points from shot quality and the simulated odds for every zone.",
          race: "How the title race and the relegation fight unfolded, match by match.",
          simulator: "Change any team's strength and watch 4,000 simulated seasons re-run in your browser.",
          ratings: "Three independent views of team strength: goals, results and the betting market.",
          stats: "Every team-level count we have, ranked, plus when each side scores and concedes.",
          trends: "Goals, home advantage, draws and cards across eight leagues and fourteen seasons.",
        }[tab]}
        right={
          <div className="filters" style={{ margin: 0 }}>
            {tab !== "trends" && <LeagueSelect value={league} onChange={changeLeague} leagues={[...SIM_LEAGUES, "MLS1"]} />}
            {!seasonOnly && seasons.rows.length > 0 && (
              <SeasonSelect value={season} onChange={(v) => setSeason(v === latest ? null : String(v))}
                            seasons={seasons.rows.map((r) => Number(r.season))} comp={league} />
            )}
          </div>
        }
      />
      <Tabs tabs={TABS} value={tab} onChange={setTab} />
      <Suspense fallback={<div className="loading">Loading…</div>}>
        {tab === "table" && <TableTab league={league} season={season} latest={latest} />}
        {tab === "race" && <RaceTab league={league} season={season} />}
        {tab === "simulator" && <SimTab league={league} season={latest} />}
        {tab === "ratings" && <RatingsTab league={league} season={season} />}
        {tab === "stats" && <StatsTab league={league} season={season} />}
        {tab === "trends" && <TrendsTab />}
      </Suspense>
    </>
  );
}
