import { describe, expect, it } from "vitest";
import { managerSlug, readProfile, stripPct, Trait } from "./tactics";

describe("managerSlug", () => {
  it("matches the pipeline's key", () => {
    expect(managerSlug("Jürgen Klopp")).toBe("jurgen-klopp");
    expect(managerSlug("Ole Gunnar Solskjær")).toBe("ole-gunnar-solskjaer");
    expect(managerSlug("Ole Gunnar Solskjaer")).toBe("ole-gunnar-solskjaer");
    expect(managerSlug("Hans-Dieter Flick")).toBe("hans-dieter-flick");
    expect(managerSlug("José Bordalás")).toBe("jose-bordalas");
  });
});

const T = (o: Partial<Trait>): Trait => ({
  trait: "x", label: "X", kind: "style", higher_better: null, high: "High", low: "Low", unit: "",
  season_rel: 0.9, per_match_rel: 0.3, matches_for_07: 5, ...o,
});

describe("readProfile", () => {
  it("only reads reliable, extreme traits and orients defence so better is higher", () => {
    const traits = [
      T({ trait: "possession", high: "Keeps the ball" }),
      T({ trait: "op_xg_against", kind: "output", higher_better: false, high: "Hard to open up", low: "Open" }),
      T({ trait: "sp_xg_against", kind: "output", higher_better: false, high: "Solid", low: "Leaky" }),
    ];
    const p = readProfile([
      { trait: "possession", pct: 92, rel: 0.95, value: 60 },
      { trait: "op_xg_against", pct: 5, rel: 0.8, value: 0.5 },
      { trait: "sp_xg_against", pct: 98, rel: 0.3, value: 0.6 },
    ], traits);
    expect(p.tendencies.map((r) => r.phrase)).toEqual(["Keeps the ball"]);
    expect(p.strengths.map((r) => r.phrase)).toEqual(["Hard to open up"]);
    expect(p.weaknesses).toEqual([]);
    expect(p.noisy).toBe(1);
    expect(stripPct(traits[1], 5)).toBe(95);
  });
});
