import { describe, expect, it } from "vitest";
import { validatePlan, validateProblemRunbook, validatePuzzleRunbook, validateSubmissions, LIMITS } from "../runbook";
import { problemRunbook, puzzleRunbook } from "./fixtures";

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const errs = (r: any) => (r.ok ? [] : r.errors.join(" | "));

describe("validateProblemRunbook", () => {
  it("accepts a complete runbook", () => expect(validateProblemRunbook(problemRunbook).ok).toBe(true));
  it("rejects an empty statement", () => expect(errs(validateProblemRunbook({ ...clone(problemRunbook), statementMd: "  " }))).toMatch(/statement/));
  it("rejects zero solution tracks", () => expect(errs(validateProblemRunbook({ ...clone(problemRunbook), solutionTracks: [] }))).toMatch(/solution track/));
  it("rejects zero rubric criteria", () => expect(errs(validateProblemRunbook({ ...clone(problemRunbook), rubric: [] }))).toMatch(/rubric/));
  it("rejects non-positive weights", () => {
    const rb = clone(problemRunbook);
    rb.rubric[0].weight = 0;
    expect(errs(validateProblemRunbook(rb))).toMatch(/weight/);
  });
  it("rejects an invalid dimension", () => {
    const rb: any = clone(problemRunbook);
    rb.rubric[0].mapsTo = "charisma";
    expect(errs(validateProblemRunbook(rb))).toMatch(/mapsTo/);
  });
  it("rejects non-ascending hint order", () => {
    const rb = clone(problemRunbook);
    rb.hintLadder[1].order = 5;
    expect(errs(validateProblemRunbook(rb))).toMatch(/ascending/);
  });
  it("rejects discounts outside 0..1", () => {
    const rb = clone(problemRunbook);
    rb.hintLadder[0].scoreDiscount = 1.5;
    expect(errs(validateProblemRunbook(rb))).toMatch(/scoreDiscount/);
  });
  it("rejects a statement over the size cap", () => {
    expect(errs(validateProblemRunbook({ ...clone(problemRunbook), statementMd: "x".repeat(LIMITS.statementChars + 1) }))).toMatch(/max/);
  });
  it("rejects early-done after the budget", () => {
    const rb = clone(problemRunbook);
    rb.defaults.earlyDoneAfterMin = 99;
    expect(errs(validateProblemRunbook(rb))).toMatch(/earlyDoneAfterMin/);
  });
  it("treats blank optional hint gates as absent", () => {
    const rb: any = clone(problemRunbook);
    rb.hintLadder = [{ order: 1, text: "t", notBeforeMin: "", afterWeakAnswers: "", scoreDiscount: 0.1 }];
    const r = validateProblemRunbook(rb);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.hintLadder[0]).not.toHaveProperty("notBeforeMin");
  });
  it("generates stable ids for criteria without one", () => {
    const rb: any = clone(problemRunbook);
    delete rb.rubric[0].id;
    const r = validateProblemRunbook(rb);
    expect(r.ok && r.value.rubric[0].id).toBe("c1");
  });
});

describe("validatePuzzleRunbook", () => {
  it("accepts a complete runbook", () => expect(validatePuzzleRunbook(puzzleRunbook).ok).toBe(true));
  it("requires expectedMin > 0", () => expect(errs(validatePuzzleRunbook({ ...clone(puzzleRunbook), expectedMin: 0 }))).toMatch(/expectedMin/));
});

describe("validateSubmissions", () => {
  const sub = { problemTitle: "Two Sum", code: "print(1)", outcome: "passed", isPrimary: true };
  it("requires exactly one primary", () => {
    expect(errs(validateSubmissions([{ ...sub, isPrimary: false }]))).toMatch(/primary/);
    expect(errs(validateSubmissions([sub, sub]))).toMatch(/primary/);
  });
  it("requires code and a valid outcome", () => {
    expect(errs(validateSubmissions([{ ...sub, code: " " }]))).toMatch(/code/);
    expect(errs(validateSubmissions([{ ...sub, outcome: "great" }]))).toMatch(/outcome/);
  });
  it("caps code size", () => expect(errs(validateSubmissions([{ ...sub, code: "x".repeat(LIMITS.codeChars + 1) }]))).toMatch(/exceeds/));
  it("rejects tests passed above total", () => expect(errs(validateSubmissions([{ ...sub, testsPassed: 9, testsTotal: 5 }]))).toMatch(/testsPassed/));
});

describe("validatePlan", () => {
  const plan = { dsaBudgetMin: 15, graceMin: 2, earlyDoneAfterMin: 8, puzzleMinRemainingMin: 5, puzzleSelection: "random" };
  it("accepts a plan that fits the duration with the closing reserve", () => expect(validatePlan(plan, 30).ok).toBe(true));
  it("rejects budget + grace + reserve beyond the duration", () => {
    expect(validatePlan({ ...plan, dsaBudgetMin: 27 }, 30).ok).toBe(false); // 27 + 2 + 2 = 31
    expect(validatePlan({ ...plan, dsaBudgetMin: 26 }, 30).ok).toBe(true); // 26 + 2 + 2 = 30
  });
  it("rejects early-done after the budget", () => expect(validatePlan({ ...plan, earlyDoneAfterMin: 20 }, 60).ok).toBe(false));
  it("defaults phase weights to 0.7 / 0.3", () => {
    const r = validatePlan(plan, 30);
    expect(r.ok && r.value.phaseWeights).toEqual({ dsa: 0.7, puzzle: 0.3 });
  });
});
