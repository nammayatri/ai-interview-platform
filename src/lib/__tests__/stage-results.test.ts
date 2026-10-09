import { describe, expect, it } from "vitest";
import { formatStageResults } from "../scoring/run-scoring";
import { describePhase } from "../scoring/phase-scoring";
import { phase } from "./fixtures";

describe("formatStageResults (what the final scoring AI receives)", () => {
  const done = describePhase(
    phase({ status: "completed", endedAt: "2026-01-01T10:12:00.000Z", endReason: "ai_done", hintsUsed: [{ order: 1, atMin: 6, transcriptEntryId: 1 }], weakAnswers: 2 }),
    { criteria: [{ id: "bottleneck", credit: "met", evidence: "found the nested loop" }, { id: "complexity", credit: "partial", evidence: "" }], notes: "Solid on correctness." }
  );
  const text = formatStageResults([done], [{ key: "puzzle", reason: "skipped no time" }]);

  it("lists each stage with score, time, weak answers and hints", () => {
    expect(text).toContain('STAGE 1: Part A evaluation "Two Sum": score 3.9/5');
    expect(text).toContain("weak answers 2");
    expect(text).toContain("hint 1 at minute 6");
  });
  it("includes every criterion with its credit and evidence, and the assessor notes", () => {
    expect(text).toContain("[met]");
    expect(text).toContain("(evidence: found the nested loop)");
    expect(text).toContain("[partial]");
    expect(text).toContain("Assessor notes: Solid on correctness.");
  });
  it("says which stages did not run", () => expect(text).toContain("NOT RUN: Puzzle (skipped no time)"));
  it("marks an unscored stage with its reason", () => {
    const skipped = describePhase(phase({ status: "completed" }), { skipped: true, reason: "Only 1 candidate response(s) in this phase" });
    expect(formatStageResults([skipped], [])).toContain("not scored (Only 1 candidate response(s)");
  });
});
