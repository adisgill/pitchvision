// A club's shapes over time: the formation barcode (every league match in its formation's
// row, coloured by result, managers marked), then results by formation and against each
// opposing formation, both measured against the closing line. Spec 12.8.
import { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { lit, Row, useQuery } from "../../db";
import { fmt, seasonLabel } from "../../lib/format";
import { formColor } from "../../lib/tactics";
import { EffectBars } from "../../ui/charts";
import { Figure, useWidth } from "../../ui/Figure";
import { Card, Empty, Legend, Loading, Seg, useParam, useTip } from "../../ui/kit";
import { ShapeStyle, WhoPlaysWhere } from "./ShapeDetail";

const RES = { W: "var(--pos)", D: "var(--muted)", L: "var(--neg)" } as const;
const res = (r: Row) => (r.gf > r.ga ? "W" : r.gf < r.ga ? "L" : "D") as keyof typeof RES;

export default function ShapeTab({ id, name }: { id: string; name: string }) {
  const [span, setSpan] = useParam("span", "3");
  const q = useQuery(`select * from team_shape where club_id = ${lit(id)} order by match_date, match_id`);
  const all = q.rows;
  const seasons = useMemo(() => [...new Set(all.map((r) => Number(r.season)))].sort((a, b) => a - b), [all]);
  const keep = span === "all" ? seasons : seasons.slice(-Number(span));
  const rows = useMemo(() => all.filter((r) => keep.includes(Number(r.season)) && r.formation), [all, span, seasons.length]);
  const byForm = useMemo(() => summarise(rows, "formation"), [rows]);
  const byOpp = useMemo(() => summarise(rows.filter((r) => r.opp_formation), "opp_formation"), [rows]);
  if (!q.loading && !all.some((r) => r.formation)) return <Empty>No formations recorded for {name}.</Empty>;
  const top = byForm[0];
  const comp = all[all.length - 1]?.competition_id;
  return (
    <div className="grid">
      <Loading state={q} />
      <div className="c12 row between">
        <Seg label="Seasons shown" options={[["1", "This season"], ["3", "Last 3 seasons"], ["6", "Last 6"], ["all", "All since 2013"]]} value={span} onChange={setSpan} />
        <span className="muted small">{rows.length} league matches with a recorded formation</span>
      </div>
      <div className="c12">
        <Barcode rows={rows} name={name} comp={comp} />
      </div>
      <div className="c12">
        <Card title={top ? `${name} are at their best in a ${[...byForm].filter((f) => f.n >= 10).sort((a, b) => b.b - a.b)[0]?.label ?? top.label}` : "Results by formation"}
              sub="Points per match above or below what the closing odds expected from the same fixtures, with 95% intervals. Shapes with fewer than 10 matches are left out. Managers pick shapes for opponents, so read this as association, not cause."
              foot="Transfermarkt formations to 2023-24, FotMob since · closing odds via football-data.co.uk">
          {byForm.filter((f) => f.n >= 10).length ? <EffectBars unit=" pts/match" rows={byForm.filter((f) => f.n >= 10).map((f) => ({ ...f, label: `${f.label} (${f.n})`, color: formColor(f.label),
            note: <div className="muted">{f.n} matches · {fmt.n(f.ppg, 2)} points per match vs {fmt.n(f.xppg, 2)} expected</div> }))} /> : <p className="muted small">Too few matches in any one shape.</p>}
        </Card>
      </div>
      <div className="c12">
        <Card title="Against each opposing shape" sub="The same measure, by the formation the opponent lined up in. Across all clubs, formation pairings show no effect beyond the odds (see Tactics), so a big number here is most likely noise."
              foot="Transfermarkt formations to 2023-24, FotMob since · closing odds via football-data.co.uk">
          {byOpp.filter((f) => f.n >= 10).length ? <EffectBars unit=" pts/match" rows={byOpp.filter((f) => f.n >= 10).map((f) => ({ ...f, label: `v ${f.label} (${f.n})`, color: "var(--muted)",
            note: <div className="muted">{f.n} matches · {fmt.n(f.ppg, 2)} points per match vs {fmt.n(f.xppg, 2)} expected</div> }))} /> : <p className="muted small">Too few matches against any one shape.</p>}
          <p className="small" style={{ marginTop: 8 }}><Link to="/tactics">Formation matchups across the league →</Link></p>
        </Card>
      </div>
      <WhoPlaysWhere id={id} name={name} />
      <ShapeStyle id={id} name={name} />
      {seasons.length > 0 && <div className="c12 muted xs">Seasons {seasonLabel(seasons[0], comp)} to {seasonLabel(seasons[seasons.length - 1], comp)} available.</div>}
    </div>
  );
}

function summarise(rows: Row[], key: string) {
  const m = new Map<string, Row[]>();
  rows.forEach((r) => { if (r.xpts == null) return; const k = r[key]; if (!m.has(k)) m.set(k, []); m.get(k)!.push(r); });
  return [...m.entries()].map(([label, rs]) => {
    const d = rs.map((r) => r.pts - r.xpts);
    const b = d.reduce((a, v) => a + v, 0) / d.length;
    const sd = Math.sqrt(d.reduce((a, v) => a + (v - b) ** 2, 0) / Math.max(1, d.length - 1)) || 1.2;
    return { label, n: rs.length, b, se: sd / Math.sqrt(rs.length), ppg: rs.reduce((a, r) => a + r.pts, 0) / rs.length, xppg: rs.reduce((a, r) => a + r.xpts, 0) / rs.length };
  }).sort((a, b) => b.n - a.n);
}

function Barcode({ rows, name, comp }: { rows: Row[]; name: string; comp?: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const tip = useTip();
  const nav = useNavigate();
  const forms = useMemo(() => {
    const c = new Map<string, number>();
    rows.forEach((r) => c.set(r.formation, (c.get(r.formation) ?? 0) + 1));
    return [...c.entries()].sort((a, b) => b[1] - a[1]).map(([f, n]) => ({ f, n }));
  }, [rows]);
  const labW = 92, rightW = 46, top = 34, rowH = 22;
  const n = rows.length;
  const step = (width - labW - rightW) / n;
  const x = (i: number) => labW + i * step;
  const yOf = new Map(forms.map((f, i) => [f.f, top + i * rowH]));
  const H = top + forms.length * rowH + 26;
  // manager changes and season starts
  const marks: { i: number; label: string; kind: "mgr" | "season" }[] = [];
  rows.forEach((r, i) => {
    if (i === 0 || r.manager !== rows[i - 1].manager) marks.push({ i, label: r.manager ?? "?", kind: "mgr" });
    if (i > 0 && r.season !== rows[i - 1].season) marks.push({ i, label: seasonLabel(r.season, comp), kind: "season" });
  });
  const sw = Math.max(1, Math.min(10, step - (step > 4 ? 1 : 0)));
  const mgrs = marks.filter((m) => m.kind === "mgr");
  const providerSwitch = rows.findIndex((r) => r.source === "fotmob");
  return (
    <Figure title={forms[0] ? `${name}: ${forms[0].f} in ${fmt.pct(forms[0].n / n)} of ${n} matches${forms.length > 1 ? `, ${forms.length} shapes in all` : ""}`
                             : "Formations"}
            subtitle="Every league match in date order, in the row of the formation the club started in. Colour is the result. Vertical rules mark a new manager (named on top) and a new season (named below)."
            source="Transfermarkt formations to 2023-24, FotMob since"
            table={{ rows, cols: [["match_date", "Date", (v) => fmt.date(v)], ["opp", "Opponent"], ["formation", "Formation"], ["opp_formation", "Their formation"], ["gf", "For"], ["ga", "Against"], ["manager", "Manager"]] }}>
      <div ref={ref}>
        {n > 0 && <svg width={width} height={H} role="img" aria-label={`${name} formations match by match`} style={{ display: "block" }}>
          {forms.map((f) => (
            <g key={f.f}>
              <line x1={labW} x2={width - rightW} y1={yOf.get(f.f)! + rowH / 2} y2={yOf.get(f.f)! + rowH / 2} stroke="var(--grid)" />
              <rect x={6} y={yOf.get(f.f)! + 6} width={8} height={rowH - 12} rx={1.5} fill={formColor(f.f)} />
              <text x={20} y={yOf.get(f.f)! + rowH / 2 + 4} fontSize={11.5} fill="var(--text)" className="num">{f.f}</text>
              <text x={width - rightW + 6} y={yOf.get(f.f)! + rowH / 2 + 4} fontSize={10.5} fill="var(--muted)" className="num">{f.n}</text>
            </g>
          ))}
          {marks.map((m, k) => (
            <line key={k} x1={x(m.i) - 0.5} x2={x(m.i) - 0.5} y1={m.kind === "mgr" ? 14 : top} y2={H - 18}
                  stroke={m.kind === "mgr" ? "var(--text)" : "var(--rule-strong)"} strokeWidth={m.kind === "mgr" ? 1 : 1} strokeDasharray={m.kind === "mgr" ? undefined : "2 3"} />
          ))}
          {mgrs.map((m, k) => {
            const next = mgrs[k + 1]?.i ?? n;
            const room = (next - m.i) * step;
            if (room < 40) return null;
            const label = m.label.length * 6.2 > room - 8 ? m.label.split(" ").slice(-1)[0] : m.label;
            return <text key={k} x={x(m.i) + 4} y={22} fontSize={10.5} fontWeight={600} fill="var(--text)">{label}</text>;
          })}
          {marks.filter((m) => m.kind === "season").map((m, k, all) => {
            const room = ((all[k + 1]?.i ?? n) - m.i) * step;
            const lab = room > 52 ? m.label : room > 22 ? `'${m.label.slice(2, 4)}` : "";
            return <text key={k} x={x(m.i) + 3} y={H - 6} fontSize={10} fill="var(--muted)">{lab}</text>;
          })}
          {providerSwitch > 0 && (
            <text x={x(providerSwitch) + 3} y={top - 4} fontSize={9.5} fill="var(--muted)">FotMob labels from here</text>
          )}
          {rows.map((r, i) => (
            <rect key={r.match_id} x={x(i) + (step - sw) / 2} y={yOf.get(r.formation)! + 3} width={sw} height={rowH - 6} rx={sw > 4 ? 1.5 : 0}
                  fill={RES[res(r)]} style={{ cursor: "pointer" }}
                  onClick={() => nav(`/match/${encodeURIComponent(r.match_id)}`)}
                  onPointerMove={(e) => tip.show(e, <>
                    <b>{fmt.dayYear(r.match_date)} · {r.home ? "v" : "at"} {r.opp}</b>
                    <div>{r.gf}–{r.ga} · {r.formation}{r.opp_formation ? ` v ${r.opp_formation}` : ""}</div>
                    <div className="muted">{r.manager ?? "manager unknown"}{r.xpts != null ? ` · ${fmt.n(r.pts - r.xpts, 2)} points vs the odds` : ""}</div>
                  </>)}
                  onPointerLeave={tip.hide} />
          ))}
        </svg>}
        {tip.node}
        <Legend items={[{ label: "Win", color: "var(--pos)", kind: "rect" }, { label: "Draw", color: "var(--muted)", kind: "rect" }, { label: "Loss", color: "var(--neg)", kind: "rect" }]} />
      </div>
    </Figure>
  );
}
