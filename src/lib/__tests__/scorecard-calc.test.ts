import { describe, expect, it } from "vitest";
import { calculateOverall, calculateRecommendation } from "../scorecard-calc";
import { DEFAULT_AI_SETTINGS } from "../ai-settings";

const settings = { ...DEFAULT_AI_SETTINGS };
// The Poisoned Wine interview that was wrongly "no hire": technical depth 1 only because no code was asked for.
const wine = { technicalDepth: 1, communication: 2.8, problemSolving: 4, domainKnowledge: 3, cultureFit: 3 };

describe("scorecard calc with dimensions that were not assessed", () => {
  it("is no hire when the untested technical depth counts against a puzzle-only candidate", () => {
    const overall = calculateOverall(wine, "SDE");
    expect(overall).toBe(2.7);
    expect(calculateRecommendation(overall, wine, settings)).toBe("no_hire");
  });
  it("is a hire once technical depth and domain knowledge are left out", () => {
    const na = ["technicalDepth", "domainKnowledge"] as const;
    const overall = calculateOverall(wine, "SDE", [...na]);
    expect(overall).toBe(3.4);
    expect(calculateRecommendation(overall, wine, settings, [...na])).toBe("hire");
  });
  it("still refuses a hire when an assessed dimension is below its minimum", () => {
    const na = ["technicalDepth", "domainKnowledge"] as const;
    const weak = { ...wine, problemSolving: 2.5, communication: 4.5 };
    const overall = calculateOverall(weak, "SDE", [...na]);
    expect(calculateRecommendation(overall, weak, settings, [...na])).toBe("no_hire");
  });
  it("keeps the old behaviour when everything was assessed", () => {
    const all = { technicalDepth: 4, communication: 4, problemSolving: 4, domainKnowledge: 4, cultureFit: 4 };
    expect(calculateOverall(all, "SDE")).toBe(4);
    expect(calculateRecommendation(4, all, settings)).toBe("hire");
  });
});
