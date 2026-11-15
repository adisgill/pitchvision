// Pitch matchup: where one team's attacking strengths meet the other's defensive leaks,
// zone by zone, from the event-data seasons.
import { useMemo } from "react";
import { lit, useQuery } from "../db";
import { fmt, LEAGUES, seasonLabel } from "../lib/format";
import { Card, ClubLink, DataTable, Field, Loading, PageHead, Seg, Select, Tile, useParam } from "../ui/kit";
import { HeatLegend, ZoneHeat } from "../ui/pitch";
import { dsLabel, zoneName } from "./player/shared";

const MEAS: [string, string, (v: number) => string][] = [
  ["xg", "xG", (v) => fmt.n(v, 3)],
  ["xt_added", "xT added", (v) => fmt.n(v, 3)],
  ["shots", "Shots", (v) => fmt.n(v, 2)],
  ["receptions", "Completed passes received", (v) => fmt.n(v, 1)],
  ["touches", "Touches", (v) => fmt.n(v, 1)],
];

type Cell = { zx: number; zy: number; a: number; b: number; lg: number; att: number; leak: number; mis: number; low: boolean };

export default function Matchup() {
  const [ds, setDs] = useParam("ds", "wyscout:GB1:2017");
  const [measure, setMeasure] = useParam("m", "xt_added");
  const [dir, setDir] = useParam("dir", "ab");
  const [prov, comp, season] = ds.split(":");
  const w = `provider = ${lit(prov)} and competition_id = ${lit(comp)} and season = ${Number(season)}`;
  const sets = useQuery(`select distinct provider, competition_id, season from zones_team order by provider desc, season desc, competition_id`);
  const teams = useQuery(`select z.club_id, coalesce(k.name, z.club_id) as name, sum(z.xg) / any_value(z.matches) as xg_pm, any_value(z.matches) as matches
                          from zones_team z left join clubs k using (club_id) where ${w} and z.side = 'for' group by all order by xg_pm desc`);
  const [aP, setA] = useParam("a", "");
  const [bP, setB] = useParam("b", "");
  const ids = teams.rows.map((r) => r.club_id);
  const a0 = ids.includes(aP) ? aP : ids[0], b0 = ids.includes(bP) ? bP : ids[1];
  const [att, def] = dir === "ab" ? [a0, b0] : [b0, a0];
  const name = (id?: string) => teams.rows.find((r) => r.club_id === id)?.name ?? id ?? "–";
  const mm = MEAS.find((m) => m[0] === measure) ?? MEAS[1];

  const res = useQuery(att && def ? `
    with z as (select * from zones_team where ${w}),
    tm as (select sum(m) m from (select distinct club_id, matches m from z where side = 'for')),
    lg as (select zx, zy, sum(${mm[0]}) / (select m from tm) pm from z where side = 'for' group by all),
    fa as (select zx, zy, sum(${mm[0]}) / any_value(matches) pm from z where club_id = ${lit(att)} and side = 'for' group by all),
    fb as (select (11 - zx)::int zx, (7 - zy)::int zy, sum(${mm[0]}) / any_value(matches) pm from z where club_id = ${lit(def)} and side = 'against' group by all),
    g as (select gx::int zx, gy::int zy from range(12) t1(gx), range(8) t2(gy))
    select g.zx, g.zy, coalesce(fa.pm, 0) a, coalesce(fb.pm, 0) b, coalesce(lg.pm, 0) lg
    from g left join lg using (zx, zy) left join fa using (zx, zy) left join fb using (zx, zy) order by zx, zy` : null);

  const cells: Cell[] = useMemo(() => {
    const rows = res.rows;
    if (!rows.length) return [];
    const pos = (v: number) => Math.max(0, v); // xT added can be negative in deep zones
    const maxLg = Math.max(...rows.map((r) => pos(r.lg)));
    const meanLg = rows.reduce((s, r) => s + pos(r.lg), 0) / rows.length;
    const c = 0.25 * meanLg; // pseudo-count: low-volume zones are pulled toward "average"
    return rows.map((r) => {
      const a = pos(r.a), b = pos(r.b), lg = pos(r.lg);
      if (lg < 0.02 * maxLg) return { zx: r.zx, zy: r.zy, a, b, lg, att: 0, leak: 0, mis: 0, low: true };
      const attI = (a + c) / (lg + c), leak = (b + c) / (lg + c);
      return { zx: r.zx, zy: r.zy, a, b, lg, att: attI - 1, leak: leak - 1, mis: attI * leak - 1, low: false };
    });
  }, [res.rows]);
  const meaningful = cells.filter((c) => !c.low);
  const top = [...meaningful].sort((x, y) => y.mis - x.mis).slice(0, 3);
  const worst = [...meaningful].sort((x, y) => x.mis - y.mis)[0];
  const totA = cells.reduce((s, c) => s + c.a, 0), totB = cells.reduce((s, c) => s + c.b, 0), totL = cells.reduce((s, c) => s + c.lg, 0);
  const lim = (k: keyof Cell) => Math.max(0.3, Math.min(1.5, Math.max(...meaningful.map((c) => Math.abs(c[k] as number)))));
  const pctS = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(Math.round(100 * v))}%`;
  const tipFor = (c: Cell) => c.low ? <><b>Too little volume</b><div className="muted">{zoneName(c.zx, c.zy)}: almost no {mm[1].toLowerCase()} happens here league-wide</div></> : <>
    <b>{pctS(c.mis)}</b> matchup edge<div className="muted">{zoneName(c.zx, c.zy)}</div>
    <div>{name(att)} create {mm[2](c.a)} / match ({pctS(c.att)} vs league)</div>
    <div>{name(def)} concede {mm[2](c.b)} / match ({pctS(c.leak)})</div>
    <div className="muted">league average {mm[2](c.lg)}</div></>;

  return (
    <>
      <PageHead eyebrow={`Pitch matchup · ${LEAGUES[comp] ?? comp} ${seasonLabel(Number(season), comp)} · ${dsLabel(prov)}`}
                title={top[0] ? <>{name(att)}'s best route against {name(def)}: the {zoneName(top[0].zx, top[0].zy)}</> : "Pitch matchup"}
                lead={<>Where one side's attacking strengths meet the other's defensive leaks. For each 8.75 × 8.5 m zone we compare what the attacking
                  team creates there per match, and what the defending team concedes there, against the league average. Their product is the matchup edge.</>} />
      <div className="filters">
        <Select label="Dataset" value={ds} onChange={(v) => { setDs(v); setA(null); setB(null); }}
                options={sets.rows.map((r) => [`${r.provider}:${r.competition_id}:${r.season}`, `${LEAGUES[r.competition_id] ?? r.competition_id} ${seasonLabel(r.season, r.competition_id)} · ${dsLabel(r.provider)}`])} />
        <Select label="Team A" value={a0 ?? ""} onChange={setA} options={teams.rows.map((r) => [r.club_id, r.name])} />
        <Select label="Team B" value={b0 ?? ""} onChange={setB} options={teams.rows.map((r) => [r.club_id, r.name])} />
        <Select label="Measure" value={mm[0]} onChange={setMeasure} options={MEAS.map(([k, l]) => [k, l])} />
        <Field label="Direction">
          <Seg options={[["ab", `${name(a0).split(" ")[0]} attacking`], ["ba", `${name(b0).split(" ")[0]} attacking`]]} value={dir as "ab" | "ba"} onChange={setDir} label="Direction" />
        </Field>
      </div>
      <Loading state={teams} />
      <Loading state={res} />
      {cells.length > 0 && (
        <>
          <div className="tiles" style={{ marginBottom: 16 }}>
            <Tile label={`${name(att)} create, per match`} value={mm[2](totA)} delta={`league ${mm[2](totL)} · ${pctS(totA / totL - 1)}`} tone={totA >= totL ? "up" : "down"} />
            <Tile label={`${name(def)} concede, per match`} value={mm[2](totB)} delta={`league ${mm[2](totL)} · ${pctS(totB / totL - 1)}`} tone={totB <= totL ? "up" : "down"} />
            {top[0] && <Tile label="Biggest edge" value={pctS(top[0].mis)} delta={zoneName(top[0].zx, top[0].zy)} />}
            {worst && <Tile label="Where the attack runs into a wall" value={pctS(worst.mis)} delta={zoneName(worst.zx, worst.zy)} tone="down" />}
          </div>
          <div className="grid">
            <div className="c12">
              <Card title={`Matchup edge: ${name(att)} attacking ${name(def)}`}
                    sub={<>(attack index × leak index) − 1, per zone, for {mm[1].toLowerCase()}. Blue: {name(att)} are strong where {name(def)} are weak.
                      Red: strength meets strength. Drawn with {name(att)} attacking left to right (their right wing along the bottom).</>}>
                <div style={{ maxWidth: 880, margin: "0 auto" }}>
                  <ZoneHeat cells={cells.map((c) => ({ ...c, v: c.mis }))} mode="div" max={lim("mis")} fmtV={pctS} labelTop={3} title={(c: any) => tipFor(c)} />
                  <HeatLegend mode="div" lo={pctS(-lim("mis"))} hi={pctS(lim("mis"))} label="matchup edge vs an average pairing" />
                </div>
              </Card>
            </div>
            <div className="c6">
              <Card title={`${name(att)}: where they create`} sub={`${mm[1]} per match started in each zone, vs the league average (blue = more).`}>
                <ZoneHeat cells={cells.map((c) => ({ ...c, v: c.att }))} mode="div" max={lim("att")} fmtV={pctS} labelTop={2} title={(c: any) => tipFor(c)} />
              </Card>
            </div>
            <div className="c6">
              <Card title={`${name(def)}: where they leak`} sub={`${mm[1]} conceded per match by zone vs the league (blue = leaks more). Mirrored so it lines up with the attack.`}>
                <ZoneHeat cells={cells.map((c) => ({ ...c, v: c.leak }))} mode="div" max={lim("leak")} fmtV={pctS} labelTop={2} title={(c: any) => tipFor(c)} />
              </Card>
            </div>
            <div className="c7">
              <Card title="The three zones that decide it" sub="Zones with at least 2% of the busiest zone's league volume, ranked by matchup edge.">
                <ol className="small ink2" style={{ paddingLeft: "1.2rem", margin: 0, lineHeight: 1.7 }}>
                  {top.map((c) => (
                    <li key={`${c.zx},${c.zy}`}><b>{zoneName(c.zx, c.zy)}</b>: {name(att)} produce {pctS(c.att)} vs the league there and {name(def)} concede {pctS(c.leak)},
                      so this pairing should see about {pctS(c.mis)} more {mm[1].toLowerCase()} there than an average one.</li>
                  ))}
                </ol>
              </Card>
            </div>
            <div className="c5">
              <Card title="Read this with care" sub={null}>
                <p className="small ink2">Free event data covers StatsBomb 2015-16 (big five leagues) and its women's seasons, and Wyscout 2017-18 (big five). This is a historical
                  analysis tool: it shows how two teams of those seasons matched up, not today's sides.</p>
                <p className="small ink2" style={{ marginBottom: 0 }}>Season averages blend opponents and game states; zones with little volume are pulled toward average. "Against" maps are mirrored into
                  the defending team's view. For what actually moves results beyond team strength, see <a href="#/factors">Hidden factors</a>.</p>
              </Card>
            </div>
            <div className="c12">
              <Card title="Every zone" sub="Per match. Sort any column.">
                <DataTable rows={meaningful.map((c) => ({ ...c, zone: zoneName(c.zx, c.zy) }))} initialSort={{ key: "mis", desc: true }} maxHeight={420} cols={[
                  { key: "zone", label: "Zone" },
                  { key: "a", label: `${name(att)} create`, num: true, fmt: (v) => mm[2](v) },
                  { key: "b", label: `${name(def)} concede`, num: true, fmt: (v) => mm[2](v) },
                  { key: "lg", label: "League avg", num: true, fmt: (v) => mm[2](v) },
                  { key: "att", label: "Attack idx", num: true, fmt: pctS },
                  { key: "leak", label: "Leak idx", num: true, fmt: pctS },
                  { key: "mis", label: "Edge", num: true, fmt: pctS, heat: "pos" },
                ]} />
                <p className="xs muted" style={{ marginTop: 8 }}>Teams: <ClubLink id={att!} name={name(att)} /> · <ClubLink id={def!} name={name(def)} /></p>
              </Card>
            </div>
          </div>
        </>
      )}
    </>
  );
}
