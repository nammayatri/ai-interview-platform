import type { PhaseRow } from "../phase-engine";
import type { DsaPhaseConfig, Hint, PartAPhaseConfig, ProblemRunbook, PuzzleRunbook, PuzzlePhaseConfig, StageFlow } from "../runbook";
import type { Submission } from "../phase-store";

export const hints: Hint[] = [
  { order: 1, text: "HINT-ONE-TEXT think about what you re-compute", notBeforeMin: 5, scoreDiscount: 0.1 },
  { order: 2, text: "HINT-TWO-TEXT SECRET-LOCKED", afterWeakAnswers: 2, scoreDiscount: 0.2 },
  { order: 3, text: "HINT-THREE-TEXT SECRET-LOCKED", notBeforeMin: 10, afterWeakAnswers: 3, scoreDiscount: 0.3 },
];

export const problemRunbook: ProblemRunbook = {
  statementMd: "Given an array, return indices of two numbers adding to target.",
  solutionTracks: [
    { key: "brute", name: "Brute force", approach: "Check all pairs", timeComplexity: "O(n^2)", spaceComplexity: "O(1)", probes: ["Why is this quadratic?"] },
    { key: "hash", name: "Hash map", approach: "SECRET-TRACK-HASHMAP single pass", timeComplexity: "O(n)", spaceComplexity: "O(n)", probes: ["What if there are duplicates?"] },
  ],
  outcomeProbes: { passed: ["PASSED-PROBE walk me through line 3"], partial: ["PARTIAL-PROBE which input fails"], failed: ["FAILED-PROBE why did it time out"] },
  hintLadder: hints,
  rubric: [
    { id: "bottleneck", text: "SECRET-RUBRIC found the bottleneck", weight: 2, mapsTo: "problemSolving" },
    { id: "complexity", text: "Stated complexity correctly", weight: 1, mapsTo: "technicalDepth" },
  ],
  defaults: { budgetMin: 15, graceMin: 2, earlyDoneAfterMin: 8 },
};

export const puzzleRunbook: PuzzleRunbook = {
  statementMd: "PUZZLE-STATEMENT You have two ropes that each burn in 60 minutes.",
  acceptedAnswers: ["SECRET-ANSWER light both ends"],
  expectedMin: 5,
  hintLadder: [{ order: 1, text: "PUZZLE-HINT-ONE burn from both ends", notBeforeMin: 2, scoreDiscount: 0.1 }],
  rubric: [{ id: "p1", text: "PUZZLE-RUBRIC reasoned about burn rate", weight: 1, mapsTo: "problemSolving" }],
};

export const partaConfig: PartAPhaseConfig = {
  problemId: "p-1", problemVersion: 1, problemTitle: "Two Sum", runbook: problemRunbook, primarySubmissionId: "s-1", contextSubmissionIds: [],
};

export const dsaProblemRunbook: ProblemRunbook = {
  ...problemRunbook,
  statementMd: "DSA-STATEMENT Find the longest run of equal values.",
  solutionTracks: [{ key: "scan", name: "Single scan", approach: "SECRET-DSA-TRACK keep a running count", timeComplexity: "O(n)", spaceComplexity: "O(1)", probes: ["What if the array is empty?"] }],
  hintLadder: [{ order: 1, text: "DSA-HINT-ONE think about one pass", notBeforeMin: 3, scoreDiscount: 0.1 }],
  rubric: [{ id: "d1", text: "DSA-RUBRIC reached a linear approach", weight: 1, mapsTo: "problemSolving" }],
};

export const dsaConfig: DsaPhaseConfig = {
  pool: [{ problemId: "d-1", version: 1, title: "Longest run", runbook: dsaProblemRunbook }],
  selection: "specific",
  selected: { problemId: "d-1", title: "Longest run", runbook: dsaProblemRunbook },
};

export const customFlow: StageFlow = {
  runbookId: "r-1", runbookVersion: 2, name: "Strict drill", description: "", probes: ["CUSTOM-PROBE ask about stack depth"],
  instructions: "1. CUSTOM-STEP ask the complexity of every function twice.",
  rubric: [{ id: "every_fn", text: "Stated complexity of every function", weight: 1, mapsTo: "technicalDepth" }],
};

export const puzzleConfig: PuzzlePhaseConfig = {
  pool: [{ puzzleId: "z-1", version: 1, title: "Ropes", runbook: puzzleRunbook }],
  selection: "random",
  selected: { puzzleId: "z-1", title: "Ropes", runbook: puzzleRunbook },
};

export function phase(over: Partial<PhaseRow> = {}): PhaseRow {
  return {
    id: "ph-1", interviewId: "i-1", phaseKey: "parta", sequence: 1, status: "active", budgetMin: 12, graceMin: 2, earlyDoneAfterMin: 6,
    minRemainingMin: null, startedAt: "2026-01-01T10:00:00.000Z", endedAt: null, endReason: null, config: partaConfig, selectedPuzzleId: null,
    hintsUsed: [], weakAnswers: 0, scoreWeight: 0.4, scorecard: null, scratchpad: "", ...over,
  };
}

export const submissions: Submission[] = [
  { id: "s-1", problemId: "p-1", problemTitle: "Two Sum", language: "python", code: "def f(a, t):\n    for i in a:\n        pass", outcome: "partial", score: 60, testsPassed: 6, testsTotal: 10, externalUrl: "", notes: "", isPrimary: true },
  { id: "s-2", problemId: null, problemTitle: "Other Problem", language: "python", code: "CONTEXT-CODE-SHOULD-NOT-APPEAR", outcome: "passed", score: 100, testsPassed: 5, testsTotal: 5, externalUrl: "", notes: "", isPrimary: false },
];
