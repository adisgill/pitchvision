// Shot map with playback, and the xG river underneath. One clock drives both: press play and the
// match replays shot by shot (about 15 seconds for 90 minutes); drag the slider or scrub the
// river to jump. FotMob (Opta) shots, coordinates in metres with every shot attacking right;
// the home side is drawn attacking right and the away side left.
import { useEffect, useMemo, useRef, useState } from "react";
import { Row } from "../../db";
import { fmt } from "../../lib/format";
import { useWidth } from "../../ui/Figure";
import { Card, useTip } from "../../ui/kit";
import { L, Pitch, W } from "../../ui/pitch";

type Shot = Row & { t: number; home: boolean; px: number; py: number };

const clock = (s: Row) => {
  const added = Math.min(Number(s.minute_added) || 0, 9);
  return Number(s.minute) + (added ? added / 10 : 0);
};
const label = (t: number) => {
  const m = Math.floor(t);
  return m >= 45 && m < 46 && t > 45 ? "45+" : m >= 90 && t > 90 ? "90+" : `${m}'`;
};
const outcome = (s: Row) => (s.goal ? (s.own_goal ? "own goal" : "goal") : s.on_target ? "saved" : s.blocked ? "blocked" : "off target");

function River({ shots, t, end, setT, home, away }: {
  shots: Shot[]; t: number; end: number; setT: (v: number) => void; home: string; away: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const tip = useTip();
  const H = 170, mid = H / 2, left = 112, right = 12;
  const x = (m: number) => left + (m / end) * (width - left - right);
  const series = (h: boolean) => {
    let c = 0;
    const pts: [number, number][] = [[0, 0]];
    shots.filter((s) => s.home === h && !s.own_goal).forEach((s) => { pts.push([s.t, c]); c += s.xg; pts.push([s.t, c]); });
    pts.push([end, c]);
    return { pts, total: c };
  };
  const hs = series(true), as = series(false);
  const maxX = Math.max(1, hs.total, as.total);
  const k = (mid - 14) / maxX;
  const area = (pts: [number, number][], sign: number) =>
    `M${x(0)},${mid}` + pts.map(([m, v]) => `L${x(m).toFixed(1)},${(mid - sign * v * k).toFixed(1)}`).join("") + `L${x(end)},${mid}Z`;
  const scrub = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setT(Math.max(0, Math.min(end, ((e.clientX - r.left - left) / (r.width - left - right)) * end)));
  };
  const goals = shots.filter((s) => s.goal);
  return (
    <div ref={ref}>
      <svg width={width} height={H + 20} role="img" style={{ display: "block", touchAction: "none", cursor: "ew-resize" }}
           aria-label={`Cumulative expected goals: ${home} ${fmt.n(hs.total, 2)}, ${away} ${fmt.n(as.total, 2)}`}
           onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); scrub(e); }}
           onPointerMove={(e) => { if (e.buttons & 1) scrub(e); }}>
        {[0, 15, 30, 45, 60, 75, 90].filter((m) => m <= end).map((m) => (
          <g key={m}>
            <line x1={x(m)} x2={x(m)} y1={6} y2={H - 6} stroke="var(--grid)" />
            <text x={x(m)} y={H + 12} textAnchor="middle" fontSize={10} fontFamily="var(--mono)" fill="var(--muted)">{m === 45 ? "HT" : `${m}'`}</text>
          </g>
        ))}
        <path d={area(hs.pts, 1)} fill="var(--s1)" fillOpacity={0.85} />
        <path d={area(as.pts, -1)} fill="var(--s2)" fillOpacity={0.85} />
        <line x1={left} x2={width - right} y1={mid} y2={mid} stroke="var(--surface)" strokeWidth={2} />
        <text x={left - 6} y={16} textAnchor="end" fontSize={10} fontFamily="var(--mono)" fill="var(--muted)">{fmt.n(maxX, 1)}</text>
        <text x={left - 6} y={H - 8} textAnchor="end" fontSize={10} fontFamily="var(--mono)" fill="var(--muted)">{fmt.n(maxX, 1)}</text>
        <text x={0} y={mid - 22} fontSize={10.5} fontWeight={650} fill="var(--text)">{home.length > 16 ? home.slice(0, 15) + "…" : home}</text>
        <text x={0} y={mid - 8} fontSize={10} fontFamily="var(--mono)" fill="var(--muted)">xG {fmt.n(hs.total, 2)} ↑</text>
        <text x={0} y={mid + 16} fontSize={10.5} fontWeight={650} fill="var(--text)">{away.length > 16 ? away.slice(0, 15) + "…" : away}</text>
        <text x={0} y={mid + 30} fontSize={10} fontFamily="var(--mono)" fill="var(--muted)">xG {fmt.n(as.total, 2)} ↓</text>
        {goals.map((g, i) => {
          const scorerHome = g.own_goal ? !g.home : g.home;
          return (
            <g key={i} transform={`translate(${x(g.t)},${scorerHome ? 8 : H - 18})`}
               onPointerMove={(e) => tip.show(e, <><b>{label(g.t)} goal</b><div className="muted">{g.player_name}{g.own_goal ? " (own goal)" : ""} · {fmt.n(g.xg, 2)} xG</div></>)}
               onPointerLeave={tip.hide}>
              <rect x={-5} y={0} width={10} height={10} rx={1} fill="var(--text)" />
              <circle cx={0} cy={5} r={2.2} fill="var(--page)" />
            </g>
          );
        })}
        {/* cover what hasn't happened yet, then the clock line */}
        <rect x={x(t)} y={0} width={Math.max(0, x(end) - x(t))} height={H} fill="var(--surface)" opacity={0.72} pointerEvents="none" />
        <line x1={x(t)} x2={x(t)} y1={0} y2={H} stroke="var(--hi)" strokeWidth={2} pointerEvents="none" />
      </svg>
      {tip.node}
    </div>
  );
}

export default function ShotPlayback({ rows, m }: { rows: Row[]; m: Row }) {
  const shots: Shot[] = useMemo(() => rows.map((s) => {
    const home = !!s.is_home;
    return { ...s, t: clock(s), home, px: home ? s.x : L - s.x, py: home ? s.y : W - s.y };
  }).sort((a, b) => a.t - b.t), [rows]);
  const end = Math.max(93, ...shots.map((s) => s.t + 1));
  const [t, setT] = useState(end);
  const [playing, setPlaying] = useState(false);
  const raf = useRef(0);
  const tip = useTip();
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    const step = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setT((v) => {
        const nv = v + dt * 6.5;
        if (nv >= end) { setPlaying(false); return end; }
        return nv;
      });
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [playing, end]);
  const shown = shots.filter((s) => s.t <= t);
  const tally = (h: boolean) => {
    const s = shown.filter((x) => x.home === h && !x.own_goal);
    return { n: s.length, xg: s.reduce((a, x) => a + x.xg, 0), g: shown.filter((x) => x.goal && (x.own_goal ? x.home !== h : x.home === h)).length };
  };
  const th = tally(true), ta = tally(false);
  const feed = [...shown].reverse().slice(0, 7);
  const toggle = () => {
    if (playing) { setPlaying(false); return; }
    if (t >= end - 0.01) setT(0);
    setPlaying(true);
  };
  return (
    <div className="c12">
      <Card title="Shot by shot" sub={`Every shot, replayed. ${m.home_team} attack right, ${m.away_team} left; circle area is the chance's xG, filled circles are goals. Press play, drag the clock, or scrub the river below.`}
            foot="FotMob (Opta) shots and xG · pitchvision">
        <div className="playback">
          <div className="pb-bar">
            <button className="btn primary pb-play" onClick={toggle} aria-label={playing ? "Pause" : "Play the match"}>
              {playing ? "❚❚" : "▶"}
            </button>
            <span className="pb-clock">{t >= end - 0.01 ? "FT" : label(t)}</span>
            <input type="range" min={0} max={end} step={0.1} value={t} aria-label="Match clock"
                   onChange={(e) => { setPlaying(false); setT(Number(e.target.value)); }} />
            <div className="pb-tally">
              <span><i style={{ background: "var(--s1)" }} />{th.g} · {fmt.n(th.xg, 2)} xG · {th.n} shots</span>
              <span><i style={{ background: "var(--s2)" }} />{ta.g} · {fmt.n(ta.xg, 2)} xG · {ta.n} shots</span>
            </div>
          </div>
          <div className="pb-main">
            <Pitch label="Shot map">
              {shown.map((s, i) => {
                const r = 0.7 + Math.sqrt(s.xg) * 2.7;
                const c = s.home ? "var(--s1)" : "var(--s2)";
                const fresh = t - s.t < 2.5;
                return (
                  <g key={`${s.t}-${i}`} transform={`translate(${s.px},${s.py})`}
                     onPointerMove={(e) => tip.show(e, <><b>{label(s.t)} · {fmt.n(s.xg, 2)} xG</b>
                       <div className="muted">{s.player_name} · {outcome(s)}</div>
                       <div className="muted">{[s.situation, s.shot_type].filter(Boolean).join(" · ")}{s.xgot != null && s.on_target ? ` · xGOT ${fmt.n(s.xgot, 2)}` : ""}</div></>)}
                     onPointerLeave={tip.hide}>
                    {fresh && <circle r={r} className="pb-ping" fill="none" stroke={c} strokeWidth={0.5} />}
                    <circle r={r} fill={s.goal ? c : "var(--pitch)"} fillOpacity={s.goal ? 1 : 0.55} stroke={c} strokeWidth={s.goal ? 0.6 : 0.45}
                            className="pb-shot" />
                  </g>
                );
              })}
            </Pitch>
            <ol className="pb-feed" aria-label="Latest shots">
              {feed.map((s, i) => (
                <li key={`${s.t}-${i}`} className={s.goal ? "goal" : ""}>
                  <span className="mn">{label(s.t)}</span>
                  <i style={{ background: s.home ? "var(--s1)" : "var(--s2)" }} />
                  <span className="nm">{s.player_name}</span>
                  <span className="oc">{outcome(s)}</span>
                  <span className="xg">{fmt.n(s.xg, 2)}</span>
                </li>
              ))}
              {!feed.length && <li className="muted small">Kick-off. Press play.</li>}
            </ol>
          </div>
          <River shots={shots} t={t} end={end} setT={(v) => { setPlaying(false); setT(v); }} home={m.home_team} away={m.away_team} />
        </div>
      </Card>
      {tip.node}
    </div>
  );
}
