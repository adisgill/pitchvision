import * as Plot from "@observablehq/plot";
import { useMemo } from "react";
import { lit, Row, useQuery } from "../../db";
import { ageOn, css, fmt, POSITION_NAMES, seasonLabel } from "../../lib/format";
import { Figure } from "../../ui/Figure";
import { Card, DataTable, Empty, Field, PlayerLink, RatingBar, SeasonSelect, Seg, Tile, useParam } from "../../ui/kit";

/** The squad: current seasons from FotMob first, Transfermarkt history after. */
export default function Squad({ id, name }: { id: string; name: string }) {
  const fs = useQuery(`select distinct competition_id, season from fm_player_season where club_id = ${lit(id)} order by season desc`);
  const [src, setSrc] = useParam("sqsrc", "");
  const source = src || (fs.rows.length ? "current" : fs.loading ? "" : "history");
  if (!source) return <div className="loading">Loading…</div>;
  return (
    <>
      {fs.rows.length > 0 && (
        <div className="filters" style={{ marginTop: 0 }}>
          <Field label="Data">
            <Seg options={[["current", "Current (FotMob)"], ["history", "History (Transfermarkt)"]]} value={source as "current" | "history"}
                 onChange={(v) => setSrc(v)} label="Squad data" />
          </Field>
        </div>
      )}
      {source === "current" && fs.rows.length ? <SquadFm id={id} name={name} seasons={fs.rows} /> : <SquadTm id={id} name={name} />}
    </>
  );
}

const FM_RATINGS: [string, string][] = [["shooting_rating", "Shooting"], ["creation_rating", "Creation"], ["progression_rating", "Progression"],
  ["defending_rating", "Defending"], ["duels_rating", "Duels"], ["physical_rating", "Physical"]];

function SquadFm({ id, name, seasons }: { id: string; name: string; seasons: Row[] }) {
  const keys = seasons.map((r) => `${r.competition_id}:${r.season}`);
  const [kP, setK] = useParam("fsq", "");
  const key = keys.includes(kP) ? kP : keys[0];
  const [comp, seasonS] = key.split(":");
  const season = Number(seasonS);
  const sq = useQuery(`
    select f.*, coalesce(p.name, fp.name) as name,
           f.minutes / nullif(90.0 * (select max(matches) from fm_zones_team z where z.club_id = ${lit(id)} and z.competition_id = ${lit(comp)} and z.season = ${season}), 0) as minutes_share
    from fm_player_season f left join players p using (player_id) left join fm_players fp using (player_id)
    where f.club_id = ${lit(id)} and f.competition_id = ${lit(comp)} and f.season = ${season} order by f.minutes desc`);
  const rows = sq.rows;
  const plot = useMemo(() => {
    const d = rows.filter((r) => r.age != null && r.minutes_share != null);
    if (!d.length) return undefined;
    const labelled = [...d].sort((a, b) => b.minutes - a.minutes).slice(0, 8);
    return (width: number) => ({
      width, height: 340, marginLeft: 46, x: { label: "Age →", domain: [16, 38] },
      y: { label: "↑ Share of league minutes so far", domain: [0, 1], tickFormat: "%", grid: true },
      marks: [
        Plot.rectX([0], { x1: 24, x2: 28, y1: 0, y2: 1, fill: css("--s3"), fillOpacity: 0.12 }),
        Plot.text([0], { x: 26, y: 0.98, text: () => "typical peak years", fill: css("--text-2"), fontSize: 10.5 }),
        Plot.dot(d, { x: "age", y: (r: any) => Math.min(1, r.minutes_share), r: 5.5, fill: css("--s1"), fillOpacity: 0.85, stroke: css("--surface"), strokeWidth: 2 }),
        Plot.text(labelled, { x: "age", y: (r: any) => Math.min(1, r.minutes_share), text: (r: any) => (r.name ?? "").split(" ").slice(-1)[0], dy: -11, fill: css("--text"), fontSize: 10.5 }),
        Plot.tip(d, Plot.pointer({ x: "age", y: (r: any) => Math.min(1, r.minutes_share), title: (r: any) =>
          `${r.name} (${r.position_group})
age ${r.age} · ${fmt.pct(Math.min(1, r.minutes_share))} of minutes, ${fmt.n(r.minutes)} min
FotMob rating ${fmt.n(r.rating, 2)}` })),
      ],
    });
  }, [rows]);
  if (!sq.loading && !rows.length) return <Empty>No current-season data for {name} yet.</Empty>;
  const value = rows.reduce((a, r) => a + (r.market_value ?? 0), 0);
  const wAge = rows.reduce((a, r) => a + (r.age ?? 0) * r.minutes, 0) / Math.max(1, rows.reduce((a, r) => a + (r.age != null ? r.minutes : 0), 0));
  const topRated = [...rows].filter((r) => r.minutes >= 270).sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))[0];
  return (
    <div className="grid">
      <div className="c12">
        <div className="tiles">
          <Tile label="Players used" value={rows.length} delta={`${seasonLabel(season, comp)} so far`} />
          <Tile label="Minutes-weighted age" value={fmt.n(wAge, 1)} />
          {value > 0 && <Tile label="Squad value (FotMob, current)" value={fmt.eur(value)} />}
          {topRated && <Tile label="Highest FotMob rating (270+ min)" value={(topRated.name ?? "").split(" ").slice(-1)[0]} delta={fmt.n(topRated.rating, 2)} />}
        </div>
      </div>
      {keys.length > 1 && (
        <div className="c12"><div className="filters" style={{ margin: 0 }}>
          <SeasonSelect value={season} onChange={(v) => setK(`${seasons.find((r) => r.season === v)?.competition_id ?? comp}:${v}`)} seasons={seasons.map((r) => r.season)} comp={comp} />
        </div></div>
      )}
      <div className="c5">
        {plot && <Figure title={`${name}'s age profile, ${seasonLabel(season, comp)}`}
                         subtitle="Each player's age against his share of league minutes so far this season. Shaded: the ages where minutes typically peak."
                         source="FotMob" plot={plot} alt="Current squad age profile"
                         table={{ rows, cols: [["name", "Player"], ["position_group", "Pos"], ["age", "Age"], ["minutes", "Minutes", (v) => fmt.n(v)]] }} />}
      </div>
      <div className="c7">
        <Card title="Current squad" sub="FotMob (Opta) match data. Ratings: 50 = position average in the league season, 10 points = one standard deviation, shrunk for small samples. Positions from line-up layouts.">
          <DataTable rows={rows} initialSort={{ key: "minutes", desc: true }} maxHeight={560} cols={[
            { key: "name", label: "Player", fmt: (v, r) => <PlayerLink id={r.player_id} name={v ?? r.player_id} /> },
            { key: "position_group", label: "Pos" },
            { key: "age", label: "Age", num: true },
            { key: "minutes", label: "Min", num: true, fmt: (v) => fmt.n(v) },
            { key: "goals", label: "G", num: true, fmt: (v) => fmt.n(v) },
            { key: "assists", label: "A", num: true, fmt: (v) => fmt.n(v) },
            { key: "npxg_p90", label: "npxG/90", num: true, fmt: (v) => fmt.n(v, 2) },
            { key: "xa_p90", label: "xA/90", num: true, fmt: (v) => fmt.n(v, 2) },
            { key: "rating", label: "Rating", num: true, fmt: (v) => fmt.n(v, 2), heat: "pos" },
            ...FM_RATINGS.map(([k, l]) => ({ key: k, label: l, fmt: (v: any) => <RatingBar v={v} width={44} /> })),
            { key: "market_value", label: "Value", num: true, fmt: (v) => fmt.eur(v) },
          ]} />
        </Card>
      </div>
    </div>
  );
}

function SquadTm({ id, name }: { id: string; name: string }) {
  const seasonsQ = useQuery(`select distinct season from players_c where club_id = ${lit(id)} order by season desc`);
  const seasons = seasonsQ.rows.map((r) => r.season as number);
  const [sP, setS] = useParam("sq", "");
  const season = Number(sP || seasons[0] || 2025);
  const latest = season === seasons[0];
  const sq = useQuery(seasons.length ? `
    select c.*, p.name, p.date_of_birth, p.nationality, p.contract_expiration_date, p.current_club_id, r.rapm, r.prior_dominated, mk.value_eur
    from players_c c join players p using (player_id)
    left join rapm r on r.player_id = c.player_id and r.season = c.season
    left join market mk on mk.player_id = c.player_id and mk.season = c.season
    where c.club_id = ${lit(id)} and c.season = ${season} order by c.minutes desc` : null);
  const peaks = useQuery(`select "group", peak_lo, peak_hi, peak_age from age_curves where kind = 'summary' and metric = 'minutes_share' and peak_lo is not null`);
  const mid = new Date(Date.UTC(season + 1, 0, 1));
  const rows: Row[] = useMemo(() => sq.rows.map((r) => ({ ...r, age: ageOn(r.date_of_birth, mid) })), [sq.rows, season]);
  const peak = Object.fromEntries(peaks.rows.map((p) => [p.group, p]));
  const band = peaks.rows.length ? [Math.min(...peaks.rows.map((p) => p.peak_lo)), Math.max(...peaks.rows.map((p) => p.peak_hi))] : [23, 26];
  const coreLo = peaks.rows.length ? peaks.rows.map((p) => p.peak_lo).sort((a, b) => a - b)[Math.floor(peaks.rows.length / 2)] : 23;
  const coreHi = peaks.rows.length ? peaks.rows.map((p) => p.peak_hi).sort((a, b) => a - b)[Math.floor(peaks.rows.length / 2)] : 26;

  const plot = useMemo(() => {
    const d = rows.filter((r) => r.age != null && r.minutes_share != null);
    if (!d.length) return undefined;
    const labelled = [...d].sort((a, b) => b.minutes - a.minutes).slice(0, 8);
    return (width: number) => ({
      width, height: 340, marginLeft: 46, x: { label: "Age at mid-season →", domain: [16, 38] },
      y: { label: "↑ Share of league minutes", domain: [0, 1], tickFormat: "%", grid: true },
      marks: [
        Plot.rectX([0], { x1: coreLo, x2: coreHi + 1, y1: 0, y2: 1, fill: css("--s3"), fillOpacity: 0.12 }),
        Plot.text([0], { x: (coreLo + coreHi + 1) / 2, y: 0.98, text: () => "typical peak years", fill: css("--text-2"), fontSize: 10.5 }),
        Plot.dot(d, { x: "age", y: "minutes_share", r: 5.5, fill: css("--s1"), fillOpacity: 0.85, stroke: css("--surface"), strokeWidth: 2 }),
        Plot.text(labelled, { x: "age", y: "minutes_share", text: (r: any) => r.name.split(" ").slice(-1)[0], dy: -11, fill: css("--text"), fontSize: 10.5 }),
        Plot.tip(d, Plot.pointer({ x: "age", y: "minutes_share", title: (r: any) => {
          const pk = peak[r.position_group];
          return `${r.name} (${r.position_group})\nage ${r.age} · ${fmt.pct(r.minutes_share)} of minutes, ${fmt.n(r.minutes)} min${pk ? `\n${POSITION_NAMES[r.position_group] ?? r.position_group}s peak around ${fmt.n(pk.peak_lo)}–${fmt.n(pk.peak_hi)}` : ""}`;
        } })),
      ],
    });
  }, [rows, coreLo, coreHi]);

  if (!seasonsQ.loading && !seasons.length) return <Empty>No player data for {name}: player tables cover the top-seven leagues from 2012-13 to 2025-26.</Empty>;
  const used = rows.length;
  const value = rows.reduce((a, r) => a + (r.value_eur ?? 0), 0);
  const wAge = rows.reduce((a, r) => a + (r.age ?? 0) * r.minutes, 0) / Math.max(1, rows.reduce((a, r) => a + (r.age != null ? r.minutes : 0), 0));
  const inPeak = rows.filter((r) => r.age != null && r.age >= coreLo && r.age <= coreHi).reduce((a, r) => a + r.minutes, 0) / Math.max(1, rows.reduce((a, r) => a + r.minutes, 0));
  return (
    <div className="grid">
      <div className="c12 row between">
        <div className="tiles" style={{ flex: 1 }}>
          <Tile label="Players used" value={used} />
          <Tile label="Minutes-weighted age" value={fmt.n(wAge, 1)} />
          <Tile label="Minutes from players in their peak years" value={fmt.pct(inPeak)} delta={`ages ${coreLo}–${coreHi}`} />
          {value > 0 && <Tile label="Squad value (Transfermarkt, end of season)" value={fmt.eur(value)} />}
        </div>
      </div>
      <div className="c12"><div className="filters" style={{ margin: 0 }}>{seasons.length > 0 && <SeasonSelect value={season} onChange={(v) => setS(String(v))} seasons={seasons} />}</div></div>
      <div className="c5">
        {plot && <Figure title={`${name}'s age profile, ${seasonLabel(season)}`}
                         subtitle={`Each player's age against his share of league minutes. Shaded: the ages where minutes typically peak (${band[0]}–${band[1]} across positions, ${coreLo}–${coreHi} for most). A squad living right of the band is getting old.`}
                         source="Transfermarkt" plot={plot} alt="Squad age profile"
                         table={{ rows, cols: [["name", "Player"], ["position_group", "Pos"], ["age", "Age"], ["minutes_share", "Minutes share", (v) => fmt.pct(v)]] }} />}
      </div>
      <div className="c7">
        <Card title="Squad" sub={`Ratings: 50 = position average in the league season, 10 points = one standard deviation (shrunk for small samples). RAPM: on-pitch goal difference per 90 adjusted for team-mates and opponents; "prior" = mostly the box-score prior.${latest ? " Contract: current Transfermarkt expiry." : ""}`}>
          <DataTable rows={rows} initialSort={{ key: "minutes", desc: true }} maxHeight={560} cols={[
            { key: "name", label: "Player", fmt: (v, r) => <PlayerLink id={r.player_id} name={v} /> },
            { key: "position_group", label: "Pos" },
            { key: "age", label: "Age", num: true },
            { key: "minutes", label: "Min", num: true, fmt: (v) => fmt.n(v) },
            { key: "goals", label: "G", num: true, fmt: (v) => fmt.n(v) },
            { key: "assists", label: "A", num: true, fmt: (v) => fmt.n(v) },
            { key: "scoring_rating", label: "Scoring", fmt: (v) => <RatingBar v={v} width={50} /> },
            { key: "creation_rating", label: "Creation", fmt: (v) => <RatingBar v={v} width={50} /> },
            { key: "rapm", label: "RAPM", num: true, fmt: (v, r) => v == null ? "–" : <>{fmt.signed(v)}{r.prior_dominated ? <span className="pill" style={{ marginLeft: 4 }}>prior</span> : null}</> },
            { key: "value_eur", label: "Value", num: true, fmt: (v) => fmt.eur(v) },
            ...(latest ? [{ key: "contract_expiration_date", label: "Contract", fmt: (v: any, r: Row) => (r.current_club_id === id && v ? fmt.date(v).slice(0, 7) : "–") }] : []),
          ]} />
        </Card>
      </div>
    </div>
  );
}
