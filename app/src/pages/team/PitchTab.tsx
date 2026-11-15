import { useMemo } from "react";
import { lit, Row, useQuery } from "../../db";
import { fmt, LEAGUES, seasonLabel } from "../../lib/format";
import { Card, Empty, Field, Seg, Select, useParam } from "../../ui/kit";
import { HeatLegend, ZoneCell, ZoneHeat } from "../../ui/pitch";

export const MEASURES: [string, string, number, string][] = [
  ["xg", "xG (shot origin)", 3, "expected goals from shots started in the zone"],
  ["shots", "Shots", 2, "shots started in the zone"],
  ["xt_added", "xT added", 3, "expected threat added by passes and carries starting in the zone"],
  ["vaep_off", "VAEP (attacking)", 3, "change in scoring chance from actions starting in the zone"],
  ["touches", "Touches", 1, "on-ball actions"],
  ["receptions", "Receptions", 1, "completed passes received in the zone"],
  ["def_actions", "Defensive actions", 2, "tackles, interceptions, recoveries, blocks, clearances, duels"],
  ["pressures", "Pressures", 2, "pressing actions (StatsBomb seasons only)"],
  ["turnovers", "Turnovers", 2, "failed passes, crosses and take-ons, dispossessions, bad touches"],
  ["vaep_def", "VAEP (defensive)", 3, "change in conceding chance from actions starting in the zone"],
];

/** Current seasons (FotMob shot maps): shot-based measures only. */
export const FM_MEASURES: [string, string, number, string][] = [
  ["xg", "xG (shot origin)", 3, "expected goals from shots taken in the zone"],
  ["shots", "Shots", 2, "shots taken from the zone"],
  ["goals", "Goals", 2, "goals scored from shots in the zone"],
  ["xgps", "xG per shot", 3, "average quality of shots from the zone (zones without shots blank)"],
];

const third = (zx: number) => (zx <= 3 ? "own third" : zx <= 7 ? "middle third" : "final third");
const lane = (zy: number) => (zy <= 1 || zy >= 6 ? "wide areas" : zy === 2 || zy === 5 ? "half-spaces" : "central lanes");
export const zoneName = (zx: number, zy: number) => `${lane(zy)} of the ${third(zx)}`;

/** Per-match zone values for every club in a provider-competition-season, plus the league mean. */
export function useZones(provider: string, comp: string, season: number, measure: string) {
  const fm = provider === "fotmob";
  const ratio = measure === "xgps";
  const q = useQuery(!provider ? null : fm
    ? `select club_id, side, zx, zy, ${ratio ? "xg" : measure} as v, shots as n, matches from fm_zones_team
       where competition_id = ${lit(comp)} and season = ${season}`
    : `select club_id, side, zx, zy, ${measure} as v, 0 as n, matches from zones_team
       where provider = ${lit(provider)} and competition_id = ${lit(comp)} and season = ${season}`);
  return useMemo(() => {
    const per = new Map<string, number>(); // club|side|zx|zy -> per match (or xG per shot)
    const sum = new Map<string, number>(), sumN = new Map<string, number>(), clubs = new Set<string>();
    q.rows.forEach((r: Row) => {
      const k = `${r.side}|${r.zx}|${r.zy}`;
      const v = ratio ? (r.n > 0 ? (r.v ?? 0) / r.n : 0) : (r.v ?? 0) / Math.max(1, r.matches);
      per.set(`${r.club_id}|${k}`, v);
      sum.set(k, (sum.get(k) ?? 0) + (ratio ? (r.v ?? 0) : v));
      sumN.set(k, (sumN.get(k) ?? 0) + (r.n ?? 0));
      clubs.add(r.club_id);
    });
    const avg = (side: string, zx: number, zy: number) => {
      const k = `${side}|${zx}|${zy}`;
      return ratio ? ((sumN.get(k) ?? 0) > 0 ? (sum.get(k) ?? 0) / sumN.get(k)! : 0) : (sum.get(k) ?? 0) / Math.max(1, clubs.size);
    };
    const get = (club: string, side: string, zx: number, zy: number) => per.get(`${club}|${side}|${zx}|${zy}`) ?? 0;
    return { loading: q.loading, ready: q.rows.length > 0, get, avg, clubs: clubs.size };
  }, [q.rows, q.loading, ratio]);
}

export default function PitchTab({ id, name }: { id: string; name: string }) {
  const sets = useQuery(`select * from (
      select distinct 'fotmob' as provider, competition_id, season, 0 as o from fm_zones_team where club_id = ${lit(id)}
      union all select distinct provider, competition_id, season, 1 as o from zones_team where club_id = ${lit(id)})
    order by o, season desc`);
  const all = useQuery(`select provider, competition_id, season from zones_team group by all order by season desc`);
  const [dsP, setDs] = useParam("zs", "");
  const ds = dsP || (sets.rows[0] ? `${sets.rows[0].provider}:${sets.rows[0].competition_id}:${sets.rows[0].season}` : "");
  const [provider, comp, seasonS] = ds ? ds.split(":") : ["", "", "0"];
  const season = Number(seasonS);
  const [measure, setMeasure] = useParam("zm", "xg");
  const [side, setSide] = useParam("zside", "for");
  const [mode, setMode] = useParam("zmode", "rel");
  const isFm = provider === "fotmob";
  const measures = isFm ? FM_MEASURES : MEASURES;
  const mm = measures.find((m) => m[0] === measure) ?? measures[0];
  const z = useZones(provider, comp, season, mm[0]);

  const cells: ZoneCell[] = useMemo(() => {
    if (!z.ready) return [];
    const out: ZoneCell[] = [];
    for (let zx = 0; zx < 12; zx++) for (let zy = 0; zy < 8; zy++) {
      const val = (s: string) => z.get(id, s, zx, zy) - (mode === "rel" ? z.avg(s, zx, zy) : 0);
      const v = side === "net" ? val("for") - val("against") : val(side);
      out.push({ zx, zy, v });
    }
    return out;
  }, [z, id, side, mode]);

  const takeaways = useMemo(() => {
    if (!cells.length) return [];
    const sorted = [...cells].sort((a, b) => b.v - a.v);
    const top = sorted[0], bottom = sorted[sorted.length - 1];
    const thirds = [0, 1, 2].map((t) => cells.filter((c) => Math.floor(c.zx / 4) === t).reduce((a, c) => a + c.v, 0));
    const verb = side === "against" ? "Opponents' " : side === "net" ? "Net " : "";
    const unit = mm[1].toLowerCase();
    const out: string[] = [];
    if (mode === "rel") {
      out.push(`${verb}${unit} furthest above the league average: the ${zoneName(top.zx, top.zy)} (${fmt.signed(top.v, mm[2])} per match).`);
      out.push(`Furthest below: the ${zoneName(bottom.zx, bottom.zy)} (${fmt.signed(bottom.v, mm[2])}).`);
      const t = thirds.indexOf(Math.max(...thirds));
      out.push(`Across thirds, the biggest surplus is in the ${["own", "middle", "final"][t]} third (${fmt.signed(thirds[t], mm[2])} per match).`);
    } else {
      const tot = cells.reduce((a, c) => a + c.v, 0);
      out.push(`Most ${verb.toLowerCase()}${unit} comes from the ${zoneName(top.zx, top.zy)} (${fmt.n(top.v, mm[2])} per match, ${fmt.pct(top.v / (tot || 1))} of the total).`);
      out.push(`Split by thirds: own ${fmt.pct(thirds[0] / (tot || 1))}, middle ${fmt.pct(thirds[1] / (tot || 1))}, final ${fmt.pct(thirds[2] / (tot || 1))}.`);
    }
    return out;
  }, [cells, mode, side, mm]);

  if (!sets.loading && !sets.rows.length) {
    const avail = all.rows.map((r) => `${LEAGUES[r.competition_id] ?? r.competition_id} ${seasonLabel(r.season, r.competition_id)}`);
    return <Empty>No pitch data for {name}. Current shot maps cover the 2024-25 season onward (FotMob, still loading for some leagues); full-action maps exist only for the free event-data seasons: {avail.join(", ")}.</Empty>;
  }
  const divMode = mode === "rel" || side === "net";
  const maxAbs = Math.max(1e-9, ...cells.map((c) => Math.abs(c.v)));
  return (
    <div className="grid">
      <div className="c12">
        <div className="filters" style={{ margin: 0 }}>
          <Select label="Season" value={ds} onChange={(v) => setDs(v)} options={sets.rows.map((r) => [`${r.provider}:${r.competition_id}:${r.season}`,
            `${LEAGUES[r.competition_id] ?? r.competition_id} ${seasonLabel(r.season, r.competition_id)} · ${r.provider === "fotmob" ? "current shot maps (FotMob)" : `full event data, historical (${r.provider === "wyscout" ? "Wyscout" : "StatsBomb"})`}`])} />
          <Select label="Measure" value={mm[0]} onChange={(v) => setMeasure(v)} options={measures.map(([k, l]) => [k, l])} />
          <Field label="Whose actions"><Seg value={side as any} onChange={(v) => setSide(v)} label="Side" options={[["for", `${name}`], ["against", "Opponents"], ["net", "Net"]] as any} /></Field>
          <Field label="Scale"><Seg value={mode as any} onChange={(v) => setMode(v)} label="Scale" options={[["rel", "vs league average"], ["raw", "Raw"]] as any} /></Field>
        </div>
      </div>
      <div className="c8">
        <Card title={`${side === "against" ? "What opponents do against" : side === "net" ? "Where" : "Where"} ${name}${side === "net" ? " out-do their opponents" : side === "against" ? "" : ` ${measure === "xg" || measure === "shots" ? "shoot from" : "act"}`}: ${mm[1]}`}
              sub={<>{mm[0] === "xgps" ? "Average xG per shot" : "Per match"}, {mm[3]}, on a 12 × 8 grid. {name} attack left to right{side !== "for" ? "; opponents' actions are mirrored into the same view, so their attacks run right to left onto this goal" : ""}.
                {mode === "rel" ? ` Blue = more than the average ${LEAGUES[comp] ?? comp} side (${z.clubs} teams), red = less.` : ""} Hover any zone.</>}>
          {cells.length ? (
            <>
              <ZoneHeat cells={cells} mode={divMode ? "div" : "seq"} max={maxAbs} labelTop={4}
                        fmtV={(v) => (divMode ? fmt.signed(v, mm[2]) : fmt.n(v, mm[2]))}
                        title={(c) => {
                          const own = z.get(id, side === "net" ? "for" : side, c.zx, c.zy), lg = z.avg(side === "net" ? "for" : side, c.zx, c.zy);
                          return <><b>{divMode ? fmt.signed(c.v, mm[2]) : fmt.n(c.v, mm[2])}</b> <span className="muted">per match</span>
                            <div className="muted">{zoneName(c.zx, c.zy)}</div>
                            {side !== "net" && <div className="xs muted">{name} {fmt.n(own, mm[2])} · league avg {fmt.n(lg, mm[2])}</div>}</>;
                        }} />
              <HeatLegend mode={divMode ? "div" : "seq"} lo={divMode ? fmt.signed(-maxAbs, mm[2]) : "0"} hi={divMode ? fmt.signed(maxAbs, mm[2]) : fmt.n(maxAbs, mm[2])}
                          label={divMode ? "per match vs league" : "per match"} />
            </>
          ) : <p className="loading">Loading…</p>}
        </Card>
      </div>
      <div className="c4">
        <Card title="What the map says">
          <ul className="small ink2" style={{ paddingLeft: "1.1rem", margin: 0, lineHeight: 1.6 }}>
            {takeaways.map((t, i) => <li key={i}>{t}</li>)}
          </ul>
          <p className="xs muted" style={{ marginTop: 12 }}>Lanes: wide areas are the outer two zone rows on each touchline, half-spaces the next row in, central lanes the middle two.
            Zone values are season totals divided by matches. Source: {isFm ? "FotMob shot maps (Opta), shots only; switch to a historical event-data season for passes, carries and defending" : provider === "wyscout" ? "Wyscout public dataset (CC BY 4.0)" : "StatsBomb open data, aggregated"}.</p>
          <p className="xs muted">Want this against a specific opponent? The <a href="#/matchup">pitch matchup</a> overlays one team's attack on another's defence.</p>
        </Card>
      </div>
    </div>
  );
}
