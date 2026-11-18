import { describe, expect, it } from "vitest";
import { emptyPuzzleForm, formToPuzzleRunbook, puzzleFormErrors, puzzleToForm, type PuzzleForm } from "../puzzle-form";
import { validatePuzzleRunbook } from "../runbook";

const rest = { noReveal: ["binary"], expectedMin: 25, hintLadder: [{ order: 1, text: "H1", notBeforeMin: 5, scoreDiscount: 0.05 }], rubric: [{ id: "c", text: "t", weight: 1, mapsTo: "problemSolving" }] };

const staged: PuzzleForm = {
  setupMd: "SETUP: 1,000 bottles, one poisoned.",
  stages: [
    { questionMd: "Q1: 24 h party, 24 h poison?", answer: "10 testers", cues: [], extra: {} },
    { questionMd: "Q2: party in 48 h?", answer: "7 testers", cues: ["48 hours", " "], extra: { moveOnWhen: "gives 7 with a reason" } },
    { questionMd: "Q3: poison in 20 h?", answer: "4 testers", cues: ["20 hours"], extra: {} },
  ],
  gradingNotes: "Hire if Stages 1-2 are solved",
  otherAnswers: [],
};

describe("puzzle form: saving", () => {
  it("builds the statement, the STAGE answer lines, grading, and numbered stages, keeping every other field", () => {
    const rb = formToPuzzleRunbook(staged, { statementMd: "old", acceptedAnswers: ["old"], ...rest });
    expect(rb.statementMd).toBe("SETUP: 1,000 bottles, one poisoned.\n\nQ1: 24 h party, 24 h poison?");
    expect(rb.acceptedAnswers).toEqual(["STAGE 1: 10 testers", "STAGE 2: 7 testers", "STAGE 3: 4 testers", "GRADING: Hire if Stages 1-2 are solved"]);
    expect(rb.stages).toEqual([
      { label: "1", questionMd: "Q1: 24 h party, 24 h poison?", answer: "10 testers" },
      { label: "2", questionMd: "Q2: party in 48 h?", answer: "7 testers", cues: ["48 hours"], moveOnWhen: "gives 7 with a reason" },
      { label: "3", questionMd: "Q3: poison in 20 h?", answer: "4 testers", cues: ["20 hours"] },
    ]);
    expect(rb.setupMd).toBe("SETUP: 1,000 bottles, one poisoned.");
    expect(rb.gradingNotes).toBe("Hire if Stages 1-2 are solved");
    expect(rb.noReveal).toEqual(["binary"]);
    expect(rb.hintLadder).toEqual(rest.hintLadder);
    expect(validatePuzzleRunbook(rb).ok).toBe(true);
  });
  it("a one-stage puzzle writes its answer as is (no STAGE prefix) and the question as the statement", () => {
    const rb = formToPuzzleRunbook({ ...emptyPuzzleForm(), stages: [{ questionMd: "Two ropes?", answer: "Light both ends", cues: [], extra: {} }] }, rest);
    expect(rb.statementMd).toBe("Two ropes?");
    expect(rb.acceptedAnswers).toEqual(["Light both ends"]);
    expect(rb.setupMd).toBe("");
  });
});

describe("puzzle form: opening", () => {
  it("round-trips a puzzle saved by the form, with no notice", () => {
    const rb = validatePuzzleRunbook(formToPuzzleRunbook(staged, rest));
    if (!rb.ok) throw new Error(rb.errors.join());
    const back = puzzleToForm(rb.value);
    expect(back.notice).toBeUndefined();
    expect(back.setupMd).toBe(staged.setupMd);
    expect(back.gradingNotes).toBe(staged.gradingNotes);
    expect(back.otherAnswers).toEqual([]);
    expect(back.stages.map((s) => [s.questionMd, s.answer, s.cues, s.extra])).toEqual([
      ["Q1: 24 h party, 24 h poison?", "10 testers", [], {}],
      ["Q2: party in 48 h?", "7 testers", ["48 hours"], { moveOnWhen: "gives 7 with a reason" }],
      ["Q3: poison in 20 h?", "4 testers", ["20 hours"], {}],
    ]);
  });
  it("round-trips a one-stage puzzle with an empty Setup without copying the question into Setup", () => {
    const form = { ...emptyPuzzleForm(), stages: [{ questionMd: "Two ropes?", answer: "Light both ends", cues: [], extra: {} }] };
    const saved = validatePuzzleRunbook(formToPuzzleRunbook(form, rest));
    if (!saved.ok) throw new Error(saved.errors.join());
    const back = puzzleToForm(saved.value);
    expect(back.setupMd).toBe("");
    expect(back.stages[0].questionMd).toBe("Two ropes?");
    expect(back.notice).toBeUndefined();
  });
  it("opens an older one-question puzzle as Stage 1, grading split out, and saves it back to the same statement", () => {
    const old = { statementMd: "You have two ropes…", acceptedAnswers: ["Light one at both ends", "GRADING: needs the reason"], ...rest };
    const form = puzzleToForm(old);
    expect(form.setupMd).toBe("");
    expect(form.stages).toHaveLength(1);
    expect(form.stages[0].questionMd).toBe("You have two ropes…");
    expect(form.stages[0].answer).toBe("Light one at both ends");
    expect(form.gradingNotes).toBe("needs the reason");
    const rb = formToPuzzleRunbook(form, old);
    expect(rb.statementMd).toBe("You have two ropes…");
    expect(rb.acceptedAnswers).toEqual(["Light one at both ends", "GRADING: needs the reason"]);
  });
  it("opens a JSON-staged puzzle: each stage's answer from its STAGE line, the Statement in Setup with a notice, other lines kept", () => {
    const old = {
      statementMd: "Story… Stage 1: question one",
      acceptedAnswers: [
        "STAGE 1 (one round): 10 testers, binary",
        "STAGE 1B (small case): 3 testers for 8 bottles",
        "STAGE 2 (two rounds): 7 testers",
        "GRADING: furthest stage reached",
        "FOLLOW-UP KNOWLEDGE: three poisoned bottles need a fourth direction",
      ],
      stages: [{ label: "1", questionMd: "q1" }, { label: "1B", questionMd: "q1b" }, { label: "2", questionMd: "q2", moveOnWhen: "rule" }],
      ...rest,
    };
    const form = puzzleToForm(old);
    expect(form.notice).toMatch(/Setup/);
    expect(form.setupMd).toBe("Story… Stage 1: question one");
    expect(form.stages.map((s) => s.answer)).toEqual(["10 testers, binary", "3 testers for 8 bottles", "7 testers"]);
    expect(form.stages[2].extra).toEqual({ moveOnWhen: "rule" });
    expect(form.gradingNotes).toBe("furthest stage reached");
    expect(form.otherAnswers).toEqual(["FOLLOW-UP KNOWLEDGE: three poisoned bottles need a fourth direction"]);
    // Saved again: stages renumbered 1, 2, 3; the extra line kept; grading last.
    const rb = formToPuzzleRunbook(form, old);
    expect(rb.stages.map((s: any) => s.label)).toEqual(["1", "2", "3"]);
    expect(rb.acceptedAnswers).toEqual([
      "STAGE 1: 10 testers, binary",
      "STAGE 2: 3 testers for 8 bottles",
      "STAGE 3: 7 testers",
      "FOLLOW-UP KNOWLEDGE: three poisoned bottles need a fourth direction",
      "GRADING: furthest stage reached",
    ]);
  });
});

describe("puzzle form: checks", () => {
  it("needs every stage's question and accepted answer", () => {
    expect(puzzleFormErrors(emptyPuzzleForm())).toEqual(["Stage 1: the question is required", "Stage 1: the accepted answer is required"]);
    expect(puzzleFormErrors(staged)).toEqual([]);
    const missing = { ...staged, stages: [...staged.stages, { questionMd: "Q4", answer: " ", cues: [], extra: {} }] };
    expect(puzzleFormErrors(missing)).toEqual(["Stage 4: the accepted answer is required"]);
  });
  it("allows at most 10 stages", () => {
    const many = { ...staged, stages: Array.from({ length: 11 }, () => ({ questionMd: "q", answer: "a", cues: [], extra: {} })) };
    expect(puzzleFormErrors(many)).toContain("At most 10 stages");
  });
});

describe("puzzle runbook check keeps the new fields", () => {
  const base = { statementMd: "s", acceptedAnswers: ["a"], expectedMin: 5, hintLadder: [], rubric: rest.rubric };
  it("keeps Setup (even empty), Grading notes and each stage's answer", () => {
    const v = validatePuzzleRunbook({ ...base, setupMd: "", gradingNotes: "g", stages: [{ label: "1", questionMd: "q", answer: "ans" }, { label: "2", questionMd: "q2" }] });
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.value.setupMd).toBe("");
      expect(v.value.gradingNotes).toBe("g");
      expect(v.value.stages?.[0].answer).toBe("ans");
      expect(v.value.stages?.[1]).toEqual({ label: "2", questionMd: "q2" });
    }
  });
  it("leaves an older puzzle without these fields unchanged", () => {
    const v = validatePuzzleRunbook(base);
    expect(v.ok && ("setupMd" in v.value || "gradingNotes" in v.value)).toBe(false);
  });
});

describe("puzzle form: edge cases", () => {
  it("re-saving a one-stage puzzle keeps exactly one answer (no copy added per save)", () => {
    let form: PuzzleForm = { ...emptyPuzzleForm(), stages: [{ questionMd: "Two ropes?", answer: "Light both ends", cues: [], extra: {} }] };
    let rb: any = rest;
    for (let i = 0; i < 3; i++) {
      const v = validatePuzzleRunbook(formToPuzzleRunbook(form, rb));
      if (!v.ok) throw new Error(v.errors.join());
      rb = v.value;
      form = puzzleToForm(rb);
    }
    expect(rb.acceptedAnswers).toEqual(["Light both ends"]);
    expect(form.otherAnswers).toEqual([]);
  });
  it("keeps the bracketed text of a GRADING line, which is content", () => {
    const f = puzzleToForm({ statementMd: "s", acceptedAnswers: ["a", "GRADING (grade on the furthest stage). BELOW BAR: below 10"] });
    expect(f.gradingNotes).toBe("(grade on the furthest stage). BELOW BAR: below 10");
  });
  it("refuses a Setup or question that contains a 'Never say' phrase (the AI could never read it out)", () => {
    const form = { ...staged, setupMd: "Use binary if you like", stages: [staged.stages[0], { ...staged.stages[1], questionMd: "Now try 10 testers again" }] };
    const errs = puzzleFormErrors(form, ["binary", "10 testers"]);
    expect(errs.some((e) => e.startsWith('Setup contains "binary"'))).toBe(true);
    expect(errs.some((e) => e.startsWith('Stage 2: the question contains "10 testers"'))).toBe(true);
    expect(puzzleFormErrors(staged, ["binary"])).toEqual([]);
  });
});
