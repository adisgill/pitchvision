import * as Plot from "@observablehq/plot";
import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { css, DataTable, Figure, fmt, LEAGUES, Loading, PlayerLink, seasonLabel, Select } from "../components";
import { lit, useQuery } from "../db";

const POS = ["all", "GK", "CB", "FB", "DM", "CM", "AM", "W", "ST"];

export default function Market() {
  const [params, setParams] = useSearchParams();
  const league = params.get("league") ?? "GB1";
  const season = Number(params.get("season") ?? 2025);
  const pos = params.get("pos") ?? "all";
  const set = (k: string, v: string) => { const p = new URLSearchParams(params); p.set(k, v); setParams(p); };
  const rows = useQuery(`select m.*, p.name from market m join players p using (player_id)
                         where league = ${lit(league)} and season = ${season} and value_eur is not null
                         ${pos === "all" ? "" : `and grp = ${lit(pos)}`}`);
  const ev = useQuery(`select * from market_eval where scope = 'all'`);

  const plot = useMemo(() => {
    if (!rows.rows.length) return undefined;
    return (width: number) => ({
      width, height: Math.min(560, width * 0.8), grid: true,
      x: { type: "log" as const, label: "Model value →", tickFormat: (v: number) => fmt.eur(v) },
      y: { type: "log" as const, label: "↑ Transfermarkt value", tickFormat: (v: number) => fmt.eur(v) },
      marks: [
        Plot.line([[1e5, 1e5], [3e8, 3e8]], { stroke: css("--line") }),
        Plot.dot(rows.rows, { x: "model_value", y: "value_eur", r: 3.5, fillOpacity: 0.7,
                              fill: (d: any) => (d.inside_80 ? css("--neutral") : d.gap > 0 ? css("--bad") : css("--good")),
                              title: (d: any) => `${d.name} (${d.grp ?? "?"}, ${fmt.n(d.age, 0)})\nTransfermarkt ${fmt.eur(d.value_eur)}\nmodel ${fmt.eur(d.model_value)} (80%: ${fmt.eur(d.model_lo)}–${fmt.eur(d.model_hi)})` }),
      ],
    });
  }, [rows.rows]);

  const e = ev.rows[0];
  return (
    <>
      <h1>Market value</h1>
      <div className="controls">
        <Select label="League" value={league} onChange={(v) => set("league", v)} options={["GB1", "ES1", "L1", "IT1", "FR1", "NL1", "PO1"].map((k) => [k, LEAGUES[k]])} />
        <Select label="Season" value={String(season)} onChange={(v) => set("season", v)}
                options={Array.from({ length: 14 }, (_, i) => 2025 - i).map((s) => [String(s), seasonLabel(s)])} />
        <Select label="Position" value={pos} onChange={(v) => set("pos", v)} options={POS.map((p) => [p, p === "all" ? "All" : p])} />
      </div>
      {e && (
        <p className="small muted">The model predicts a player's end-of-season Transfermarkt value from age, minutes, output, team strength,
          league and position. Out of sample it explains {fmt.pct(e.r2_log)} of the variance (log scale), the typical miss is {fmt.pct(e.median_abs_pct_error)},
          and its 80% interval contains {fmt.pct(e.inside_80)} of players. A gap is not a bargain: it means Transfermarkt sees something these inputs don't.</p>
      )}
      <Loading state={rows} />
      <div className="grid">
        <div className="span-6">
          {plot && <Figure title="Transfermarkt value vs model value" subtitle="Orange: valued above the model's 80% interval. Blue: below it. Grey: inside."
                           source="Transfermarkt" plot={plot} alt="Scatter of Transfermarkt value against model value" />}
        </div>
        <div className="span-6 card">
          <p className="figure-title">Biggest gaps</p>
          <p className="figure-sub">Gap = log(Transfermarkt ÷ model). Positive: the market values them above the model.</p>
          <DataTable rows={rows.rows} initialSort={{ key: "gap", desc: true }} cols={[
            { key: "name", label: "Player", fmt: (v, r) => <PlayerLink id={r.player_id} name={v} /> },
            { key: "grp", label: "Pos" },
            { key: "age", label: "Age", num: true, fmt: (v) => fmt.n(v, 0) },
            { key: "value_eur", label: "Transfermarkt", num: true, fmt: (v) => fmt.eur(v) },
            { key: "model_value", label: "Model", num: true, fmt: (v) => fmt.eur(v) },
            { key: "gap", label: "Gap", num: true, fmt: (v) => fmt.signed(v) },
          ]} />
        </div>
      </div>
    </>
  );
}
