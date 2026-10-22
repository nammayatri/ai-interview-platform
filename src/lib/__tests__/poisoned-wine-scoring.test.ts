import { describe, expect, it } from "vitest";
import { puzzleOnlyNotAssessed, rollupDimensions, type Credit, type RollupPhaseInput } from "../scoring/rollup";
import { calculateOverall, calculateRecommendation, type DimScores } from "../scorecard-calc";
import { DEFAULT_AI_SETTINGS } from "../ai-settings";

// Mirrors the Poisoned Wine rubric and hint costs in scripts/seed/evaluation-content.mjs (problem solving only).
const W: Record<string, number> = { stage1: 2, small_case: 1, counting: 2, stage2: 2, bonus: 1, stage3_break: 1.5, stage3_plan: 1, self_check: 0.5 };
const rubric = Object.entries(W).map(([id, weight]) => ({ id, text: id, weight, mapsTo: "problemSolving" as const }));
const ladder = Array.from({ length: 10 }, (_, i) => ({ order: i + 1, text: "h", scoreDiscount: i < 6 ? 0.05 : 0.06 })) as any;

function verdict(met: string[], hintCount: number) {
  const phase: RollupPhaseInput = {
    key: "puzzle", scoreWeight: 0.3, rubric,
    criteria: Object.keys(W).map((id) => ({ id, credit: (met.includes(id) ? "met" : "missed") as Credit, evidence: "" })),
    hintsUsed: Array.from({ length: hintCount }, (_, i) => ({ order: i + 1 })), hintLadder: ladder,
  };
  const notAssessed = puzzleOnlyNotAssessed([phase]);
  const ps = rollupDimensions([phase]).scores.problemSolving!;
  // Global AI values for the dimensions that are not assessed must make no difference.
  const dims: DimScores = { technicalDepth: 1, communication: 1, problemSolving: ps, domainKnowledge: 1, cultureFit: 1 };
  const overall = calculateOverall(dims, "Backend Engineer", notAssessed);
  return { notAssessed, ps, overall, rec: calculateRecommendation(overall, dims, DEFAULT_AI_SETTINGS, notAssessed) };
}
const THROUGH_BONUS = ["stage1", "small_case", "counting", "stage2", "bonus"];

describe("Poisoned Wine scoring", () => {
  it("scores only problem solving", () => {
    expect(verdict(THROUGH_BONUS, 0).notAssessed.sort()).toEqual(["communication", "cultureFit", "domainKnowledge", "technicalDepth"]);
  });
  it("hires a candidate who finishes the bonus round, with up to 4 hints", () => {
    for (const hints of [0, 1, 2, 3, 4]) expect(verdict(THROUGH_BONUS, hints).rec).toBe("hire");
    expect(verdict(THROUGH_BONUS, 0).ps).toBeCloseTo(1 + 4 * (8 / 11), 1);
  });
  it("does not hire after 5 hints, or when the bonus is not reached and Stage 2 is missing", () => {
    expect(verdict(THROUGH_BONUS, 5).rec).toBe("no_hire");
    expect(verdict(["stage1", "small_case", "counting"], 0).rec).toBe("no_hire");
  });
  it("hires Stage 1 + Stage 2 even without the bonus", () => {
    expect(verdict(["stage1", "small_case", "counting", "stage2"], 2).rec).toBe("hire");
  });
  it("needs Stage 3 for a strong hire", () => {
    expect(verdict(THROUGH_BONUS, 0).rec).toBe("hire");
    expect(verdict([...THROUGH_BONUS, "stage3_break"], 0).rec).toBe("strong_hire");
  });
  it("keeps communication when a puzzle rubric scores it", () => {
    const phase: RollupPhaseInput = { key: "puzzle", scoreWeight: 0.3, rubric: [...rubric, { id: "explains", text: "e", weight: 1, mapsTo: "communication" }], criteria: [], hintsUsed: [], hintLadder: ladder };
    expect(puzzleOnlyNotAssessed([phase]).sort()).toEqual(["cultureFit", "domainKnowledge", "technicalDepth"]);
  });
  it("falls back to the old behaviour when nothing is scored", () => {
    expect(puzzleOnlyNotAssessed([])).toEqual(["technicalDepth", "domainKnowledge"]);
  });
});
