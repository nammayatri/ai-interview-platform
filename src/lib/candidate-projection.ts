// What a candidate (token) is allowed to see of a DSA Review interview.
// Everything not listed here (solution tracks, probes, hints, rubric, accepted answers, puzzle pool,
// weak-answer counts, hints used) stays on the server.
import type { PhaseRow } from "./phase-engine";
import type { Submission } from "./phase-store";
import { phaseMaterial } from "./phase-config";
import type { PartAPhaseConfig } from "./runbook";

export interface CandidatePhase {
  phaseKey: string;
  status: string;
  budgetMin: number | null;
  startedAt: string | null;
  endedAt: string | null;
  /** parta only */
  problemTitle?: string;
  runbook?: { statementMd: string };
  /** dsa / puzzle: only once the stage is active (the random pick is not revealed earlier) */
  selected?: { title: string; runbook: { statementMd: string } };
}

export function projectPhaseForCandidate(p: PhaseRow): CandidatePhase {
  const out: CandidatePhase = {
    phaseKey: p.phaseKey,
    status: p.status,
    budgetMin: p.budgetMin,
    startedAt: p.startedAt,
    endedAt: p.endedAt,
  };
  if (p.phaseKey === "parta") {
    const cfg = p.config as PartAPhaseConfig;
    out.problemTitle = cfg.problemTitle;
    out.runbook = { statementMd: cfg.runbook.statementMd };
  } else if (p.status === "active") {
    const m = phaseMaterial(p);
    if (m.ready) out.selected = { title: m.title, runbook: { statementMd: m.statementMd } };
  }
  return out;
}

export function projectSubmissionForCandidate(s: Submission) {
  return { id: s.id, problemTitle: s.problemTitle, language: s.language, code: s.code, outcome: s.outcome, isPrimary: s.isPrimary };
}

/** Returns a copy of the interview that is safe to send to the candidate's browser. */
export function projectInterviewForCandidate<T extends { roundType?: string; phases?: PhaseRow[]; submissions?: Submission[] }>(interview: T): T {
  if (interview.roundType !== "DSA Review") return interview;
  return {
    ...interview,
    phases: (interview.phases || []).map(projectPhaseForCandidate) as any,
    // Context submissions are for the AI only; the candidate sees their primary submission.
    submissions: (interview.submissions || []).filter((s) => s.isPrimary).map(projectSubmissionForCandidate) as any,
  };
}
