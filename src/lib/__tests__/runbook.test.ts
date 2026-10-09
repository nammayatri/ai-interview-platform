import { describe, expect, it } from "vitest";
import { validateInterviewRunbook, validateProblemRunbook, validatePuzzleRunbook, validateStages, validateSubmissions, BUILTIN_RUNBOOKS, LIMITS } from "../runbook";
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

const ID = "11111111-1111-1111-1111-111111111111";
const stage = (over: any = {}) => ({ key: "parta", budgetMin: 15, graceMin: 2, earlyDoneAfterMin: 8, itemId: ID, ...over });

describe("validateStages", () => {
  const three = [stage(), stage({ key: "dsa", mode: "random", itemId: null }), stage({ key: "puzzle", mode: "specific", earlyDoneAfterMin: null, budgetMin: 8, graceMin: 0 })];
  it("accepts a full plan and keeps the order", () => {
    const r = validateStages(three, 60);
    expect(r.ok && r.value.map((s) => s.key)).toEqual(["parta", "dsa", "puzzle"]);
  });
  it("accepts any subset and any order", () => {
    const r = validateStages([stage({ key: "puzzle", mode: "random", itemId: null }), stage({ key: "dsa", mode: "random", itemId: null })], 40);
    expect(r.ok && r.value.map((s) => s.key)).toEqual(["puzzle", "dsa"]);
  });
  it("requires at least one stage", () => expect(validateStages([], 30).ok).toBe(false));
  it("rejects a duplicate stage", () => expect(errs(validateStages([stage(), stage()], 60))).toMatch(/twice/));
  it("requires an item when not random, and always for Part A", () => {
    expect(errs(validateStages([stage({ key: "dsa", mode: "specific", itemId: null })], 60))).toMatch(/pick/);
    expect(errs(validateStages([stage({ itemId: null })], 60))).toMatch(/Part A question/);
  });
  it("forces Part A to be specific even if random is sent", () => {
    const r = validateStages([stage({ mode: "random" })], 60);
    expect(r.ok && r.value[0].mode).toBe("specific");
  });
  it("requires the stage times plus the 2 minute reserve to fit the duration", () => {
    expect(validateStages([stage({ budgetMin: 28 })], 30).ok).toBe(true);
    expect(validateStages([stage({ budgetMin: 29 })], 30).ok).toBe(false);
    expect(errs(validateStages(three, 30))).toMatch(/add up to 38/);
  });
  it("rejects early-done beyond the stage time and bad numbers", () => {
    expect(errs(validateStages([stage({ earlyDoneAfterMin: 20 })], 60))).toMatch(/early/);
    expect(errs(validateStages([stage({ budgetMin: 0 })], 60))).toMatch(/at least 1/);
  });
  it("carries the chosen runbook and rejects a malformed id", () => {
    const r = validateStages([stage({ runbookId: ID })], 60);
    expect(r.ok && r.value[0].runbookId).toBe(ID);
    expect(validateStages([stage({ runbookId: "nope" })], 60).ok).toBe(false);
    const d = validateStages([stage()], 60);
    expect(d.ok && d.value[0].runbookId).toBeNull();
  });
});

describe("validateInterviewRunbook", () => {
  const good = { name: "Strict drill", instructions: "1. Ask each function's complexity.", probes: ["q1", " "], rubric: [{ id: "a", text: "t", weight: 1, mapsTo: "technicalDepth" }] };
  it("accepts a runbook and trims empty probes", () => {
    const r = validateInterviewRunbook(good);
    expect(r.ok && r.value.probes).toEqual(["q1"]);
  });
  it("requires a name and instructions", () => {
    expect(errs(validateInterviewRunbook({ ...good, name: " " }))).toMatch(/name/);
    expect(errs(validateInterviewRunbook({ ...good, instructions: "" }))).toMatch(/instructions/);
  });
  it("validates extra rubric criteria", () => {
    expect(errs(validateInterviewRunbook({ ...good, rubric: [{ id: "a", text: "t", weight: 0, mapsTo: "technicalDepth" }] }))).toMatch(/weight/);
  });
  it("allows no extra probes or rubric", () => expect(validateInterviewRunbook({ name: "n", instructions: "i" }).ok).toBe(true));
  it("ships a valid built-in runbook for every stage", () => {
    (["parta", "dsa", "puzzle"] as const).forEach((k) => expect(validateInterviewRunbook(BUILTIN_RUNBOOKS[k]).ok).toBe(true));
  });
  it("the built-in Part A flow asks function-by-function complexity and pseudocode when not optimized", () => {
    expect(BUILTIN_RUNBOOKS.parta.instructions).toMatch(/FUNCTION BY FUNCTION/);
    expect(BUILTIN_RUNBOOKS.parta.instructions).toMatch(/pseudocode/);
  });
});
