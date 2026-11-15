// Win probability through a match, built for reading at a glance: three lines (home win,
// draw, away win) with values labelled at the whistle, an event lane above the plot with
// every goal (minute, scorer, score) and red card, and a crosshair that reads out all three
// probabilities and the score at any minute.
import { useMemo, useState } from "react";
import { Row } from "../../db";
import { fmt } from "../../lib/format";
import { useWidth } from "../../ui/Figure";
import { useTip } from "../../ui/kit";
import { WpPoint } from "./shared";

type Ev = { minute: number; kind: "goal" | "red"; home: boolean; who: string; score?: string; og?: boolean; pen?: boolean };

export function WinProbChart({ wp, home, away, goals, reds, homeId }: {
  wp: WpPoint[]; home: string; away: string; goals: Row[]; reds: Row[]; homeId: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const tip = useTip();
  const [hover, setHover] = useState<number | null>(null);
  const narrow = width < 560;
  const ml = 40, mr = narrow ? 64 : 150, mb = 34;
  const pw = Math.max(120, width - ml - mr);
  let mt = 62;
  let ph = 0;
  let H = 0;
  const x = (t: number) => ml + (t / 90) * pw;
  const y = (p: number) => mt + (1 - p) * ph;
  const surname = (n: string | null | undefined) => (n ? n.split(" ").slice(-1)[0] : "?");

  const events: Ev[] = useMemo(() => {
    let h = 0, a = 0;
    const gs = [...goals].sort((p, q) => p.minute - q.minute).map((g) => {
      const isHome = g.club_id === homeId;
      if (isHome) h++; else a++;
      return { minute: g.minute, kind: "goal" as const, home: isHome, who: surname(g.name), score: `${h}–${a}`, og: !!g.is_own_goal, pen: !!g.is_penalty };
    });
    const rs = reds.map((r) => ({ minute: r.minute, kind: "red" as const, home: r.club_id === homeId, who: surname(r.name) }));
    return [...gs, ...rs].sort((p, q) => p.minute - q.minute);
  }, [goals, reds, homeId]);

  // event lane: label widths are measured (approximately) and each label goes in the first
  // row where it fits; the plot moves down to make room for as many rows as are needed
  const labelOf = (e: Ev) => (narrow ? `${e.minute}'`
    : e.kind === "goal" ? `${e.minute}' ${e.who}${e.og ? " og" : ""} ${e.score}` : `${e.minute}' ${e.who}`);
  const placed = useMemo(() => {
    const ends: number[] = [];
    return events.map((e) => {
      const px = ml + (e.minute / 90) * pw;
      const w = labelOf(e).length * 6.6 + 18;
      let row = ends.findIndex((end) => end + 8 <= px);
      if (row === -1) { row = ends.length; ends.push(0); }
      ends[row] = px + w;
      return { ...e, px, row, label: labelOf(e) };
    });
  }, [events, width]);
  const rows = Math.max(1, ...placed.map((p) => p.row + 1));
  mt = 22 + rows * 22;
  ph = 250;
  H = mt + ph + mb;

  const series: { key: "p_home" | "p_draw" | "p_away"; name: string; color: string; w: number }[] = [
    { key: "p_home", name: home, color: "var(--s1)", w: 2.5 },
    { key: "p_draw", name: "Draw", color: "var(--muted)", w: 1.75 },
    { key: "p_away", name: away, color: "var(--s2)", w: 2.5 },
  ];
  const path = (k: "p_home" | "p_draw" | "p_away") =>
    wp.map((r, i) => (i === 0 ? `M${x(r.minute)},${y(r[k])}` : `H${x(r.minute)}V${y(r[k])}`)).join("");

  // end labels with collision avoidance (min 17 px apart), leader lines when displaced
  const last = wp[wp.length - 1];
  const ends = useMemo(() => {
    const items = series.map((s) => ({ ...s, v: last[s.key], ty: y(last[s.key]) })).sort((p, q) => p.ty - q.ty);
    const gap = 17;
    for (let i = 1; i < items.length; i++) if (items[i].ty - items[i - 1].ty < gap) items[i].ty = items[i - 1].ty + gap;
    const over = items[items.length - 1].ty - (mt + ph);
    if (over > 0) items.forEach((it) => { it.ty -= over; });
    for (let i = items.length - 2; i >= 0; i--) if (items[i + 1].ty - items[i].ty < gap) items[i].ty = items[i + 1].ty - gap;
    return items;
  }, [wp, width]);

  const scoreAt = (t: number) => {
    let h = 0, a = 0;
    events.forEach((e) => { if (e.kind === "goal" && e.minute <= t) { if (e.home) h++; else a++; } });
    return `${h}–${a}`;
  };
  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const box = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
    const t = Math.max(0, Math.min(90, Math.round(((e.clientX - box.left) * (width / box.width) - ml) / pw * 90)));
    setHover(t);
    const r = wp.find((p) => p.minute === t) ?? last;
    const here = events.filter((ev) => ev.minute === t);
    tip.show(e, (
      <div>
        <div className="muted xs">{t === 45 ? "Half-time (45')" : `${t}'`} · score {scoreAt(t)}{r.redD ? ` · ${r.redD > 0 ? away : home} down to ten` : ""}</div>
        {series.map((s) => (
          <div key={s.key} className="row" style={{ gap: 6 }}>
            <span className="key" style={{ background: s.color }} /><b>{fmt.pct(r[s.key], 0)}</b><span className="muted">{s.name}</span>
          </div>
        ))}
        {here.map((ev, i) => <div key={i} className="xs" style={{ marginTop: 4 }}>{ev.kind === "goal" ? `Goal: ${ev.who}${ev.og ? " (og)" : ev.pen ? " (pen)" : ""} → ${ev.score}` : `Red card: ${ev.who}`}</div>)}
      </div>
    ));
  };
  const hr = hover != null ? wp.find((p) => p.minute === hover) : null;

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${width} ${H}`} width="100%" height={H} role="img" style={{ display: "block", overflow: "visible" }}
           aria-label={`Win probability: ${home} ${fmt.pct(wp[0].p_home)} at kickoff, final ${fmt.pct(last.p_home)}; ${away} ${fmt.pct(wp[0].p_away)} to ${fmt.pct(last.p_away)}`}>
        {/* grid */}
        {[0, 0.25, 0.5, 0.75, 1].map((p) => (
          <g key={p}>
            <line x1={ml} x2={ml + pw} y1={y(p)} y2={y(p)} stroke={p === 0.5 ? "var(--axis)" : "var(--grid)"} />
            <text x={ml - 8} y={y(p) + 4} textAnchor="end" fontSize={11} fill="var(--muted)">{Math.round(p * 100)}%</text>
          </g>
        ))}
        {[0, 15, 30, 45, 60, 75, 90].map((t) => (
          <text key={t} x={x(t)} y={mt + ph + 18} textAnchor="middle" fontSize={11} fill="var(--muted)">{t === 45 ? "HT" : `${t}'`}</text>
        ))}
        <line x1={x(45)} x2={x(45)} y1={mt} y2={mt + ph} stroke="var(--axis)" />

        {/* event lane and hairlines */}
        <line x1={ml} x2={ml + pw} y1={mt - 6} y2={mt - 6} stroke="var(--grid)" />
        {placed.map((e, i) => {
          const c = e.kind === "red" ? "var(--critical)" : e.home ? "var(--s1)" : "var(--s2)";
          const ly = 14 + e.row * 22;
          const label = e.label;
          return (
            <g key={i}>
              <line x1={e.px} x2={e.px} y1={ly + 6} y2={mt + ph} stroke={c} strokeOpacity={0.35} strokeWidth={1} />
              {e.kind === "goal"
                ? <circle cx={e.px} cy={ly} r={5} fill={c} stroke="var(--surface)" strokeWidth={2} />
                : <rect x={e.px - 3.5} y={ly - 5} width={7} height={10} rx={1.5} fill={c} />}
              <text x={e.px + 9} y={ly + 4} fontSize={11} fill="var(--text)" fontWeight={e.kind === "goal" ? 600 : 400}>{label}</text>
            </g>
          );
        })}

        {/* series */}
        {series.map((s) => <path key={s.key} d={path(s.key)} fill="none" stroke={s.color} strokeWidth={s.w} strokeLinejoin="round" strokeLinecap="round" />)}

        {/* end labels */}
        {ends.map((it) => (
          <g key={it.key}>
            {Math.abs(it.ty - y(it.v)) > 2 && <line x1={x(90) + 2} x2={x(90) + 8} y1={y(it.v)} y2={it.ty} stroke="var(--axis)" />}
            <circle cx={x(90)} cy={y(it.v)} r={4} fill={it.color} stroke="var(--surface)" strokeWidth={2} />
            <text x={x(90) + 12} y={it.ty + 4} fontSize={12} fill="var(--text)">
              <tspan fontWeight={700}>{fmt.pct(it.v)}</tspan>{!narrow && <tspan fill="var(--text-2)"> {it.name.length > 14 ? it.name.slice(0, 13) + "…" : it.name}</tspan>}
            </text>
          </g>
        ))}

        {/* crosshair */}
        {hr && (
          <g pointerEvents="none">
            <line x1={x(hr.minute)} x2={x(hr.minute)} y1={mt} y2={mt + ph} stroke="var(--text)" strokeOpacity={0.5} />
            {series.map((s) => <circle key={s.key} cx={x(hr.minute)} cy={y(hr[s.key])} r={4.5} fill={s.color} stroke="var(--surface)" strokeWidth={2} />)}
          </g>
        )}
        <rect x={ml} y={mt} width={pw} height={ph} fill="transparent" style={{ cursor: "crosshair" }}
              onPointerMove={onMove} onPointerLeave={() => { setHover(null); tip.hide(); }} />
      </svg>
      <div className="legend" style={{ marginTop: 4 }}>
        {series.map((s) => <span key={s.key}><span className="key" style={{ background: s.color, height: s.w }} />{s.name}{s.key === "p_draw" ? "" : " win"}</span>)}
        <span><span className="dot" style={{ background: "var(--muted)" }} />goal (team colour)</span>
        <span><span className="dot" style={{ background: "var(--critical)", borderRadius: 2 }} />red card</span>
      </div>
      {tip.node}
    </div>
  );
}

/** A one-line takeaway for the chart title. */
export function wpTitle(wp: WpPoint[], home: string, away: string) {
  const last = wp[wp.length - 1], first = wp[0];
  if (last.gd === 0) {
    const peakH = wp.reduce((a, r) => (r.p_home > a.p_home ? r : a), first);
    const peakA = wp.reduce((a, r) => (r.p_away > a.p_away ? r : a), first);
    const pk = peakH.p_home >= peakA.p_away ? { team: home, p: peakH.p_home, t: peakH.minute } : { team: away, p: peakA.p_away, t: peakA.minute };
    return `It ended level, but ${pk.team} were at ${fmt.pct(pk.p)} to win at ${pk.t}'`;
  }
  const homeWon = last.gd > 0;
  const team = homeWon ? home : away;
  const k = homeWon ? "p_home" : "p_away";
  const low = wp.reduce((a, r) => (r[k] < a[k] ? r : a), first);
  if (low[k] < 0.25 && low.minute > 0) return `${team} won from ${fmt.pct(low[k])} at ${low.minute}'`;
  return `${team} won: ${fmt.pct(first[k])} at kickoff, never below ${fmt.pct(low[k])}`;
}
