import * as Plot from "@observablehq/plot";
import { ReactNode, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Row, useQuery } from "../db";
import { css, fmt, LEAGUES, POSITION_NAMES, POSITIONS, seasonLabel, slot } from "../lib/format";
import { Radar } from "../ui/charts";
import { Figure } from "../ui/Figure";
import {
  Card, ClubLink, Col, DataTable, Empty, EntityPicker, Field, Loading, PageHead, PlayerLink, RatingBar, Select, Tabs, Tile, useParam,
} from "../ui/kit";
import { DIMS, fmAxes } from "./player/fotmob";
import {
  addZ, composite, download, loadShortlist, METRIC_KEYS, peakLabel, phi, saveShortlist, sharedStrengths, ShortItem, similarity, toCsv, valueFit,
} from "./recruit/model";

const ALL_LEAGUES = ["GB1", "ES1", "L1", "IT1", "FR1", "NL1", "PO1", "GB2", "MLS1"];
const keyOf = (r: Row) => `${r.player_id}|${r.competition_id}|${r.season}`;
const num = (v: string, d: number) => (v === "" || Number.isNaN(Number(v)) ? d : Number(v));

export default function Recruit() {
  const nav = useNavigate();
  const [tab, setTab] = useParam("tab", "find");
  const [target, setTarget] = useParam("t", "tm-418560");
  const [tSeason, setTSeason] = useParam("ts", "");
  const [pos, setPos] = useParam("pos", "");
  const [amin, setAmin] = useParam("amin", "16");
  const [amax, setAmax] = useParam("amax", "40");
  const [vmax, setVmax] = useParam("vmax", "");
  const [minMin, setMinMin] = useParam("min", "900");
  const [share, setShare] = useParam("share", "0");
  const [lg, setLg] = useParam("lg", ALL_LEAGUES.join(","));
  const [exp, setExp] = useParam("exp", "");
  const [foot, setFoot] = useParam("foot", "");
  const [hmin, setHmin] = useParam("hmin", "");
  const [inj, setInj] = useParam("inj", "0");
  const [pool, setPool] = useParam("pool", "latest");
  const [adj, setAdj] = useParam("adj", "0");
  const [picked, setPicked] = useState<string | null>(null);
  const [short, setShort] = useState<ShortItem[]>(() => loadShortlist());
  useEffect(() => saveShortlist(short), [short]);

  const cols = METRIC_KEYS.map((k) => `f.${k}`).join(", ");
  const data = useQuery(`
    select f.player_id, f.competition_id, f.season, f.club_id, f.position_group, f.minutes, f.apps, f.starts, f.age, f.qualified,
           coalesce(f.market_value, p.market_value_in_eur) as value, ${cols},
           coalesce(p.name, q.name) as pname, p.foot, p.height_in_cm, p.contract_expiration_date as contract,
           coalesce(p.nationality, q.country) as nat, c.name as club_name
    from fm_player_season f left join players p on p.player_id = f.player_id
    left join fm_players q on q.player_id = f.player_id left join clubs c on c.club_id = f.club_id`);
  const lt = useQuery(`select league, goals_multiplier_vs_pl from league_translation`);
  const peaks = useQuery(`select "group" as grp, max(peak_lo) as lo, max(peak_hi) as hi from age_curves
                          where kind = 'summary' and metric = 'minutes_share' group by 1`);
  const avail = useQuery(`
    with mx as (select max(kickoff_utc) as m from fm_unavailable)
    select player_id,
           count(distinct match_id) filter (where type = 'injury' and kickoff_utc >= (select m from mx) - interval 365 day) as missed_12m,
           max(kickoff_utc) filter (where type = 'injury') as last_inj,
           arg_max(expected_return, kickoff_utc) filter (where type = 'injury') as exp_ret
    from fm_unavailable group by player_id`);
  const clubLast = useQuery(`select club, max(k) as last_match from (
      select home_club as club, kickoff_utc as k from fixtures where finished
      union all select away_club, kickoff_utc from fixtures where finished) group by club`);

  const factor = useMemo(() => Object.fromEntries(lt.rows.map((r) => [r.league, 1 / r.goals_multiplier_vs_pl])), [lt.rows]);
  const peakBy = useMemo(() => Object.fromEntries(peaks.rows.map((r) => [r.grp, { lo: r.lo, hi: r.hi }])), [peaks.rows]);

  // enrich every player-season once per mode
  const rows = useMemo(() => {
    if (!data.rows.length) return [] as Row[];
    const rs = data.rows.map((r) => ({ ...r }));
    addZ(rs, factor, adj === "1");
    const teamMax = new Map<string, number>();
    rs.forEach((r) => { const k = `${r.club_id}|${r.season}`; teamMax.set(k, Math.max(teamMax.get(k) ?? 0, r.minutes)); });
    const av = new Map(avail.rows.map((a) => [a.player_id, a]));
    const cl = new Map(clubLast.rows.map((c) => [c.club, c.last_match]));
    rs.forEach((r) => {
      r.composite = composite(r);
      r.share = r.minutes / (teamMax.get(`${r.club_id}|${r.season}`) || 1);
      const a = av.get(r.player_id);
      r.missed_12m = a?.missed_12m ?? 0;
      const last = cl.get(r.club_id);
      r.injured_now = !!(a?.last_inj && last && Math.abs(+new Date(a.last_inj) - +new Date(last)) < 36e5 * 36);
      r.exp_ret = r.injured_now ? a?.exp_ret : null;
      r.peak = peakLabel(r.age, peakBy[r.position_group]);
    });
    return rs;
  }, [data.rows, factor, adj, avail.rows, clubLast.rows, peakBy]);

  const minM = num(minMin, 900);
  const pooled = useMemo(() => {
    if (pool !== "latest") return rows.filter((r) => String(r.season) === pool);
    const best = new Map<string, Row>();
    rows.filter((r) => r.minutes >= minM).forEach((r) => {
      const b = best.get(r.player_id);
      if (!b || r.season > b.season || (r.season === b.season && r.minutes > b.minutes)) best.set(r.player_id, r);
    });
    return [...best.values()];
  }, [rows, pool, minM]);

  const leagues = new Set(lg.split(",").filter(Boolean));
  const expDate = exp ? new Date(exp) : null;
  const filtered = useMemo(() => pooled.filter((r) =>
    leagues.has(r.competition_id) && r.minutes >= minM && r.share >= num(share, 0) / 100
    && (r.age == null || (r.age >= num(amin, 0) && r.age <= num(amax, 99)))
    && (!vmax || (r.value ?? Infinity) <= num(vmax, 1e9) * 1e6)
    && (!expDate || (r.contract && new Date(r.contract) <= expDate))
    && (!foot || r.foot === foot) && (!hmin || (r.height_in_cm ?? 0) >= num(hmin, 0))
    && (inj !== "1" || !r.injured_now)), [pooled, lg, minM, share, amin, amax, vmax, exp, foot, hmin, inj]);

  // target
  const tRows = rows.filter((r) => r.player_id === target).sort((a, b) => b.season - a.season || b.minutes - a.minutes);
  const tRow = tRows.find((r) => `${r.competition_id}|${r.season}` === tSeason) ?? tRows.find((r) => r.minutes >= 450) ?? tRows[0];
  const tPos = tRow?.position_group;
  const matchPos = pos || tPos;

  const similar = useMemo(() => {
    if (!tRow) return [] as Row[];
    return filtered.filter((r) => r.player_id !== target && (!matchPos || matchPos === "all" || r.position_group === matchPos))
      .map((r): Row => ({ ...r, sim: similarity(tRow, r, tPos), shared: sharedStrengths(tRow, r, tPos) }))
      .filter((r) => r.sim != null).sort((a, b) => b.sim - a.sim).slice(0, 60);
  }, [filtered, tRow, matchPos]);

  const valued = useMemo(() => {
    const rs = filtered.filter((r) => r.qualified && (!pos || pos === "all" || r.position_group === pos)).map((r) => ({ ...r }));
    valueFit(rs);
    return rs.filter((r) => r.value_resid != null);
  }, [filtered, pos]);

  const inList = (r: Row) => short.some((s) => s.id === r.player_id && s.season === r.season && s.comp === r.competition_id);
  const toggle = (r: Row) => setShort((s) => (inList(r) ? s.filter((x) => !(x.id === r.player_id && x.season === r.season && x.comp === r.competition_id))
    : [...s, { id: r.player_id, season: r.season, comp: r.competition_id }]));
  const listed = short.map((s) => rows.find((r) => r.player_id === s.id && r.season === s.season && r.competition_id === s.comp)).filter(Boolean) as Row[];

  const pickedRow: Row | undefined = similar.find((r) => keyOf(r) === picked) ?? similar[0];
  const loading = data.loading && !data.rows.length;

  const common = (extra: Col[] = []): Col[] => [
    { key: "pname", label: "Player", fmt: (v, r) => <PlayerLink id={r.player_id} name={v ?? r.player_id} /> },
    { key: "club_name", label: "Club", fmt: (v, r) => (r.club_id ? <ClubLink id={r.club_id} name={v ?? r.club_id} /> : "–") },
    { key: "competition_id", label: "League", fmt: (v, r) => <span title={LEAGUES[v]}>{v} {String(r.season).slice(2)}</span> },
    { key: "position_group", label: "Pos" },
    { key: "age", label: "Age", num: true, fmt: (v, r) => <>{fmt.n(v)} {r.peak && <span className={`pill ${r.peak.tone === "up" ? "good" : r.peak.tone === "down" ? "bad" : ""}`}>{r.peak.label}</span>}</> },
    ...extra,
    { key: "minutes", label: "Min", num: true, fmt: (v, r) => <>{fmt.n(v)} <span className="xs muted">{fmt.pct(r.share)}</span></> },
    { key: "composite", label: "Composite", fmt: (v) => <RatingBar v={v} width={56} />, title: "Mean of the position's key dimension ratings (50 = position average)" },
    { key: "value", label: "Value", num: true, fmt: (v) => fmt.eur(v) },
    { key: "contract", label: "Contract", fmt: (v) => (v ? fmt.date(v).slice(0, 7) : "–") },
    { key: "missed_12m", label: "Inj. 12m", num: true, title: "Matches missed injured in the last 12 months (FotMob absence lists)",
      fmt: (v, r) => <>{v ? fmt.n(v) : "0"}{r.injured_now && <span className="pill bad" title={r.exp_ret ?? ""}>out</span>}</> },
    { key: "_list", label: "", sortable: false, fmt: (_v, r) => (
      <button className="btn ghost" style={{ padding: "0.1rem 0.4rem" }} onClick={(e) => { e.stopPropagation(); toggle(r); }}
              aria-label={inList(r) ? "Remove from shortlist" : "Add to shortlist"}>{inList(r) ? "★" : "☆"}</button>) },
  ];
  const csvCols: [string, string][] = [["pname", "player"], ["player_id", "id"], ["club_name", "club"], ["competition_id", "league"], ["season", "season"],
    ["position_group", "position"], ["age", "age"], ["minutes", "minutes"], ["composite", "composite"], ["value", "value_eur"], ["contract", "contract"],
    ["missed_12m", "injury_matches_12m"], ["sim", "similarity"], ["value_resid", "value_residual"],
    ...DIMS.map(([k, l]) => [k, l.toLowerCase().replace(/ /g, "_")] as [string, string])];

  const radarFor = (list: Row[], posKey: string) => {
    const axes = fmAxes(posKey).map((m) => ({ key: m.key, label: m.short ?? m.label }));
    return { axes, series: list.slice(0, 3).map((r, i) => ({
      name: `${r.pname ?? r.player_id} ${seasonLabel(r.season, r.competition_id)}`, color: slot(i + 1),
      values: Object.fromEntries(axes.map((a) => [a.key, r[`z_${a.key}`] == null ? null : 100 * phi(r[`z_${a.key}`])])),
    })) };
  };

  const scatter = useMemo(() => {
    if (!valued.length) return undefined;
    const top = new Set([...valued].sort((a, b) => b.value_resid - a.value_resid).slice(0, 8).map(keyOf));
    return (width: number) => ({
      width, height: Math.min(520, Math.max(320, width * 0.62)), marginLeft: 44,
      x: { type: "log" as const, label: "Market value (€, log) →", tickFormat: (v: number) => fmt.eur(v), grid: true },
      y: { label: "↑ Composite rating (50 = position average)", grid: true },
      marks: [
        Plot.ruleY([50], { stroke: css("--axis") }),
        Plot.dot(valued, { x: "value", y: "composite", r: 4, fill: (d: any) => (d.value_resid >= 0 ? css("--pos") : css("--neg")),
                           fillOpacity: 0.65, stroke: css("--surface"), strokeWidth: 1,
                           href: (d: any) => `#/player/${encodeURIComponent(d.player_id)}` }),
        Plot.text(valued.filter((d) => top.has(keyOf(d))), { x: "value", y: "composite", text: (d: any) => d.pname?.split(" ").slice(-1)[0], dy: -9, fontSize: 10, fill: css("--text") }),
        Plot.tip(valued, Plot.pointer({ x: "value", y: "composite", title: (d: any) =>
          `${d.pname} (${d.position_group}, ${fmt.n(d.age)}), ${d.club_name ?? ""}\n${LEAGUES[d.competition_id]} ${seasonLabel(d.season, d.competition_id)} · ${fmt.n(d.minutes)} min\ncomposite ${fmt.n(d.composite, 0)} · value ${fmt.eur(d.value)}\n${fmt.signed(d.value_resid, 1)} vs value-expected` })),
      ],
    });
  }, [valued]);

  const bestValue = [...valued].sort((a, b) => b.value_resid - a.value_resid)[0];
  const title = tab === "find" && tRow && similar[0] ? `${similar[0].pname ?? similar[0].player_id} is the closest match to ${tRow.pname ?? "the target"} (${fmt.pct(similar[0].sim)})`
    : tab === "value" && bestValue ? `${bestValue.pname} gives the most performance per euro in this search`
    : tab === "list" ? `${listed.length} player${listed.length === 1 ? "" : "s"} on your shortlist` : "Recruitment";

  return (
    <>
      <PageHead eyebrow="Recruitment" title={title}
        lead="Find replacements, rank value for money and build a shortlist from every player in nine leagues, on current Opta-based data (FotMob, 2024-25 onward)." />
      <Tabs value={tab} onChange={setTab} tabs={[["find", "Find a replacement"], ["value", "Value for money"], ["list", `Shortlist (${short.length})`]]} />

      {tab !== "list" && (
        <div className="filters">
          {tab === "find" && (
            <Field label="Target player"><EntityPicker kind="player" placeholder="Search a player" value={tRow?.pname ?? ""}
              onPick={(e) => { setTarget(e.id); setTSeason(null); setPicked(null); }} /></Field>
          )}
          {tab === "find" && tRows.length > 1 && (
            <Select label="Target season" value={tRow ? `${tRow.competition_id}|${tRow.season}` : ""} onChange={(v) => setTSeason(v)}
                    options={tRows.map((r) => [`${r.competition_id}|${r.season}`, `${seasonLabel(r.season, r.competition_id)} ${LEAGUES[r.competition_id]} (${fmt.n(r.minutes)} min)`])} />
          )}
          <Select label="Position" value={pos || (tab === "find" ? "" : "all")} onChange={(v) => setPos(v || null)}
                  options={[...(tab === "find" ? [["", `Same as target${tPos ? ` (${tPos})` : ""}`] as [string, string]] : []), ["all", "All positions"], ...POSITIONS.map((p) => [p, POSITION_NAMES[p]] as [string, string])]} />
          <Select label="Search pool" value={pool} onChange={setPool}
                  options={[["latest", "Latest season per player"], ["2026", "2026-27 (in progress)"], ["2025", "2025-26"], ["2024", "2024-25"]]} />
          <Field label="Age"><span className="row" style={{ gap: 4 }}>
            <input type="number" value={amin} min={15} max={45} onChange={(e) => setAmin(e.target.value)} style={{ width: 62 }} aria-label="Minimum age" />–
            <input type="number" value={amax} min={15} max={45} onChange={(e) => setAmax(e.target.value)} style={{ width: 62 }} aria-label="Maximum age" /></span></Field>
          <Field label="Max value (€m)"><input type="number" value={vmax} min={0} placeholder="any" onChange={(e) => setVmax(e.target.value || null)} style={{ width: 90 }} /></Field>
          <Select label="Min minutes" value={minMin} onChange={setMinMin} options={["270", "450", "900", "1350", "1800", "2500"].map((v) => [v, `${v}+`])} />
          <Select label="Min share of team minutes" value={share} onChange={setShare} options={["0", "25", "50", "70"].map((v) => [v, v === "0" ? "any" : `${v}%+`])} />
          <Field label="Contract ends by"><input type="date" value={exp} onChange={(e) => setExp(e.target.value || null)} /></Field>
          <Select label="Foot" value={foot} onChange={(v) => setFoot(v || null)} options={[["", "any"], ["right", "right"], ["left", "left"], ["both", "both"]]} />
          <Field label="Min height (cm)"><input type="number" value={hmin} placeholder="any" onChange={(e) => setHmin(e.target.value || null)} style={{ width: 80 }} /></Field>
          <Field label="Quick filters"><span className="row" style={{ gap: 6 }}>
            <button className="btn" aria-pressed={inj === "1"} style={{ fontWeight: inj === "1" ? 650 : 400 }} onClick={() => setInj(inj === "1" ? null : "1")}>Fit now</button>
            <button className="btn" aria-pressed={exp === "2027-06-30"} style={{ fontWeight: exp === "2027-06-30" ? 650 : 400 }}
                    onClick={() => setExp(exp === "2027-06-30" ? null : "2027-06-30")}>Free or expiring 2027</button>
            <button className="btn" aria-pressed={adj === "1"} style={{ fontWeight: adj === "1" ? 650 : 400 }} onClick={() => setAdj(adj === "1" ? null : "1")}
                    title="Compare across leagues: attacking outputs scaled by league strength, z-scores pooled across leagues">League-adjusted</button>
          </span></Field>
          <Field label="Leagues"><span className="row" style={{ gap: 4 }}>
            {ALL_LEAGUES.map((k) => (
              <button key={k} className="pill" aria-pressed={leagues.has(k)} title={LEAGUES[k]}
                      style={{ cursor: "pointer", opacity: leagues.has(k) ? 1 : 0.45, background: leagues.has(k) ? "var(--accent-soft)" : undefined }}
                      onClick={() => { const s = new Set(leagues); if (s.has(k)) s.delete(k); else s.add(k); setLg([...s].join(",") || null); }}>{k}</button>
            ))}</span></Field>
        </div>
      )}
      {loading && <Loading state={data} />}

      {tab === "find" && !loading && (
        !tRow ? <Empty>No current-season (FotMob) data for this player. Pick a player who has played in one of the nine leagues since 2024-25.</Empty> : (
          <>
            <div className="tiles" style={{ marginBottom: 16 }}>
              <Tile label="Target" value={tRow.pname ?? tRow.player_id} delta={`${POSITION_NAMES[tRow.position_group]} · ${tRow.club_name ?? ""} · ${seasonLabel(tRow.season, tRow.competition_id)}`} />
              <Tile label="Target composite" value={fmt.n(tRow.composite, 0)} delta={`${fmt.n(tRow.minutes)} minutes`} />
              <Tile label="Candidates searched" value={fmt.n(filtered.filter((r) => !matchPos || matchPos === "all" || r.position_group === matchPos).length)} delta={adj === "1" ? "league-adjusted, pooled across leagues" : "z-scores within each league"} />
              <Tile label="Cheapest of the top 10" value={(() => { const c = similar.slice(0, 10).filter((r) => r.value > 0).sort((a, b) => a.value - b.value)[0]; return c ? c.pname : "–"; })()}
                    delta={(() => { const c = similar.slice(0, 10).filter((r) => r.value > 0).sort((a, b) => a.value - b.value)[0]; return c ? `${fmt.eur(c.value)} · ${fmt.pct(c.sim)} similar` : ""; })()} />
            </div>
            <div className="grid">
              <div className="c8">
                <Card title="Most similar players" sub={<>Cosine similarity of per-90 profiles on the {POSITION_NAMES[tPos]?.toLowerCase()} axes, discounted when the overall level differs. Click a row to overlay it on the radar; ☆ adds to the shortlist.</>}
                      right={<button className="btn" onClick={() => download(`replacements-${target}.csv`, toCsv(similar, csvCols))}>Export CSV</button>}>
                  {similar.length ? (
                    <DataTable rows={similar} rank maxHeight={640} onRow={(r) => setPicked(keyOf(r))} highlight={(r) => keyOf(r) === keyOf(pickedRow ?? {})}
                               cols={common([
                                 { key: "sim", label: "Similar", num: true, fmt: (v) => fmt.pct(v) },
                                 { key: "shared", label: "Shared strengths", sortable: false, fmt: (v: string[]) => <span className="xs ink2">{v?.length ? v.join(", ") : "–"}</span> },
                               ])} />
                  ) : <Empty>No players match these filters. Loosen the age, value or minutes limits.</Empty>}
                </Card>
              </div>
              <div className="c4 stack" style={{ gap: 16 }}>
                {pickedRow && (
                  <Card title={`${tRow.pname} vs ${pickedRow.pname ?? pickedRow.player_id}`}
                        sub="Percentile vs position peers on each axis (outward is better; lower-is-better measures flipped).">
                    <Radar size={340} {...radarFor([tRow, pickedRow], tPos)} />
                    <div className="legend">{[tRow, pickedRow].map((r, i) => <span key={i}><span className="key" style={{ background: slot(i + 1) }} />{r.pname} {seasonLabel(r.season, r.competition_id)}</span>)}</div>
                  </Card>
                )}
                <MethodNote />
              </div>
            </div>
          </>
        )
      )}

      {tab === "value" && !loading && (
        <div className="grid">
          <div className="c7">
            {scatter ? (
              <Figure title="Performance against price"
                subtitle={<>Each dot is a qualified player in this search. The composite averages the position's key ratings (50 = average). Blue: above the
                  rating their value predicts (fitted per position); red: below. Click a dot for the player.</>}
                source="FotMob (Opta) per-90s; values FotMob / Transfermarkt" plot={scatter} alt="Composite rating against market value"
                table={{ rows: valued.slice(0, 200), cols: [["pname", "Player"], ["position_group", "Pos"], ["value", "Value", (v) => fmt.eur(v)], ["composite", "Composite", (v) => fmt.n(v, 0)], ["value_resid", "vs value", (v) => fmt.signed(v, 1)]] }} />
            ) : <Empty>No qualified players with a market value match these filters.</Empty>}
          </div>
          <div className="c5">
            <Card title="Best performance per euro" sub="Composite rating above what the player's market value predicts, for his position."
                  right={<button className="btn" onClick={() => download("value-for-money.csv", toCsv([...valued].sort((a, b) => b.value_resid - a.value_resid), csvCols))}>Export CSV</button>}>
              <DataTable rows={valued} rank maxHeight={600} initialSort={{ key: "value_resid", desc: true }}
                         cols={[common()[0], common()[2], common()[3], common()[4],
                           { key: "value", label: "Value", num: true, fmt: (v) => fmt.eur(v) },
                           { key: "composite", label: "Comp.", num: true, fmt: (v) => fmt.n(v, 0) },
                           { key: "value_resid", label: "vs value", num: true, heat: "pos", fmt: (v) => fmt.signed(v, 1) },
                           common().slice(-1)[0]]} />
            </Card>
          </div>
        </div>
      )}

      {tab === "list" && (
        <Shortlist rows={listed} common={common} radarFor={radarFor} onClear={() => setShort([])}
                   onCsv={() => download("shortlist.csv", toCsv(listed, csvCols))} onOpen={(id) => nav(`/player/${encodeURIComponent(id)}`)} />
      )}
    </>
  );
}

function Shortlist({ rows, common, radarFor, onClear, onCsv }: {
  rows: Row[]; common: (extra?: Col[]) => Col[]; radarFor: (l: Row[], p: string) => { axes: any[]; series: any[] };
  onClear: () => void; onCsv: () => void; onOpen: (id: string) => void;
}) {
  if (!rows.length) return <Empty>Your shortlist is empty. Star players (☆) in "Find a replacement" or "Value for money". It's saved in this browser only.</Empty>;
  const posKey = rows[0].position_group;
  const same = rows.slice(0, 3).every((r) => r.position_group === posKey);
  return (
    <div className="grid">
      <div className="c12">
        <Card title="Shortlist" sub="Saved in this browser. Ratings: 50 = position average in the league-season, 10 points = one SD."
              right={<span className="row" style={{ gap: 6 }}><button className="btn" onClick={onCsv}>Export CSV</button><button className="btn" onClick={onClear}>Clear</button></span>}>
          <DataTable rows={rows} cols={[...common().slice(0, -1),
            ...DIMS.filter(([k]) => rows.some((r) => r[k] != null)).map(([k, l]) => ({ key: k, label: l, fmt: (v: any) => <RatingBar v={v} width={44} /> } as Col)),
            common().slice(-1)[0]]} />
        </Card>
      </div>
      <div className="c6">
        <Card title={same ? "Profiles side by side" : "Profiles (first three, same position needed)"}
              sub={same ? "First three shortlisted players, percentile vs position peers." : "Radar comparisons need players of one position group; reorder by removing others."}>
          {same ? (
            <>
              <Radar size={360} {...radarFor(rows, posKey)} />
              <div className="legend">{rows.slice(0, 3).map((r, i) => <span key={i}><span className="key" style={{ background: slot(i + 1) }} />{r.pname}</span>)}</div>
            </>
          ) : null}
        </Card>
      </div>
      <div className="c6"><MethodNote /></div>
    </div>
  );
}

function MethodNote(): ReactNode {
  return (
    <div className="callout small">
      <b>How this works.</b> Per-90 numbers are FotMob's (Opta-based) for 2024-25 onward. Each metric becomes a z-score against qualified players of the
      same position group in the same league-season; similarity is the cosine of those profiles on the position's axes. <b>League-adjusted</b> pools all
      leagues instead and scales attacking outputs by league strength (the goals a Premier League side would add in each league, from players who moved
      between leagues; Championship and MLS have no estimate and are left unscaled), so it's approximate. Position groups come from FotMob's line-up
      layout and can be off for hybrid roles. Values are FotMob or Transfermarkt estimates; contracts come only from Transfermarkt-linked players and are
      frozen at July 2026. Injury history counts matches a player was listed out injured.
    </div>
  );
}
