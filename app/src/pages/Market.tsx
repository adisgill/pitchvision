// The market-value model: what a player's numbers say he's worth, against Transfermarkt.
import * as Plot from "@observablehq/plot";
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { lit, Row, useQuery } from "../db";
import { css, fmt, LEAGUES, PLAYER_LEAGUES, POSITIONS, POSITION_NAMES, seasonLabel, slot } from "../lib/format";
import { Figure } from "../ui/Figure";
import { Card, DataTable, Field, Loading, PageHead, PlayerLink, Select, Tile, useParam } from "../ui/kit";
import { InlineLegend } from "./player/shared";

export default function Market() {
  const nav = useNavigate();
  const [league, setLeague] = useParam("league", "GB1");
  const [season, setSeason] = useParam("season", "2025");
  const [pos, setPos] = useParam("pos", "all");
  const [q, setQ] = useParam("q", "");
  const res = useQuery(`select m.*, p.name, c.club_id, k.name club from market m join players p using (player_id)
      left join (select player_id, season, arg_max(club_id, minutes) club_id from players_c group by all) c using (player_id, season)
      left join clubs k on k.club_id = c.club_id
      where m.league = ${lit(league)} and m.season = ${Number(season)} and m.value_eur > 0 and m.model_value > 0
      ${pos === "all" ? "" : `and m.grp = ${lit(pos)}`}`);
  const ev = useQuery(`select * from market_eval`);
  const ages = useQuery(`select round(age)::int as a, median(value_eur) as tm, median(model_value) as model, count(*) as n
      from market where league = ${lit(league)} and season = ${Number(season)} and value_eur > 0 and model_value > 0 ${pos === "all" ? "" : `and grp = ${lit(pos)}`}
      group by 1 having count(*) >= 8 order by a`);

  const rows = res.rows;
  const all = ev.rows.find((r) => r.scope === "all");
  const thisSeason = ev.rows.find((r) => r.scope === String(season));
  const term = q.trim().toLowerCase();
  const found = term.length >= 2 ? rows.filter((r) => (r.name ?? "").toLowerCase().includes(term)).slice(0, 3) : [];
  const above = rows.filter((r) => !r.inside_80 && r.gap > 0).sort((a, b) => b.gap - a.gap);
  const below = rows.filter((r) => !r.inside_80 && r.gap < 0).sort((a, b) => a.gap - b.gap);
  const total = rows.reduce((s, r) => s + r.value_eur, 0), totalModel = rows.reduce((s, r) => s + r.model_value, 0);

  const scatter = useMemo(() => {
    if (!rows.length) return undefined;
    const hl = new Set(found);
    const extremes = [...rows].sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap)).slice(0, 5);
    const labelled = [...new Set([...extremes, ...found])];
    const lo = Math.min(...rows.map((r) => Math.min(r.value_eur, r.model_value))) * 0.8;
    const hi = Math.max(...rows.map((r) => Math.max(r.value_eur, r.model_value))) * 1.2;
    const col = (r: Row) => (r.inside_80 ? css("--muted") : r.gap > 0 ? css("--neg") : css("--pos"));
    return (width: number) => ({
      width, height: Math.min(560, Math.max(340, width * 0.75)), marginLeft: 58,
      x: { type: "log" as const, label: "Model value →", domain: [lo, hi], tickFormat: (v: number) => fmt.eur(v), grid: true, ticks: 6 },
      y: { type: "log" as const, label: "↑ Transfermarkt value", domain: [lo, hi], tickFormat: (v: number) => fmt.eur(v), grid: true, ticks: 6 },
      marks: [
        Plot.line([[lo, lo], [hi, hi]], { stroke: css("--axis") }),
        Plot.dot(rows.filter((r) => !hl.has(r)), { x: "model_value", y: "value_eur", r: 4, fill: col, fillOpacity: (r: Row) => (r.inside_80 ? 0.35 : 0.8) }),
        Plot.dot(found, { x: "model_value", y: "value_eur", r: 6.5, fill: (_d: Row, i: number) => slot(i + 1), stroke: css("--surface"), strokeWidth: 2 }),
        Plot.text(labelled, { x: "model_value", y: "value_eur", text: (r: Row) => (r.name ?? "").split(" ").slice(-1)[0], dy: -10, fontSize: 10.5, fill: css("--text-2"), fontWeight: 600 }),
        Plot.dot(rows, Plot.pointer({ x: "model_value", y: "value_eur", r: 8, fill: "none", stroke: css("--accent"), strokeWidth: 2, maxRadius: 30 })),
        Plot.tip(rows, Plot.pointer({ x: "model_value", y: "value_eur", maxRadius: 30, title: (r: Row) =>
          `${r.name} (${r.grp ?? "?"}, ${fmt.n(r.age, 0)})${r.club ? ` · ${r.club}` : ""}\nTransfermarkt ${fmt.eur(r.value_eur)}\nModel ${fmt.eur(r.model_value)} (80%: ${fmt.eur(r.model_lo)}–${fmt.eur(r.model_hi)})\n${fmt.n(r.minutes_)} minutes` })),
      ],
    });
  }, [rows, found.map((f) => f.player_id).join(",")]);

  const agePlot = useMemo(() => {
    const d = ages.rows;
    if (!d.length) return undefined;
    const pts = d.map((r) => ({ a: r.a, tm: r.tm, model: r.model, n: r.n }));
    const long = pts.flatMap((p) => [{ a: p.a, v: p.tm, k: "Transfermarkt", n: p.n }, { a: p.a, v: p.model, k: "Model", n: p.n }]);
    return { pts, plot: (width: number) => ({
      width, height: 280, marginLeft: 58,
      x: { label: "Age →", grid: false }, y: { label: "↑ Median value", type: "log" as const, grid: true, ticks: 5, tickFormat: (v: number) => fmt.eur(v) },
      color: { domain: ["Transfermarkt", "Model"], range: [slot(1), slot(2)] },
      marks: [
        Plot.line(long, { x: "a", y: "v", stroke: "k", strokeWidth: 2, curve: "monotone-x" }),
        Plot.dot(long, { x: "a", y: "v", fill: "k", r: 3.5, stroke: css("--surface"), strokeWidth: 1.5 }),
        Plot.tip(pts, Plot.pointerX({ x: "a", y: "tm", title: (p: any) => `Age ${p.a} (${p.n} players)\nTransfermarkt median ${fmt.eur(p.tm)}\nModel median ${fmt.eur(p.model)}` })),
      ],
    }) };
  }, [ages.rows]);

  const gapCols = [
    { key: "name", label: "Player", fmt: (v: any, r: Row) => <PlayerLink id={r.player_id} name={v} /> },
    { key: "grp", label: "Pos" },
    { key: "age", label: "Age", num: true, fmt: (v: any) => fmt.n(v, 0) },
    { key: "value_eur", label: "Transfermarkt", num: true, fmt: (v: any) => fmt.eur(v) },
    { key: "model_value", label: "Model", num: true, fmt: (v: any) => fmt.eur(v) },
    { key: "gap", label: "Gap", num: true, fmt: (v: any) => `×${Math.exp(v).toFixed(2)}`, title: "Transfermarkt ÷ model" },
  ];
  const ctx = `${LEAGUES[league]} ${seasonLabel(Number(season))}`;

  return (
    <>
      <PageHead eyebrow={`Market value · ${ctx}`}
                title={above[0] ? <>{above[0].name} is valued {Math.exp(above[0].gap).toFixed(1)}× what his numbers explain</> : "What players' numbers say they're worth"}
                lead={<>A model of each player's end-of-season Transfermarkt value from age, minutes, output, team strength, league and position, fitted out of sample. A gap is not a bargain:
                  it means the market sees something these inputs don't (potential, reputation, contract, injuries).</>} />
      <div className="filters">
        <Select label="League" value={league} onChange={setLeague} options={PLAYER_LEAGUES.map((k) => [k, LEAGUES[k]])} />
        <Select label="Season" value={season} onChange={setSeason} options={Array.from({ length: 14 }, (_, i) => 2025 - i).map((s) => [String(s), seasonLabel(s)])} />
        <Select label="Position" value={pos} onChange={setPos} options={[["all", "All positions"], ...POSITIONS.map((p) => [p, POSITION_NAMES[p]] as [string, string])]} />
        <Field label="Highlight player"><input type="search" placeholder="Type a name" value={q} onChange={(e) => setQ(e.target.value || null)} /></Field>
      </div>
      <div className="tiles" style={{ marginBottom: 16 }}>
        <Tile label="Variance explained (log value)" value={fmt.pct(thisSeason?.r2_log ?? all?.r2_log)} delta={`${seasonLabel(Number(season))}, out of sample · all seasons ${fmt.pct(all?.r2_log)}`} />
        <Tile label="Typical miss" value={fmt.pct(thisSeason?.median_abs_pct_error ?? all?.median_abs_pct_error)} delta="median absolute % error" />
        <Tile label="Inside the 80% band" value={fmt.pct(thisSeason?.inside_80 ?? all?.inside_80)} delta="should be 80%: the band is honest" />
        <Tile label="Squad value in view" value={fmt.eur(total)} delta={`model ${fmt.eur(totalModel)} · ${rows.length} players`} />
      </div>
      <Loading state={res} />
      <div className="grid">
        <div className="c7">
          {scatter && (
            <Figure title="Transfermarkt value against model value" stale={res.loading}
                    subtitle={<><InlineLegend items={[{ label: "Above the model's 80% band", color: "var(--neg)" }, { label: "Below it", color: "var(--pos)" }, { label: "Inside", color: "var(--muted)" }]} />
                      Diagonal = market and model agree. Log scales. Click a dot for the player.</>}
                    source="Transfermarkt; pitchvision value model" plot={scatter} alt="Scatter of Transfermarkt value against model value"
                    onRender={(el) => el.addEventListener("click", () => { const v = (el as any).value; if (v?.player_id) nav(`/player/${encodeURIComponent(v.player_id)}`); })}
                    table={{ rows: [...rows].sort((a, b) => b.value_eur - a.value_eur), cols: [["name", "Player"], ["grp", "Pos"], ["value_eur", "Transfermarkt", fmt.eur], ["model_value", "Model", fmt.eur], ["gap", "Gap (log)", (v) => fmt.signed(v)]] }} />
          )}
        </div>
        <div className="c5">
          {agePlot && (
            <Figure title={(() => {
                      const p = agePlot.pts; if (p.length < 3) return "Value by age";
                      const r = (x: any) => x.tm / x.model, young = r(p[0]), old = r(p[p.length - 1]);
                      return young > old * 1.15 ? `The market pays ${fmt.pct(young / old - 1)} more for youth than output explains` : old > young * 1.15 ? "The market pays more for experience than output explains" : "Market and model value age alike";
                    })()}
                    subtitle={<><InlineLegend items={[{ label: "Transfermarkt", color: slot(1), kind: "line" }, { label: "Model", color: slot(2), kind: "line" }]} />
                      Median value by age, {pos === "all" ? "all positions" : POSITION_NAMES[pos]?.toLowerCase() + "s"} (ages with 8+ players).</>}
                    source="Transfermarkt; pitchvision value model" plot={agePlot.plot} alt="Median value by age"
                    table={{ rows: agePlot.pts, cols: [["a", "Age"], ["tm", "Transfermarkt", fmt.eur], ["model", "Model", fmt.eur], ["n", "Players"]] }} />
          )}
        </div>
        <div className="c6">
          <Card title="Valued above what their numbers explain" sub={`Outside the 80% band, high side (${above.length} players). Gap = Transfermarkt ÷ model.`}>
            <DataTable rows={above} cols={gapCols} limit={25} />
          </Card>
        </div>
        <div className="c6">
          <Card title="Valued below what their numbers explain" sub={`Outside the 80% band, low side (${below.length} players).`}>
            <DataTable rows={below} cols={gapCols} limit={25} />
          </Card>
        </div>
      </div>
    </>
  );
}
