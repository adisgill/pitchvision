// Compare up to three players: overlaid percentile radar, side-by-side numbers, and their
// pitch maps when event data covers them.
import { lit, Row, useQuery } from "../db";
import { fmt, LEAGUES, seasonLabel, slot } from "../lib/format";
import { Radar } from "../ui/charts";
import { Card, EntityPicker, Field, PageHead, PlayerLink, Seg, Select, useParam } from "../ui/kit";
import { HeatLegend, ZoneHeat } from "../ui/pitch";
import { fmAxes, fmSeasonLabel, fmZoneSql, useFmPercentiles } from "./player/fotmob";
import { usePercentiles, seasonKeys } from "./player/Overview";
import { zoneSql } from "./player/PitchTab";
import { InlineLegend, MEASURES, zoneShares } from "./player/shared";

const DEFAULT = "tm-418560,tm-132098,tm-342229";

function useSeasons(id: string | null) {
  const c = useQuery(id ? `select competition_id, season, minutes from players_c where player_id = ${lit(id)} order by season desc, minutes desc` : null);
  const a = useQuery(id ? `select provider, competition_id, season from players_a where player_id = ${lit(id)} order by season desc` : null);
  const f = useQuery(id ? `select competition_id, season, minutes from fm_player_season where player_id = ${lit(id)} order by season desc, minutes desc` : null);
  const n = useQuery(id ? `select name from players where player_id = ${lit(id)} union all select name from fm_players where player_id = ${lit(id)}` : null);
  return { c: c.rows, a: a.rows, f: f.rows, name: n.rows[0]?.name as string | undefined };
}

const fKeys = (rows: Row[]): [string, string][] => rows.map((r) => [`f:${r.competition_id}:${r.season}`, `${fmSeasonLabel(r)} · current (FotMob)`]);
function optsFor(tier: string, s: { c: Row[]; a: Row[]; f: Row[] }): [string, string][] {
  return tier === "f" ? fKeys(s.f) : seasonKeys(tier === "a" ? [] : s.c, tier === "a" ? s.a : []);
}

export default function Compare() {
  const [pParam, setP] = useParam("p", DEFAULT);
  const [sParam, setS] = useParam("s", "");
  const [tierP, setTier] = useParam("tier", "");
  const [measure, setMeasure] = useParam("m", "touches");
  const ids = pParam.split(",").filter(Boolean).slice(0, 3);
  const slotsIds: (string | null)[] = [ids[0] ?? null, ids[1] ?? null, ids[2] ?? null];
  const seasons = [useSeasons(slotsIds[0]), useSeasons(slotsIds[1]), useSeasons(slotsIds[2])];
  const active = slotsIds.map((id, i) => ({ id, ...seasons[i] })).filter((x) => x.id);
  const allEvent = active.length > 0 && active.every((x) => x.a.length > 0);
  const allFm = active.length > 0 && active.every((x) => x.f.length > 0);
  const tier = tierP || (allFm ? "f" : allEvent ? "a" : "c");
  const chosen = sParam.split(",");
  const keyFor = (i: number) => {
    const s = seasons[i];
    const opts = optsFor(tier, s);
    return opts.some(([k]) => k === chosen[i]) ? chosen[i] : opts[0]?.[0] ?? null;
  };
  const keys = [0, 1, 2].map((i) => (slotsIds[i] ? keyFor(i) : null));
  const isF = tier === "f";
  const pc = [usePercentiles(slotsIds[0] ?? "", isF ? null : keys[0]), usePercentiles(slotsIds[1] ?? "", isF ? null : keys[1]),
              usePercentiles(slotsIds[2] ?? "", isF ? null : keys[2])];
  const fk = keys.map((k) => (isF && k ? k.split(":") : null));
  const pf = [useFmPercentiles(slotsIds[0] ?? "", fk[0]?.[1], fk[0] ? Number(fk[0][2]) : undefined),
              useFmPercentiles(slotsIds[1] ?? "", fk[1]?.[1], fk[1] ? Number(fk[1][2]) : undefined),
              useFmPercentiles(slotsIds[2] ?? "", fk[2]?.[1], fk[2] ? Number(fk[2][2]) : undefined)];
  const fAxes = fmAxes(pf.find((p) => p.pos)?.pos);
  // one shape for both: per-player raw row and percentiles on the shared axes
  const pr = [0, 1, 2].map((i) => (isF
    ? { me: pf[i].me, vals: Object.fromEntries(fAxes.map((m) => [m.key, pf[i].pct(m)])) as Record<string, number | null>,
        raw: Object.fromEntries(fAxes.map((m) => [m.key, m.f(pf[i].me?.[m.key])])) as Record<string, string> }
    : { me: pc[i].me, vals: pc[i].vals, raw: pc[i].raw }));
  const axes = isF ? fAxes : (pc.find((p) => p.axes.length && p.me)?.axes ?? pc[0].axes);
  const mm = MEASURES.find((m) => m[0] === measure) ?? MEASURES[0];
  const zk = keys.map((k) => (tier === "a" && k ? k.split(":") : null));
  const zsql = (i: number) => (zk[i] && slotsIds[i] ? zoneSql(slotsIds[i]!, zk[i]![1], zk[i]![2], Number(zk[i]![3]), mm[0])
    : fk[i] && slotsIds[i] ? fmZoneSql(slotsIds[i]!, fk[i]![1], Number(fk[i]![2])) : null);
  const zones = [useQuery(zsql(0)), useQuery(zsql(1)), useQuery(zsql(2))];
  const zval = (r: Row) => (isF ? r.xg90 : r.mine);

  const setId = (i: number, id: string | null) => {
    const next = [...slotsIds];
    next[i] = id;
    setP(next.filter(Boolean).join(",") || null);
    const s = [...chosen]; s[i] = ""; setS(s.join(",").replace(/,+$/, "") || null);
  };
  const setKey = (i: number, k: string) => { const s = [0, 1, 2].map((j) => chosen[j] ?? ""); s[i] = k; setS(s.join(",")); };

  const series = [0, 1, 2].filter((i) => slotsIds[i] && pr[i].me).map((i) => ({
    name: seasons[i].name ?? slotsIds[i]!, color: slot(i + 1),
    values: Object.fromEntries(axes.map((m) => [m.key, pr[i].vals[m.key] ?? null])),
    raw: Object.fromEntries(axes.map((m) => [m.key, pr[i].raw[m.key]])),
  }));
  const zmax = Math.max(1e-9, ...zones.flatMap((z) => z.rows.map(zval)));
  const wins = (m: (typeof axes)[number]) => {
    const vals = [0, 1, 2].map((i) => (slotsIds[i] && pr[i].me ? pr[i].me![m.key] : null));
    const ok = vals.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    if (ok.length < 2) return -1;
    const best = m.higher === false ? Math.min(...ok) : Math.max(...ok);
    return vals.indexOf(best);
  };
  const tally = [0, 1, 2].map((i) => axes.filter((m) => wins(m) === i).length);
  const leaderIdx = tally.indexOf(Math.max(...tally));

  return (
    <>
      <PageHead eyebrow="Compare players"
                title={series.length >= 2 ? <>{series[leaderIdx]?.name ?? "–"} comes out ahead on {tally[leaderIdx]} of {axes.length} measures</> : "Compare up to three players"}
                lead="Percentiles are against each player's own position peers in their own league season, so players from different leagues and eras can sit on one chart. Pick seasons per player." />
      <div className="grid" style={{ marginBottom: 16 }}>
        {[0, 1, 2].map((i) => {
          const s = seasons[i];
          const opts = optsFor(tier, s);
          return (
            <div key={i} className="c4">
              <div className="card tight" style={{ borderTop: `3px solid ${slot(i + 1)}` }}>
                <div className="stack">
                  <Field label={`Player ${i + 1}`}>
                    <EntityPicker kind="player" value={s.name ?? ""} placeholder="Search a player" onPick={(e) => setId(i, e.id)} />
                  </Field>
                  {slotsIds[i] && (opts.length ? <Select label="Season" value={keys[i] ?? ""} onChange={(k) => setKey(i, k)} options={opts} />
                    : <span className="small muted">No {tier === "a" ? "event-data" : tier === "f" ? "current (FotMob)" : "rated"} seasons for this player.</span>)}
                  {slotsIds[i] && <div className="row between small"><PlayerLink id={slotsIds[i]!} name="Open profile →" />
                    <button className="btn ghost small" onClick={() => setId(i, null)}>Remove</button></div>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="filters">
        <Field label="Data">
          <Seg options={[["f", "Current (FotMob)"], ["c", "Box score (every season)"], ["a", "Event data (historical)"]]} value={tier as "f" | "c" | "a"} onChange={(v) => { setTier(v); setS(null); }} label="Data tier" />
        </Field>
        {tier === "a" && !allEvent && <span className="small muted">Some players have no event-data seasons (StatsBomb 2015-16, Wyscout 2017-18, women's seasons).</span>}
      </div>
      <div className="grid">
        <div className="c6">
          <Card title="Percentile radar" sub="Outward is always better (lower-is-better measures flipped); the darker ring is the median. Hover an axis for raw values.">
            {series.length ? <><InlineLegend items={series.map((s) => ({ label: s.name, color: s.color, kind: "line" as const }))} />
              <Radar axes={axes.map((m) => ({ key: m.key, label: m.short ?? m.label }))} series={series} size={400} /></>
              : <div className="empty">Pick players with {tier === "a" ? "event-data" : tier === "f" ? "current (FotMob)" : "rated"} seasons.</div>}
          </Card>
        </div>
        <div className="c6">
          <Card title="Side by side" sub="Raw values; the best of the group is in bold. In brackets: percentile vs position peers.">
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Measure</th>{[0, 1, 2].filter((i) => slotsIds[i]).map((i) => (
                  <th key={i} className="r"><span className="dot" style={{ background: slot(i + 1), marginRight: 4 }} />{(seasons[i].name ?? "").split(" ").slice(-1)[0]}</th>))}</tr></thead>
                <tbody>
                  <tr><td className="muted">Season</td>{[0, 1, 2].filter((i) => slotsIds[i]).map((i) => {
                    const k = keys[i]?.split(":") ?? [];
                    const comp = tier === "a" ? k[2] : k[1], ss = Number(tier === "a" ? k[3] : k[2]);
                    return <td key={i} className="r small">{k.length ? `${seasonLabel(ss, comp)} ${LEAGUES[comp] ?? comp}` : "–"}</td>;
                  })}</tr>
                  <tr><td className="muted">Minutes</td>{[0, 1, 2].filter((i) => slotsIds[i]).map((i) => <td key={i} className="r">{fmt.n(pr[i].me?.minutes)}</td>)}</tr>
                  {axes.map((m) => {
                    const w = wins(m);
                    return (
                      <tr key={m.key}><td title={m.label}>{m.short ?? m.label}</td>
                        {[0, 1, 2].filter((i) => slotsIds[i]).map((i) => (
                          <td key={i} className="r" style={{ fontWeight: w === i ? 700 : 400 }}>
                            {pr[i].me ? m.f(pr[i].me![m.key]) : "–"}
                            <span className="xs muted"> {pr[i].vals[m.key] == null ? "" : `(${Math.round(pr[i].vals[m.key]!)})`}</span>
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
        {(tier === "a" || isF) && (
          <div className="c12">
            <Card title={isF ? "Where they shoot from" : "Where on the pitch"}
                  sub={isF ? "xG per 90 by zone (FotMob shots), same colour scale for all three. Attacking left to right." : "Per 90 minutes, same colour scale for all three so the maps compare directly. Attacking left to right."}
                  right={isF ? undefined : <Select label="Measure" value={mm[0]} onChange={setMeasure} options={MEASURES.map(([k, l]) => [k, l])} />}>
              <div className="grid">
                {[0, 1, 2].filter((i) => slotsIds[i]).map((i) => {
                  const rows: Row[] = zones[i].rows;
                  const sh = zoneShares(rows.map((r) => ({ zx: r.zx, zy: r.zy, v: zval(r) })));
                  const zf = isF ? (v: number) => fmt.n(v, 3) : mm[2];
                  return (
                    <div key={i} className="c4">
                      <p className="small" style={{ margin: "0 0 4px", fontWeight: 600 }}><span className="dot" style={{ background: slot(i + 1), marginRight: 6 }} />{seasons[i].name}</p>
                      {rows.length ? <ZoneHeat cells={rows.map((r) => ({ zx: r.zx, zy: r.zy, v: zval(r) }))} max={zmax} fmtV={zf} labelTop={2} />
                        : <div className="empty small">No data</div>}
                      {rows.length > 0 && <p className="xs muted" style={{ marginTop: 4 }}>{zf(rows.reduce((a, r) => a + zval(r), 0))}{isF ? " xG" : ""} per 90 · mostly {sh.topCh[0]}, {sh.topTh[0]}</p>}
                    </div>
                  );
                })}
              </div>
              <HeatLegend mode="seq" lo="0" hi={isF ? fmt.n(zmax, 3) : mm[2](zmax)} label={isF ? "xG per 90, per zone" : `${mm[1]} per 90, per zone`} />
            </Card>
          </div>
        )}
      </div>
    </>
  );
}
