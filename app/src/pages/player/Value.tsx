import * as Plot from "@observablehq/plot";
import { useMemo } from "react";
import { lit, Row, useQuery } from "../../db";
import { css, fmt, seasonLabel } from "../../lib/format";
import { Figure } from "../../ui/Figure";
import { Card, ClubLink, DataTable, Empty, Loading, Tile } from "../../ui/kit";
import { InlineLegend } from "./shared";

export default function Value({ id, name }: { id: string; name: string }) {
  const vals = useQuery(`select v.*, k.name club from valuations v left join clubs k using (club_id)
                         where player_id = ${lit(id)} order by value_date`);
  const tr = useQuery(`select * from transfers where player_id = ${lit(id)} order by transfer_date`);
  const mk = useQuery(`select * from market where player_id = ${lit(id)} order by season`);

  const v = vals.rows.filter((r) => r.value_eur > 0);
  const t = tr.rows.filter((r) => r.transfer_date);
  const m: Row[] = mk.rows.filter((r) => r.model_value > 0).map((r) => ({ ...r, d: new Date(Date.UTC(r.season + 1, 5, 1)) }) as Row);
  const peak = v.reduce<Row | null>((a, r) => (!a || r.value_eur > a.value_eur ? r : a), null);
  const totalFees = t.reduce((a, r) => a + (r.fee_eur ?? 0), 0);
  const lastVal = v[v.length - 1];
  const lastModel = m[m.length - 1];

  const plot = useMemo(() => {
    if (!v.length && !m.length) return undefined;
    const fees = t.filter((r) => r.fee_eur > 0);
    const all = [...v.map((r) => r.value_eur), ...m.map((r) => r.model_hi), ...fees.map((r) => r.fee_eur)].filter((x) => x > 0);
    const lo = Math.max(1e4, Math.min(...all) * 0.6), hi = Math.max(...all) * 1.5;
    return (width: number) => ({
      width, height: 340, marginLeft: 58, marginRight: 20,
      x: { label: null, type: "utc" as const },
      y: { label: "↑ € (log scale)", type: "log" as const, grid: true, domain: [lo, hi], ticks: 6, tickFormat: (d: number) => fmt.eur(d) },
      marks: [
        Plot.areaY(m, { x: "d", y1: "model_lo", y2: "model_hi", fill: css("--s2"), fillOpacity: 0.12, curve: "monotone-x" }),
        Plot.line(m, { x: "d", y: "model_value", stroke: css("--s2"), strokeWidth: 2, curve: "monotone-x" }),
        Plot.ruleX(t, { x: "transfer_date", stroke: css("--axis"), strokeWidth: 1 }),
        Plot.line(v, { x: "value_date", y: "value_eur", stroke: css("--s1"), strokeWidth: 2, curve: "step-after" }),
        Plot.dot(v, { x: "value_date", y: "value_eur", r: 2.5, fill: css("--s1") }),
        Plot.dot(fees, { x: "transfer_date", y: "fee_eur", r: 5.5, fill: css("--text"), stroke: css("--surface"), strokeWidth: 2, symbol: "diamond" }),
        Plot.text(fees.filter((r) => r.fee_eur >= Math.max(...fees.map((f) => f.fee_eur)) * 0.2), {
          x: "transfer_date", y: "fee_eur", text: (r: Row) => `${fmt.eur(r.fee_eur)} → ${r.to_club_name ?? ""}`, dy: -12, fontSize: 10.5, fill: css("--text-2"), fontWeight: 600,
        }),
        Plot.tip(v, Plot.pointerX({ x: "value_date", y: "value_eur", title: (r: Row) => `${fmt.dayYear(r.value_date)}\nTransfermarkt ${fmt.eur(r.value_eur)}${r.club ? `\nat ${r.club}` : ""}` })),
      ],
    });
  }, [v, m, t]);

  if (vals.loading && !v.length) return <Loading state={vals} />;
  return (
    <div className="grid">
      <div className="c12">
        <div className="tiles">
          <Tile label="Current Transfermarkt value" value={fmt.eur(lastVal?.value_eur)} delta={lastVal ? fmt.dayYear(lastVal.value_date) : undefined} />
          <Tile label="Peak value" value={fmt.eur(peak?.value_eur)} delta={peak ? `${fmt.dayYear(peak.value_date)}${peak.club ? ` · ${peak.club}` : ""}` : undefined} />
          <Tile label="Transfer fees paid for him" value={fmt.eur(totalFees)} delta={`${t.filter((r) => r.fee_eur > 0).length} paid moves of ${t.length}`} />
          {lastModel && <Tile label={`Model value, ${seasonLabel(lastModel.season)}`} value={fmt.eur(lastModel.model_value)}
                              delta={`80% range ${fmt.eur(lastModel.model_lo)}–${fmt.eur(lastModel.model_hi)}`}
                              tone={lastModel.value_eur > lastModel.model_hi ? "down" : lastModel.value_eur < lastModel.model_lo ? "up" : undefined} />}
        </div>
      </div>
      <div className="c12">
        {plot ? (
          <Figure title={peak ? `${name}'s value peaked at ${fmt.eur(peak.value_eur)}` : `${name}'s market value`}
                  subtitle={<>
                    <InlineLegend items={[{ label: "Transfermarkt value", color: "var(--s1)", kind: "line" }, { label: "Model value (band: 80% interval)", color: "var(--s2)", kind: "line" },
                      { label: "Transfer fee (◆) and date (rule)", color: "var(--text)", kind: "dot" }]} />
                    The model estimates an end-of-season value from age, minutes, output, team strength, league and position (out of sample, 80% of players fall inside the band).
                  </>}
                  source="Transfermarkt valuations and transfers; pitchvision value model" plot={plot} alt="Market value over time"
                  table={{ rows: v, cols: [["value_date", "Date", fmt.date], ["value_eur", "Value", fmt.eur], ["club", "Club"]] }} />
        ) : <Empty>No valuations on record.</Empty>}
      </div>
      <div className="c7">
        <Card title="Transfer history" sub="Fees as reported by Transfermarkt; blank = free, loan or undisclosed.">
          {t.length ? (
            <DataTable rows={[...t].reverse()} cols={[
              { key: "transfer_date", label: "Date", fmt: (v) => fmt.dayYear(v) },
              { key: "from_club_name", label: "From", fmt: (v, r) => <ClubLink id={r.from_club} name={v ?? r.from_club} /> },
              { key: "to_club_name", label: "To", fmt: (v, r) => <ClubLink id={r.to_club} name={v ?? r.to_club} /> },
              { key: "fee_eur", label: "Fee", num: true, fmt: (v) => (v > 0 ? fmt.eur(v) : v === 0 ? "free" : "–") },
              { key: "value_eur", label: "Value then", num: true, fmt: (v) => fmt.eur(v) },
            ]} />
          ) : <Empty>No transfers since 2012.</Empty>}
        </Card>
      </div>
      <div className="c5">
        <Card title="Model vs market, by season" sub="Gap = log(Transfermarkt ÷ model). Positive: valued above what his numbers explain.">
          {m.length ? (
            <DataTable rows={[...m].reverse()} cols={[
              { key: "season", label: "Season", fmt: (v) => seasonLabel(v) },
              { key: "value_eur", label: "Transfermarkt", num: true, fmt: (v) => fmt.eur(v) },
              { key: "model_value", label: "Model", num: true, fmt: (v) => fmt.eur(v) },
              { key: "gap", label: "Gap", num: true, fmt: (v, r) => <span style={{ fontWeight: r.inside_80 ? 400 : 650 }}>{fmt.signed(v)}</span> },
            ]} />
          ) : <Empty>No model values (needs top-league minutes).</Empty>}
        </Card>
      </div>
    </div>
  );
}
