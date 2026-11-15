// Shared building blocks: the figure frame every chart lives in, the pitch, tables, and
// small formatting helpers.
import * as Plot from "@observablehq/plot";
import { toPng, toSvg } from "html-to-image";
import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { lit, Row, useQuery } from "./db";

export const css = (name: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#888";

export const LEAGUES: Record<string, string> = {
  GB1: "Premier League", ES1: "La Liga", L1: "Bundesliga", IT1: "Serie A", FR1: "Ligue 1",
  GB2: "Championship", NL1: "Eredivisie", PO1: "Primeira Liga", MLS1: "MLS",
  WSL: "WSL", FBL: "Frauen-Bundesliga", LIGAF: "Liga F", SERIEAW: "Serie A Women", NWSL: "NWSL",
};
export const seasonLabel = (s: number, comp?: string) =>
  comp === "MLS1" || comp === "NWSL" ? `${s}` : `${s}-${String((s + 1) % 100).padStart(2, "0")}`;

export const fmt = {
  n: (v: any, d = 0) => (v == null || Number.isNaN(v) ? "–" : Number(v).toFixed(d)),
  pct: (v: any, d = 0) => (v == null || Number.isNaN(v) ? "–" : `${(100 * v).toFixed(d)}%`),
  signed: (v: any, d = 2) => (v == null || Number.isNaN(v) ? "–" : `${v > 0 ? "+" : ""}${Number(v).toFixed(d)}`),
  eur: (v: any) => (v == null ? "–" : v >= 1e6 ? `€${(v / 1e6).toFixed(1)}m` : `€${Math.round(v / 1e3)}k`),
  date: (v: any) => (v ? new Date(v).toISOString().slice(0, 10) : "–"),
};

/** Width of a container, tracked. */
export function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(640);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver((e) => setW(Math.max(280, Math.floor(e[0].contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** A chart with the house frame: takeaway title, definitions and sample sizes in the
 *  subtitle, a source line, PNG / SVG export with a small watermark. */
export function Figure(props: {
  title: string;
  subtitle?: ReactNode;
  source?: string;
  plot?: (width: number) => Record<string, any>; // Plot options; loosely typed so literal scale options need no casts
  children?: ReactNode;
  alt?: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!props.plot || !box.current) return;
    const el = Plot.plot({
      style: { background: "transparent", color: css("--text"), fontSize: "12px" },
      ...(props.plot(width) as Plot.PlotOptions),
    });
    el.setAttribute("role", "img");
    if (props.alt) el.setAttribute("aria-label", props.alt);
    box.current.replaceChildren(el);
    return () => el.remove();
  }, [props.plot, width]);
  const save = async (kind: "png" | "svg") => {
    if (!frame.current) return;
    const opts = { backgroundColor: css("--surface"), pixelRatio: 2 };
    const url = kind === "png" ? await toPng(frame.current, opts) : await toSvg(frame.current, opts);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${props.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60)}.${kind}`;
    a.click();
  };
  return (
    <div className="card" ref={frame}>
      <p className="figure-title">{props.title}</p>
      {props.subtitle && <p className="figure-sub">{props.subtitle}</p>}
      <div ref={ref} className="plot">
        <div ref={box} />
        {props.children}
      </div>
      <div className="figure-foot">
        <span>{props.source ?? ""} · pitchvision · adisgill.github.io/pitchvision</span>
        <span className="figure-actions">
          <button onClick={() => save("png")} aria-label="Download as PNG">PNG</button>{" "}
          <button onClick={() => save("svg")} aria-label="Download as SVG">SVG</button>
        </span>
      </div>
    </div>
  );
}

/** The one pitch renderer: 105 x 68 m, attacking left to right, children in pitch metres. */
export function Pitch({ children, height = 320 }: { children?: ReactNode; height?: number }) {
  const L = 105, W = 68;
  const line = { stroke: "var(--pitch-line)", strokeWidth: 0.35, fill: "none" };
  return (
    <svg viewBox={`-2 -2 ${L + 4} ${W + 4}`} style={{ width: "100%", maxHeight: height }}
         role="img" aria-label="Football pitch">
      <rect x={-2} y={-2} width={L + 4} height={W + 4} fill="var(--pitch)" />
      <g {...line} transform={`translate(0 ${W}) scale(1 -1)`}>
        <rect x={0} y={0} width={L} height={W} />
        <line x1={L / 2} y1={0} x2={L / 2} y2={W} />
        <circle cx={L / 2} cy={W / 2} r={9.15} />
        {[0, L].map((x) => {
          const s = x === 0 ? 1 : -1;
          return (
            <g key={x}>
              <rect x={x === 0 ? 0 : L - 16.5} y={W / 2 - 20.16} width={16.5} height={40.32} />
              <rect x={x === 0 ? 0 : L - 5.5} y={W / 2 - 9.16} width={5.5} height={18.32} />
              <circle cx={x + s * 11} cy={W / 2} r={0.4} fill="var(--pitch-line)" />
              <rect x={x === 0 ? -1.2 : L} y={W / 2 - 3.66} width={1.2} height={7.32} />
            </g>
          );
        })}
        {children}
      </g>
    </svg>
  );
}

export type Col = {
  key: string;
  label: string;
  num?: boolean;
  fmt?: (v: any, r: Row) => ReactNode;
  title?: string;
};

export function DataTable({ rows, cols, initialSort, limit }: {
  rows: Row[]; cols: Col[]; initialSort?: { key: string; desc: boolean }; limit?: number;
}) {
  const [sort, setSort] = useState(initialSort ?? { key: cols[0].key, desc: false });
  const sorted = useMemo(() => {
    const s = [...rows].sort((a, b) => {
      const x = a[sort.key], y = b[sort.key];
      if (x == null) return 1;
      if (y == null) return -1;
      return (x < y ? -1 : x > y ? 1 : 0) * (sort.desc ? -1 : 1);
    });
    return limit ? s.slice(0, limit) : s;
  }, [rows, sort, limit]);
  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c.key} className={c.num ? "r" : ""} title={c.title}
                  onClick={() => setSort({ key: c.key, desc: sort.key === c.key ? !sort.desc : !!c.num })}>
                {c.label}{sort.key === c.key ? (sort.desc ? " ▾" : " ▴") : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => (
            <tr key={i}>
              {cols.map((c) => (
                <td key={c.key} className={c.num ? "r" : ""}>{c.fmt ? c.fmt(r[c.key], r) : r[c.key] ?? "–"}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A 0-100 rating as a bar: blue above 50, orange below. */
export function RatingBar({ v }: { v: number | null }) {
  if (v == null || Number.isNaN(v)) return <span className="muted">–</span>;
  const good = v >= 50;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span className="num" style={{ width: 22, textAlign: "right" }}>{Math.round(v)}</span>
      <span className="bar" style={{ width: 80 }}>
        <span style={{ width: `${Math.max(0, Math.min(100, v))}%`, background: good ? "var(--good)" : "var(--bad)" }} />
      </span>
    </span>
  );
}

export function ProbBar({ p }: { p: number | null }) {
  if (p == null) return <span className="muted">–</span>;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span className="num" style={{ width: 38, textAlign: "right" }}>{fmt.pct(p, p < 0.01 && p > 0 ? 1 : 0)}</span>
      <span className="bar" style={{ width: 70 }}><span style={{ width: `${100 * p}%` }} /></span>
    </span>
  );
}

export function Loading({ state }: { state: { loading: boolean; error: string | null } }) {
  if (state.error) return <div className="error">Couldn't load data: {state.error}</div>;
  if (state.loading) return <div className="loading">Loading…</div>;
  return null;
}

export const ClubLink = ({ id, name }: { id: string; name: string }) => (
  <Link to={`/team/${encodeURIComponent(id)}`}>{name}</Link>
);
export const PlayerLink = ({ id, name }: { id: string; name: string }) => (
  <Link to={`/player/${encodeURIComponent(id)}`}>{name}</Link>
);

export function Select({ value, onChange, options, label }: {
  value: string; onChange: (v: string) => void; options: [string, string][]; label: string;
}) {
  return (
    <label className="small muted">
      {label}{" "}
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}

/** Global search over players and clubs. */
export function Search() {
  const [q, setQ] = useState("");
  const nav = useNavigate();
  const sql = q.trim().length >= 3
    ? `select 'player' kind, player_id id, name from players
         where name ilike ${lit(`%${q.trim()}%`)} and player_id in
           (select player_id from players_c union select player_id from players_a)
       union all
       select 'team', club_id, name from clubs where name ilike ${lit(`%${q.trim()}%`)}
       limit 25`
    : null;
  const res = useQuery(sql);
  return (
    <div style={{ position: "relative" }}>
      <input type="search" placeholder="Search players and teams" value={q}
             onChange={(e) => setQ(e.target.value)} aria-label="Search players and teams"
             onKeyDown={(e) => {
               if (e.key === "Enter" && res.rows[0]) {
                 const r = res.rows[0];
                 nav(`/${r.kind === "team" ? "team" : "player"}/${encodeURIComponent(r.id)}`);
                 setQ("");
               }
             }} />
      {sql && res.rows.length > 0 && (
        <div className="search-results">
          {res.rows.map((r) => (
            <Link key={r.kind + r.id} to={`/${r.kind === "team" ? "team" : "player"}/${encodeURIComponent(r.id)}`}
                  onClick={() => setQ("")}>
              {r.name} <span className="pill">{r.kind}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
