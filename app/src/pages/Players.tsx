// Player explorer: any metric against any metric, for every league season (box score) or
// every event-data season (deep), with a leaderboard twin.
import * as Plot from "@observablehq/plot";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { lit, Row, useQuery } from "../db";
import { css, fmt, LEAGUES, PLAYER_LEAGUES, POSITIONS, POSITION_NAMES, seasonLabel, slot } from "../lib/format";
import { Figure } from "../ui/Figure";
import {
  ClubLink, Col, DataTable, Field, Loading, PageHead, PlayerLink, Seg, Select, Tile, useParam,
} from "../ui/kit";
import { F_METRICS, fMetric } from "./player/fotmob";
import { A_METRICS, ageSql, C_METRICS, dsLabel, Metric, metricOf } from "./player/shared";

const metricFor = (tier: string, key: string) => (tier === "f" ? fMetric(key) : metricOf(tier, key));

const med = (v: number[]) => {
  const s = v.filter(Number.isFinite).sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : NaN;
};

export default function Players() {
  const nav = useNavigate();
  const [tier, setTier] = useParam("tier", "f");
  const fsets = useQuery(`select competition_id, season, count(*) as n from fm_player_season group by all order by season desc, competition_id`);
  const fdefault = fsets.rows.find((r) => r.competition_id === "GB1") ?? fsets.rows[0];
  const [fds, setFds] = useParam("fds", "");
  const fdsKey = fds || (fdefault ? `${fdefault.competition_id}:${fdefault.season}` : "GB1:2026");
  const [fComp, fSeason] = fdsKey.split(":");
  const [league, setLeague] = useParam("league", "GB1");
  const [season, setSeason] = useParam("season", "2025");
  const [ds, setDs] = useParam("ds", "wyscout:GB1:2017");
  const [pos, setPos] = useParam("pos", "all");
  const [xKey, setX] = useParam("x", tier === "c" ? "np_goals_p90" : "npxg_p90");
  const [yKey, setY] = useParam("y", tier === "c" ? "assists_p90" : "xa_p90");
  const [minMin, setMin] = useParam("min", tier === "f" ? "270" : "900");
  const [q, setQ] = useParam("q", "");
  const [view, setView] = useParam("view", "chart");
  const [pctMode, setPct] = useState(false);

  const metrics = tier === "a" ? A_METRICS : tier === "f" ? F_METRICS : C_METRICS;
  const xm = metricFor(tier, xKey) ?? metrics[1];
  const ym = metricFor(tier, yKey) ?? metrics[2];

  const sets = useQuery(`select provider, competition_id, season, count(*) n from players_a group by all
                         order by provider desc, season desc, competition_id`);
  const [prov, comp, dsSeason] = ds.split(":");
  const posSql = pos === "all" ? "" : `and position_group = ${lit(pos)}`;
  const data = useQuery(tier === "f"
    ? `select f.*, f.position_group as pos, coalesce(p.name, fp.name) as name, k.name as club
       from fm_player_season f left join players p using (player_id) left join fm_players fp using (player_id)
       left join clubs k on k.club_id = f.club_id
       where f.competition_id = ${lit(fComp)} and f.season = ${Number(fSeason)} and f.minutes >= ${Number(minMin)}
       ${posSql.replace("position_group", "f.position_group")}`
    : tier === "a"
    ? `select a.*, a.position_group pos, p.name, k.name club, ${ageSql("p.date_of_birth", "a.season")} age
       from players_a a left join players p using (player_id) left join clubs k on k.club_id = a.club_id
       where a.provider = ${lit(prov)} and a.competition_id = ${lit(comp)} and a.season = ${Number(dsSeason)}
         and a.minutes >= ${Number(minMin)} ${posSql}`
    : `select c.player_id, p.name, c.club_id, k.name club, c.position_group pos, c.minutes, c.minutes_share,
              c.np_goals_p90, c.assists_p90, c.cards_p90, c.scoring_rating, c.creation_rating,
              c.availability_rating, c.discipline_rating, c.goals, c.assists, r.rapm, r.prior_dominated,
              ${ageSql("p.date_of_birth", "c.season")} age, m.value_eur
       from players_c c join players p using (player_id) left join clubs k on k.club_id = c.club_id
       left join rapm r on r.player_id = c.player_id and r.season = c.season
       left join market m on m.player_id = c.player_id and m.season = c.season
       where c.competition_id = ${lit(league)} and c.season = ${Number(season)}
         and c.minutes >= ${Number(minMin)} ${posSql.replace("position_group", "c.position_group")}`);

  // percentiles within position group (lower-is-better metrics inverted)
  const rows = useMemo(() => {
    const byPos: Record<string, Row[]> = {};
    data.rows.forEach((r) => (byPos[r.pos] ??= []).push(r));
    const out = data.rows.map((r) => ({ ...r }));
    const idx = new Map(data.rows.map((r, i) => [r, i]));
    for (const group of Object.values(byPos)) {
      for (const m of metrics) {
        const vals = group.map((r) => r[m.key]).filter((v) => typeof v === "number" && Number.isFinite(v)).sort((a, b) => a - b);
        for (const r of group) {
          const v = r[m.key];
          if (typeof v !== "number" || !Number.isFinite(v) || vals.length < 2) continue;
          let lo = 0, hi = vals.length;
          while (lo < hi) { const mid = (lo + hi) >> 1; if (vals[mid] < v) lo = mid + 1; else hi = mid; }
          let p = (100 * lo) / (vals.length - 1);
          if (m.higher === false) p = 100 - p;
          out[idx.get(r)!][`${m.key}__pct`] = Math.max(0, Math.min(100, p));
        }
      }
    }
    return out;
  }, [data.rows, metrics]);

  const term = q.trim().toLowerCase();
  const found = term.length >= 2 ? rows.filter((r) => (r.name ?? "").toLowerCase().includes(term)).slice(0, 3) : [];
  const pts = rows.filter((r) => Number.isFinite(r[xm.key]) && Number.isFinite(r[ym.key]));
  const mx = med(pts.map((r) => r[xm.key])), my = med(pts.map((r) => r[ym.key]));

  const plot = useMemo(() => {
    if (!pts.length) return undefined;
    const sx = Math.max(1e-9, ...pts.map((r) => Math.abs(r[xm.key] - mx)));
    const sy = Math.max(1e-9, ...pts.map((r) => Math.abs(r[ym.key] - my)));
    const sgn = (m: Metric) => (m.higher === false ? -1 : 1);
    const score = (r: Row) => (sgn(xm) * (r[xm.key] - mx)) / sx + (sgn(ym) * (r[ym.key] - my)) / sy;
    const outliers = [...pts].sort((a, b) => score(b) - score(a)).slice(0, 6);
    const hl = new Set(found);
    const labelled = [...new Set([...outliers, ...found])];
    const lab = (r: Row) => (r.name ?? r.player_id).split(" ").slice(-1)[0];
    const tipText = (d: Row) => `${d.name}\n${d.club ?? ""} · ${d.pos} · ${fmt.n(d.minutes)} min\n${xm.label}: ${xm.f(d[xm.key])}\n${ym.label}: ${ym.f(d[ym.key])}`;
    return (width: number) => ({
      width, height: Math.min(560, Math.max(340, width * 0.62)), marginRight: 24, marginLeft: 52,
      x: { label: `${xm.label} →`, grid: true, nice: true, ticks: 8 },
      y: { label: `↑ ${ym.label}`, grid: true, nice: true, ticks: 8 },
      marks: [
        Plot.ruleX([mx], { stroke: css("--axis"), strokeWidth: 1 }),
        Plot.ruleY([my], { stroke: css("--axis"), strokeWidth: 1 }),
        Plot.dot(pts.filter((r) => !hl.has(r)), { x: xm.key, y: ym.key, r: 4, fill: css("--muted"), fillOpacity: 0.45 }),
        Plot.dot(outliers.filter((r) => !hl.has(r)), { x: xm.key, y: ym.key, r: 4.5, fill: css("--text-2"), stroke: css("--surface"), strokeWidth: 1.5 }),
        Plot.dot(found, { x: xm.key, y: ym.key, r: 6, fill: (_d: Row, i: number) => slot(i + 1), stroke: css("--surface"), strokeWidth: 2 }),
        Plot.text(labelled, { x: xm.key, y: ym.key, text: lab, dy: -10, fontSize: 10.5, fill: css("--text-2"), fontWeight: 600 }),
        Plot.text([`↗ high ${xm.short ?? xm.label}, high ${ym.short ?? ym.label}`], { frameAnchor: "top-right", dx: -6, dy: 6, fill: css("--muted"), fontSize: 10 }),
        Plot.text([`↙ low both`], { frameAnchor: "bottom-left", dx: 6, dy: -6, fill: css("--muted"), fontSize: 10 }),
        Plot.dot(pts, Plot.pointer({ x: xm.key, y: ym.key, r: 8, fill: "none", stroke: css("--accent"), strokeWidth: 2, maxRadius: 30 })),
        Plot.tip(pts, Plot.pointer({ x: xm.key, y: ym.key, title: tipText, maxRadius: 30 })),
      ],
    });
  }, [pts, xm, ym, found.map((f) => f.player_id).join(",")]);

  const metricOptions: [string, string][] = metrics.map((m) => [m.key, `${m.group} · ${m.label}`]);
  const leader = [...pts].sort((a, b) => (ym.higher === false ? a[ym.key] - b[ym.key] : b[ym.key] - a[ym.key]))[0];
  const ctx = tier === "f" ? `${LEAGUES[fComp] ?? fComp} ${seasonLabel(Number(fSeason), fComp)} (current, FotMob)`
    : tier === "a" ? `${LEAGUES[comp] ?? comp} ${seasonLabel(Number(dsSeason), comp)} (${dsLabel(prov)})` : `${LEAGUES[league]} ${seasonLabel(Number(season))}`;

  const tableCols: Col[] = [
    { key: "name", label: "Player", fmt: (v, r) => <PlayerLink id={r.player_id} name={v ?? r.player_id} /> },
    { key: "club", label: "Club", fmt: (v, r) => (r.club_id ? <ClubLink id={r.club_id} name={v ?? r.club_id} /> : "–") },
    { key: "pos", label: "Pos" },
    ...metrics.filter((m) => !((tier === "a" || tier === "f") && pos !== "GK" && /goals_prevented|shot_stopping|distribution|save_pct|goalkeeping/.test(m.key)))
      .map((m) => {
        const k = pctMode && m.key !== "minutes" ? `${m.key}__pct` : m.key;
        return {
          key: k, label: m.short ?? m.label, num: true, title: m.label,
          heat: m.key === "minutes" || m.key === "age" ? undefined : pctMode ? ("pos" as const) : m.higher === false ? ("neg" as const) : ("pos" as const),
          fmt: (v: any) => (pctMode && m.key !== "minutes" ? fmt.n(v, 0) : m.f(v)),
        } as Col;
      }),
  ];

  return (
    <>
      <PageHead eyebrow={`Player explorer · ${ctx}`}
                title={leader ? <>{leader.name} leads on {ym.label.toLowerCase()}</> : "Player explorer"}
                lead={<>Plot any two measures against each other. Lines mark the medians of the {pts.length} players shown; the six players
                  furthest into the top-right corner are labelled. Click a dot to open the player.</>} />
      <div className="filters">
        <Field label="Data">
          <Seg options={[["f", "Current (FotMob)"], ["c", "Every league season"], ["a", "Event data (historical)"]]} value={tier as "f" | "c" | "a"}
               onChange={(v) => { setTier(v); setX(null); setY(null); setMin(null); }} label="Data tier" />
        </Field>
        {tier === "f" ? (
          <Select label="League season" value={fdsKey} onChange={setFds}
                  options={fsets.rows.map((r) => [`${r.competition_id}:${r.season}`, `${LEAGUES[r.competition_id] ?? r.competition_id} ${seasonLabel(r.season, r.competition_id)} (${r.n} players)`])} />
        ) : tier === "c" ? (
          <>
            <Select label="League" value={league} onChange={setLeague} options={PLAYER_LEAGUES.map((k) => [k, LEAGUES[k]])} />
            <Select label="Season" value={season} onChange={setSeason}
                    options={Array.from({ length: 14 }, (_, i) => 2025 - i).map((s) => [String(s), seasonLabel(s)])} />
          </>
        ) : (
          <Select label="Dataset" value={ds} onChange={setDs}
                  options={sets.rows.map((r) => [`${r.provider}:${r.competition_id}:${r.season}`,
                    `${LEAGUES[r.competition_id] ?? r.competition_id} ${seasonLabel(r.season, r.competition_id)} · ${dsLabel(r.provider)}`])} />
        )}
        <Select label="Position" value={pos} onChange={setPos} options={[["all", "All positions"], ...POSITIONS.map((p) => [p, POSITION_NAMES[p]] as [string, string])]} />
        <Select label="Minimum minutes" value={minMin} onChange={setMin} options={(tier === "f" ? ["90", "270", "450", "900", "1350", "1800", "2700"] : ["450", "900", "1350", "1800", "2700"]).map((m) => [m, `${m}+`])} />
        <Select label="X axis" value={xm.key} onChange={setX} options={metricOptions} />
        <Select label="Y axis" value={ym.key} onChange={setY} options={metricOptions} />
        <Field label="Highlight player">
          <input type="search" placeholder="Type a name" value={q} onChange={(e) => setQ(e.target.value || null)} aria-label="Highlight player" />
        </Field>
      </div>

      <div className="tiles" style={{ marginBottom: 16 }}>
        <Tile label="Players shown" value={fmt.n(pts.length)} delta={`${fmt.n(Number(minMin))}+ minutes`} />
        <Tile label={`Median ${xm.short ?? xm.label}`} value={xm.f(mx)} />
        <Tile label={`Median ${ym.short ?? ym.label}`} value={ym.f(my)} />
        {leader && <Tile label={`Top on ${ym.short ?? ym.label}`} value={leader.name?.split(" ").slice(-1)[0]} delta={`${ym.f(leader[ym.key])} · ${leader.club ?? ""}`} />}
      </div>

      <div className="row between" style={{ marginBottom: 10 }}>
        <Seg options={[["chart", "Scatter"], ["table", "Leaderboard"]]} value={view as "chart" | "table"} onChange={setView} label="View" />
        {view === "table" && <Seg options={[["raw", "Values"], ["pct", "Percentiles vs position"]]} value={pctMode ? "pct" : "raw"} onChange={(v) => setPct(v === "pct")} label="Table values" />}
      </div>
      <Loading state={data} />
      {view === "chart" ? (
        plot ? (
          <Figure title={`${xm.label} vs ${ym.label}`} stale={data.loading}
                  subtitle={<>{ctx}, {pos === "all" ? "all positions" : POSITION_NAMES[pos]}, {fmt.n(Number(minMin))}+ minutes.
                    {found.length ? <> Highlighted: {found.map((f, i) => <span key={f.player_id} style={{ marginLeft: 6 }}><span className="dot" style={{ background: slot(i + 1) }} /> {f.name}</span>)}</> : null}</>}
                  source={tier === "f" ? "FotMob (Opta) match stats" : tier === "a" ? `${dsLabel(prov)} event data, pitchvision models` : "Transfermarkt minutes and events"}
                  plot={plot} alt={`Scatter of ${xm.label} against ${ym.label}`}
                  onRender={(el) => el.addEventListener("click", () => { const v = (el as any).value; if (v?.player_id) nav(`/player/${encodeURIComponent(v.player_id)}`); })}
                  table={{ rows: [...pts].sort((a, b) => b[ym.key] - a[ym.key]), cols: [["name", "Player"], ["club", "Club"], ["pos", "Pos"], [xm.key, xm.label, xm.f], [ym.key, ym.label, ym.f]] }} />
        ) : !data.loading && <div className="empty">No players match these filters.</div>
      ) : (
        <div className="card">
          <p className="fig-sub" style={{ marginTop: 0 }}>
            {pctMode ? "Percentile within position group in this league season (100 = best; lower-is-better measures inverted)." : "Raw values; shading marks the top of each column."}
            {tier === "c" && " RAPM covers seasons up to 2024-25; market value is the end-of-season Transfermarkt value."}
            {tier === "f" && " Current-era data from FotMob match pages; ratings use the house scale (50 = position average, 10 = 1 SD). Positions come from line-up layouts."}
          </p>
          <DataTable rows={rows} cols={tableCols} rank initialSort={{ key: pctMode ? `${ym.key}__pct` : ym.key, desc: ym.higher !== false }}
                     highlight={(r) => found.includes(r)} />
        </div>
      )}
    </>
  );
}
