import * as Plot from "@observablehq/plot";
import { useMemo, useState } from "react";
import { useQuery } from "../db";
import { css, fmt, inkOn, seq } from "../lib/format";
import { scoreMatrix, summarise, wpAt, wpTable } from "../lib/models";
import { ScoreMatrix } from "../ui/charts";
import { Figure } from "../ui/Figure";
import { Card, Field, OutcomeBar, PageHead, Tabs, useParam, useTip } from "../ui/kit";
import { HeatLegend, Pitch, ZoneHeat } from "../ui/pitch";

export default function Lab() {
  const [tab, setTab] = useParam("tab", "wp");
  return (
    <>
      <PageHead eyebrow="Model lab" title="Play with the models"
        lead="The same models that power the forecasts, running live in your browser. Change the inputs and watch the numbers move." />
      <Tabs value={tab} onChange={setTab} tabs={[["wp", "Win probability"], ["score", "Score matrix"], ["xt", "Expected threat"], ["xg", "Shot quality map"], ["red", "Red cards"]]} />
      {tab === "wp" && <WinProb />}
      {tab === "score" && <Scores />}
      {tab === "xt" && <Threat />}
      {tab === "xg" && <ShotMapLab />}
      {tab === "red" && <RedCards />}
    </>
  );
}

function Slider({ label, value, set, min, max, step, show }: { label: string; value: number; set: (v: number) => void; min: number; max: number; step: number; show: string }) {
  return (
    <Field label={`${label}: ${show}`}>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => set(Number(e.target.value))} aria-label={label} />
    </Field>
  );
}

function WinProb() {
  const params = useQuery(`select term, coef from wp_params`);
  const [lh, setLh] = useState(1.6);
  const [la, setLa] = useState(1.1);
  const [minute, setMinute] = useState(60);
  const [hg, setHg] = useState(0);
  const [ag, setAg] = useState(1);
  const [red, setRed] = useState(0);
  const V = useMemo(() => (params.rows.length ? wpTable(lh, la, params.rows as any, red) : null), [params.rows, lh, la, red]);
  const V0 = useMemo(() => (params.rows.length ? wpTable(lh, la, params.rows as any, 0) : null), [params.rows, lh, la]);
  const now = V ? wpAt(V, minute, hg - ag) : null;
  const pre = V0 ? wpAt(V0, 0, 0) : null;
  const curve = useMemo(() => {
    if (!V) return undefined;
    const rows = Array.from({ length: 91 - minute }, (_, i) => minute + i).flatMap((t) => {
      const [h, d, a] = wpAt(V, t, hg - ag);
      return [{ t, p: h, k: "Home win" }, { t, p: d, k: "Draw" }, { t, p: a, k: "Away win" }];
    });
    return (width: number) => ({
      width, height: 260, x: { label: "Minute (if the score doesn't change)", domain: [minute, 90] },
      y: { label: "Probability", domain: [0, 1], tickFormat: "%", grid: true },
      color: { domain: ["Home win", "Draw", "Away win"], range: [css("--s1"), css("--muted"), css("--s2")], legend: true },
      marks: [
        Plot.line(rows, { x: "t", y: "p", stroke: "k", strokeWidth: 2 }),
        Plot.ruleX(rows, Plot.pointerX({ x: "t", stroke: css("--axis") })),
        Plot.tip(rows, Plot.pointerX({ x: "t", y: "p", title: (d: any) => `${d.t}': ${d.k} ${fmt.pct(d.p, 1)}` })),
      ],
    });
  }, [V, minute, hg, ag]);
  const grid = useMemo(() => {
    if (!V) return undefined;
    const rows = [0, 15, 30, 45, 60, 75, 85].flatMap((t) => [-2, -1, 0, 1, 2].map((g) => ({ t, g, p: wpAt(V, t, g)[0] })));
    return (width: number) => ({
      width: Math.min(width, 520), height: 230, padding: 0.06, marginLeft: 60,
      x: { label: "Minute", domain: [0, 15, 30, 45, 60, 75, 85] },
      y: { label: "Home goal difference", domain: [2, 1, 0, -1, -2], tickFormat: (v: number) => fmt.signed(v, 0) },
      color: { type: "linear" as const, domain: [0, 1], range: [css("--seq-100"), css("--seq-700")], legend: true, label: "P(home win)", tickFormat: "%" },
      marks: [
        Plot.cell(rows, { x: "t", y: "g", fill: "p", inset: 1, rx: 4 }),
        Plot.text(rows, { x: "t", y: "g", text: (d: any) => fmt.pct(d.p), fill: (d: any) => inkOn(seq(d.p)), fontSize: 10.5 }),
        Plot.tip(rows, Plot.pointer({ x: "t", y: "g", title: (d: any) => `${d.t}', home ${fmt.signed(d.g, 0)}: ${fmt.pct(d.p, 1)} home win` })),
      ],
    });
  }, [V]);
  return (
    <div className="grid">
      <div className="c4">
        <Card title="Game state" sub="Pre-match expected goals set each side's scoring rate; the score, minute and red cards change it minute by minute.">
          <div className="stack" style={{ gap: 12 }}>
            <Slider label="Home expected goals" value={lh} set={setLh} min={0.3} max={3.5} step={0.05} show={lh.toFixed(2)} />
            <Slider label="Away expected goals" value={la} set={setLa} min={0.3} max={3.5} step={0.05} show={la.toFixed(2)} />
            <Slider label="Minute" value={minute} set={setMinute} min={0} max={89} step={1} show={`${minute}'`} />
            <div className="row">
              <Field label="Home goals"><input type="number" min={0} max={9} value={hg} onChange={(e) => setHg(Math.max(0, Number(e.target.value)))} style={{ width: 80 }} /></Field>
              <Field label="Away goals"><input type="number" min={0} max={9} value={ag} onChange={(e) => setAg(Math.max(0, Number(e.target.value)))} style={{ width: 80 }} /></Field>
            </div>
            <Field label="Red cards">
              <select value={red} onChange={(e) => setRed(Number(e.target.value))}>
                <option value={0}>Level</option><option value={1}>Away down to ten</option><option value={-1}>Home down to ten</option>
              </select>
            </Field>
          </div>
        </Card>
      </div>
      <div className="c8 stack" style={{ gap: 16 }}>
        <Card title={now ? `Home ${fmt.pct(now[0])} · draw ${fmt.pct(now[1])} · away ${fmt.pct(now[2])}` : "…"}
              sub={pre ? <>At kickoff these teams were {fmt.pct(pre[0])} / {fmt.pct(pre[1])} / {fmt.pct(pre[2])}. Calibrated on 2017-18 to 2020-21; tested on 2021-22 onward, where it beats the pre-match odds in every 15-minute bucket.</> : null}>
          {now && <OutcomeBar h={now[0]} d={now[1]} a={now[2]} labels={["Home win", "Draw", "Away win"]} />}
        </Card>
        {curve && <Figure title="How the odds drift if nothing happens" subtitle="Each minute without a goal moves probability toward the current result." plot={curve} source="pitchvision win-probability model" alt="Win probability over the remaining minutes" />}
        {grid && <Figure title="Home win chance by minute and score" subtitle="For the expected goals and red-card state set on the left." plot={grid} source="pitchvision win-probability model" alt="Grid of home win probability by minute and goal difference" />}
      </div>
    </div>
  );
}

function Scores() {
  const [lh, setLh] = useState(1.55);
  const [la, setLa] = useState(1.05);
  const [rho, setRho] = useState(-0.06);
  const m = useMemo(() => scoreMatrix(lh, la, rho), [lh, la, rho]);
  const s = useMemo(() => summarise(m), [m]);
  return (
    <div className="grid">
      <div className="c4">
        <Card title="Inputs" sub="Expected goals for each side and the Dixon-Coles low-score correction (negative rho makes 0-0 and 1-1 likelier).">
          <div className="stack" style={{ gap: 12 }}>
            <Slider label="Home expected goals" value={lh} set={setLh} min={0.2} max={4} step={0.05} show={lh.toFixed(2)} />
            <Slider label="Away expected goals" value={la} set={setLa} min={0.2} max={4} step={0.05} show={la.toFixed(2)} />
            <Slider label="rho" value={rho} set={setRho} min={-0.2} max={0.1} step={0.01} show={rho.toFixed(2)} />
          </div>
        </Card>
      </div>
      <div className="c4"><Card title="Every score" sub="Probability (%) of each final score; hover for fair odds."><ScoreMatrix m={m} home="Home" away="Away" /></Card></div>
      <div className="c4">
        <Card title="What it implies">
          <OutcomeBar h={s.home} d={s.draw} a={s.away} />
          <table className="data" style={{ marginTop: 12 }}><tbody>
            {[["Both teams score", s.btts], ["Over 1.5 goals", s.over15], ["Over 2.5 goals", s.over25], ["Over 3.5 goals", s.over35], ["Home clean sheet", s.cleanHome], ["Away clean sheet", s.cleanAway]].map(([l, p]) => (
              <tr key={l as string}><td>{l}</td><td className="r">{fmt.pct(p as number, 1)}</td><td className="r muted">{fmt.odds(p)}</td></tr>
            ))}
            <tr><td>Most likely score</td><td className="r">{s.top[0].h}–{s.top[0].a}</td><td className="r muted">{fmt.pct(s.top[0].p, 1)}</td></tr>
          </tbody></table>
        </Card>
      </div>
    </div>
  );
}

function Threat() {
  const g = useQuery(`select * from xt_grid order by cx, cy`);
  const tip = useTip();
  const [from, setFrom] = useState<{ cx: number; cy: number } | null>(null);
  const [hover, setHover] = useState<{ cx: number; cy: number } | null>(null);
  const nx = 16, ny = 12, cw = 105 / nx, ch = 68 / ny;
  const val = (cx: number, cy: number) => g.rows.find((r) => r.cx === cx && r.cy === cy)?.xt ?? 0;
  const max = Math.max(1e-9, ...g.rows.map((r) => r.xt));
  const added = from && hover ? val(hover.cx, hover.cy) - val(from.cx, from.cy) : null;
  return (
    <div className="grid">
      <div className="c8">
        <Card title="Expected threat: what every part of the pitch is worth"
              sub="The chance that possession in a cell ends in a goal within the next few actions (a 16 × 12 Markov model fitted on StatsBomb and Wyscout events). Click a cell to start a move, then hover any other cell to see the threat that pass or carry would add.">
          <Pitch>
            {g.rows.map((r) => {
              const isFrom = from?.cx === r.cx && from?.cy === r.cy;
              return (
                <rect key={`${r.cx}-${r.cy}`} className="zone" x={r.cx * cw + 0.1} y={r.cy * ch + 0.1} width={cw - 0.2} height={ch - 0.2} rx={0.5}
                      fill={seq(Math.sqrt(r.xt / max))} fillOpacity={0.2 + 0.8 * Math.sqrt(r.xt / max)}
                      stroke={isFrom ? "var(--s2)" : undefined} strokeWidth={isFrom ? 0.8 : undefined} style={{ cursor: "pointer" }}
                      onClick={() => setFrom({ cx: r.cx, cy: r.cy })}
                      onPointerMove={(e) => { setHover({ cx: r.cx, cy: r.cy }); tip.show(e, <><b>{fmt.pct(r.xt, 2)}</b><div className="muted">chance this possession becomes a goal</div>
                        {from && <div>move from the selected cell: <b>{fmt.signed(100 * (r.xt - val(from.cx, from.cy)), 2)} pp</b></div>}</>); }}
                      onPointerLeave={() => { setHover(null); tip.hide(); }} />
              );
            })}
            {from && hover && (
              <line x1={from.cx * cw + cw / 2} y1={from.cy * ch + ch / 2} x2={hover.cx * cw + cw / 2} y2={hover.cy * ch + ch / 2}
                    stroke="var(--s2)" strokeWidth={0.7} strokeLinecap="round" markerEnd="none" pointerEvents="none" />
            )}
          </Pitch>
          {tip.node}
          <HeatLegend mode="seq" lo="0%" hi={fmt.pct(max, 1)} label="threat (square-root scale)" />
        </Card>
      </div>
      <div className="c4 stack" style={{ gap: 16 }}>
        <Card title={added == null ? "Pick a starting cell" : `${added >= 0 ? "Adds" : "Costs"} ${Math.abs(100 * added).toFixed(2)} percentage points`}
              sub="xT added is how much a successful pass or carry raises the chance of scoring. Summed over a season it values build-up play that never shows in goals or assists.">
          <p className="small ink2">The most valuable cell is worth {fmt.pct(max, 1)}: just in front of goal. Your own box is worth almost nothing, and the
            zones wide of the box are worth far less than the half-spaces either side of the D, which is why cut-backs beat crosses.</p>
        </Card>
      </div>
    </div>
  );
}

function ShotMapLab() {
  const z = useQuery(`select zx, zy, sum(shots) shots, sum(xg) xg, sum(goals) goals from zones_team where side = 'for' group by all`);
  const [m, setM] = useState<"xgps" | "share" | "conv">("xgps");
  const total = z.rows.reduce((a, r) => a + r.shots, 0);
  const cells = z.rows.filter((r) => r.zx >= 6 && r.shots >= 30).map((r) => ({
    zx: r.zx, zy: r.zy,
    v: m === "xgps" ? r.xg / r.shots : m === "share" ? r.shots / total : r.goals / r.shots - r.xg / r.shots,
    r,
  }));
  return (
    <div className="grid">
      <div className="c8">
        <Card title="Where shots come from, and what they're worth"
              sub={`${fmt.n(total)} shots from every event-data season (StatsBomb and Wyscout), by 8.75 × 8.5 m zone. Zones with fewer than 30 shots are left blank.`}
              right={<div className="seg">{([["xgps", "xG per shot"], ["share", "Share of shots"], ["conv", "Goals − xG per shot"]] as const).map(([k, l]) =>
                <button key={k} aria-pressed={m === k} onClick={() => setM(k)}>{l}</button>)}</div>}>
          <ZoneHeat cells={cells} mode={m === "conv" ? "div" : "seq"} labelTop={8}
                    fmtV={(v) => (m === "conv" ? fmt.signed(v, 3) : fmt.pct(v, m === "share" ? 1 : 0))}
                    title={(c: any) => <><b>{m === "conv" ? fmt.signed(c.v, 3) : fmt.pct(c.v, 1)}</b>
                      <div className="muted">{fmt.n(c.r.shots)} shots · {fmt.n(c.r.goals)} goals · {fmt.n(c.r.xg, 1)} xG</div></>} />
          <HeatLegend mode={m === "conv" ? "div" : "seq"} lo={m === "conv" ? "below xG" : "low"} hi={m === "conv" ? "above xG" : "high"} label={m === "conv" ? "finishing vs our xG model" : ""} />
        </Card>
      </div>
      <div className="c4">
        <Card title="Reading it" sub="Our xG model is calibrated: goals minus xG is close to zero in every zone, which is what an honest shot model should show. The value is in the gradient: a shot from the six-yard box is worth ten from the edge of the area." />
      </div>
    </div>
  );
}

function RedCards() {
  const r = useQuery(`select * from wp_red_card order by minute`);
  const plot = useMemo(() => {
    if (!r.rows.length) return undefined;
    return (width: number) => ({
      width, height: 300, x: { label: "Minute of the red card" }, y: { label: "Expected points lost", grid: true },
      marks: [
        Plot.areaY(r.rows, { x: "minute", y: "cost_xpts", fill: css("--neg"), fillOpacity: 0.1, curve: "monotone-x" }),
        Plot.line(r.rows, { x: "minute", y: "cost_xpts", stroke: css("--neg"), strokeWidth: 2, curve: "monotone-x" }),
        Plot.ruleX(r.rows, Plot.pointerX({ x: "minute", stroke: css("--axis") })),
        Plot.tip(r.rows, Plot.pointerX({ x: "minute", y: "cost_xpts", title: (d: any) => `Red at ${d.minute}': costs ${d.cost_xpts.toFixed(2)} expected points\n(${d.home_xpts_11v11.toFixed(2)} → ${d.home_xpts_10v11.toFixed(2)})` })),
      ],
    });
  }, [r.rows]);
  const first = r.rows[0], late = r.rows.find((x) => x.minute >= 80);
  return (
    <div className="grid">
      <div className="c8">{plot && <Figure title={first ? `A first-minute red costs ${first.cost_xpts.toFixed(2)} points; at 80 minutes, ${late?.cost_xpts.toFixed(2)}` : "What a red card costs"}
        subtitle="Expected points lost by a side going down to ten men at level score, average teams, from the game-state model."
        source="pitchvision win-probability model" plot={plot} alt="Expected points cost of a red card by minute"
        table={{ rows: r.rows, cols: [["minute", "Minute"], ["cost_xpts", "Points lost", (v) => v.toFixed(3)]] }} />}</div>
      <div className="c4"><Card title="Why it matters" sub="A professional foul to stop a clear chance late in a game can be worth it in expected points; early, it almost never is. The model sees ten men score about 42% less often and concede about 69% more." /></div>
    </div>
  );
}
