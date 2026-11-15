import * as Plot from "@observablehq/plot";
import { useMemo } from "react";
import { lit, Row, useQuery } from "../../db";
import { css, fmt } from "../../lib/format";
import { Figure } from "../../ui/Figure";
import { Card, ClubLink, DataTable, Empty, Legend, PlayerLink, Tile } from "../../ui/kit";

export default function TransfersTab({ id, name }: { id: string; name: string }) {
  const t = useQuery(`select t.*, p.name from transfers t left join players p using (player_id)
    where t.to_club = ${lit(id)} or t.from_club = ${lit(id)} order by transfer_date desc`);
  const rows: Row[] = useMemo(() => t.rows.map((r) => ({ ...r, dir: r.to_club === id ? "in" : "out",
    other: r.to_club === id ? r.from_club_name : r.to_club_name, other_id: r.to_club === id ? r.from_club : r.to_club })), [t.rows, id]);
  const bySeason = useMemo(() => {
    const m = new Map<string, { season: string; spend: number; income: number; inN: number; outN: number }>();
    rows.forEach((r) => {
      const s = m.get(r.transfer_season) ?? { season: r.transfer_season, spend: 0, income: 0, inN: 0, outN: 0 };
      if (r.dir === "in") { s.spend += r.fee_eur ?? 0; s.inN++; } else { s.income += r.fee_eur ?? 0; s.outN++; }
      m.set(r.transfer_season, s);
    });
    return [...m.values()].map((s) => ({ ...s, net: s.spend - s.income })).sort((a, b) => a.season.localeCompare(b.season));
  }, [rows]);

  const plot = useMemo(() => {
    if (!bySeason.length) return undefined;
    const long = bySeason.flatMap((s) => [{ season: s.season, k: "Spent", v: s.spend }, { season: s.season, k: "Received", v: -s.income }]);
    return (width: number) => ({
      width, height: 280, marginLeft: 56, x: { label: null, domain: bySeason.map((s) => s.season), padding: 0.25 },
      y: { label: "↑ Spent  ·  received ↓ (€m)", grid: true, tickFormat: (v: number) => `${Math.round(v / 1e6)}` },
      color: { domain: ["Spent", "Received"], range: [css("--s1"), css("--s2")] },
      marks: [
        Plot.ruleY([0], { stroke: css("--axis") }),
        Plot.barY(long, { x: "season", y: "v", fill: "k", rx: 3 }),
        Plot.line(bySeason, { x: "season", y: "net", stroke: css("--text"), strokeWidth: 2 }),
        Plot.dot(bySeason, { x: "season", y: "net", r: 4, fill: css("--text"), stroke: css("--surface"), strokeWidth: 2 }),
        Plot.tip(bySeason, Plot.pointerX({ x: "season", y: "net", title: (d: any) => `${d.season}\nspent ${fmt.eur(d.spend)} on ${d.inN} arrivals\nreceived ${fmt.eur(d.income)} from ${d.outN} departures\nnet ${fmt.eur(d.net)}` })),
      ],
    });
  }, [bySeason]);

  if (!t.loading && !rows.length) return <Empty>No transfers recorded for {name} (Transfermarkt, from July 2012).</Empty>;
  const spend = bySeason.reduce((a, s) => a + s.spend, 0), income = bySeason.reduce((a, s) => a + s.income, 0);
  const priciest = rows.filter((r) => r.dir === "in" && r.fee_eur).sort((a, b) => b.fee_eur - a.fee_eur)[0];
  const biggestSale = rows.filter((r) => r.dir === "out" && r.fee_eur).sort((a, b) => b.fee_eur - a.fee_eur)[0];
  const undisclosed = rows.filter((r) => r.fee_eur == null).length;
  const cols = [
    { key: "transfer_date", label: "Date", fmt: (v: any) => fmt.date(v) },
    { key: "name", label: "Player", fmt: (v: any, r: Row) => <PlayerLink id={r.player_id} name={v ?? r.player_id} /> },
    { key: "other", label: "Club", fmt: (v: any, r: Row) => <ClubLink id={r.other_id} name={v ?? r.other_id} /> },
    { key: "fee_eur", label: "Fee", num: true, fmt: (v: any) => (v == null ? <span className="muted">undisclosed</span> : v === 0 ? "free" : fmt.eur(v)) },
    { key: "value_eur", label: "Value then", num: true, fmt: (v: any) => fmt.eur(v) },
  ];
  return (
    <div className="grid">
      <div className="c12 tiles">
        <Tile label="Spent since 2012-13" value={fmt.eur(spend)} />
        <Tile label="Received" value={fmt.eur(income)} />
        <Tile label="Net spend" value={fmt.eur(spend - income)} tone={spend - income > 0 ? "down" : "up"} delta={spend > income ? "a net buyer" : "a net seller"} />
        {priciest && <Tile label="Record signing" value={fmt.eur(priciest.fee_eur)} delta={`${priciest.name ?? "?"}, ${priciest.transfer_season}`} />}
        {biggestSale && <Tile label="Record sale" value={fmt.eur(biggestSale.fee_eur)} delta={`${biggestSale.name ?? "?"}, ${biggestSale.transfer_season}`} />}
      </div>
      <div className="c12">
        {plot && <Figure title={`${name} transfer spending by season`} subtitle={<>Fees paid (up) and received (down) per transfer window season; the line is net spend. {undisclosed} of {rows.length} moves have no disclosed fee and count as zero.</>}
          right={<Legend items={[{ label: "Spent", color: "var(--s1)", kind: "rect" }, { label: "Received", color: "var(--s2)", kind: "rect" }, { label: "Net", color: "var(--text)", kind: "line" }]} />}
          source="Transfermarkt" plot={plot} alt="Transfer spending by season"
          table={{ rows: bySeason, cols: [["season", "Season"], ["spend", "Spent", (v) => fmt.eur(v)], ["income", "Received", (v) => fmt.eur(v)], ["net", "Net", (v) => fmt.eur(v)]] }} />}
      </div>
      <div className="c6"><Card title="Arrivals"><DataTable rows={rows.filter((r) => r.dir === "in")} initialSort={{ key: "fee_eur", desc: true }} maxHeight={480} cols={cols} /></Card></div>
      <div className="c6"><Card title="Departures"><DataTable rows={rows.filter((r) => r.dir === "out")} initialSort={{ key: "fee_eur", desc: true }} maxHeight={480} cols={cols} /></Card></div>
    </div>
  );
}
