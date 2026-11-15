// The models, re-implemented in the browser so every tool is live: Dixon-Coles score
// matrices, a season simulator, and the game-state win-probability recursion. They follow
// the Python pipeline exactly (src/pitchvision/models/team.py, forecast/season.py,
// forecast/winprob.py); the pipeline is the reference.

export const MAXG = 10;

export function poisson(k: number, l: number) {
  let p = Math.exp(-l);
  for (let i = 1; i <= k; i++) p *= l / i;
  return p;
}

/** P(home = i, away = j), Dixon-Coles low-score correction rho. */
export function scoreMatrix(lh: number, la: number, rho = 0, maxg = MAXG): number[][] {
  const m: number[][] = [];
  let tot = 0;
  for (let i = 0; i <= maxg; i++) {
    m.push([]);
    for (let j = 0; j <= maxg; j++) {
      let p = poisson(i, lh) * poisson(j, la);
      if (i === 0 && j === 0) p *= 1 - lh * la * rho;
      else if (i === 0 && j === 1) p *= 1 + lh * rho;
      else if (i === 1 && j === 0) p *= 1 + la * rho;
      else if (i === 1 && j === 1) p *= 1 - rho;
      m[i].push(Math.max(p, 0));
      tot += Math.max(p, 0);
    }
  }
  return m.map((r) => r.map((p) => p / tot));
}

export type MarketSummary = {
  home: number; draw: number; away: number; btts: number; over15: number; over25: number;
  over35: number; cleanHome: number; cleanAway: number; gd: Map<number, number>; total: Map<number, number>;
  top: { h: number; a: number; p: number }[]; xgh: number; xga: number;
};

export function summarise(m: number[][]): MarketSummary {
  let home = 0, draw = 0, away = 0, btts = 0, o15 = 0, o25 = 0, o35 = 0, ch = 0, ca = 0;
  const gd = new Map<number, number>(), total = new Map<number, number>();
  const cells: { h: number; a: number; p: number }[] = [];
  let xgh = 0, xga = 0;
  m.forEach((row, i) => row.forEach((p, j) => {
    if (i > j) home += p; else if (i === j) draw += p; else away += p;
    if (i > 0 && j > 0) btts += p;
    if (i + j > 1.5) o15 += p;
    if (i + j > 2.5) o25 += p;
    if (i + j > 3.5) o35 += p;
    if (j === 0) ch += p;
    if (i === 0) ca += p;
    gd.set(i - j, (gd.get(i - j) ?? 0) + p);
    total.set(i + j, (total.get(i + j) ?? 0) + p);
    cells.push({ h: i, a: j, p });
    xgh += i * p; xga += j * p;
  }));
  cells.sort((a, b) => b.p - a.p);
  return { home, draw, away, btts, over15: o15, over25: o25, over35: o35, cleanHome: ch, cleanAway: ca,
           gd, total, top: cells.slice(0, 8), xgh, xga };
}

/** Expected goals from Dixon-Coles parameters (log scale): lh = exp(home + att_h + dfn_a). */
export function rates(t: { att: number; dfn: number }, o: { att: number; dfn: number }, home: number, neutral = false) {
  return {
    lh: Math.exp((neutral ? home / 2 : home) + t.att + o.dfn),
    la: Math.exp((neutral ? home / 2 : 0) + o.att + t.dfn),
  };
}

// ---------- season simulator ----------

/** Seeded RNG (mulberry32) so a simulation is reproducible for a given seed. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function samplePoisson(l: number, u: () => number) {
  const L = Math.exp(-l);
  let k = 0, p = 1;
  do { k++; p *= u(); } while (p > L);
  return k - 1;
}

export type SimTeam = { id: string; name: string; att: number; dfn: number; pts: number; gf: number; ga: number; played: number };
export type SimFixture = { h: string; a: string };
export type SimResult = {
  id: string; name: string; expPts: number; expGd: number; pos: number[]; pTitle: number; pTop4: number;
  pTop6: number; pReleg: number; ptsDist: number[];
};

/** Remaining double round-robin fixtures, given the pairs already played. */
export function remainingFixtures(ids: string[], played: SimFixture[]): SimFixture[] {
  const done = new Set(played.map((p) => `${p.h}|${p.a}`));
  const out: SimFixture[] = [];
  for (const h of ids) for (const a of ids) if (h !== a && !done.has(`${h}|${a}`)) out.push({ h, a });
  return out;
}

/** Monte Carlo of the rest of a season. Ranking: points, goal difference, goals scored
 *  (head-to-head tiebreakers are applied in the pipeline's simulator, not here). */
export function simulateSeason(teams: SimTeam[], fixtures: SimFixture[], home: number, runs = 4000,
                               relegated = 3, seed = 7): SimResult[] {
  const u = rng(seed);
  const n = teams.length;
  const idx = new Map(teams.map((t, i) => [t.id, i]));
  const fx = fixtures.map((f) => {
    const h = teams[idx.get(f.h)!], a = teams[idx.get(f.a)!];
    return { hi: idx.get(f.h)!, ai: idx.get(f.a)!, ...rates(h, a, home) };
  });
  const posCount = teams.map(() => new Array(n).fill(0));
  const ptsSum = new Array(n).fill(0), gdSum = new Array(n).fill(0);
  const ptsDist = teams.map(() => new Array(120).fill(0));
  const pts = new Array(n), gd = new Array(n), gf = new Array(n);
  const order = teams.map((_, i) => i);
  for (let r = 0; r < runs; r++) {
    for (let i = 0; i < n; i++) { pts[i] = teams[i].pts; gd[i] = teams[i].gf - teams[i].ga; gf[i] = teams[i].gf; }
    for (const f of fx) {
      const hg = samplePoisson(f.lh, u), ag = samplePoisson(f.la, u);
      gd[f.hi] += hg - ag; gd[f.ai] += ag - hg; gf[f.hi] += hg; gf[f.ai] += ag;
      if (hg > ag) pts[f.hi] += 3; else if (hg < ag) pts[f.ai] += 3; else { pts[f.hi]++; pts[f.ai]++; }
    }
    order.sort((a, b) => pts[b] - pts[a] || gd[b] - gd[a] || gf[b] - gf[a] || u() - 0.5);
    order.forEach((t, p) => { posCount[t][p]++; });
    for (let i = 0; i < n; i++) { ptsSum[i] += pts[i]; gdSum[i] += gd[i]; ptsDist[i][Math.min(119, pts[i])]++; }
  }
  return teams.map((t, i) => {
    const pos = posCount[i].map((c) => c / runs);
    const sum = (a: number, b: number) => pos.slice(a, b).reduce((x, y) => x + y, 0);
    return { id: t.id, name: t.name, expPts: ptsSum[i] / runs, expGd: gdSum[i] / runs, pos,
             pTitle: pos[0], pTop4: sum(0, 4), pTop6: sum(0, 6), pReleg: sum(n - relegated, n),
             ptsDist: ptsDist[i].map((c) => c / runs) };
  }).sort((a, b) => b.expPts - a.expPts);
}

// ---------- win probability by game state ----------

export type WpParams = { term: string; coef: number }[];
const GDMAX = 10;

/** Multiplier on a side's scoring rate for its own goal difference g, red-card advantage r
 *  and minute t (terms named as in forecast/winprob.py: gd_-2, gd_-1, gd_1, gd_2,
 *  red_advantage, red_disadvantage, phase_1..phase_5). */
function multiplier(b: Record<string, number>, g: number, r: number, t: number) {
  const gg = Math.max(-2, Math.min(2, g));
  let eta = 0;
  if (gg !== 0) eta += b[`gd_${gg}`] ?? 0;
  if (r === 1) eta += b.red_advantage ?? 0;
  if (r === -1) eta += b.red_disadvantage ?? 0;
  const ph = Math.min(Math.floor(t / 15), 5);
  if (ph > 0) eta += b[`phase_${ph}`] ?? 0;
  return Math.exp(eta);
}

/** V[t][gd + 10] = [P(home win), P(draw), P(away win)] from the start of minute t. */
export function wpTable(lh: number, la: number, params: WpParams, redD = 0) {
  const b = Object.fromEntries(params.map((p) => [p.term, p.coef]));
  const G = 2 * GDMAX + 1;
  const V: number[][][] = Array.from({ length: 91 }, () => Array.from({ length: G }, () => [0, 0, 0]));
  for (let k = 0; k < G; k++) { const g = k - GDMAX; V[90][k] = g > 0 ? [1, 0, 0] : g === 0 ? [0, 1, 0] : [0, 0, 1]; }
  for (let t = 89; t >= 0; t--) {
    for (let k = 0; k < G; k++) {
      const g = k - GDMAX;
      const h = 1 - Math.exp(-(lh / 90) * multiplier(b, g, redD, t));
      const a = 1 - Math.exp(-(la / 90) * multiplier(b, -g, -redD, t));
      const up = V[t + 1][Math.min(k + 1, G - 1)], dn = V[t + 1][Math.max(k - 1, 0)], st = V[t + 1][k];
      const ph = h * (1 - a), pa = (1 - h) * a, ps = (1 - h) * (1 - a) + h * a;
      V[t][k] = [0, 1, 2].map((o) => ph * up[o] + pa * dn[o] + ps * st[o]);
    }
  }
  return V;
}
export const wpAt = (V: number[][][], minute: number, gd: number) =>
  V[Math.max(0, Math.min(90, minute))][Math.max(-GDMAX, Math.min(GDMAX, gd)) + GDMAX];

/** Pre-match expected goals that reproduce a 1X2 (rough inversion, for the calculator). */
export function ratesFrom1x2(pH: number, pA: number, total = 2.7) {
  let best = { lh: 1.5, la: 1.2, err: 1e9 };
  for (let s = -1.5; s <= 1.5; s += 0.02) {
    const lh = (total / 2) * Math.exp(s / 2), la = (total / 2) * Math.exp(-s / 2);
    const m = summarise(scoreMatrix(lh, la, -0.05, 8));
    const err = (m.home - pH) ** 2 + (m.away - pA) ** 2;
    if (err < best.err) best = { lh, la, err };
  }
  return best;
}
