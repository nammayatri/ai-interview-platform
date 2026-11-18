import { describe, expect, it } from "vitest";
import { validatePuzzleRunbook, type PuzzleStage } from "../runbook";
import { currentStageIndex, decideStageAdvance, puzzleStages, stageIndexOf, stageProgress } from "../puzzle-stages";
import { buildDsaReviewMessages, puzzleStageSection, type DsaPromptInput } from "../prompt/dsa-review";
import { resolvePhase } from "../phase-engine";
import { DEFAULT_AI_SETTINGS } from "../ai-settings";
import { phase, puzzleConfig, submissions } from "./fixtures";

const stages: PuzzleStage[] = [
  { label: "1", questionMd: "Q-ONE party in 24 hours" },
  { label: "2", questionMd: "Q-TWO party in 48 hours", moveOnWhen: "MOVE-RULE-TWO", cues: ["48 hours"] },
  { label: "3", questionMd: "Q-THREE poison in 20 hours", cues: ["20 hours"] },
];

const baseRunbook = { statementMd: "Intro", acceptedAnswers: ["a"], expectedMin: 10, hintLadder: [], rubric: [{ id: "c", text: "t", weight: 1, mapsTo: "problemSolving" }] };

describe("puzzle stages: validation", () => {
  it("keeps the stages when a puzzle is saved", () => {
    const v = validatePuzzleRunbook({ ...baseRunbook, stages });
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.value.stages?.map((s) => s.label)).toEqual(["1", "2", "3"]);
  });
  it("leaves a puzzle without stages exactly as before", () => {
    const v = validatePuzzleRunbook(baseRunbook);
    expect(v.ok && "stages" in v.value).toBe(false);
  });
  it("rejects a stage without a label or question, and duplicate labels", () => {
    const v = validatePuzzleRunbook({ ...baseRunbook, stages: [{ label: "1", questionMd: "" }, { label: "", questionMd: "q" }, { label: "1", questionMd: "q" }] });
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.errors.join(" ")).toMatch(/stages\[0\]: questionMd is required/);
      expect(v.errors.join(" ")).toMatch(/stages\[1\]: label is required/);
      expect(v.errors.join(" ")).toMatch(/duplicate label "1"/);
    }
  });
});

describe("puzzle stages: which puzzles have them", () => {
  it("treats no stages, or a single stage, as a single-question puzzle", () => {
    expect(puzzleStages({})).toEqual([]);
    expect(puzzleStages({ stages: [stages[0]] })).toEqual([]);
    expect(puzzleStages({ stages })).toHaveLength(3);
  });
  it("finds stages by label, ignoring case and spaces, and starts on the first", () => {
    expect(stageIndexOf([{ label: "BONUS", questionMd: "x" }], " bonus ")).toBe(0);
    expect(currentStageIndex(stages, null)).toBe(0);
    expect(currentStageIndex(stages, "2")).toBe(1);
    expect(currentStageIndex(stages, "unknown")).toBe(0);
  });
});

describe("puzzle stages: moving on", () => {
  it("accepts the marker for the next stage", () => {
    expect(decideStageAdvance(stages, 0, "2", "")).toEqual({ advanceTo: 1, via: "marker" });
  });
  it("ignores skipping ahead and going back, and treats the current stage as no change", () => {
    expect(decideStageAdvance(stages, 0, "3", "")).toEqual({ advanceTo: null, ignoredLabel: "3" });
    expect(decideStageAdvance(stages, 1, "1", "")).toEqual({ advanceTo: null, ignoredLabel: "1" });
    expect(decideStageAdvance(stages, 0, "1", "")).toEqual({ advanceTo: null });
  });
  it("moves on from a cue phrase of the next stage when the marker is missing", () => {
    expect(decideStageAdvance(stages, 0, undefined, "Now the party starts in 48 Hours. Can you do better?")).toEqual({ advanceTo: 1, via: "cue" });
    // A later stage's cue does not count: only the next stage can be reached.
    expect(decideStageAdvance(stages, 0, undefined, "the poison kills in 20 hours")).toEqual({ advanceTo: null });
    expect(decideStageAdvance(stages, 0, undefined, "Walk me through why.")).toEqual({ advanceTo: null });
  });
  it("never moves past the last stage", () => {
    expect(decideStageAdvance(stages, 2, undefined, "48 hours 20 hours")).toEqual({ advanceTo: null });
    expect(decideStageAdvance(stages, 2, "3", "")).toEqual({ advanceTo: null });
  });
  it("on the last stage, [STAGE:done] reports it solved (any case); before the last stage it is ignored", () => {
    expect(decideStageAdvance(stages, 2, "done", "")).toEqual({ advanceTo: null, solvedLast: true });
    expect(decideStageAdvance(stages, 2, " DONE ", "")).toEqual({ advanceTo: null, solvedLast: true });
    expect(decideStageAdvance(stages, 0, "done", "")).toEqual({ advanceTo: null, ignoredLabel: "done" });
    expect(decideStageAdvance(stages, 1, "done", "the poison kills in 20 hours")).toEqual({ advanceTo: null, ignoredLabel: "done" });
  });
  it("a stage cannot be called 'done' (reserved for the solved marker)", () => {
    const v = validatePuzzleRunbook({ ...baseRunbook, stages: [{ label: "1", questionMd: "q" }, { label: "Done", questionMd: "q2" }] });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.errors.join(" ")).toMatch(/"done" is reserved/);
  });
});

describe("puzzle stages: the candidate's boxes", () => {
  it("while running, the stages before the current one are completed", () => {
    expect(stageProgress(stages, 1, { status: "active" }, false)).toEqual({ labels: ["1", "2", "3"], current: 1, completed: 1 });
  });
  it("the last stage turns green only when the interviewer reported it solved", () => {
    expect(stageProgress(stages, 2, { status: "completed", endReason: "ai_done" }, true)?.completed).toBe(3);
    // The bug from the long test runs: the AI ended the puzzle early to stop a stuck candidate. Not solved, so box 3 stays white.
    expect(stageProgress(stages, 2, { status: "completed", endReason: "ai_done" }, false)?.completed).toBe(2);
    expect(stageProgress(stages, 2, { status: "completed", endReason: "hard_cap" }, false)?.completed).toBe(2); // time ran out
    // Solved just as the time ran out: still green.
    expect(stageProgress(stages, 2, { status: "completed", endReason: "hard_cap" }, true)?.completed).toBe(3);
    expect(stageProgress(stages, 1, { status: "completed", endReason: "ai_done" }, true)?.completed).toBe(1); // ended before the last stage
    expect(stageProgress(stages, 2, { status: "completed", endReason: "ai_done" }, true)?.current).toBeNull();
  });
  it("solved while the puzzle is still running (an early end not yet allowed): all green, last box still current", () => {
    expect(stageProgress(stages, 2, { status: "active" }, true)).toEqual({ labels: ["1", "2", "3"], current: 2, completed: 3 });
    expect(stageProgress(stages, 2, { status: "active" }, false)).toEqual({ labels: ["1", "2", "3"], current: 2, completed: 2 });
  });
  it("has no boxes for a single-question puzzle or a phase that has not started", () => {
    expect(stageProgress([stages[0]], 0, { status: "active" }, false)).toBeNull();
    expect(stageProgress(stages, 0, { status: "pending" }, false)).toBeNull();
  });
});

describe("puzzle stages: what the AI is told", () => {
  it("names the current stage and shows only the next stage's question, with its marker", () => {
    const s = puzzleStageSection({ stages, index: 0 });
    expect(s).toContain("this puzzle has 3 stages");
    expect(s).toContain("CURRENT STAGE: 1 of 3");
    expect(s).toContain("Q-ONE");
    expect(s).toContain("Q-TWO");
    expect(s).toContain("[STAGE:2]");
    expect(s).not.toContain("Q-THREE");
  });
  it("uses the stage's own move-on rule", () => {
    expect(puzzleStageSection({ stages, index: 1 })).toContain("MOVE-RULE-TWO");
  });
  it("on the last stage asks for [STAGE:done] only when solved, PHASE_DONE either way, and shows no next stage", () => {
    const s = puzzleStageSection({ stages, index: 2 });
    expect(s).toContain("LAST stage");
    expect(s).toContain("[STAGE:done] [PHASE_DONE]");
    expect(s).toMatch(/NOT SOLVED[^\n]*append only \[PHASE_DONE\]/);
    expect(s).not.toContain("NEXT STAGE");
    expect(puzzleStageSection({ stages, index: 1 })).not.toContain("[STAGE:done]");
  });

  const startedAt = "2026-01-01T10:00:00.000Z";
  const now = new Date(new Date(startedAt).getTime() + 3 * 60000);
  const puzzlePhase = phase({ phaseKey: "puzzle", status: "active", budgetMin: 20, graceMin: 0, config: puzzleConfig });
  const input = (over: Partial<DsaPromptInput> = {}): DsaPromptInput => ({
    role: "SDE", level: "Senior", duration: 30, candidateName: "Asha", levelCalibration: "", interviewerNotes: "",
    settings: DEFAULT_AI_SETTINGS, phases: [puzzlePhase], submissions, resolution: resolvePhase([puzzlePhase], { startedAt, duration: 30 }, now),
    history: [], scratchpad: "", unlockedHint: null, ...over,
  });
  it("adds the stage section to the puzzle prompt only for a multi-stage puzzle", () => {
    expect(buildDsaReviewMessages(input({ puzzleStage: { stages, index: 1 } }))[0].content).toContain("CURRENT STAGE: 2 of 3");
    expect(buildDsaReviewMessages(input())[0].content).not.toContain("CURRENT STAGE");
  });
});

describe("puzzle stages: what the candidate's browser receives", () => {
  it("gets the box labels and progress on the puzzle phase, never a later stage's question", async () => {
    const { projectInterviewForCandidate } = await import("../candidate-projection");
    const stagedConfig = { ...puzzleConfig, selected: { ...puzzleConfig.selected!, runbook: { ...puzzleConfig.selected!.runbook, stages } } };
    const interview = { roundType: "DSA Review", phases: [phase({ phaseKey: "puzzle", status: "active", config: stagedConfig })], submissions: [] };
    const out = projectInterviewForCandidate(interview, { puzzleStages: { labels: ["1", "2", "3"], current: 0, completed: 0 } });
    const json = JSON.stringify(out);
    expect((out.phases as any)[0].stages).toEqual({ labels: ["1", "2", "3"], current: 0, completed: 0 });
    expect(json).not.toContain("Q-TWO");
    expect(json).not.toContain("Q-THREE");
  });
});
