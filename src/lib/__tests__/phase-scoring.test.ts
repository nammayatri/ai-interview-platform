import { describe, expect, it } from "vitest";
import { describePhase, normalizePhaseScorecard } from "../scoring/phase-scoring";
import { phase, problemRunbook } from "./fixtures";

describe("normalizePhaseScorecard", () => {
  it("keeps valid credits, drops unknown ids and counts missing criteria as missed", () => {
    const r = normalizePhaseScorecard(
      { criteria: [{ id: "bottleneck", credit: "met", evidence: "found it" }, { id: "ghost", credit: "met", evidence: "" }], notes: "ok" },
      problemRunbook.rubric,
      false
    );
    expect(r.criteria).toEqual([
      { id: "bottleneck", credit: "met", evidence: "found it" },
      { id: "complexity", credit: "missed", evidence: "" },
    ]);
  });
  it("coerces invalid credit values to missed", () => {
    const r = normalizePhaseScorecard({ criteria: [{ id: "bottleneck", credit: "excellent" }] }, problemRunbook.rubric, false);
    expect(r.criteria![0].credit).toBe("missed");
  });
  it("only keeps finalAnswerCorrect for puzzles", () => {
    expect(normalizePhaseScorecard({ finalAnswerCorrect: true }, problemRunbook.rubric, true).finalAnswerCorrect).toBe(true);
    expect(normalizePhaseScorecard({ finalAnswerCorrect: true }, problemRunbook.rubric, false)).not.toHaveProperty("finalAnswerCorrect");
  });
});

describe("describePhase", () => {
  it("reports raw and discounted credit and the hints used with their text", () => {
    const p = phase({ status: "completed", endedAt: "2026-01-01T10:12:00.000Z", endReason: "ai_done", hintsUsed: [{ order: 1, atMin: 6, transcriptEntryId: 3 }], weakAnswers: 1 });
    const d = describePhase(p, { criteria: [{ id: "bottleneck", credit: "met", evidence: "x" }, { id: "complexity", credit: "met", evidence: "y" }], notes: "n" });
    expect(d.score).toBe(4.6);
    expect(d.rawCredit).toBe(1);
    expect(d.hintDiscount).toBe(0.1);
    expect(d.creditAfterDiscount).toBe(0.9);
    expect(d.durationMin).toBe(12);
    expect(d.hintsUsed[0]).toMatchObject({ order: 1, atMin: 6 });
    expect(d.hintsUsed[0].text).toContain("HINT-ONE-TEXT");
    expect(d.criteria[0]).toMatchObject({ id: "bottleneck", credit: "met", mapsTo: "problemSolving" });
  });
  it("marks an unscored phase as skipped with its reason", () => {
    const d = describePhase(phase({ status: "completed" }), { skipped: true, reason: "Only 1 candidate response(s) in this phase" });
    expect(d).toMatchObject({ status: "skipped", score: null });
    expect(d.skipReason).toMatch(/Only 1/);
  });
});
