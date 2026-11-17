import * as Plot from "@observablehq/plot";
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { lit, useQuery } from "../../db";
import { css, fmt } from "../../lib/format";
import { managerSlug } from "../../lib/tactics";
import { Figure } from "../../ui/Figure";
import { Card, DataTable, Empty } from "../../ui/kit";
import { stintsSql } from "./stints";

export default function ManagersTab({ id, name }: { id: string; name: string }) {
  const q = useQuery(`select * from (${stintsSql(`m.home_club = ${lit(id)} or m.away_club = ${lit(id)}`)}) where club_id = ${lit(id)} order by start_date`);
  const rows = q.rows;
  const slugs = useQuery(`select distinct manager, manager_slug from manager_spells where club_id = ${lit(id)}`);
  const slugOf = useMemo(() => new Map(slugs.rows.map((r) => [r.manager, r.manager_slug])), [slugs.rows]);
  const plot = useMemo(() => {
    if (!rows.length) return undefined;
    const d = rows.map((r) => ({ ...r, label: `${r.manager}` }));
    return (width: number) => ({
      width, height: Math.max(160, d.length * 34 + 50), marginLeft: 150, marginRight: 60,
      x: { label: null, type: "time" as const }, y: { label: null, domain: [...new Set(d.map((r) => r.label))] },
      marks: [
        Plot.barX(d, { x1: "start_date", x2: "end_date", y: "label", fill: (r: any) => (r.over_pm >= 0 ? css("--pos") : css("--neg")), rx: 4, insetTop: 6, insetBottom: 6 }),
        Plot.text(d, { x: "end_date", y: "label", text: (r: any) => `${fmt.signed(r.over_pm, 2)}/match`, dx: 6, textAnchor: "start", fill: css("--text-2"), fontSize: 10.5 }),
        Plot.tip(d, Plot.pointer({ x1: "start_date", x2: "end_date", y: "label", title: (r: any) =>
          `${r.manager}\n${fmt.dayYear(r.start_date)} – ${fmt.dayYear(r.end_date)}\n${r.n} league matches, ${r.w}-${r.d}-${r.l}\n${fmt.n(r.ppg, 2)} points per match vs ${fmt.n(r.xppg, 2)} expected by the odds\n${fmt.signed(r.over_pm, 2)} ± ${fmt.n(1.96 * r.se, 2)} per match` })),
      ],
    });
  }, [rows]);
  if (!q.loading && !rows.length) return <Empty>No manager records for {name} with modelled odds (2017-18 onward, Transfermarkt to July 2026).</Empty>;
  return (
    <div className="grid">
      <div className="c12">
        {plot && <Figure title={`${name}'s managers against the odds`}
          subtitle="Each bar is a spell in charge (league matches since 2017-18). Blue: more points than the closing market expected from the same fixtures; red: fewer. The label is points per match above or below expectation."
          source="Transfermarkt, football-data.co.uk closing odds" plot={plot} alt="Manager tenures timeline"
          table={{ rows, cols: [["manager", "Manager"], ["n", "Matches"], ["ppg", "PPG", (v) => fmt.n(v, 2)], ["xppg", "Expected", (v) => fmt.n(v, 2)], ["over_pm", "Over/under", (v) => fmt.signed(v, 2)]] }} />}
      </div>
      <div className="c12">
        <Card title="Every spell" sub="95% interval from the match-to-match spread: a short spell's figure is mostly noise.">
          <DataTable rows={rows} initialSort={{ key: "start_date", desc: true }} cols={[
            { key: "manager", label: "Manager", fmt: (v) => <Link to={`/manager/${slugOf.get(v) ?? managerSlug(String(v))}`}>{v}</Link> },
            { key: "start_date", label: "From", fmt: (v) => fmt.date(v) },
            { key: "end_date", label: "To", fmt: (v) => fmt.date(v) },
            { key: "n", label: "Matches", num: true },
            { key: "w", label: "W-D-L", fmt: (_v, r) => `${r.w}-${r.d}-${r.l}` },
            { key: "ppg", label: "PPG", num: true, fmt: (v) => fmt.n(v, 2) },
            { key: "xppg", label: "Expected PPG", num: true, fmt: (v) => fmt.n(v, 2) },
            { key: "over_pm", label: "vs odds / match", num: true, fmt: (v, r) => <span style={{ color: v >= 0 ? "var(--up-text)" : "var(--critical)" }}>{fmt.signed(v, 2)} <span className="muted xs">± {fmt.n(1.96 * r.se, 2)}</span></span> },
          ]} />
        </Card>
      </div>
    </div>
  );
}
