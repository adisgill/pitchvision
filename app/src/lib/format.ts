// Formatting, league metadata and colour helpers shared by every page.

export const LEAGUES: Record<string, string> = {
  GB1: "Premier League", ES1: "La Liga", L1: "Bundesliga", IT1: "Serie A", FR1: "Ligue 1",
  GB2: "Championship", NL1: "Eredivisie", PO1: "Primeira Liga", MLS1: "MLS",
  WSL: "WSL", FBL: "Frauen-Bundesliga", LIGAF: "Liga F", SERIEAW: "Serie A Women", NWSL: "NWSL",
};
export const SHORT: Record<string, string> = {
  GB1: "EPL", ES1: "LaLiga", L1: "BL", IT1: "SA", FR1: "L1", GB2: "Champ", NL1: "Ere", PO1: "Liga",
  MLS1: "MLS", WSL: "WSL", FBL: "FBL", LIGAF: "LigaF", SERIEAW: "SAW", NWSL: "NWSL",
};
/** Leagues with results, odds, forecasts and simulations. */
export const SIM_LEAGUES = ["GB1", "ES1", "L1", "IT1", "FR1", "NL1", "PO1", "GB2"];
/** Leagues with player-level (Transfermarkt) data. */
export const PLAYER_LEAGUES = ["GB1", "ES1", "L1", "IT1", "FR1", "NL1", "PO1"];
export const POSITIONS = ["GK", "CB", "FB", "DM", "CM", "AM", "W", "ST"];
export const POSITION_NAMES: Record<string, string> = {
  GK: "Goalkeeper", CB: "Centre-back", FB: "Full-back", DM: "Defensive mid", CM: "Central mid",
  AM: "Attacking mid", W: "Winger", ST: "Striker",
};

export const seasonLabel = (s: number, comp?: string) =>
  comp === "MLS1" || comp === "NWSL" ? `${s}` : `${s}-${String((s + 1) % 100).padStart(2, "0")}`;

const bad = (v: any) => v == null || (typeof v === "number" && !Number.isFinite(v));
export const fmt = {
  n: (v: any, d = 0) => (bad(v) ? "–" : Number(v).toLocaleString("en-GB", { minimumFractionDigits: d, maximumFractionDigits: d })),
  pct: (v: any, d = 0) => (bad(v) ? "–" : `${(100 * v).toFixed(d)}%`),
  signed: (v: any, d = 2) => (bad(v) ? "–" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(Number(v)).toFixed(d)}`),
  eur: (v: any) => {
    if (bad(v)) return "–";
    const a = Math.abs(v);
    return a >= 1e9 ? `€${(v / 1e9).toFixed(2)}bn` : a >= 1e6 ? `€${(v / 1e6).toFixed(a >= 1e8 ? 0 : 1)}m` : a >= 1e3 ? `€${Math.round(v / 1e3)}k` : `€${v}`;
  },
  date: (v: any) => (v ? new Date(v).toISOString().slice(0, 10) : "–"),
  day: (v: any) => (v ? new Date(v).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "–"),
  dayYear: (v: any) => (v ? new Date(v).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "–"),
  compact: (v: any) => (bad(v) ? "–" : Intl.NumberFormat("en-GB", { notation: "compact", maximumFractionDigits: 1 }).format(v)),
  odds: (p: any) => (bad(p) || p <= 0 ? "–" : (1 / p).toFixed(2)),
};

/** Resolved value of a CSS custom property (for libraries that need a literal colour). */
export const css = (name: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#888";

/** Categorical slot colour, 1-based, fixed order. */
export const slot = (i: number) => css(`--s${((i - 1) % 8) + 1}`);

/** Sequential blue ramp: t in [0, 1] -> colour (via the seven ramp steps). */
export function seq(t: number) {
  const steps = [100, 200, 300, 400, 500, 600, 700].map((s) => css(`--seq-${s}`));
  const x = Math.max(0, Math.min(1, t)) * (steps.length - 1);
  const i = Math.floor(x);
  return mix(steps[i], steps[Math.min(i + 1, steps.length - 1)], x - i);
}

/** Diverging: t in [-1, 1] -> red (neg) ... grey (mid) ... blue (pos). */
export function div(t: number) {
  const c = Math.max(-1, Math.min(1, t));
  return c >= 0 ? mix(css("--mid"), css("--pos"), c) : mix(css("--mid"), css("--neg"), -c);
}

function hex(c: string): [number, number, number] {
  const h = c.replace("#", "");
  const f = h.length === 3 ? h.split("").map((x) => x + x).join("") : h;
  return [parseInt(f.slice(0, 2), 16), parseInt(f.slice(2, 4), 16), parseInt(f.slice(4, 6), 16)];
}
export function mix(a: string, b: string, t: number) {
  try {
    const [r1, g1, b1] = hex(a), [r2, g2, b2] = hex(b);
    const m = (x: number, y: number) => Math.round(x + (y - x) * t);
    return `rgb(${m(r1, r2)}, ${m(g1, g2)}, ${m(b1, b2)})`;
  } catch {
    return a;
  }
}
/** Label ink for text placed inside a filled mark. */
export function inkOn(c: string) {
  const m = c.match(/\d+/g);
  let r = 0, g = 0, b = 0;
  if (c.startsWith("#")) [r, g, b] = hex(c);
  else if (m) [r, g, b] = m.map(Number);
  return 0.299 * r + 0.587 * g + 0.114 * b > 160 ? "#0b0b0b" : "#ffffff";
}

export const ageOn = (dob: any, at = new Date()) =>
  dob ? Math.floor((at.getTime() - new Date(dob).getTime()) / 3.15576e10) : null;

export const result = (gf: number, ga: number) => (gf > ga ? "W" : gf < ga ? "L" : "D");
