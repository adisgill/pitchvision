// The browser models must match the Python pipeline. Reference values come from
// pitchvision.models.team.score_matrix / outcome_probs and forecast.winprob.outcome_table
// (lh 1.6, la 1.1, rho -0.07, published wp_params).
import { describe, expect, it } from "vitest";
import { remainingFixtures, scoreMatrix, simulateSeason, summarise, wpAt, wpTable } from "./models";

const WP = [
  { term: "gd_-1", coef: 0.028699 }, { term: "gd_-2", coef: 0.040359 }, { term: "gd_1", coef: -0.071638 },
  { term: "gd_2", coef: -0.003339 }, { term: "phase_1", coef: -0.12235 }, { term: "phase_2", coef: 0.024008 },
  { term: "phase_3", coef: -0.010511 }, { term: "phase_4", coef: 0.030131 }, { term: "phase_5", coef: 0.300127 },
  { term: "red_advantage", coef: 0.525769 }, { term: "red_disadvantage", coef: -0.550571 },
];
const close = (a: number[], b: number[], tol = 2e-4) => a.forEach((x, i) => expect(Math.abs(x - b[i])).toBeLessThan(tol));

describe("Dixon-Coles score matrix", () => {
  const m = scoreMatrix(1.6, 1.1, -0.07);
  it("matches the Python cells", () => {
    close([m[0][0], m[1][1], m[2][1]], [0.07548531125062347, 0.1265615546182106, 0.09462546139679297], 1e-6);
  });
  it("matches the Python 1X2", () => {
    const s = summarise(m);
    close([s.home, s.draw, s.away], [0.48129329892911643, 0.2654706980122575, 0.2532360030586261], 1e-6);
  });
});

describe("win probability recursion", () => {
  it("kickoff, level", () => close(wpAt(wpTable(1.6, 1.1, WP, 0), 0, 0), [0.48926297566047305, 0.25364334029254226, 0.2570936840469835]));
  it("minute 60, home a goal down", () => close(wpAt(wpTable(1.6, 1.1, WP, 0), 60, -1), [0.09366303245133574, 0.2602847952499306, 0.6460521722987337]));
  it("minute 75, home a goal up and a man up", () => close(wpAt(wpTable(1.6, 1.1, WP, 1), 75, 1), [0.9209648368830369, 0.07401524981184222, 0.005019913305120176]));
});

describe("season simulator", () => {
  it("probabilities sum to one and a far stronger team wins the title", () => {
    const teams = ["a", "b", "c", "d"].map((id, i) => ({ id, name: id, att: i === 0 ? 0.6 : 0, dfn: i === 0 ? -0.6 : 0, pts: 0, gf: 0, ga: 0, played: 0 }));
    const fx = remainingFixtures(teams.map((t) => t.id), []);
    expect(fx.length).toBe(12);
    const r = simulateSeason(teams, fx, 0.25, 2000, 1);
    const pos1 = r.reduce((a, t) => a + t.pos[0], 0);
    expect(Math.abs(pos1 - 1)).toBeLessThan(1e-9);
    expect(r[0].id).toBe("a");
    expect(r[0].pTitle).toBeGreaterThan(0.6);
  });
});
