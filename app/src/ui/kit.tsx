// The UI kit: every page is built from these pieces so the whole app reads as one system.
import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useSearchParams } from "react-router-dom";
import { lit, Row, useQuery } from "../db";
import { css, fmt, LEAGUES, seasonLabel, slot } from "../lib/format";

// ---------- URL state ----------

/** A search-param-backed state value, so every view is linkable. */
export function useParam(name: string, fallback: string): [string, (v: string | null) => void] {
  const [params, setParams] = useSearchParams();
  const v = params.get(name) ?? fallback;
  const set = (nv: string | null) => {
    const p = new URLSearchParams(window.location.hash.split("?")[1] ?? "");
    if (nv == null || nv === fallback) p.delete(name); else p.set(name, nv);
    setParams(p, { replace: true });
  };
  return [v, set];
}

// ---------- layout ----------

export function PageHead({ eyebrow, title, lead, right }: { eyebrow?: ReactNode; title: ReactNode; lead?: ReactNode; right?: ReactNode }) {
  return (
    <div className="hero-band">
      <div>
        {eyebrow && <div className="eyebrow" style={{ marginBottom: 6 }}>{eyebrow}</div>}
        <h1>{title}</h1>
        {lead && <p className="lead" style={{ margin: 0 }}>{lead}</p>}
      </div>
      {right && <div className="row">{right}</div>}
    </div>
  );
}

export function Card({ title, sub, right, children, className = "", foot }: {
  title?: ReactNode; sub?: ReactNode; right?: ReactNode; children?: ReactNode; className?: string; foot?: ReactNode;
}) {
  return (
    <div className={`card ${className}`}>
      {(title || right) && (
        <div className="card-head">
          <div>{title && <p className="fig-title">{title}</p>}{sub && <p className="fig-sub">{sub}</p>}</div>
          {right}
        </div>
      )}
      {children}
      {foot && <div className="fig-foot">{foot}</div>}
    </div>
  );
}

export function Tabs({ tabs, value, onChange }: { tabs: [string, string][]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map(([k, l]) => (
        <button key={k} role="tab" aria-selected={value === k} className={value === k ? "on" : ""} onClick={() => onChange(k)}>{l}</button>
      ))}
    </div>
  );
}

export function Seg<T extends string>({ options, value, onChange, label }: {
  options: [T, string][]; value: T; onChange: (v: T) => void; label?: string;
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map(([k, l]) => (
        <button key={k} aria-pressed={value === k} onClick={() => onChange(k)}>{l}</button>
      ))}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="field">{label}{children}</label>;
}

export function Select({ value, onChange, options, label }: {
  value: string; onChange: (v: string) => void; options: [string, string][]; label: string;
}) {
  return (
    <Field label={label}>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </Field>
  );
}

export const LeagueSelect = ({ value, onChange, leagues }: { value: string; onChange: (v: string) => void; leagues: string[] }) =>
  <Select label="League" value={value} onChange={onChange} options={leagues.map((k) => [k, LEAGUES[k] ?? k])} />;

export const SeasonSelect = ({ value, onChange, seasons, comp }: { value: number; onChange: (v: number) => void; seasons: number[]; comp?: string }) =>
  <Select label="Season" value={String(value)} onChange={(v) => onChange(Number(v))} options={seasons.map((s) => [String(s), seasonLabel(s, comp)])} />;

// ---------- figures ----------

export function Tile({ label, value, delta, tone, children }: {
  label: ReactNode; value: ReactNode; delta?: ReactNode; tone?: "up" | "down"; children?: ReactNode;
}) {
  return (
    <div className="tile">
      <div className="l">{label}</div>
      <div className="v">{value}</div>
      {delta && <div className={`d ${tone ?? ""}`}>{delta}</div>}
      {children}
    </div>
  );
}

export function Loading({ state }: { state: { loading: boolean; error: string | null; rows?: Row[] } }) {
  if (state.error) return <div className="error">Couldn't load data: {state.error}</div>;
  if (state.loading && !(state.rows && state.rows.length)) return <div className="loading">Loading…</div>;
  return null;
}

export const Empty = ({ children }: { children: ReactNode }) => <div className="empty">{children}</div>;

/** A 0-100 rating (50 = position average, 10 = one SD) as a bar: blue above 50, red below. */
export function RatingBar({ v, width = 74 }: { v: number | null | undefined; width?: number }) {
  if (v == null || Number.isNaN(v)) return <span className="muted">–</span>;
  const c = v >= 50 ? "var(--pos)" : "var(--neg)";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }} title={`${Math.round(v)} (50 = position average; 10 points = 1 SD)`}>
      <span className="num" style={{ width: 22, textAlign: "right" }}>{Math.round(v)}</span>
      <span className="bar" style={{ width }}><span style={{ width: `${Math.max(2, Math.min(100, v))}%`, background: c }} /></span>
    </span>
  );
}

export function ProbBar({ p, width = 64 }: { p: number | null | undefined; width?: number }) {
  if (p == null) return <span className="muted">–</span>;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span className="num" style={{ width: 40, textAlign: "right" }}>{p > 0 && p < 0.005 ? "<1%" : fmt.pct(p, p > 0.995 && p < 1 ? 1 : 0)}</span>
      <span className="bar" style={{ width }}><span style={{ width: `${100 * p}%` }} /></span>
    </span>
  );
}

/** Home / draw / away as one tall segmented bar (the shares printed inside when they fit). */
export function OutcomeBar({ h, d, a, labels, thin }: { h: number; d: number; a: number; labels?: [string, string, string]; thin?: boolean }) {
  const parts: [number, string, string][] = [[h, "var(--s1)", labels?.[0] ?? "Home"], [d, "var(--muted)", labels?.[1] ?? "Draw"], [a, "var(--s2)", labels?.[2] ?? "Away"]];
  return (
    <div className={`segbar ${thin ? "thin" : ""}`} role="img" aria-label={parts.map(([p, , l]) => `${l} ${fmt.pct(p)}`).join(", ")}>
      {parts.map(([p, c, l]) => p > 0 && (
        <div key={l} style={{ flex: p, background: c }} title={`${l}: ${fmt.pct(p, 1)}`}>{!thin && p >= 0.12 ? fmt.pct(p) : ""}</div>
      ))}
    </div>
  );
}

export function FormStrip({ results }: { results: string[] }) {
  return <span className="form" aria-label={`Form ${results.join(" ")}`}>{results.map((r, i) => <i key={i} className={r}>{r}</i>)}</span>;
}

export function Sparkline({ values, width = 90, height = 24, color = "var(--accent)", band }: {
  values: number[]; width?: number; height?: number; color?: string; band?: number;
}) {
  const v = values.filter((x) => Number.isFinite(x));
  if (v.length < 2) return null;
  const lo = Math.min(...v, band ?? Infinity), hi = Math.max(...v, band ?? -Infinity);
  const x = (i: number) => (i / (v.length - 1)) * (width - 4) + 2;
  const y = (z: number) => height - 2 - ((z - lo) / (hi - lo || 1)) * (height - 4);
  const d = v.map((z, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(z).toFixed(1)}`).join("");
  return (
    <svg width={width} height={height} aria-hidden="true" style={{ verticalAlign: "middle" }}>
      {band != null && <line x1={0} x2={width} y1={y(band)} y2={y(band)} stroke="var(--axis)" strokeWidth={1} />}
      <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(v.length - 1)} cy={y(v[v.length - 1])} r={2.5} fill={color} />
    </svg>
  );
}

export function Legend({ items }: { items: { label: string; color: string; kind?: "line" | "dot" | "rect" }[] }) {
  return (
    <div className="legend">
      {items.map((it) => (
        <span key={it.label}>
          {it.kind === "line" ? <span className="key" style={{ background: it.color }} />
            : <span className="dot" style={{ background: it.color, borderRadius: it.kind === "rect" ? 2 : "50%" }} />}
          {it.label}
        </span>
      ))}
    </div>
  );
}

// ---------- links ----------

export const ClubLink = ({ id, name, bold }: { id: string; name: string; bold?: boolean }) =>
  <Link to={`/team/${encodeURIComponent(id)}`} style={bold ? { fontWeight: 650 } : undefined}>{name}</Link>;
export const PlayerLink = ({ id, name }: { id: string; name: string }) =>
  <Link to={`/player/${encodeURIComponent(id)}`}>{name}</Link>;
export const MatchLink = ({ id, children }: { id: string; children: ReactNode }) =>
  <Link to={`/match/${encodeURIComponent(id)}`}>{children}</Link>;

// ---------- table ----------

export type Col = {
  key: string; label: ReactNode; num?: boolean; center?: boolean;
  fmt?: (v: any, r: Row, i: number) => ReactNode; title?: string; sortable?: boolean;
  /** colour cells by value: "pos" (higher = better), "neg" (lower = better) */
  heat?: "pos" | "neg";
};

export function DataTable({ rows, cols, initialSort, limit, highlight, onRow, maxHeight, rank }: {
  rows: Row[]; cols: Col[]; initialSort?: { key: string; desc: boolean }; limit?: number;
  highlight?: (r: Row) => boolean; onRow?: (r: Row) => void; maxHeight?: number; rank?: boolean;
}) {
  const [sort, setSort] = useState(initialSort ?? null);
  const sorted = useMemo(() => {
    let s = rows;
    if (sort) {
      s = [...rows].sort((a, b) => {
        const x = a[sort.key], y = b[sort.key];
        if (x == null || (typeof x === "number" && Number.isNaN(x))) return 1;
        if (y == null || (typeof y === "number" && Number.isNaN(y))) return -1;
        return (x < y ? -1 : x > y ? 1 : 0) * (sort.desc ? -1 : 1);
      });
    }
    return limit ? s.slice(0, limit) : s;
  }, [rows, sort, limit]);
  const ranges = useMemo(() => Object.fromEntries(cols.filter((c) => c.heat).map((c) => {
    const v = rows.map((r) => r[c.key]).filter((x) => typeof x === "number" && Number.isFinite(x)) as number[];
    v.sort((a, b) => a - b);
    return [c.key, [v[Math.floor(v.length * 0.05)] ?? 0, v[Math.floor(v.length * 0.95)] ?? 1]];
  })), [rows, cols]);
  return (
    <div className="table-wrap" style={maxHeight ? { maxHeight } : undefined}>
      <table className="data">
        <thead>
          <tr>
            {rank && <th className="r">#</th>}
            {cols.map((c) => {
              const can = c.sortable !== false;
              return (
                <th key={c.key} className={`${c.num ? "r" : c.center ? "c" : ""} ${can ? "sort" : ""}`} title={c.title}
                    aria-sort={sort?.key === c.key ? (sort.desc ? "descending" : "ascending") : undefined}
                    onClick={can ? () => setSort({ key: c.key, desc: sort?.key === c.key ? !sort.desc : !!c.num }) : undefined}>
                  {c.label}{sort?.key === c.key ? (sort.desc ? " ↓" : " ↑") : ""}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => (
            <tr key={i} className={highlight?.(r) ? "hl" : ""} onClick={onRow ? () => onRow(r) : undefined} style={onRow ? { cursor: "pointer" } : undefined}>
              {rank && <td className="r muted">{i + 1}</td>}
              {cols.map((c) => {
                const v = r[c.key];
                let content: ReactNode = c.fmt ? c.fmt(v, r, i) : v ?? "–";
                if (c.heat && typeof v === "number" && Number.isFinite(v)) {
                  const [lo, hi] = ranges[c.key];
                  let t = (v - lo) / (hi - lo || 1);
                  if (c.heat === "neg") t = 1 - t;
                  const a = Math.max(0, Math.min(1, t));
                  content = <span className="heatcell" style={{ background: `color-mix(in srgb, var(--accent) ${Math.round(a * 45)}%, transparent)` }}>{content}</span>;
                }
                return <td key={c.key} className={c.num ? "r" : c.center ? "c" : ""}>{content}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------- tooltip for custom SVG charts ----------

export function useTip() {
  const [tip, setTip] = useState<{ x: number; y: number; content: ReactNode } | null>(null);
  const show = (e: { clientX: number; clientY: number }, content: ReactNode) => setTip({ x: e.clientX, y: e.clientY, content });
  const hide = () => setTip(null);
  const node = tip ? createPortal(
    <div className="tip" style={{
      left: Math.min(tip.x + 14, window.innerWidth - 310), top: tip.y + 14 > window.innerHeight - 120 ? tip.y - 90 : tip.y + 14,
    }}>{tip.content}</div>, document.body) : null;
  return { show, hide, node };
}

// ---------- entity pickers ----------

export type Entity = { kind: "team" | "player"; id: string; name: string; sub?: string };

/** Search-as-you-type picker over clubs and/or players. */
export function EntityPicker({ kind, onPick, placeholder, value, filterSql }: {
  kind: "team" | "player" | "both"; onPick: (e: Entity) => void; placeholder?: string; value?: string;
  /** extra SQL condition on the player table alias p (e.g. limit to tier-A players) */
  filterSql?: string;
}) {
  const [q, setQ] = useState(value ?? "");
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(0);
  useEffect(() => { setQ(value ?? ""); }, [value]);
  const term = q.trim();
  const like = lit(`%${term}%`);
  const parts: string[] = [];
  if (kind !== "player") parts.push(`select 'team' kind, club_id id, name, league sub, 0 o from clubs where name ilike ${like} and league is not null`);
  if (kind !== "team") parts.push(`select 'player' kind, p.player_id id, p.name, coalesce(p.position, '') sub, 1 o from players p
    where p.name ilike ${like} and p.player_id in (select player_id from players_c union select player_id from players_a
      union select player_id from fm_player_season) ${filterSql ?? ""}`);
  // players only FotMob knows (joined after the Transfermarkt freeze)
  if (kind !== "team" && !filterSql) parts.push(`select 'player' kind, f.player_id id, f.name, coalesce(f.country, '') sub, 1 o from fm_players f where f.name ilike ${like}`);
  const res = useQuery(open && term.length >= 2 ? `select * from (${parts.join(" union all ")}) order by o, length(name) limit 20` : null);
  const pick = (r: Row) => { onPick({ kind: r.kind, id: r.id, name: r.name, sub: r.sub }); setQ(r.name); setOpen(false); };
  return (
    <div className="combo">
      <input type="search" value={q} placeholder={placeholder ?? "Search"} aria-label={placeholder ?? "Search"}
             onChange={(e) => { setQ(e.target.value); setOpen(true); setSel(0); }} onFocus={() => setOpen(true)}
             onBlur={() => setTimeout(() => setOpen(false), 150)}
             onKeyDown={(e) => {
               if (e.key === "ArrowDown") { setSel((s) => Math.min(s + 1, res.rows.length - 1)); e.preventDefault(); }
               if (e.key === "ArrowUp") { setSel((s) => Math.max(s - 1, 0)); e.preventDefault(); }
               if (e.key === "Enter" && res.rows[sel]) pick(res.rows[sel]);
               if (e.key === "Escape") setOpen(false);
             }} />
      {open && res.rows.length > 0 && (
        <ul role="listbox">
          {res.rows.map((r, i) => (
            <li key={r.kind + r.id} role="option" aria-selected={i === sel} onMouseDown={() => pick(r)}>
              <span>{r.name}</span><span className="muted xs" style={{ marginLeft: "auto" }}>{r.kind === "team" ? LEAGUES[r.sub] ?? r.sub : r.sub}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------- misc ----------

export const signedTone = (v: number | null | undefined) => (v == null ? undefined : v >= 0 ? "up" : "down") as "up" | "down" | undefined;

/** Colour for a club in a multi-team chart: slot order by its position in ``ids``. */
export const teamColor = (ids: string[], id: string) => slot(ids.indexOf(id) + 1);

export function useDebounced<T>(v: T, ms = 250) {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}

export function useInView<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (!ref.current || seen) return;
    const io = new IntersectionObserver((e) => { if (e[0].isIntersecting) setSeen(true); }, { rootMargin: "200px" });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [seen]);
  return [ref, seen] as const;
}

export { css };
