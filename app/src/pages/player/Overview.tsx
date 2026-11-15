import * as Plot from "@observablehq/plot";
import { useMemo } from "react";
import { lit, Row, useQuery } from "../../db";
import { css, fmt, LEAGUES, POSITION_NAMES, seasonLabel, slot } from "../../lib/format";
import { Radar } from "../../ui/charts";
import { Figure } from "../../ui/Figure";
import { Card, ClubLink, DataTable, Empty, RatingBar, Select, useParam } from "../../ui/kit";
import { dsLabel, radarAxes } from "./shared";

/** Percentiles of one player against qualified position peers in one league season. */
export function usePercentiles(id: string, key: string | null) {
  const [tier, a, b, c] = (key ?? "").split(":");
  const isA = tier === "a";
  const axes = useMemo(() => (key ? radarAxes(isA ? "a" : "c", "") : []), [key, isA]);
  const posQ = useQuery(!key ? null : isA
    ? `select position_group pos from players_a where player_id = ${lit(id)} and provider = ${lit(a)} and competition_id = ${lit(b)} and season = ${Number(c)} limit 1`
    : `select position_group pos from players_c where player_id = ${lit(id)} and competition_id = ${lit(a)} and season = ${Number(b)} order by minutes desc limit 1`);
  const pos: string | undefined = posQ.rows[0]?.pos;
  const ax = pos ? radarAxes(isA ? "a" : "c", pos) : axes;
  const cols = ax.map((m) => `case when ${m.key} is null then null else 100 * percent_rank() over (order by ${m.key}) end as "${m.key}__pct"`).join(", ");
  const res = useQuery(!key || !pos ? null : isA
    ? `with peers as (select * from players_a where provider = ${lit(a)} and competition_id = ${lit(b)} and season = ${Number(c)}
                      and position_group = ${lit(pos)} and (qualified or player_id = ${lit(id)}))
       select *, ${cols}, count(*) over () n_peers from peers`
    : `with peers as (select c.*, r.rapm, m.value_eur from players_c c
                      left join rapm r on r.player_id = c.player_id and r.season = c.season
                      left join market m on m.player_id = c.player_id and m.season = c.season
                      where c.competition_id = ${lit(a)} and c.season = ${Number(b)} and c.position_group = ${lit(pos)}
                        and (c.qualified or c.player_id = ${lit(id)}))
       select *, ${cols}, count(*) over () n_peers from peers`);
  const me = res.rows.find((r) => r.player_id === id);
  const vals: Record<string, number | null> = {};
  const raw: Record<string, string> = {};
  ax.forEach((m) => {
    const p = me?.[`${m.key}__pct`];
    vals[m.key] = p == null ? null : m.higher === false ? 100 - p : p;
    raw[m.key] = m.f(me?.[m.key]);
  });
  return { axes: ax, vals, raw, me, pos, n: me?.n_peers as number | undefined, loading: res.loading || posQ.loading, tier: isA ? "a" : "c" };
}

export function seasonKeys(seasonsC: Row[], seasonsA: Row[]): [string, string][] {
  const seenC = new Set<string>();
  const c = seasonsC.filter((r) => { const k = `${r.competition_id}:${r.season}`; if (seenC.has(k)) return false; seenC.add(k); return true; })
    .map((r) => [`c:${r.competition_id}:${r.season}`, `${seasonLabel(r.season)} ${LEAGUES[r.competition_id] ?? r.competition_id} · box score`] as [string, string]);
  const a = seasonsA.map((r) => [`a:${r.provider}:${r.competition_id}:${r.season}`,
    `${seasonLabel(r.season, r.competition_id)} ${LEAGUES[r.competition_id] ?? r.competition_id} · ${dsLabel(r.provider)} event data`] as [string, string]);
  return [...a, ...c];
}

export default function Overview({ id, seasonsC, seasonsA, seasonsF = [] }: { id: string; seasonsC: Row[]; seasonsA: Row[]; seasonsF?: Row[] }) {
  const keys = seasonKeys(seasonsC, seasonsA);
  const [sk, setSk] = useParam("rs", keys[0]?.[0] ?? "");
  const key = keys.some(([k]) => k === sk) ? sk : keys[0]?.[0] ?? null;
  const pr = usePercentiles(id, key);

  // career: Transfermarkt seasons, then FotMob seasons Transfermarkt doesn't cover (2026-27 on)
  const career: Row[] = useMemo(() => {
    const seen = new Set(seasonsC.map((r) => `${r.competition_id}:${r.season}`));
    const maxC = Math.max(-Infinity, ...seasonsC.map((r) => r.season));
    const extra = seasonsF.filter((r) => !seen.has(`${r.competition_id}:${r.season}`) && (r.season > maxC || !seasonsC.length))
      .map((r) => ({ ...r, source: "FotMob" }));
    return [...seasonsC.map((r) => ({ ...r, source: "Transfermarkt" })), ...extra];
  }, [seasonsC, seasonsF]);

  const timeline = useMemo(() => {
    if (!career.length) return undefined;
    const rows = [...career].sort((x, y) => x.season - y.season || (x.club ?? "").localeCompare(y.club ?? ""))
      .map((r) => ({ ...r, s: seasonLabel(r.season), clubName: r.club ?? r.club_id }));
    const clubs = [...new Set(rows.map((r) => r.clubName))];
    const range = clubs.map((_, i) => (i < 8 ? slot(i + 1) : css("--muted")));
    return (width: number) => ({
      width, height: 240, marginLeft: 48,
      x: { label: null, domain: [...new Set(rows.map((r) => r.s))], tickRotate: rows.length > 10 ? -40 : 0 },
      y: { label: "↑ League minutes", grid: true },
      color: { domain: clubs, range, legend: true },
      marks: [
        Plot.barY(rows, { x: "s", y: "minutes", fill: "clubName", inset: 2, rx: 4 }),
        Plot.ruleY([0], { stroke: css("--axis") }),
        Plot.tip(rows, Plot.pointerX(Plot.stackY({ x: "s", y: "minutes", title: (d: Row) =>
          `${d.s} · ${d.clubName}\n${fmt.n(d.minutes)} min · ${fmt.n(d.goals)} G · ${fmt.n(d.assists)} A\n${LEAGUES[d.competition_id] ?? d.competition_id}` }))),
      ],
    });
  }, [seasonsC]);

  const strongest = pr.axes.filter((m) => pr.vals[m.key] != null).sort((x, y) => (pr.vals[y.key] ?? 0) - (pr.vals[x.key] ?? 0));
  return (
    <div className="grid">
      <div className="c6">
        <Card title={strongest.length ? `Best at: ${strongest.slice(0, 2).map((m) => (m.short ?? m.label).toLowerCase()).join(" and ")}` : "Percentiles vs peers"}
              sub={<>Percentile against {pr.n ? `${pr.n} ` : ""}{pr.pos ? POSITION_NAMES[pr.pos]?.toLowerCase() + "s" : "players"} in the same league season
                (qualified minutes; 50 = the median ring; lower-is-better measures flipped so outward is always better). Hover an axis for the raw value.</>}>
          {keys.length > 1 && <div style={{ marginBottom: 8 }}><Select label="Season" value={key ?? ""} onChange={setSk} options={keys} /></div>}
          {!key ? <Empty>No rated seasons.</Empty> : pr.loading && !pr.me ? <div className="loading">Loading…</div>
            : <Radar axes={pr.axes.map((m) => ({ key: m.key, label: m.short ?? m.label }))}
                     series={[{ name: "Percentile", color: "var(--s1)", values: pr.vals, raw: pr.raw }]} />}
        </Card>
      </div>
      <div className="c6 stack" style={{ gap: 16 }}>
        {timeline ? (
          <Figure title="Career in the top leagues" subtitle="League minutes per season, coloured by club (Transfermarkt from 2012-13; FotMob for seasons after the July 2026 freeze)."
                  source="Transfermarkt, FotMob" plot={timeline} alt="Minutes per season by club"
                  table={{ rows: career, cols: [["season", "Season", (v) => seasonLabel(v)], ["club", "Club"], ["minutes", "Minutes", (v) => fmt.n(v)], ["goals", "Goals"], ["assists", "Assists"]] }} />
        ) : <Card title="Career"><Empty>No top-league minutes since 2012-13 on record; this player appears through event data only.</Empty></Card>}
        {pr.me && (
          <Card className="flat" title="Where the percentiles come from">
            <table className="data"><tbody>
              {pr.axes.map((m) => (
                <tr key={m.key}><td>{m.label}</td><td className="r">{pr.raw[m.key]}</td>
                  <td className="r muted">{pr.vals[m.key] == null ? "–" : `${Math.round(pr.vals[m.key]!)}th pct`}</td></tr>
              ))}
            </tbody></table>
          </Card>
        )}
      </div>
      {seasonsC.length > 0 && (
        <div className="c12">
          <Card title="Season by season" sub="Box-score ratings: 50 = the position average in that league season, 10 points = one standard deviation, shrunk toward average for small samples.">
            <DataTable rows={seasonsC} initialSort={{ key: "season", desc: true }} cols={[
              { key: "season", label: "Season", fmt: (v) => seasonLabel(v) },
              { key: "competition_id", label: "League", fmt: (v) => LEAGUES[v] ?? v },
              { key: "club", label: "Club", fmt: (v, r) => <ClubLink id={r.club_id} name={v ?? r.club_id} /> },
              { key: "position_group", label: "Pos" },
              { key: "apps", label: "Apps", num: true },
              { key: "minutes", label: "Min", num: true, fmt: (v) => fmt.n(v) },
              { key: "goals", label: "G", num: true, fmt: (v) => fmt.n(v) },
              { key: "assists", label: "A", num: true, fmt: (v) => fmt.n(v) },
              { key: "np_goals_p90", label: "npG/90", num: true, fmt: (v) => fmt.n(v, 2) },
              { key: "scoring_rating", label: "Scoring", fmt: (v) => <RatingBar v={v} /> },
              { key: "creation_rating", label: "Creation", fmt: (v) => <RatingBar v={v} /> },
              { key: "availability_rating", label: "Availability", fmt: (v) => <RatingBar v={v} /> },
              { key: "discipline_rating", label: "Discipline", fmt: (v) => <RatingBar v={v} /> },
            ]} />
          </Card>
        </div>
      )}
    </div>
  );
}
