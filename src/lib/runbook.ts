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

export const DEFAULT_PHASE_WEIGHTS = { dsa: 0.7, puzzle: 0.3 };

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
    if (!OUTCOMES.includes(s.outcome)) errors.push(`submissions[${i}]: outcome must be passed, partial or failed`);
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
      outcome: s.outcome,
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

// ─── Phase plan ─────────────────────────────────────────────────────────────

export interface PhasePlan {
  dsaBudgetMin: number;
  graceMin: number;
  earlyDoneAfterMin: number;
  puzzleMinRemainingMin: number;
  puzzleSelection: "random" | "ordered";
  phaseWeights: { dsa: number; puzzle: number };
}

export function validatePlan(raw: unknown, durationMin: number): ValidationResult<PhasePlan> {
  const errors: string[] = [];
  const p = isObj(raw) ? raw : {};
  const dsaBudgetMin = Number(p.dsaBudgetMin);
  const graceMin = Number(p.graceMin ?? 0);
  const earlyDoneAfterMin = Number(p.earlyDoneAfterMin ?? 0);
  const puzzleMinRemainingMin = Number(p.puzzleMinRemainingMin ?? 0);
  if (!Number.isFinite(dsaBudgetMin) || dsaBudgetMin < 1) errors.push("plan.dsaBudgetMin must be >= 1");
  if (!Number.isFinite(graceMin) || graceMin < 0) errors.push("plan.graceMin must be >= 0");
  if (!Number.isFinite(earlyDoneAfterMin) || earlyDoneAfterMin < 0) errors.push("plan.earlyDoneAfterMin must be >= 0");
  if (!Number.isFinite(puzzleMinRemainingMin) || puzzleMinRemainingMin < 0) errors.push("plan.puzzleMinRemainingMin must be >= 0");
  if (errors.length === 0) {
    if (dsaBudgetMin + graceMin + CLOSE_RESERVE_MIN > durationMin) {
      errors.push(`plan: dsaBudgetMin + graceMin + ${CLOSE_RESERVE_MIN} (closing reserve) must fit within the ${durationMin} minute duration`);
    }
    if (earlyDoneAfterMin > dsaBudgetMin) errors.push("plan.earlyDoneAfterMin must be <= dsaBudgetMin");
  }
  const w = isObj(p.phaseWeights) ? p.phaseWeights : {};
  const wDsa = Number(w.dsa ?? DEFAULT_PHASE_WEIGHTS.dsa);
  const wPuzzle = Number(w.puzzle ?? DEFAULT_PHASE_WEIGHTS.puzzle);
  if (!Number.isFinite(wDsa) || wDsa <= 0 || !Number.isFinite(wPuzzle) || wPuzzle <= 0) errors.push("plan.phaseWeights must be positive numbers");
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      dsaBudgetMin: Math.floor(dsaBudgetMin),
      graceMin: Math.floor(graceMin),
      earlyDoneAfterMin: Math.floor(earlyDoneAfterMin),
      puzzleMinRemainingMin: Math.floor(puzzleMinRemainingMin),
      puzzleSelection: p.puzzleSelection === "ordered" ? "ordered" : "random",
      phaseWeights: { dsa: wDsa, puzzle: wPuzzle },
    },
  };
}

// ─── Phase config snapshots (stored in interview_phases.config) ─────────────

export interface DsaPhaseConfig {
  problemId: string;
  problemVersion: number;
  problemTitle: string;
  runbook: ProblemRunbook;
  primarySubmissionId: string;
  contextSubmissionIds: string[];
}

export interface PoolEntry {
  puzzleId: string;
  version: number;
  title: string;
  runbook: PuzzleRunbook;
}

export interface PuzzlePhaseConfig {
  pool: PoolEntry[];
  selection: "random" | "ordered";
  selected?: { puzzleId: string; title: string; runbook: PuzzleRunbook };
}

export function snapshotDsaConfig(
  problem: { id: string; version: number; title: string; runbook: ProblemRunbook },
  primarySubmissionId: string,
  contextSubmissionIds: string[]
): DsaPhaseConfig {
  return {
    problemId: problem.id,
    problemVersion: problem.version,
    problemTitle: problem.title,
    runbook: problem.runbook,
    primarySubmissionId,
    contextSubmissionIds,
  };
}

export function snapshotPuzzleConfig(
  puzzles: Array<{ id: string; version: number; title: string; runbook: PuzzleRunbook }>,
  selection: "random" | "ordered"
): PuzzlePhaseConfig {
  return {
    pool: puzzles.map((p) => ({ puzzleId: p.id, version: p.version, title: p.title, runbook: p.runbook })),
    selection,
  };
}
