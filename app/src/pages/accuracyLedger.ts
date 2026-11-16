/** Ranked probability score for one home/draw/away forecast (outcome 0 home, 1 draw, 2 away). */
export function rps(p: [number, number, number], outcome: number) {
  const o = [0, 0, 0];
  o[outcome] = 1;
  const c1 = p[0] - o[0], c2 = p[0] + p[1] - (o[0] + o[1]);
  return 0.5 * (c1 * c1 + c2 * c2);
}
