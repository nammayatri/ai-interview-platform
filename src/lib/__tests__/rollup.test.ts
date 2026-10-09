import { describe, expect, it } from "vitest";
import { hintDiscount, phaseScore, rollupDimensions, type RollupPhaseInput } from "../scoring/rollup";
import { hints, problemRunbook, puzzleRunbook } from "./fixtures";

const dsa = (criteria: RollupPhaseInput["criteria"], hintsUsed: Array<{ order: number }> = []): RollupPhaseInput => ({
  key: "dsa", scoreWeight: 0.7, rubric: problemRunbook.rubric, criteria, hintsUsed, hintLadder: hints,
});
const puzzle = (credit: "met" | "partial" | "missed"): RollupPhaseInput => ({
  key: "puzzle", scoreWeight: 0.3, rubric: puzzleRunbook.rubric, criteria: [{ id: "p1", credit, evidence: "" }], hintsUsed: [], hintLadder: puzzleRunbook.hintLadder,
});

describe("phase score", () => {
  it("maps full credit to 5 and none to 1", () => {
    expect(phaseScore(dsa([{ id: "bottleneck", credit: "met", evidence: "" }, { id: "complexity", credit: "met", evidence: "" }]))).toBe(5);
    expect(phaseScore(dsa([]))).toBe(1);
  });
  it("weights criteria (bottleneck weight 2, complexity weight 1)", () => {
    // (2*1 + 1*0) / 3 = 0.667 -> 1 + 4 * 0.667 = 3.667
    expect(phaseScore(dsa([{ id: "bottleneck", credit: "met", evidence: "" }]))).toBeCloseTo(3.667, 2);
  });
  it("gives half credit for partial", () => {
    expect(phaseScore(dsa([{ id: "bottleneck", credit: "partial", evidence: "" }, { id: "complexity", credit: "partial", evidence: "" }]))).toBe(3);
  });
  it("subtracts hint discounts", () => {
    const all = [{ id: "bottleneck", credit: "met" as const, evidence: "" }, { id: "complexity", credit: "met" as const, evidence: "" }];
    expect(hintDiscount([{ order: 1 }, { order: 2 }], hints)).toBeCloseTo(0.3);
    expect(phaseScore(dsa(all, [{ order: 1 }, { order: 2 }]))).toBeCloseTo(1 + 4 * 0.7);
  });
  it("clamps the credit fraction at zero", () => {
    expect(phaseScore(dsa([{ id: "complexity", credit: "partial", evidence: "" }], [{ order: 1 }, { order: 2 }, { order: 3 }]))).toBe(1);
  });
});

describe("rollupDimensions", () => {
  const dsaFull = dsa([{ id: "bottleneck", credit: "met", evidence: "" }, { id: "complexity", credit: "met", evidence: "" }]);
  it("scores a single phase by dimension and marks sources", () => {
    const r = rollupDimensions([dsaFull]);
    expect(r.scores.problemSolving).toBe(5);
    expect(r.scores.technicalDepth).toBe(5);
    expect(r.sources.problemSolving).toBe("rubric");
  });
  it("falls back to global for dimensions with no mapped criteria", () => {
    const r = rollupDimensions([dsaFull]);
    expect(r.scores.communication).toBeUndefined();
    expect(r.sources.communication).toBe("global");
    expect(r.sources.cultureFit).toBe("global");
  });
  it("combines two phases by score_weight (0.7 dsa / 0.3 puzzle) for a shared dimension", () => {
    // problemSolving: dsa fraction 1.0 (bottleneck met), puzzle fraction 0 -> 0.7 -> 1 + 4*0.7 = 3.8
    const r = rollupDimensions([dsaFull, puzzle("missed")]);
    expect(r.scores.problemSolving).toBe(3.8);
    // technicalDepth is only mapped in the DSA phase, so it is not diluted by the puzzle
    expect(r.scores.technicalDepth).toBe(5);
  });
  it("gives the DSA phase full weight when the puzzle was not scored", () => {
    expect(rollupDimensions([dsaFull]).scores.problemSolving).toBe(5);
  });
  it("applies a phase's hint discount to its dimension fractions", () => {
    const r = rollupDimensions([dsa([{ id: "bottleneck", credit: "met", evidence: "" }, { id: "complexity", credit: "met", evidence: "" }], [{ order: 1 }])]);
    expect(r.scores.problemSolving).toBe(4.6); // fraction 1 - 0.1 = 0.9 -> 1 + 3.6
  });
  it("returns nothing for no phases", () => {
    const r = rollupDimensions([]);
    expect(r.scores).toEqual({});
    expect(Object.values(r.sources).every((v) => v === "global")).toBe(true);
  });
});
