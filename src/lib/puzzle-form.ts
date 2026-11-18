// The puzzle editor's stage form (Setup, one card per stage with its Question and Accepted answer, Grading notes) and
// how it maps to a saved puzzle runbook. Pure module, safe to import from client components.
//
// Only the puzzle INPUT changes: on save the form also writes the fields the rest of the app already reads, so the
// interview, the AI prompt, the stage boxes and scoring work unchanged:
//   statementMd     = Setup + Stage 1's question            (the candidate's left panel, the AI's opening)
//   acceptedAnswers = "STAGE n: <answer>" per stage (a one-stage puzzle: the answer as is), any other answer lines the
//                     puzzle already had, then "GRADING: <notes>"   (the AI's answer key, per-stage scoring)
//   stages          = numbered 1, 2, 3 ... with question, answer and cue phrases (stage tracking and boxes)
import { MAX_PUZZLE_STAGES } from "./runbook";
import { phrasePattern } from "./reveal-guard";

export interface PuzzleStageForm {
  questionMd: string;
  answer: string;
  cues: string[];
  /** Stage fields the form does not show (e.g. a "moveOnWhen" from pasted JSON); kept as they are on save. */
  extra: Record<string, unknown>;
}

export interface PuzzleForm {
  setupMd: string;
  stages: PuzzleStageForm[];
  gradingNotes: string;
  /** Answer lines the puzzle had that belong to no stage and are not grading (kept as they are on save). */
  otherAnswers: string[];
  /** A one-time note for the editor, e.g. when an older puzzle's Statement was moved into Setup. */
  notice?: string;
}

export const emptyStage = (): PuzzleStageForm => ({ questionMd: "", answer: "", cues: [], extra: {} });

export const emptyPuzzleForm = (): PuzzleForm => ({ setupMd: "", stages: [emptyStage()], gradingNotes: "", otherAnswers: [] });

const STAGE_PREFIX = /^\s*STAGE\s+([A-Za-z0-9][\w.+-]*)/i;
// Only the word and an optional colon: "GRADING (grade on ...). BELOW BAR: ..." keeps its bracketed text, which is content.
const GRADING_PREFIX = /^\s*GRADING\b\s*:?\s*/i;
// "STAGE 2 (two rounds of 24 hours): 7 testers" -> "7 testers"; "STAGE 2: 7 testers" -> "7 testers"
const STAGE_LINE_HEAD = /^\s*STAGE\s+[A-Za-z0-9][\w.+-]*\s*(\([^)]*\))?\s*:?\s*/i;

const stageLabelOf = (line: string): string | null => {
  const m = line.match(STAGE_PREFIX);
  return m ? m[1].toLowerCase() : null;
};
const isGrading = (line: string) => /^\s*GRADING\b/i.test(line);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** Opens a saved puzzle runbook in the stage form. Older puzzles without stages become a one-stage form. */
export function puzzleToForm(rb: Record<string, any> | null | undefined): PuzzleForm {
  const r = rb || {};
  const answers = strings(r.acceptedAnswers).map((a) => a.trim()).filter(Boolean);
  const grading = typeof r.gradingNotes === "string" && r.gradingNotes.trim()
    ? r.gradingNotes.trim()
    : answers.filter(isGrading).map((a) => a.replace(GRADING_PREFIX, "").trim()).join("\n");
  const rawStages = Array.isArray(r.stages) ? r.stages.filter((s: unknown) => s && typeof s === "object") : [];

  if (rawStages.length === 0) {
    // An older one-question puzzle: the whole Statement is Stage 1's question, its answers are Stage 1's answer.
    return {
      setupMd: typeof r.setupMd === "string" ? r.setupMd : "",
      stages: [{ ...emptyStage(), questionMd: String(r.statementMd || ""), answer: answers.filter((a) => !isGrading(a)).join("\n") }],
      gradingNotes: grading,
      otherAnswers: [],
    };
  }

  const used = new Set<number>();
  const stages: PuzzleStageForm[] = rawStages.map((s: Record<string, any>, i: number) => {
    const { label, questionMd, answer, cues, ...extra } = s;
    let ans = typeof answer === "string" ? answer : "";
    if (!ans) {
      // Puzzles written before this form keep each stage's answer as a "STAGE <label> ..." line.
      const want = String(label ?? i + 1).toLowerCase();
      const idx = answers.findIndex((a, j) => !used.has(j) && stageLabelOf(a) === want);
      if (idx >= 0) { used.add(idx); ans = answers[idx].replace(STAGE_LINE_HEAD, "").trim(); }
    } else {
      // Its own line written by this form ("STAGE n: ..." or, for a one-stage puzzle, the bare answer) is regenerated on
      // save, so it must not also be kept as an extra line (that would add a copy on every save).
      const want = String(label ?? i + 1).toLowerCase();
      const own = ans.trim();
      const idx = answers.findIndex((a, j) => !used.has(j) && (stageLabelOf(a) === want || a === own));
      if (idx >= 0) used.add(idx);
    }
    return { questionMd: String(questionMd || ""), answer: ans, cues: strings(cues), extra };
  });

  const hasSetup = typeof r.setupMd === "string";
  return {
    setupMd: hasSetup ? r.setupMd : String(r.statementMd || ""),
    stages,
    gradingNotes: grading,
    otherAnswers: answers.filter((a, j) => !used.has(j) && !isGrading(a)),
    ...(hasSetup ? {} : { notice: "This puzzle was made before the stage form: its old Statement was put into Setup. Check that Setup does not repeat Stage 1's question." }),
  };
}

/**
 * Problems that stop the form from being saved (on top of the puzzle runbook's own checks). `noReveal` is the puzzle's
 * "Never say before the candidate does" list: a question or the Setup containing one of those phrases could never be
 * read out, because the reply guard cuts any sentence with a locked phrase the candidate has not said yet.
 */
export function puzzleFormErrors(form: PuzzleForm, noReveal: string[] = []): string[] {
  const errors: string[] = [];
  const banned = noReveal.map((p) => ({ p: p.trim(), re: phrasePattern(p) })).filter((x) => x.p && x.re);
  const clash = (text: string) => banned.find((b) => b.re!.test(text))?.p;
  if (form.stages.length === 0) errors.push("Stage 1 is required");
  if (form.stages.length > MAX_PUZZLE_STAGES) errors.push(`At most ${MAX_PUZZLE_STAGES} stages`);
  const setupClash = clash(form.setupMd);
  if (setupClash) errors.push(`Setup contains "${setupClash}", which is in "Never say before the candidate does": the AI would not be allowed to read it out. Reword it, or remove that phrase from the list.`);
  form.stages.forEach((s, i) => {
    if (!s.questionMd.trim()) errors.push(`Stage ${i + 1}: the question is required`);
    if (!s.answer.trim()) errors.push(`Stage ${i + 1}: the accepted answer is required`);
    const c = clash(s.questionMd);
    if (c) errors.push(`Stage ${i + 1}: the question contains "${c}", which is in "Never say before the candidate does": the AI would not be allowed to read it out. Reword it, or remove that phrase from the list.`);
  });
  return errors;
}

/** Builds the runbook to save from the form, keeping every other field of `base` (hints, rubric, banned words, ...). */
export function formToPuzzleRunbook(form: PuzzleForm, base: Record<string, any>): Record<string, any> {
  const setup = form.setupMd.trim();
  const grading = form.gradingNotes.trim();
  const stages = form.stages.map((s, i) => {
    const answer = s.answer.trim();
    const cues = s.cues.map((c) => c.trim()).filter(Boolean);
    return { ...s.extra, label: String(i + 1), questionMd: s.questionMd.trim(), ...(answer ? { answer } : {}), ...(cues.length ? { cues } : {}) };
  });
  const multi = stages.length >= 2;
  const stageAnswers = multi
    ? stages.filter((s) => s.answer).map((s) => `STAGE ${s.label}: ${s.answer}`)
    : stages[0]?.answer ? [stages[0].answer as string] : [];

  const { setupMd: _s, gradingNotes: _g, stages: _st, ...rest } = base || {};
  return {
    ...rest,
    statementMd: [setup, stages[0]?.questionMd || ""].filter(Boolean).join("\n\n"),
    acceptedAnswers: [...stageAnswers, ...form.otherAnswers, ...(grading ? [`GRADING: ${grading}`] : [])],
    stages,
    setupMd: setup, // always written, even empty: it marks a puzzle saved by this form
    ...(grading ? { gradingNotes: grading } : {}),
  };
}
