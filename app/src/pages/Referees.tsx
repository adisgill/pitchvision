import * as Plot from "@observablehq/plot";
import { useMemo } from "react";
import { lit, useQuery } from "../db";
import { css, fmt, SIM_LEAGUES } from "../lib/format";
import { Figure } from "../ui/Figure";
import { Card, DataTable, LeagueSelect, Loading, PageHead, SeasonSelect, Seg, Tile, useParam } from "../ui/kit";

const METRICS: [string, string, number][] = [["yellows", "Yellow cards", 2], ["fouls", "Fouls", 1], ["reds", "Red cards", 3], ["pen_goals", "Penalty goals", 3], ["home_bias", "Home card bias", 2]];

export default function Referees() {
  const [league, setLeague] = useParam("league", "GB1");
  const seasons = useQuery(`select distinct season from referees where competition_id = ${lit(league)} order by season desc`);
  const [seasonP, setSeason] = useParam("season", "");
  const season = Number(seasonP || seasons.rows[0]?.season || 2025);
  const [metric, setMetric] = useParam("m", "yellows");
  const rows = useQuery(`select * from referees where competition_id = ${lit(league)} and season = ${season} order by matches desc`);
  const rel = useQuery(`select * from referee_reliability`);
  const k = Object.fromEntries(rel.rows.map((r) => [r.metric, r.k_matches]));
  const mm = METRICS.find((m) => m[0] === metric)!;

  const plot = useMemo(() => {
    const d = rows.rows.filter((r) => r[`${metric}_pm`] != null);
    if (!d.length) return undefined;
    const lg = d[0][`${metric}_league_pm`];
    return (width: number) => ({
      width, height: Math.max(260, d.length * 22 + 50), marginLeft: 130,
      x: { label: `${mm[1]} per match`, grid: true },
      y: { label: null, domain: [...d].sort((a, b) => b[`${metric}_pm_shrunk`] - a[`${metric}_pm_shrunk`]).map((r) => r.referee) },
      marks: [
        Plot.ruleX([lg], { stroke: css("--axis") }),
        Plot.link(d, { y: "referee", x1: `${metric}_pm`, x2: `${metric}_pm_shrunk`, stroke: css("--muted"), strokeOpacity: 0.6 }),
        Plot.dot(d, { y: "referee", x: `${metric}_pm`, r: 3.5, fill: css("--surface"), stroke: css("--muted") }),
        Plot.dot(d, { y: "referee", x: `${metric}_pm_shrunk`, r: 5, fill: css("--s1"), stroke: css("--surface"), strokeWidth: 2 }),
        Plot.tip(d, Plot.pointerY({ y: "referee", x: `${metric}_pm_shrunk`, title: (r: any) =>
          `${r.referee} · ${r.matches} matches\nraw ${fmt.n(r[`${metric}_pm`], mm[2])} → shrunk ${fmt.n(r[`${metric}_pm_shrunk`], mm[2])}\nleague ${fmt.n(r[`${metric}_league_pm`], mm[2])}` })),
      ],
    });
  }, [rows.rows, metric]);

  const strictest = [...rows.rows].filter((r) => r.matches >= 10).sort((a, b) => b.yellows_pm_shrunk - a.yellows_pm_shrunk)[0];
  return (
    <>
      <PageHead eyebrow="Officials" title="Referees: real differences, and a lot of noise"
        lead="Every rate is shrunk toward the league average by how much it genuinely varies between referees, so a hot streak over a few matches doesn't make a referee look card-happy." />
      <div className="filters">
        <LeagueSelect value={league} onChange={(v) => { setLeague(v); setSeason(null); }} leagues={SIM_LEAGUES} />
        <SeasonSelect value={season} onChange={(v) => setSeason(String(v))} seasons={seasons.rows.map((r) => r.season)} comp={league} />
      </div>
      <div className="tiles" style={{ marginBottom: 16 }}>
        <Tile label="Matches for a foul rate to be half signal" value={fmt.n(k.fouls, 1)} delta="referee style is real here" />
        <Tile label="…for yellow cards" value={fmt.n(k.yellows, 1)} />
        <Tile label="…for red cards" value={fmt.n(k.reds, 0)} delta="more than a season" tone="down" />
        <Tile label="…for penalties" value={fmt.n(k.pen_goals, 0)} delta="effectively pure noise" tone="down" />
        <Tile label="…for home bias" value={fmt.n(k.home_bias, 0)} delta="the factors study found no home lean either" tone="down" />
      </div>
      <Loading state={rows} />
      <div className="grid">
        <div className="c7">
          {plot && <Figure title={strictest && metric === "yellows" ? `${strictest.referee} shows the most yellows once noise is removed` : `${mm[1]}: raw rate vs what we believe`}
            subtitle="Hollow: the raw per-match rate. Filled: shrunk toward the league average by the referee's sample size. The line marks the league average."
            right={<Seg value={metric as any} onChange={setMetric} label="Metric" options={METRICS.map(([k2, l]) => [k2, l]) as any} />}
            source="football-data.co.uk, Transfermarkt" plot={plot} alt={`${mm[1]} per match by referee`}
            table={{ rows: rows.rows, cols: [["referee", "Referee"], ["matches", "Matches"], [`${metric}_pm`, "Raw", (v) => fmt.n(v, mm[2])], [`${metric}_pm_shrunk`, "Shrunk", (v) => fmt.n(v, mm[2])]] }} />}
        </div>
        <div className="c5">
          <Card title="All referees this season" sub="Shrunk rates per match; in brackets, the difference from the league.">
            <DataTable rows={rows.rows} initialSort={{ key: "matches", desc: true }} maxHeight={560} cols={[
              { key: "referee", label: "Referee" },
              { key: "matches", label: "Matches", num: true },
              ...METRICS.slice(0, 4).map(([k2, l, d]) => ({
                key: `${k2}_pm_shrunk`, label: l.replace(" cards", ""), num: true, heat: "pos" as const,
                fmt: (v: any, r: any) => v == null ? "–" : <>{fmt.n(v, d)} <span className="xs muted">({fmt.signed(v - r[`${k2}_league_pm`], d)})</span></>,
              })),
            ]} />
          </Card>
        </div>
      </div>
    </>
  );
}
