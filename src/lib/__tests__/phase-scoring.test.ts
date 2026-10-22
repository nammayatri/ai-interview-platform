import { describe, expect, it } from "vitest";
import { describePhase, normalizePhaseScorecard, salvagePhaseScorecard } from "../scoring/phase-scoring";
import { parseScorecardJSON } from "../parse-scorecard";
import { customFlow, partaConfig, phase, problemRunbook } from "./fixtures";

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

describe("runbook criteria in scoring", () => {
  it("adds the plugged-in runbook's extra criteria (prefixed rb:) to the item's rubric", () => {
    const p = phase({ status: "completed", endedAt: "2026-01-01T10:12:00.000Z", config: { ...partaConfig, flow: customFlow } });
    const d = describePhase(p, { criteria: [{ id: "bottleneck", credit: "met", evidence: "" }, { id: "complexity", credit: "met", evidence: "" }, { id: "rb:every_fn", credit: "partial", evidence: "x" }], notes: "" });
    expect(d.criteria.map((c) => c.id)).toEqual(["bottleneck", "complexity", "rb:every_fn"]);
    expect(d.criteria[2]).toMatchObject({ credit: "partial", mapsTo: "technicalDepth" });
  });
});

describe("salvagePhaseScorecard (a reply that is not valid JSON)", () => {
  const rubric = [
    { id: "understanding", text: "u", weight: 1, mapsTo: "problemSolving" as const },
    { id: "complexity", text: "c", weight: 1, mapsTo: "technicalDepth" as const },
    { id: "rb:why", text: "w", weight: 1, mapsTo: "technicalDepth" as const },
  ];
  // The candidate's own words contain double quotes, which break the JSON.
  const broken = `{
  "criteria": [
    {"id": "understanding", "credit": "met", "evidence": "He said "a nested loop" and then explained the lock rules."},
    {"id": "complexity", "credit": "partial", "evidence": "Said "O(h)" without defining h"},
    {"id": "rb:why", "credit": "missed", "evidence": ""}
  ],
  "notes": "Understood the rules, vague on "why" for complexity."
}`;

  it("the broken reply really does defeat the strict parser (so the rescue is needed)", () => {
    expect(() => JSON.parse(broken)).toThrow();
  });
  it("reads every criterion's credit, including ids that contain a colon", () => {
    const r = salvagePhaseScorecard(broken, rubric, false)!;
    expect(r.criteria!.map((c) => [c.id, c.credit])).toEqual([["understanding", "met"], ["complexity", "partial"], ["rb:why", "missed"]]);
  });
  it("keeps the evidence text, quotes and all, and the notes", () => {
    const r = salvagePhaseScorecard(broken, rubric, false)!;
    expect(r.criteria![0].evidence).toContain('a nested loop');
    expect(r.criteria![1].evidence).toContain("O(h)");
    expect(r.notes).toContain("Understood the rules");
  });
  it("treats a criterion the model forgot as missed, as the normal path does", () => {
    const partial = broken.replace(/\{"id": "rb:why"[^}]*\}/, "");
    const r = salvagePhaseScorecard(partial, rubric, false)!;
    expect(r.criteria!.find((c) => c.id === "rb:why")).toMatchObject({ credit: "missed" });
  });
  it("works on a reply that was cut off at the end", () => {
    const cut = broken.slice(0, broken.indexOf('"notes"')).trimEnd();
    const r = salvagePhaseScorecard(cut, rubric, false)!;
    expect(r.criteria!.map((c) => c.credit)).toEqual(["met", "partial", "missed"]);
  });
  it("returns null when less than half of the criteria can be read", () => {
    expect(salvagePhaseScorecard('{"criteria": [{"id": "understanding", "credit": "met", "evidence": "x"}', rubric, false)).toBeNull();
    expect(salvagePhaseScorecard("I could not score this.", rubric, false)).toBeNull();
  });
  it("reads finalAnswerCorrect for puzzles only", () => {
    const text = broken.replace('"notes"', '"finalAnswerCorrect": true, "notes"');
    expect(salvagePhaseScorecard(text, rubric, true)!.finalAnswerCorrect).toBe(true);
    expect(salvagePhaseScorecard(text, rubric, false)).not.toHaveProperty("finalAnswerCorrect");
  });
  it("is not needed for a valid reply: the normal parser handles it", () => {
    const ok = '{"criteria":[{"id":"understanding","credit":"met","evidence":"x"}],"notes":"n"}';
    expect(normalizePhaseScorecard(parseScorecardJSON(ok), rubric, false).criteria![0].credit).toBe("met");
  });
});

describe("puzzle stage results", () => {
  const rubric = [{ id: "p1", text: "t", weight: 1, mapsTo: "problemSolving" as const }];
  const raw = {
    criteria: [{ id: "p1", credit: "met", evidence: "" }],
    stages: [
      { label: "Stage 1: one bottle, one round", correctAnswer: "10 testers, binary", answer: "10 testers, binary numbering", explanation: "2^10 covers 1000", verdict: "correct", help: "no hints" },
      { label: "Stage 2: two rounds", answer: "still 10", verdict: "weird", help: "after hint 2" },
      { label: "Stage 3: two poisoned bottles", answer: "made up", verdict: "not_reached", help: "" },
      { label: "", answer: "dropped", verdict: "correct", help: "" },
    ],
    furthestStage: "Stage 2: two rounds",
  };
  it("keeps the answer and verdict of each stage and the furthest stage", () => {
    const r = normalizePhaseScorecard(raw, rubric, true);
    expect(r.furthestStage).toBe("Stage 2: two rounds");
    expect(r.stages).toHaveLength(3); // the unlabeled one is dropped
    expect(r.stages![0]).toMatchObject({ verdict: "correct", correctAnswer: "10 testers, binary", answer: "10 testers, binary numbering", explanation: "2^10 covers 1000", help: "no hints" });
    expect(r.stages![1].verdict).toBe("incorrect"); // unknown verdicts never count as correct
    expect(r.stages![2]).toMatchObject({ verdict: "not_reached", answer: "", explanation: "" }); // nothing is shown as an answer for a stage not reached
  });
  it("ignores stages outside a puzzle and tolerates their absence", () => {
    expect(normalizePhaseScorecard(raw, rubric, false).stages).toBeUndefined();
    expect(normalizePhaseScorecard({ criteria: [] }, rubric, true).stages).toBeUndefined();
  });
});
