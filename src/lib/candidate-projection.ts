// What a candidate (token) is allowed to see of a DSA Review interview.
// Everything not listed here (solution tracks, probes, hints, rubric, accepted answers, puzzle pool,
// weak-answer counts, hints used) stays on the server.
import type { PhaseRow } from "./phase-engine";
import type { Submission } from "./phase-store";
import type { DsaPhaseConfig, PuzzlePhaseConfig } from "./runbook";

export interface CandidatePhase {
  phaseKey: string;
  status: string;
  budgetMin: number | null;
  startedAt: string | null;
  endedAt: string | null;
  problemTitle?: string;
  runbook?: { statementMd: string };
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
  if (p.phaseKey === "dsa") {
    const cfg = p.config as DsaPhaseConfig;
    out.problemTitle = cfg.problemTitle;
    out.runbook = { statementMd: cfg.runbook.statementMd };
  } else if (p.phaseKey === "puzzle" && p.status === "active") {
    const sel = (p.config as PuzzlePhaseConfig).selected;
    if (sel) out.selected = { title: sel.title, runbook: { statementMd: sel.runbook.statementMd } };
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
