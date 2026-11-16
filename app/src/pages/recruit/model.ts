// Recruitment maths, all in the browser: z-scores within peers, cosine similarity over a
// position's profile, a per-position composite rating and value-for-money residuals.
import { Row } from "../../db";
import { fmAxes, F_METRICS } from "../player/fotmob";

export type Pool = "latest" | "2026" | "2025" | "2024";

/** Columns pulled for every player-season (only what the tool uses). */
export const METRIC_KEYS = [...new Set(F_METRICS.map((m) => m.key))].filter((k) => !["minutes", "age", "market_value"].includes(k));

/** Attacking outputs scaled by league strength when the league-adjusted mode is on. */
export const ATTACKING = new Set(["npxg_p90", "goals_p90", "shots_p90", "box_touches_p90", "xa_p90", "chances_p90",
  "big_chances_p90", "assists_p90", "dribbles_ok_p90", "final_third_passes_p90", "line_breaking_p90"]);

/** Dimension ratings that make up the composite, per position (equal weights). */
export const COMPOSITE: Record<string, string[]> = {
  GK: ["goalkeeping_rating"],
  CB: ["defending_rating", "duels_rating", "security_rating", "progression_rating"],
  FB: ["creation_rating", "progression_rating", "defending_rating", "physical_rating"],
  DM: ["defending_rating", "security_rating", "progression_rating", "duels_rating"],
  CM: ["progression_rating", "creation_rating", "security_rating", "defending_rating"],
  AM: ["creation_rating", "shooting_rating", "progression_rating"],
  W: ["shooting_rating", "creation_rating", "progression_rating"],
  ST: ["shooting_rating", "creation_rating", "duels_rating"],
};

export function composite(r: Row) {
  const ks = COMPOSITE[r.position_group] ?? COMPOSITE.CM;
  const v = ks.map((k) => r[k]).filter((x) => typeof x === "number" && Number.isFinite(x)) as number[];
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

const higherIsBetter = (k: string) => F_METRICS.find((m) => m.key === k)?.higher !== false;

/** Standard normal CDF (Abramowitz-Stegun), for z -> percentile. */
export function phi(z: number) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

/** Adds ``z_<metric>`` (sign-flipped so higher is always better) to every row.
 *  ``adjusted``: pool all leagues per position-season after scaling attacking outputs by
 *  league strength; otherwise z is within league-season-position. Means and SDs come from
 *  qualified players only. */
export function addZ(rows: Row[], factor: Record<string, number>, adjusted: boolean) {
  const keyOf = (r: Row) => (adjusted ? `${r.season}|${r.position_group}` : `${r.competition_id}|${r.season}|${r.position_group}`);
  const raw = (r: Row, k: string) => {
    const v = r[k];
    if (typeof v !== "number" || !Number.isFinite(v)) return null;
    return adjusted && ATTACKING.has(k) ? v * (factor[r.competition_id] ?? 1) : v;
  };
  const groups = new Map<string, Row[]>();
  rows.forEach((r) => { const k = keyOf(r); if (!groups.has(k)) groups.set(k, []); groups.get(k)!.push(r); });
  for (const g of groups.values()) {
    const q = g.filter((r) => r.qualified);
    for (const k of METRIC_KEYS) {
      const vals = q.map((r) => raw(r, k)).filter((x): x is number => x != null);
      if (vals.length < 5) { g.forEach((r) => { r[`z_${k}`] = null; }); continue; }
      const mu = vals.reduce((a, b) => a + b, 0) / vals.length;
      const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mu) ** 2, 0) / vals.length) || 1;
      const s = higherIsBetter(k) ? 1 : -1;
      g.forEach((r) => { const v = raw(r, k); r[`z_${k}`] = v == null ? null : (s * (v - mu)) / sd; });
    }
  }
}

/** Cosine similarity of two players over a position's profile axes (z-scores, clipped). */
export function similarity(a: Row, b: Row, pos: string) {
  const ks = fmAxes(pos).map((m) => m.key);
  let dot = 0, na = 0, nb = 0, used = 0;
  for (const k of ks) {
    const x = a[`z_${k}`], y = b[`z_${k}`];
    if (x == null || y == null) continue;
    const cx = Math.max(-3, Math.min(3, x)), cy = Math.max(-3, Math.min(3, y));
    dot += cx * cy; na += cx * cx; nb += cy * cy; used++;
  }
  if (used < 4 || !na || !nb) return null;
  // cosine on profile shape, discounted when the candidate's overall level differs a lot
  const cos = dot / Math.sqrt(na * nb);
  const lvl = Math.abs(Math.sqrt(na / used) - Math.sqrt(nb / used));
  return Math.max(0, cos) * Math.exp(-0.35 * lvl);
}

/** Axes where both players are clearly above their peers. */
export function sharedStrengths(a: Row, b: Row, pos: string, n = 3) {
  return fmAxes(pos)
    .map((m) => ({ m, s: Math.min(a[`z_${m.key}`] ?? -9, b[`z_${m.key}`] ?? -9) }))
    .filter((x) => x.s > 0.5).sort((x, y) => y.s - x.s).slice(0, n).map((x) => x.m.short ?? x.m.label);
}

/** Least-squares line of composite on log10(value), per position; residual = above/below. */
export function valueFit(rows: Row[]) {
  const by = new Map<string, Row[]>();
  rows.forEach((r) => { if (r.value > 0 && r.composite != null) { const k = r.position_group; if (!by.has(k)) by.set(k, []); by.get(k)!.push(r); } });
  const fits: Record<string, { a: number; b: number }> = {};
  for (const [k, g] of by) {
    const xs = g.map((r) => Math.log10(r.value)), ys = g.map((r) => r.composite as number);
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
    const sxx = xs.reduce((a, x) => a + (x - mx) ** 2, 0) || 1;
    const b = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / sxx;
    fits[k] = { a: my - b * mx, b };
  }
  rows.forEach((r) => {
    const f = fits[r.position_group];
    r.value_resid = f && r.value > 0 && r.composite != null ? r.composite - (f.a + f.b * Math.log10(r.value)) : null;
  });
  return fits;
}

export function peakLabel(age: number | null | undefined, peak?: { lo: number; hi: number }) {
  if (age == null || !peak) return null;
  if (age < peak.lo) return { label: "Pre-peak", tone: "up" as const };
  if (age > peak.hi + 2) return { label: "Past peak", tone: "down" as const };
  if (age > peak.hi) return { label: "Late peak", tone: undefined };
  return { label: "At peak", tone: undefined };
}

export function toCsv(rows: Row[], cols: [string, string][]) {
  const esc = (v: any) => {
    if (v == null) return "";
    const s = v instanceof Date ? v.toISOString().slice(0, 10) : typeof v === "number" ? String(Math.round(v * 1000) / 1000) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.map(([, l]) => esc(l)).join(","), ...rows.map((r) => cols.map(([k]) => esc(r[k])).join(","))].join("\n");
}

export function download(name: string, text: string) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export type ShortItem = { id: string; season: number; comp: string };
const KEY = "pv-shortlist";
export function loadShortlist(): ShortItem[] {
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
}
export function saveShortlist(items: ShortItem[]) {
  try { localStorage.setItem(KEY, JSON.stringify(items)); } catch { /* private mode: keep in memory only */ }
}
