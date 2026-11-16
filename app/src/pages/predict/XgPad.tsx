// The matchup pad: every point is a pair of expected-goals rates (home across, away up), coloured
// by who the score model makes favourite there, with each side's 50% win line and the even line.
// The model's pick is the ring; drag the puck (or use the arrow keys) to ask "what if", and everything on
// the page follows.
import { useMemo, useRef } from "react";
import { div, fmt } from "../../lib/format";
import { scoreMatrix, summarise } from "../../lib/models";

const MAX = 4, N = 40;

export default function XgPad({ model, value, rho, home, away, onChange }: {
  model: { lh: number; la: number }; value: { lh: number; la: number }; rho: number;
  home: string; away: string; onChange: (v: { lh: number; la: number } | null) => void;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const S = 320, pad = 34, W = S + pad + 8, H = S + 8 + 30;
  const px = (v: number) => pad + (v / MAX) * S;
  const py = (v: number) => 8 + (1 - v / MAX) * S;
  const field = useMemo(() => {
    const ph: number[] = [], pa: number[] = [], diff: number[] = [];
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const lh = ((i + 0.5) / N) * MAX, la = (1 - (j + 0.5) / N) * MAX;
        const s = summarise(scoreMatrix(Math.max(0.02, lh), Math.max(0.02, la), rho, 8));
        ph.push(s.home); pa.push(s.away); diff.push(s.home - s.away);
      }
    }
    // P(home win) rises with the home rate at a fixed away rate, so each row crosses a threshold
    // at most once: interpolate the crossing per row and join them into the iso-line
    const iso = (vals: number[], t: number) => {
      const pts: string[] = [];
      for (let j = 0; j < N; j++) {
        for (let i = 0; i < N - 1; i++) {
          const a = vals[j * N + i] - t, b = vals[j * N + i + 1] - t;
          if ((a <= 0 && b > 0) || (a >= 0 && b < 0)) {
            const x = ((i + 0.5 + a / (a - b)) / N) * S + pad, y = 8 + ((j + 0.5) / N) * S;
            pts.push(`${pts.length ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`);
            break;
          }
        }
      }
      return pts.join("");
    };
    return {
      cells: diff,
      lines: [
        { d: iso(ph, 0.5), label: `${home} 50%`, c: "var(--s1)" },
        { d: iso(pa, 0.5), label: `${away} 50%`, c: "var(--s2)" },
        { d: iso(diff, 0), label: "even", c: "var(--text)" },
      ],
    };
  }, [rho, home, away]);
  const toVal = (e: { clientX: number; clientY: number }) => {
    const r = svg.current!.getBoundingClientRect();
    const k = W / r.width;
    const x = ((e.clientX - r.left) * k - pad) / S * MAX;
    const y = (1 - ((e.clientY - r.top) * k - 8) / S) * MAX;
    const clamp = (v: number) => Math.round(Math.max(0.05, Math.min(MAX - 0.05, v)) * 100) / 100;
    return { lh: clamp(x), la: clamp(y) };
  };
  const moved = Math.abs(value.lh - model.lh) > 0.005 || Math.abs(value.la - model.la) > 0.005;
  const cs = S / N;
  return (
    <div className="xgpad">
      <svg ref={svg} viewBox={`0 0 ${W} ${H}`} role="slider" tabIndex={0}
           aria-label={`Expected goals: ${home} ${value.lh.toFixed(2)}, ${away} ${value.la.toFixed(2)}. Arrow keys move; Escape resets to the model.`}
           aria-valuetext={`${home} ${value.lh.toFixed(2)}, ${away} ${value.la.toFixed(2)}`}
           style={{ width: "100%", maxWidth: 440, height: "auto", touchAction: "none", cursor: "crosshair", display: "block", margin: "0 auto" }}
           onPointerDown={(e) => { (e.target as Element).setPointerCapture?.(e.pointerId); onChange(toVal(e)); }}
           onPointerMove={(e) => { if (e.buttons & 1) onChange(toVal(e)); }}
           onKeyDown={(e) => {
             const st = e.shiftKey ? 0.25 : 0.05;
             const d = { ArrowRight: [st, 0], ArrowLeft: [-st, 0], ArrowUp: [0, st], ArrowDown: [0, -st] }[e.key];
             if (d) { e.preventDefault(); onChange({ lh: Math.max(0.05, Math.min(MAX - 0.05, value.lh + d[0])), la: Math.max(0.05, Math.min(MAX - 0.05, value.la + d[1])) }); }
             if (e.key === "Escape") onChange(null);
           }}>
        {field.cells.map((v, k) => (
          <rect key={k} x={pad + (k % N) * cs} y={8 + Math.floor(k / N) * cs} width={cs + 0.5} height={cs + 0.5} fill={div(v)} shapeRendering="crispEdges" />
        ))}
        {field.lines.map((l) => <path key={l.label} d={l.d} fill="none" stroke={l.c} strokeWidth={l.label === "even" ? 1.5 : 1}
                                      strokeDasharray={l.label === "even" ? undefined : "3 3"} opacity={0.8} pointerEvents="none" />)}
        {[0, 1, 2, 3, 4].map((t) => (
          <g key={t} pointerEvents="none">
            <text x={px(t)} y={8 + S + 14} textAnchor="middle" fontSize={10} fontFamily="var(--font)" fill="var(--muted)">{t}</text>
            <text x={pad - 6} y={py(t) + 3} textAnchor="end" fontSize={10} fontFamily="var(--font)" fill="var(--muted)">{t}</text>
          </g>
        ))}
        <text x={pad + S / 2} y={H - 2} textAnchor="middle" fontSize={10.5} fontFamily="var(--font)" fill="var(--text-2)">{home} expected goals →</text>
        <text x={10} y={8 + S / 2} textAnchor="middle" fontSize={10.5} fontFamily="var(--font)" fill="var(--text-2)" transform={`rotate(-90 10 ${8 + S / 2})`}>{away} expected goals →</text>
        {/* the model's pick */}
        <circle cx={px(model.lh)} cy={py(model.la)} r={9} fill="none" stroke="var(--text)" strokeWidth={1.5} strokeDasharray={moved ? "2 2" : undefined} pointerEvents="none" />
        {moved && <line x1={px(model.lh)} y1={py(model.la)} x2={px(value.lh)} y2={py(value.la)} stroke="var(--text)" strokeWidth={1} strokeDasharray="2 3" pointerEvents="none" />}
        <g transform={`translate(${px(value.lh)},${py(value.la)})`} pointerEvents="none" className="puck">
          <circle r={7} fill="var(--hi)" stroke="var(--on-hi)" strokeWidth={2} />
          <g transform={`translate(${value.lh > MAX * 0.7 ? -12 : 12},${value.la > MAX * 0.85 ? 18 : -12})`}>
            <rect x={value.lh > MAX * 0.7 ? -74 : 0} y={-12} width={74} height={18} rx={2} fill="var(--text)" />
            <text x={value.lh > MAX * 0.7 ? -37 : 37} y={1} textAnchor="middle" fontSize={11} fontWeight={700} fontFamily="var(--display)" fill="var(--page)">
              {value.lh.toFixed(2)} – {value.la.toFixed(2)}
            </text>
          </g>
        </g>
      </svg>
      <div className="row between xs muted" style={{ marginTop: 6 }}>
        <span>Ring: the model ({fmt.n(model.lh, 2)}–{fmt.n(model.la, 2)}). Colour: blue = {home} favoured, red = {away}. Lines: each side's 50% win line and the even line.</span>
        {moved && <button className="btn" onClick={() => onChange(null)}>Reset to model</button>}
      </div>
    </div>
  );
}
