// Runbook types, validation and snapshot helpers for the DSA Review round.
// Pure module: no database access, safe to import from client components.

export const DIMENSIONS = ["technicalDepth", "problemSolving", "domainKnowledge", "communication", "cultureFit"] as const;
export type Dimension = (typeof DIMENSIONS)[number];

export const DIMENSION_LABELS: Record<Dimension, string> = {
  technicalDepth: "Technical Depth",
  problemSolving: "Problem Solving",
  domainKnowledge: "Domain Knowledge",
  communication: "Communication",
  cultureFit: "Culture Fit",
};

export interface SolutionTrack {
  key: string;
  name: string;
  approach: string;
  timeComplexity: string;
  spaceComplexity: string;
  probes: string[];
}

export interface Hint {
  order: number;
  text: string;
  notBeforeMin?: number;
  afterWeakAnswers?: number;
  scoreDiscount: number;
}

export interface RubricCriterion {
  id: string;
  text: string;
  weight: number;
  mapsTo: Dimension;
}

export interface OutcomeProbes {
  passed: string[];
  partial: string[];
  failed: string[];
}

export interface ProblemRunbook {
  statementMd: string;
  solutionTracks: SolutionTrack[];
  outcomeProbes: OutcomeProbes;
  hintLadder: Hint[];
  rubric: RubricCriterion[];
  defaults: { budgetMin: number; graceMin: number; earlyDoneAfterMin: number };
}

export interface PuzzleRunbook {
  statementMd: string;
  acceptedAnswers: string[];
  expectedMin: number;
  hintLadder: Hint[];
  rubric: RubricCriterion[];
}

export type Outcome = "passed" | "partial" | "failed";
export const OUTCOMES: Outcome[] = ["passed", "partial", "failed"];

export const LIMITS = {
  statementChars: 20_000,
  codeChars: 50_000,
  scratchpadChars: 10_000,
  notesChars: 5_000,
  shortText: 2_000,
};

/** Reserved at the end of the interview for the global "wrap up" behaviour. */
export const CLOSE_RESERVE_MIN = 2;

export type StageKey = "parta" | "dsa" | "puzzle";
export const STAGE_KEYS: StageKey[] = ["parta", "dsa", "puzzle"];
export const STAGE_LABELS: Record<StageKey, string> = { parta: "Part A evaluation", dsa: "DSA problem", puzzle: "Puzzle" };
/** Share of the rubric roll-up per stage (renormalised over the stages that were actually scored). */
export const DEFAULT_STAGE_WEIGHTS: Record<StageKey, number> = { parta: 0.4, dsa: 0.4, puzzle: 0.2 };

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v : "");
const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean) : [];
const optNum = (v: unknown): number | undefined => {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
};

function validateHints(raw: unknown, errors: string[]): Hint[] {
  const list = Array.isArray(raw) ? raw : [];
  const hints: Hint[] = [];
  list.forEach((h, i) => {
    if (!isObj(h)) { errors.push(`hintLadder[${i}] must be an object`); return; }
    const text = str(h.text).trim();
    if (!text) errors.push(`hintLadder[${i}]: text is required`);
    if (text.length > LIMITS.shortText) errors.push(`hintLadder[${i}]: text too long`);
    const order = Number(h.order);
    const discount = Number(h.scoreDiscount ?? 0);
    if (!Number.isFinite(discount) || discount < 0 || discount > 1) errors.push(`hintLadder[${i}]: scoreDiscount must be between 0 and 1`);
    const notBeforeMin = optNum(h.notBeforeMin);
    const afterWeakAnswers = optNum(h.afterWeakAnswers);
    if (notBeforeMin !== undefined && (Number.isNaN(notBeforeMin) || notBeforeMin < 0)) errors.push(`hintLadder[${i}]: notBeforeMin must be >= 0`);
    if (afterWeakAnswers !== undefined && (Number.isNaN(afterWeakAnswers) || afterWeakAnswers < 0)) errors.push(`hintLadder[${i}]: afterWeakAnswers must be >= 0`);
    hints.push({
      order,
      text,
      ...(notBeforeMin !== undefined && !Number.isNaN(notBeforeMin) ? { notBeforeMin } : {}),
      ...(afterWeakAnswers !== undefined && !Number.isNaN(afterWeakAnswers) ? { afterWeakAnswers: Math.floor(afterWeakAnswers) } : {}),
      scoreDiscount: Number.isFinite(discount) ? discount : 0,
    });
  });
  // Orders must be 1..n strictly ascending.
  hints.forEach((h, i) => {
    if (h.order !== i + 1) errors.push(`hintLadder: order must be strictly ascending starting at 1 (item ${i + 1} has order ${h.order})`);
  });
  return hints;
}

function validateRubric(raw: unknown, errors: string[]): RubricCriterion[] {
  const list = Array.isArray(raw) ? raw : [];
  if (list.length === 0) errors.push("rubric: at least one criterion is required");
  const seen: Record<string, boolean> = {};
  const out: RubricCriterion[] = [];
  list.forEach((c, i) => {
    if (!isObj(c)) { errors.push(`rubric[${i}] must be an object`); return; }
    const text = str(c.text).trim();
    const weight = Number(c.weight);
    const id = str(c.id).trim() || `c${i + 1}`;
    if (!text) errors.push(`rubric[${i}]: text is required`);
    if (!Number.isFinite(weight) || weight <= 0) errors.push(`rubric[${i}]: weight must be a positive number`);
    if (!(DIMENSIONS as readonly string[]).includes(c.mapsTo)) errors.push(`rubric[${i}]: mapsTo must be one of ${DIMENSIONS.join(", ")}`);
    if (seen[id]) errors.push(`rubric[${i}]: duplicate id "${id}"`);
    seen[id] = true;
    out.push({ id, text, weight, mapsTo: c.mapsTo });
  });
  return out;
}

export function validateProblemRunbook(raw: unknown): ValidationResult<ProblemRunbook> {
  const errors: string[] = [];
  if (!isObj(raw)) return { ok: false, errors: ["runbook must be an object"] };

  const statementMd = str(raw.statementMd).trim();
  if (!statementMd) errors.push("statementMd: statement is required");
  if (statementMd.length > LIMITS.statementChars) errors.push(`statementMd: max ${LIMITS.statementChars} characters`);

  const tracksRaw = Array.isArray(raw.solutionTracks) ? raw.solutionTracks : [];
  if (tracksRaw.length === 0) errors.push("solutionTracks: at least one solution track is required");
  const solutionTracks: SolutionTrack[] = [];
  tracksRaw.forEach((t: any, i: number) => {
    if (!isObj(t)) { errors.push(`solutionTracks[${i}] must be an object`); return; }
    const name = str(t.name).trim();
    if (!name) errors.push(`solutionTracks[${i}]: name is required`);
    const key = str(t.key).trim() || name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || `track_${i + 1}`;
    solutionTracks.push({
      key,
      name,
      approach: str(t.approach).trim(),
      timeComplexity: str(t.timeComplexity).trim(),
      spaceComplexity: str(t.spaceComplexity).trim(),
      probes: strList(t.probes),
    });
  });

  const op = isObj(raw.outcomeProbes) ? raw.outcomeProbes : {};
  const outcomeProbes: OutcomeProbes = { passed: strList(op.passed), partial: strList(op.partial), failed: strList(op.failed) };

  const hintLadder = validateHints(raw.hintLadder, errors);
  const rubric = validateRubric(raw.rubric, errors);

  const d = isObj(raw.defaults) ? raw.defaults : {};
  const budgetMin = Number(d.budgetMin ?? 15);
  const graceMin = Number(d.graceMin ?? 2);
  const earlyDoneAfterMin = Number(d.earlyDoneAfterMin ?? Math.min(8, budgetMin));
  if (!Number.isFinite(budgetMin) || budgetMin < 1) errors.push("defaults.budgetMin must be >= 1");
  if (!Number.isFinite(graceMin) || graceMin < 0) errors.push("defaults.graceMin must be >= 0");
  if (!Number.isFinite(earlyDoneAfterMin) || earlyDoneAfterMin < 0) errors.push("defaults.earlyDoneAfterMin must be >= 0");
  else if (earlyDoneAfterMin > budgetMin) errors.push("defaults.earlyDoneAfterMin must be <= budgetMin");

  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { statementMd, solutionTracks, outcomeProbes, hintLadder, rubric, defaults: { budgetMin, graceMin, earlyDoneAfterMin } } };
}

export function validatePuzzleRunbook(raw: unknown): ValidationResult<PuzzleRunbook> {
  const errors: string[] = [];
  if (!isObj(raw)) return { ok: false, errors: ["runbook must be an object"] };

  const statementMd = str(raw.statementMd).trim();
  if (!statementMd) errors.push("statementMd: statement is required");
  if (statementMd.length > LIMITS.statementChars) errors.push(`statementMd: max ${LIMITS.statementChars} characters`);

  const expectedMin = Number(raw.expectedMin);
  if (!Number.isFinite(expectedMin) || expectedMin <= 0) errors.push("expectedMin must be greater than 0");

  const hintLadder = validateHints(raw.hintLadder, errors);
  const rubric = validateRubric(raw.rubric, errors);

  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { statementMd, acceptedAnswers: strList(raw.acceptedAnswers), expectedMin: Math.ceil(expectedMin), hintLadder, rubric } };
}

// ─── Submissions ────────────────────────────────────────────────────────────

export interface SubmissionInput {
  problemId?: string | null;
  problemTitle: string;
  language?: string;
  code: string;
  outcome: Outcome;
  score?: number | null;
  testsPassed?: number | null;
  testsTotal?: number | null;
  externalUrl?: string;
  notes?: string;
  isPrimary: boolean;
}

export function validateSubmissions(raw: unknown): ValidationResult<SubmissionInput[]> {
  const errors: string[] = [];
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, errors: ["submissions: at least the primary submission is required"] };
  const out: SubmissionInput[] = [];
  raw.forEach((s: any, i: number) => {
    if (!isObj(s)) { errors.push(`submissions[${i}] must be an object`); return; }
    const problemTitle = str(s.problemTitle).trim();
    const code = str(s.code);
    if (!problemTitle) errors.push(`submissions[${i}]: problemTitle is required`);
    if (!code.trim()) errors.push(`submissions[${i}]: code is required`);
    if (code.length > LIMITS.codeChars) errors.push(`submissions[${i}]: code exceeds ${LIMITS.codeChars} characters`);
    // Interviewers no longer supply a result; the AI judges the code itself. The column is NOT NULL, so store a neutral value.
    const outcome = s.outcome === undefined || s.outcome === null || s.outcome === "" ? "partial" : s.outcome;
    if (!OUTCOMES.includes(outcome)) errors.push(`submissions[${i}]: outcome must be passed, partial or failed`);
    const num = (v: unknown) => {
      const n = optNum(v);
      return n === undefined || Number.isNaN(n) ? null : n;
    };
    const testsPassed = num(s.testsPassed);
    const testsTotal = num(s.testsTotal);
    if (testsPassed !== null && testsTotal !== null && testsPassed > testsTotal) errors.push(`submissions[${i}]: testsPassed cannot exceed testsTotal`);
    const notes = str(s.notes);
    if (notes.length > LIMITS.notesChars) errors.push(`submissions[${i}]: notes exceed ${LIMITS.notesChars} characters`);
    out.push({
      problemId: s.problemId ? String(s.problemId) : null,
      problemTitle,
      language: str(s.language).trim().slice(0, 50),
      code,
      outcome,
      score: num(s.score),
      testsPassed: testsPassed === null ? null : Math.floor(testsPassed),
      testsTotal: testsTotal === null ? null : Math.floor(testsTotal),
      externalUrl: str(s.externalUrl).trim().slice(0, 1000),
      notes: notes.trim(),
      isPrimary: s.isPrimary === true,
    });
  });
  if (out.filter((s) => s.isPrimary).length !== 1) errors.push("submissions: exactly one submission must be primary");
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: out };
}

// ─── Interview runbooks: how the AI asks questions in a stage ─────────────────
// Separate from the problem/puzzle itself. Create as many as you like per stage type and plug one into a stage.

export interface InterviewRunbook {
  name: string;
  description: string;
  /** The steps the AI follows, as plain instructions (markdown-ish text). */
  instructions: string;
  /** Extra questions the AI may use in this stage regardless of the item. */
  probes: string[];
  /** Extra rubric criteria added to the item's own rubric when the stage is scored. */
  rubric: RubricCriterion[];
}

/** What a stage stores: the chosen runbook copied at creation, so later edits never change a created interview. */
export interface StageFlow extends InterviewRunbook {
  runbookId: string | null;
  runbookVersion: number;
}

const COMPLEXITY_NOTE = "Time complexity is in terms of the input size and, for trees, their depth (note any degenerate case such as a branching factor of 1).";

export const BUILTIN_RUNBOOKS: Record<StageKey, InterviewRunbook> = {
  parta: {
    name: "Default Part A flow",
    description: "Understand the candidate's own solution function by function, ask complexity per function, check correctness, then push for an optimized approach (pseudocode) if it is not optimal.",
    instructions: `1. UNDERSTANDING, FUNCTION BY FUNCTION: read the code and ask what each function (or major block) is for and how it works, naming line numbers. Cover every function they wrote, one at a time. Do not skip any.
2. COMPLEXITY, FUNCTION BY FUNCTION: for each function ask its time complexity and its space complexity, and why. Then ask the overall complexity for the worst case. ${COMPLEXITY_NOTE}
3. CORRECTNESS: if the submission passed, probe edge cases and why it is correct. If it did not fully pass, see whether the candidate can locate the failing case or the bug by reasoning about their code. Never point at the bug yourself.
4. OPTIMIZATION: compare their approach with the reference solution tracks (the LAST listed track is the best). If their code is not already as good as the best track (for example it lacks a data structure or bookkeeping that the best track relies on), do NOT say what is missing. Ask them to describe how they would make it faster, by voice or as pseudocode in the scratchpad, and ask the complexity of their improved approach. If their code already matches the best track, probe edge cases and trade-offs instead.`,
    probes: [],
    rubric: [],
  },
  dsa: {
    name: "Default DSA flow",
    description: "Check understanding, get the approach by voice, push toward better approaches, then have the candidate write the code in the scratchpad and review it.",
    instructions: `1. UNDERSTAND: invite clarifying questions and check they understand the input, output and constraints on a tiny example.
2. APPROACH BY VOICE: ask how they would solve it. A brute force is a fine start: ask its time and space complexity.
3. IMPROVE: push toward a better approach by asking what is repeated or wasted. Never name the better data structure or technique; ask for the complexity of each improvement. ${COMPLEXITY_NOTE}
4. CODE IN THE SCRATCHPAD: once the approach is clear, ask them to write the solution in the scratchpad (typed, never executed). Read the latest scratchpad, ask about specific lines, the complexity of each function they wrote, edge cases, and walk one example through it.
5. If time remains, ask how it changes under harder constraints.`,
    probes: [],
    rubric: [],
  },
  puzzle: {
    name: "Default puzzle flow",
    description: "Let the candidate reason aloud, test small cases, and justify the answer; never confirm or reveal it.",
    instructions: `1. Read the puzzle once, then wait. Do not rephrase it unless asked.
2. Let the candidate reason aloud. Ask them to try small cases and to state their assumptions.
3. When they give an answer, ask them to justify or sanity-check it. Never say whether it is right.
4. Judge the reasoning, not just the final answer.`,
    probes: [],
    rubric: [],
  },
};

export function validateInterviewRunbook(raw: unknown): ValidationResult<InterviewRunbook> {
  const errors: string[] = [];
  if (!isObj(raw)) return { ok: false, errors: ["runbook must be an object"] };
  const name = str(raw.name).trim();
  if (!name) errors.push("name is required");
  if (name.length > 255) errors.push("name must be at most 255 characters");
  const instructions = str(raw.instructions).trim();
  if (!instructions) errors.push("instructions are required: describe how the AI should ask its questions");
  if (instructions.length > LIMITS.statementChars) errors.push(`instructions: max ${LIMITS.statementChars} characters`);
  const description = str(raw.description).trim().slice(0, 1000);
  const probes = strList(raw.probes);
  const rubricRaw = Array.isArray(raw.rubric) ? raw.rubric : [];
  const rubric = rubricRaw.length ? validateRubric(rubricRaw, errors) : [];
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { name, description, instructions, probes, rubric } };
}

// ─── Stages (the interview plan) ─────────────────────────────────────────────

export type StageMode = "specific" | "random";

/** One enabled stage as the interviewer configured it, in the order it will run. */
export interface StagePlan {
  key: StageKey;
  budgetMin: number;
  graceMin: number;
  earlyDoneAfterMin: number | null;
  mode: StageMode;
  /** parta: the Part A question; dsa: the problem; puzzle: the puzzle (only when mode is "specific"). */
  itemId: string | null;
  /** The interview runbook (how the AI asks) plugged into this stage; null = the built-in default for the stage type. */
  runbookId: string | null;
}

const isUuidLike = (v: unknown) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

export function validateStages(raw: unknown, durationMin: number): ValidationResult<StagePlan[]> {
  const errors: string[] = [];
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, errors: ["Enable at least one stage"] };
  const seen: Record<string, boolean> = {};
  const out: StagePlan[] = [];
  raw.forEach((s: any, i: number) => {
    if (!isObj(s) || !(STAGE_KEYS as string[]).includes(s.key)) { errors.push(`stages[${i}]: unknown stage`); return; }
    const key = s.key as StageKey;
    const label = STAGE_LABELS[key];
    if (seen[key]) errors.push(`${label}: listed twice`);
    seen[key] = true;
    const budgetMin = Number(s.budgetMin);
    const graceMin = Number(s.graceMin ?? 0);
    const early = s.earlyDoneAfterMin === undefined || s.earlyDoneAfterMin === null || s.earlyDoneAfterMin === "" ? null : Number(s.earlyDoneAfterMin);
    if (!Number.isFinite(budgetMin) || budgetMin < 1) errors.push(`${label}: time must be at least 1 minute`);
    if (!Number.isFinite(graceMin) || graceMin < 0) errors.push(`${label}: grace must be 0 or more`);
    if (early !== null && (!Number.isFinite(early) || early < 0)) errors.push(`${label}: early-done threshold must be 0 or more`);
    else if (early !== null && early > budgetMin) errors.push(`${label}: early-done threshold cannot exceed its time`);
    const mode: StageMode = key === "parta" ? "specific" : s.mode === "random" ? "random" : "specific";
    const itemId = mode === "specific" ? (s.itemId ?? null) : null;
    if (mode === "specific" && !isUuidLike(itemId)) errors.push(`${label}: pick ${key === "parta" ? "a Part A question" : key === "dsa" ? "a DSA problem" : "a puzzle"} (or choose random)`);
    const runbookId = s.runbookId ? String(s.runbookId) : null;
    if (runbookId !== null && !isUuidLike(runbookId)) errors.push(`${label}: invalid runbook`);
    out.push({ key, budgetMin: Math.floor(budgetMin), graceMin: Math.floor(graceMin) || 0, earlyDoneAfterMin: early === null ? null : Math.floor(early), mode, itemId: itemId as string | null, runbookId });
  });
  if (errors.length === 0) {
    const total = out.reduce((n, s) => n + s.budgetMin, 0);
    if (total + CLOSE_RESERVE_MIN > durationMin) {
      errors.push(`The stage times add up to ${total} min; with the ${CLOSE_RESERVE_MIN} minute closing reserve that must fit within the ${durationMin} minute interview`);
    }
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: out };
}

// ─── Phase config snapshots (stored in interview_phases.config) ─────────────

/** Part A: the candidate's own submission, reviewed against the question's runbook. */
export interface PartAPhaseConfig {
  problemId: string;
  problemVersion: number;
  problemTitle: string;
  runbook: ProblemRunbook;
  primarySubmissionId: string;
  contextSubmissionIds: string[];
  flow?: StageFlow;
}

export interface DsaPoolEntry {
  problemId: string;
  version: number;
  title: string;
  runbook: ProblemRunbook;
}

/** DSA: a fresh problem solved live (approach by voice, code in the scratchpad). */
export interface DsaPhaseConfig {
  pool: DsaPoolEntry[];
  selection: StageMode;
  selected?: { problemId: string; title: string; runbook: ProblemRunbook }; // set at activation
  flow?: StageFlow;
}

export interface PoolEntry {
  puzzleId: string;
  version: number;
  title: string;
  runbook: PuzzleRunbook;
}

export interface PuzzlePhaseConfig {
  pool: PoolEntry[];
  selection: "random" | "ordered" | "specific";
  selected?: { puzzleId: string; title: string; runbook: PuzzleRunbook };
  flow?: StageFlow;
}

export function snapshotPartAConfig(
  problem: { id: string; version: number; title: string; runbook: ProblemRunbook },
  primarySubmissionId: string,
  contextSubmissionIds: string[],
  flow?: StageFlow
): PartAPhaseConfig {
  return {
    flow,
    problemId: problem.id,
    problemVersion: problem.version,
    problemTitle: problem.title,
    runbook: problem.runbook,
    primarySubmissionId,
    contextSubmissionIds,
  };
}

export function snapshotDsaConfig(
  problems: Array<{ id: string; version: number; title: string; runbook: ProblemRunbook }>,
  selection: StageMode,
  flow?: StageFlow
): DsaPhaseConfig {
  return { pool: problems.map((p) => ({ problemId: p.id, version: p.version, title: p.title, runbook: p.runbook })), selection, flow };
}

export function snapshotPuzzleConfig(
  puzzles: Array<{ id: string; version: number; title: string; runbook: PuzzleRunbook }>,
  selection: "random" | "ordered" | "specific",
  flow?: StageFlow
): PuzzlePhaseConfig {
  return {
    flow,
    pool: puzzles.map((p) => ({ puzzleId: p.id, version: p.version, title: p.title, runbook: p.runbook })),
    selection,
  };
}
