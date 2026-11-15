import { lit, Row, useQuery } from "../../db";
import { fmt, LEAGUES, POSITION_NAMES, seasonLabel } from "../../lib/format";
import { Card, Empty, Field, Seg, Select, Tile, useParam } from "../../ui/kit";
import { HeatLegend, Pitch, ShotLayer, ZoneHeat } from "../../ui/pitch";
import { dsLabel, MEASURES, zoneName, zoneShares } from "./shared";

/** Per-90 zone values for one player-season and its qualified position peers. */
export function zoneSql(id: string, provider: string, comp: string, season: number, measure: string) {
  const w = `provider = ${lit(provider)} and competition_id = ${lit(comp)} and season = ${season}`;
  return `
    with me as (select position_group pos, minutes from players_a where player_id = ${lit(id)} and ${w} limit 1),
    pa as (select player_id, minutes from players_a where ${w} and qualified
             and position_group = (select pos from me)),
    mine as (select zx, zy, sum(${measure}) v from zones_player where player_id = ${lit(id)} and ${w} group by all),
    peer as (select z.zx, z.zy, sum(z.${measure}) v from zones_player z join pa using (player_id) where z.${w.replace(/ and /g, " and z.")} group by all),
    g as (select gx::int zx, gy::int zy from range(12) t1(gx), range(8) t2(gy))
    select g.zx, g.zy, coalesce(mine.v, 0) * 90 / (select minutes from me) mine,
           coalesce(peer.v, 0) * 90 / (select sum(minutes) from pa) peer,
           (select minutes from me) as minutes, (select pos from me) as pos, (select count(*) from pa) as n_peers
    from g left join mine using (zx, zy) left join peer using (zx, zy) order by zx, zy`;
}

export default function PitchTab({ id, seasonsA, name }: { id: string; seasonsA: Row[]; name: string }) {
  const keys = seasonsA.map((r) => [`${r.provider}:${r.competition_id}:${r.season}`,
    `${seasonLabel(r.season, r.competition_id)} ${LEAGUES[r.competition_id] ?? r.competition_id} · ${dsLabel(r.provider)}`] as [string, string]);
  const [dsP, setDs] = useParam("ds", keys[0]?.[0] ?? "");
  const ds = keys.some(([k]) => k === dsP) ? dsP : keys[0]?.[0];
  const [measure, setMeasure] = useParam("m", "xt_added");
  const [mode, setMode] = useParam("mode", "raw");
  const [prov, comp, season] = (ds ?? "::").split(":");
  const mm = MEASURES.find((m) => m[0] === measure) ?? MEASURES[1];
  const z = useQuery(ds ? zoneSql(id, prov, comp, Number(season), mm[0]) : null);
  const shots = useQuery(prov === "wyscout" ? `select s.*, m.home_club, m.away_club from shots_wy s
      left join matches_a m on m.provider = 'wyscout' and m.match_id = s.match_id where s.player_id = ${lit(id)}` : null);

  if (!ds) return <Empty>No event-data seasons.</Empty>;
  const rows = z.rows;
  const pos = rows[0]?.pos;
  const cells = rows.map((r) => ({ zx: r.zx, zy: r.zy, v: mode === "raw" ? r.mine : r.mine - r.peer, mine: r.mine, peer: r.peer }));
  const total = rows.reduce((a, r) => a + r.mine, 0), peerTotal = rows.reduce((a, r) => a + r.peer, 0);
  const sh = zoneShares(rows.map((r) => ({ zx: r.zx, zy: r.zy, v: r.mine })));
  const bestVs = [...cells].sort((a, b) => (b.mine - b.peer) - (a.mine - a.peer))[0];
  const maxAbs = Math.max(1e-9, ...cells.map((c) => Math.abs(c.v)));
  const s = shots.rows;
  const goals = s.filter((x) => x.goal).length, xg = s.reduce((a, x) => a + x.xg, 0);
  const neg = measure === "turnovers";

  return (
    <div className="grid">
      <div className="c12">
        <div className="filters" style={{ marginBottom: 4 }}>
          {keys.length > 1 && <Select label="Season" value={ds} onChange={setDs} options={keys} />}
          <Select label="Measure" value={mm[0]} onChange={setMeasure} options={MEASURES.map(([k, l]) => [k, l])} />
          <Field label="Show"><Seg options={[["raw", "Per 90"], ["vs", "vs position average"]]} value={mode as "raw" | "vs"} onChange={setMode} label="Show" /></Field>
        </div>
      </div>
      <div className="c8">
        <Card title={total > 0 ? `${Math.round(100 * sh.topTh[1])}% of his ${mm[1].toLowerCase()} is in the ${sh.topTh[0]}, mostly down the ${sh.topCh[0]}` : `${mm[1]} by zone`}
              sub={<>Each zone is 8.75 × 8.5 m; he attacks left to right (his right wing along the bottom).
                {mode === "raw" ? ` ${mm[1]} per 90 minutes started in each zone.` : ` Per-90 difference from the average ${pos ? POSITION_NAMES[pos]?.toLowerCase() : "player"} in this league season (${rows[0]?.n_peers ?? "–"} qualified peers): blue = more than peers, red = less.`}</>}>
          {z.error ? <div className="error">Couldn't load zones: {z.error}</div> : z.loading && !rows.length ? <div className="loading">Loading…</div> : (
            <>
              <ZoneHeat cells={cells} mode={mode === "raw" ? "seq" : "div"} max={maxAbs} fmtV={mm[2]} labelTop={4}
                        title={(c: any) => <><b>{mm[2](c.mine)}</b> per 90<div className="muted">{zoneName(c.zx, c.zy)}</div>
                          <div>peers: {mm[2](c.peer)} · {c.mine >= c.peer ? "+" : ""}{fmt.pct(c.peer > 0 ? c.mine / c.peer - 1 : 0)}</div></>} />
              <HeatLegend mode={mode === "raw" ? "seq" : "div"} lo={mode === "raw" ? "0" : `−${mm[2](maxAbs)}`} hi={mm[2](maxAbs)}
                          label={mode === "raw" ? `${mm[1]} per 90` : neg ? "more than peers is worse" : "per 90 vs peers"} />
            </>
          )}
        </Card>
      </div>
      <div className="c4">
        <div className="stack">
          <Tile label={`${mm[1]} per 90`} value={mm[2](total)} delta={`peers ${mm[2](peerTotal)} · ${fmt.signed(peerTotal > 0 ? (100 * (total / peerTotal - 1)) : 0, 0)}%`}
                tone={(total >= peerTotal) !== neg ? "up" : "down"} />
          {bestVs && total > 0 && <Tile label="Where he stands out most" value={zoneName(bestVs.zx, bestVs.zy)}
                                        delta={`${mm[2](bestVs.mine)} vs ${mm[2](bestVs.peer)} per 90 for peers`} />}
          <Card className="flat" title="By channel" sub={null}>
            {Object.entries(sh.byCh).reverse().map(([ch, v]) => (
              <div key={ch} className="row" style={{ gap: 8, marginBottom: 4 }}>
                <span className="small" style={{ width: 110 }}>{ch}</span>
                <span className="bar" style={{ flex: 1 }}><span style={{ width: `${100 * v}%` }} /></span>
                <span className="small num" style={{ width: 38, textAlign: "right" }}>{fmt.pct(v)}</span>
              </div>
            ))}
            <p className="xs muted" style={{ margin: "6px 0 0" }}>Left wing at top, as the pitch is drawn.</p>
          </Card>
        </div>
      </div>
      {prov === "wyscout" && (
        <div className="c12">
          <Card title={s.length ? `${s.length} shots, ${goals} goals from ${fmt.n(xg, 1)} xG (${fmt.signed(goals - xg, 1)})` : "Shot map"}
                sub="Every shot of the season (Wyscout public dataset, CC BY 4.0). Circle area scales with our xG; filled = goal. Hover for details.">
            {s.length ? (
              <div style={{ maxWidth: 520, margin: "0 auto" }}>
                <Pitch half label={`${name} shot map`}>
                  <ShotLayer shots={s.map((x) => ({ x: x.x, y: x.y, xg: x.xg * 0.3, goal: x.goal, side: 0 as const, label: x as any }))}
                             tipFn={(sh: any) => <><b>{sh.label.xg.toFixed(2)} xG</b>{sh.goal ? " · goal" : ""}<div className="muted">{sh.label.body}, {sh.label.situation}{sh.label.assist ? ` · ${sh.label.assist}` : ""}</div>
                               <div className="muted">{(sh.label.period === 2 ? 45 : 0) + Math.floor(sh.label.time_s / 60)}'</div></>} />
                </Pitch>
              </div>
            ) : <Empty>No shots recorded.</Empty>}
          </Card>
        </div>
      )}
    </div>
  );
}
