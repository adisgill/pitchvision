// Current-season (FotMob, 2024-25 onward) player data: the metric catalogue, radar axes per
// position, peer percentiles, the "This season" view and the shot-zone query.
import { useMemo } from "react";
import { lit, Row, useQuery } from "../../db";
import { fmt, LEAGUES, POSITION_NAMES, seasonLabel } from "../../lib/format";
import { Radar } from "../../ui/charts";
import { Card, ClubLink, DataTable, Empty, RatingBar, Seg, Select, Tile, useParam } from "../../ui/kit";
import { HeatLegend, ZoneHeat } from "../../ui/pitch";
import { Metric, zoneName, zoneShares } from "./shared";

const d2 = (v: any) => fmt.n(v, 2), d1 = (v: any) => fmt.n(v, 1), d0 = (v: any) => fmt.n(v, 0), pc = (v: any) => fmt.pct(v);

export const F_METRICS: Metric[] = [
  { key: "minutes", label: "Minutes", group: "Volume", f: d0, tier: "c" },
  { key: "npxg_p90", label: "Non-penalty xG / 90", short: "npxG/90", group: "Shooting", f: d2, tier: "c" },
  { key: "shots_p90", label: "Shots / 90", short: "Shots/90", group: "Shooting", f: d2, tier: "c" },
  { key: "box_touches_p90", label: "Touches in the opposition box / 90", short: "Box touches", group: "Shooting", f: d1, tier: "c" },
  { key: "goals_p90", label: "Goals / 90", short: "G/90", group: "Shooting", f: d2, tier: "c" },
  { key: "xa_p90", label: "Expected assists / 90", short: "xA/90", group: "Creation", f: d2, tier: "c" },
  { key: "chances_p90", label: "Chances created / 90", short: "Chances", group: "Creation", f: d2, tier: "c" },
  { key: "big_chances_p90", label: "Big chances created / 90", short: "Big chances", group: "Creation", f: d2, tier: "c" },
  { key: "assists_p90", label: "Assists / 90", short: "A/90", group: "Creation", f: d2, tier: "c" },
  { key: "final_third_passes_p90", label: "Passes into the final third / 90", short: "Final-third passes", group: "Progression", f: d1, tier: "c" },
  { key: "line_breaking_p90", label: "Line-breaking passes / 90", short: "Line-breaking", group: "Progression", f: d1, tier: "c" },
  { key: "dribbles_ok_p90", label: "Successful dribbles / 90", short: "Dribbles", group: "Progression", f: d2, tier: "c" },
  { key: "pass_pct", label: "Pass accuracy", short: "Pass %", group: "Security", f: pc, tier: "c" },
  { key: "dispossessed_p90", label: "Dispossessed / 90", short: "Dispossessed", group: "Security", higher: false, f: d2, tier: "c" },
  { key: "touches_p90", label: "Touches / 90", short: "Touches", group: "Security", f: d1, tier: "c" },
  { key: "tackles_p90", label: "Tackles / 90", short: "Tackles", group: "Defending", f: d2, tier: "c" },
  { key: "interceptions_p90", label: "Interceptions / 90", short: "Interceptions", group: "Defending", f: d2, tier: "c" },
  { key: "recoveries_p90", label: "Recoveries / 90", short: "Recoveries", group: "Defending", f: d1, tier: "c" },
  { key: "clearances_p90", label: "Clearances / 90", short: "Clearances", group: "Defending", f: d1, tier: "c" },
  { key: "dribbled_past_p90", label: "Dribbled past / 90", short: "Dribbled past", group: "Defending", higher: false, f: d2, tier: "c" },
  { key: "aerial_pct", label: "Aerial duels won", short: "Aerial %", group: "Duels", f: pc, tier: "c" },
  { key: "ground_pct", label: "Ground duels won", short: "Ground %", group: "Duels", f: pc, tier: "c" },
  { key: "aerials_won_p90", label: "Aerials won / 90", short: "Aerials won", group: "Duels", f: d2, tier: "c" },
  { key: "distance_p90", label: "Distance covered / 90 (m)", short: "Distance", group: "Physical", f: (v) => fmt.n(v, 0), tier: "c" },
  { key: "sprints_p90", label: "Sprints / 90", short: "Sprints", group: "Physical", f: d1, tier: "c" },
  { key: "top_speed", label: "Top speed (km/h)", short: "Top speed", group: "Physical", f: d1, tier: "c" },
  { key: "goals_prevented_p90", label: "Goals prevented / 90 (GK)", short: "Goals prev.", group: "Goalkeeping", f: d2, tier: "c" },
  { key: "save_pct", label: "Save percentage (GK)", short: "Save %", group: "Goalkeeping", f: pc, tier: "c" },
  { key: "rating", label: "FotMob match rating (avg)", short: "Rating", group: "Overall", f: (v) => fmt.n(v, 2), tier: "c" },
  { key: "market_value", label: "Market value (FotMob, €)", short: "Value", group: "Profile", f: fmt.eur, tier: "c" },
  { key: "age", label: "Age", group: "Profile", f: d0, tier: "c", higher: false },
  { key: "shooting_rating", label: "Shooting rating", short: "Shooting", group: "Ratings", f: d0, tier: "c" },
  { key: "creation_rating", label: "Creation rating", short: "Creation", group: "Ratings", f: d0, tier: "c" },
  { key: "progression_rating", label: "Progression rating", short: "Progression", group: "Ratings", f: d0, tier: "c" },
  { key: "security_rating", label: "Ball security rating", short: "Security", group: "Ratings", f: d0, tier: "c" },
  { key: "defending_rating", label: "Defending rating", short: "Defending", group: "Ratings", f: d0, tier: "c" },
  { key: "duels_rating", label: "Duels rating", short: "Duels", group: "Ratings", f: d0, tier: "c" },
  { key: "physical_rating", label: "Physical rating", short: "Physical", group: "Ratings", f: d0, tier: "c" },
  { key: "goalkeeping_rating", label: "Goalkeeping rating (GK)", short: "GK", group: "Ratings", f: d0, tier: "c" },
];
export const fMetric = (k: string) => F_METRICS.find((m) => m.key === k);

export const DIMS: [string, string][] = [["shooting_rating", "Shooting"], ["creation_rating", "Creation"], ["progression_rating", "Progression"],
  ["security_rating", "Ball security"], ["defending_rating", "Defending"], ["duels_rating", "Duels"], ["physical_rating", "Physical"],
  ["goalkeeping_rating", "Goalkeeping"]];

const AXES: Record<string, string[]> = {
  GK: ["goals_prevented_p90", "save_pct", "pass_pct", "line_breaking_p90", "recoveries_p90", "distance_p90"],
  CB: ["aerial_pct", "aerials_won_p90", "ground_pct", "interceptions_p90", "clearances_p90", "recoveries_p90", "dribbled_past_p90",
       "pass_pct", "line_breaking_p90", "final_third_passes_p90", "dispossessed_p90"],
  FB: ["xa_p90", "chances_p90", "final_third_passes_p90", "dribbles_ok_p90", "tackles_p90", "interceptions_p90", "ground_pct",
       "dribbled_past_p90", "distance_p90", "sprints_p90", "pass_pct"],
  DM: ["tackles_p90", "interceptions_p90", "recoveries_p90", "ground_pct", "aerial_pct", "line_breaking_p90", "final_third_passes_p90",
       "pass_pct", "dispossessed_p90", "distance_p90", "xa_p90"],
  CM: ["npxg_p90", "xa_p90", "chances_p90", "line_breaking_p90", "final_third_passes_p90", "dribbles_ok_p90", "tackles_p90",
       "recoveries_p90", "ground_pct", "pass_pct", "distance_p90"],
  AM: ["npxg_p90", "shots_p90", "xa_p90", "chances_p90", "big_chances_p90", "box_touches_p90", "dribbles_ok_p90",
       "final_third_passes_p90", "pass_pct", "dispossessed_p90", "recoveries_p90"],
  W: ["npxg_p90", "shots_p90", "box_touches_p90", "xa_p90", "chances_p90", "big_chances_p90", "dribbles_ok_p90",
      "dispossessed_p90", "sprints_p90", "recoveries_p90"],
  ST: ["npxg_p90", "goals_p90", "shots_p90", "box_touches_p90", "xa_p90", "chances_p90", "aerials_won_p90", "aerial_pct",
       "dribbles_ok_p90", "dispossessed_p90", "sprints_p90"],
};
export const fmAxes = (pos: string | undefined) => (AXES[pos ?? "CM"] ?? AXES.CM).map((k) => fMetric(k)!);

/** Percentiles of a player against qualified position peers in one FotMob league-season. */
export function useFmPercentiles(id: string, comp: string | undefined, season: number | undefined) {
  const posQ = useQuery(comp && season ? `select position_group as pos from fm_player_season where player_id = ${lit(id)}
    and competition_id = ${lit(comp)} and season = ${season} order by minutes desc limit 1` : null);
  const pos: string | undefined = posQ.rows[0]?.pos;
  const ax = fmAxes(pos);
  const cols = F_METRICS.filter((m) => m.key !== "minutes").map((m) =>
    `case when "${m.key}" is null or isnan("${m.key}"::double) then null else 100 * percent_rank() over (order by "${m.key}") end as "${m.key}__pct"`).join(", ");
  const res = useQuery(comp && season && pos ? `
    with peers as (select * from fm_player_season where competition_id = ${lit(comp)} and season = ${season}
                   and position_group = ${lit(pos)} and (qualified or player_id = ${lit(id)}))
    select *, ${cols}, count(*) over () as n_peers from peers` : null);
  const me = res.rows.find((r) => r.player_id === id);
  const pct = (m: Metric) => {
    const p = me?.[`${m.key}__pct`];
    return p == null ? null : m.higher === false ? 100 - p : p;
  };
  const vals: Record<string, number | null> = {}, raw: Record<string, string> = {};
  ax.forEach((m) => { vals[m.key] = pct(m); raw[m.key] = m.f(me?.[m.key]); });
  return { axes: ax, vals, raw, me, pos, pct, n: me?.n_peers as number | undefined, loading: res.loading || posQ.loading };
}

/** Shots / xG per 90 by zone for a player-season, and the position-peer average. */
export function fmZoneSql(id: string, comp: string, season: number) {
  const w = `competition_id = ${lit(comp)} and season = ${season}`;
  return `
    with me as (select position_group as pos, minutes from fm_player_season where player_id = ${lit(id)} and ${w} order by minutes desc limit 1),
    pa as (select player_id, minutes from fm_player_season where ${w} and qualified and position_group = (select pos from me)),
    mine as (select zx, zy, sum(shots) as s, sum(xg) as x, sum(goals) as g, sum(xgot) as xo from fm_zones_player where player_id = ${lit(id)} and ${w} group by all),
    peer as (select z.zx, z.zy, sum(z.shots) as s, sum(z.xg) as x from fm_zones_player z join pa using (player_id)
             where z.competition_id = ${lit(comp)} and z.season = ${season} group by all),
    g as (select gx::int as zx, gy::int as zy from range(12) t1(gx), range(8) t2(gy))
    select g.zx, g.zy, coalesce(mine.s, 0) as shots, coalesce(mine.x, 0) as xg, coalesce(mine.g, 0) as goals, coalesce(mine.xo, 0) as xgot,
           coalesce(mine.s, 0) * 90 / (select minutes from me) as shots90, coalesce(mine.x, 0) * 90 / (select minutes from me) as xg90,
           coalesce(peer.s, 0) * 90 / (select sum(minutes) from pa) as pshots90, coalesce(peer.x, 0) * 90 / (select sum(minutes) from pa) as pxg90,
           (select count(*) from pa) as n_peers
    from g left join mine using (zx, zy) left join peer using (zx, zy) order by zx, zy`;
}

export const fmSeasonLabel = (r: Row) => `${seasonLabel(r.season, r.competition_id)} ${LEAGUES[r.competition_id] ?? r.competition_id}`;

/** The "This season" view: the most recent FotMob season first. */
export function FmSeason({ id, seasons, name }: { id: string; seasons: Row[]; name: string }) {
  const keys: [string, string][] = seasons.map((r) => [`${r.competition_id}:${r.season}`, `${fmSeasonLabel(r)} · ${r.club ?? ""}`]);
  const [sk, setSk] = useParam("fs", keys[0]?.[0] ?? "");
  const key = keys.some(([k]) => k === sk) ? sk : keys[0]?.[0];
  const [comp, seasonS] = (key ?? ":").split(":");
  const season = Number(seasonS);
  const pr = useFmPercentiles(id, comp, season);
  const [zm, setZm] = useParam("zm", "xg");
  const [zmode, setZmode] = useParam("zmode", "raw");
  const z = useQuery(key ? fmZoneSql(id, comp, season) : null);
  const me = pr.me ?? seasons.find((r) => `${r.competition_id}:${r.season}` === key);
  const isGK = pr.pos === "GK";

  const groups = useMemo(() => {
    const order = ["Shooting", "Creation", "Progression", "Security", "Defending", "Duels", "Physical", ...(isGK ? ["Goalkeeping"] : [])];
    return order.map((g) => ({ g, ms: F_METRICS.filter((m) => m.group === g && (isGK || m.group !== "Goalkeeping")) }));
  }, [isGK]);

  if (!key || !me) return <Empty>No current-season (FotMob) data for this player yet.</Empty>;
  const zr = z.rows;
  const raw = (r: Row) => (zm === "xg" ? r.xg90 : zm === "shots" ? r.shots90 : r.shots ? r.xg / r.shots : 0);
  const peer = (r: Row) => (zm === "xg" ? r.pxg90 : zm === "shots" ? r.pshots90 : r.pshots90 ? r.pxg90 / r.pshots90 : 0);
  const cells = zr.filter((r) => zm !== "xgps" || r.shots > 0).map((r) => ({ zx: r.zx, zy: r.zy, v: zmode === "raw" ? raw(r) : raw(r) - peer(r), r }));
  const maxAbs = Math.max(1e-9, ...cells.map((c) => Math.abs(c.v)));
  const totShots = zr.reduce((a, r) => a + r.shots, 0), totXg = zr.reduce((a, r) => a + r.xg, 0), totG = zr.reduce((a, r) => a + r.goals, 0);
  const totXgot = zr.reduce((a, r) => a + (r.xgot ?? 0), 0);
  const sh = zoneShares(zr.map((r) => ({ zx: r.zx, zy: r.zy, v: r.xg })));
  const strongest = pr.axes.filter((m) => pr.vals[m.key] != null).sort((a, b) => (pr.vals[b.key] ?? 0) - (pr.vals[a.key] ?? 0));
  const zf = (v: number) => (zm === "xgps" ? fmt.n(v, 2) : fmt.n(v, 3));
  const zLabel = zm === "xg" ? "xG per 90" : zm === "shots" ? "Shots per 90" : "xG per shot";

  return (
    <div className="grid">
      <div className="c12">
        <div className="filters" style={{ marginBottom: 4 }}>
          {keys.length > 1 && <Select label="Season" value={key} onChange={setSk} options={keys} />}
          <span className="small muted" style={{ alignSelf: "center" }}>
            Source: FotMob (Opta) match stats. {me.club_id && me.club ? <>Club <ClubLink id={me.club_id} name={me.club} /> · </> : null}
            {pr.pos ? POSITION_NAMES[pr.pos] : me.position_group} (position from the line-up layout)
          </span>
        </div>
      </div>
      <div className="c12">
        <div className="tiles">
          <Tile label="Minutes" value={fmt.n(me.minutes)} delta={`${fmt.n(me.apps)} apps · ${fmt.n(me.starts)} starts`} />
          <Tile label="Goals · assists" value={`${fmt.n(me.goals)} · ${fmt.n(me.assists)}`} delta={`npxG ${fmt.n(me.npxg, 1)} · xA ${fmt.n(me.xa, 1)}`} />
          <Tile label="npxG + xA per 90" value={fmt.n((me.npxg_p90 ?? 0) + (me.xa_p90 ?? 0), 2)} delta={`${fmt.n(me.npxg_p90, 2)} + ${fmt.n(me.xa_p90, 2)}`} />
          <Tile label="FotMob rating (avg)" value={fmt.n(me.rating, 2)} />
          <Tile label="Distance per 90" value={`${fmt.n((me.distance_p90 ?? 0) / 1000, 1)} km`} delta={`${fmt.n(me.sprints_p90, 1)} sprints / 90`} />
          <Tile label="Top speed" value={me.top_speed ? `${fmt.n(me.top_speed, 1)} km/h` : "–"} />
          <Tile label="Market value (FotMob)" value={fmt.eur(me.market_value)} delta={me.age ? `age ${me.age}` : undefined} />
        </div>
      </div>
      <div className="c6">
        <Card title={strongest.length ? `Best at: ${strongest.slice(0, 2).map((m) => (m.short ?? m.label).toLowerCase()).join(" and ")}` : "Percentiles vs peers"}
              sub={<>Percentile against {pr.n ? `${pr.n} ` : ""}{pr.pos ? POSITION_NAMES[pr.pos]?.toLowerCase() + "s" : "players"} in {fmSeasonLabel(me)}
                (qualified minutes; 50 = the median ring; lower-is-better measures flipped so outward is always better).</>}>
          {pr.loading && !pr.me ? <div className="loading">Loading…</div>
            : <Radar axes={pr.axes.map((m) => ({ key: m.key, label: m.short ?? m.label }))} series={[{ name: name, color: "var(--s1)", values: pr.vals, raw: pr.raw }]} />}
        </Card>
      </div>
      <div className="c6 stack" style={{ gap: 16 }}>
        <Card title="Dimension ratings" sub="50 = position average in this league-season, 10 points = one standard deviation; small samples shrunk toward 50.">
          <table className="data"><tbody>
            {DIMS.filter(([k]) => me[k] != null).map(([k, l]) => <tr key={k}><td>{l}</td><td className="r"><RatingBar v={me[k]} width={140} /></td></tr>)}
          </tbody></table>
        </Card>
        <Card title={totShots ? `${fmt.n(totShots)} shots, ${fmt.n(totG)} goals from ${fmt.n(totXg, 1)} xG (${fmt.signed(totG - totXg, 1)})` : "Shot quality"}
              sub={totShots ? `${Math.round(100 * sh.topTh[1])}% of his xG comes from the ${sh.topTh[0]}, mostly the ${sh.topCh[0]}.` : "No shots this season."}>
          {totShots > 0 && <p className="small ink2" style={{ margin: 0 }}>xG per shot {fmt.n(totXg / totShots, 2)} · xG on target (xGOT) {fmt.n(totXgot, 1)}
            {me.big_chances_missed != null ? ` · ${fmt.n(me.big_chances_missed)} big chances missed` : ""}</p>}
        </Card>
      </div>
      <div className="c7">
        <Card title={`Where he shoots from: ${zLabel.toLowerCase()}`}
              sub={<>8.75 × 8.5 m zones, attacking left to right. {zmode === "raw" ? "Raw per-90 values." : `Difference from the average ${pr.pos ? POSITION_NAMES[pr.pos]?.toLowerCase() : "player"} (${zr[0]?.n_peers ?? "–"} qualified peers): blue = more, red = less.`}</>}
              right={<div className="row" style={{ gap: 6 }}>
                <Seg options={[["xg", "xG"], ["shots", "Shots"], ["xgps", "xG/shot"]]} value={zm as any} onChange={setZm} label="Measure" />
                <Seg options={[["raw", "Raw"], ["vs", "vs peers"]]} value={zmode as any} onChange={setZmode} label="Mode" />
              </div>}>
          {z.loading && !zr.length ? <div className="loading">Loading…</div> : totShots === 0 ? <Empty>No shots recorded this season.</Empty> : (
            <>
              <ZoneHeat cells={cells} mode={zmode === "raw" ? "seq" : "div"} max={maxAbs} fmtV={zf} labelTop={4}
                        title={(c: any) => <><b>{zf(c.v)}</b> {zmode === "raw" ? zLabel : "vs peers"}<div className="muted">{zoneName(c.zx, c.zy)}</div>
                          <div>{fmt.n(c.r.shots)} shots · {fmt.n(c.r.goals)} goals · {fmt.n(c.r.xg, 2)} xG</div></>} />
              <HeatLegend mode={zmode === "raw" ? "seq" : "div"} lo={zmode === "raw" ? "0" : `−${zf(maxAbs)}`} hi={zf(maxAbs)} label={zLabel} />
            </>
          )}
        </Card>
      </div>
      <div className="c5">
        <Card title="Per 90, with percentile vs peers" sub="Grouped by dimension; percentiles within position in this league-season (100 = best).">
          <div className="table-wrap" style={{ maxHeight: 560 }}>
            <table className="data">
              <tbody>
                {groups.map(({ g, ms }) => [
                  <tr key={g}><td colSpan={3} className="eyebrow" style={{ paddingTop: 10 }}>{g}</td></tr>,
                  ...ms.map((m) => {
                    const p = pr.pct(m);
                    return (
                      <tr key={m.key}><td className="small">{m.label}</td><td className="r">{m.f(me[m.key])}</td>
                        <td className="r" style={{ width: 90 }}>{p == null ? <span className="muted">–</span> :
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span className="num small" style={{ width: 22, textAlign: "right" }}>{Math.round(p)}</span>
                            <span className="bar" style={{ width: 50, minWidth: 50 }}><span style={{ width: `${p}%`, background: p >= 50 ? "var(--pos)" : "var(--neg)" }} /></span></span>}</td></tr>
                    );
                  }),
                ])}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
      {seasons.length > 0 && (
        <div className="c12">
          <Card title="Current-era seasons (FotMob)" sub="Every FotMob season on record (2024-25 onward), all leagues we cover.">
            <DataTable rows={seasons} initialSort={{ key: "season", desc: true }} cols={[
              { key: "season", label: "Season", fmt: (v, r) => seasonLabel(v, r.competition_id) },
              { key: "competition_id", label: "League", fmt: (v) => LEAGUES[v] ?? v },
              { key: "club", label: "Club", fmt: (v, r) => (r.club_id ? <ClubLink id={r.club_id} name={v ?? r.club_id} /> : "–") },
              { key: "position_group", label: "Pos" },
              { key: "minutes", label: "Min", num: true, fmt: (v) => fmt.n(v) },
              { key: "goals", label: "G", num: true, fmt: (v) => fmt.n(v) },
              { key: "assists", label: "A", num: true, fmt: (v) => fmt.n(v) },
              { key: "npxg_p90", label: "npxG/90", num: true, fmt: (v) => fmt.n(v, 2) },
              { key: "xa_p90", label: "xA/90", num: true, fmt: (v) => fmt.n(v, 2) },
              { key: "rating", label: "Rating", num: true, fmt: (v) => fmt.n(v, 2) },
              ...DIMS.slice(0, 7).map(([k, l]) => ({ key: k, label: l, fmt: (v: any) => <RatingBar v={v} width={50} /> })),
            ]} />
          </Card>
        </div>
      )}
      <div className="c12"><p className="xs muted">Stats per FotMob (Opta-derived match data) for {name}; physical metrics are FotMob's tracking figures.</p></div>
    </div>
  );
}
