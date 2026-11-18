// Multi-stage puzzles: which stages a puzzle has, when the interviewer has moved to the next one, and the progress the
// candidate sees as stage boxes. Pure module (no database access), safe to import from client components.
//
// The server owns the current stage. The AI reports a move with [STAGE:label]; it is accepted only when it names the
// NEXT stage (forward, one step at a time). If the marker is missing but the reply contains one of the next stage's cue
// phrases, the move is accepted too. Puzzles with fewer than two stages have no stage tracking at all.
// The last stage has no next stage to move to: the AI reports that the candidate SOLVED it with [STAGE:done]. Ending the
// puzzle ([PHASE_DONE]) alone does not count, because the AI also ends it when it stops a stuck candidate.
import type { PuzzleRunbook, PuzzleStage } from "./runbook";

/** The [STAGE:...] value that reports the last stage as solved. Reserved: no stage may use it as its label. */
export const LAST_STAGE_SOLVED = "done";

/** What the candidate's stage boxes show. Labels only: never a stage's question or answer. */
export interface StageProgress {
  labels: string[];
  /** Index of the stage being worked on; null once the puzzle is over. */
  current: number | null;
  /** How many stages are completed (the first `completed` boxes are green). */
  completed: number;
}

export interface StageAdvance {
  /** Index of the stage the interviewer has just moved to, or null when the stage did not change. */
  advanceTo: number | null;
  via?: "marker" | "cue";
  /** A [STAGE] marker that was not accepted (wrong stage, a skip, or going back). */
  ignoredLabel?: string;
  /** The interviewer reported the LAST stage as solved ([STAGE:done] while on the last stage). */
  solvedLast?: boolean;
}

/** The stages of a puzzle, or [] for a single-question puzzle (no stages, or just one). */
export function puzzleStages(runbook: Pick<PuzzleRunbook, "stages"> | null | undefined): PuzzleStage[] {
  const stages = runbook?.stages;
  return Array.isArray(stages) && stages.length >= 2 ? stages : [];
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** Index of the stage with this label (case-insensitive), or -1. */
export function stageIndexOf(stages: PuzzleStage[], label: string | null | undefined): number {
  if (!label) return -1;
  const want = norm(label);
  return stages.findIndex((s) => norm(s.label) === want);
}

/** The current stage from the last accepted stage label; the first stage until a move has been accepted. */
export function currentStageIndex(stages: PuzzleStage[], lastLabel: string | null | undefined): number {
  return Math.max(0, stageIndexOf(stages, lastLabel));
}

/** Decides whether this interviewer reply moved the puzzle to its next stage. */
export function decideStageAdvance(stages: PuzzleStage[], currentIndex: number, markerLabel: string | undefined, replyText: string): StageAdvance {
  const next = currentIndex + 1;
  const solvedMarker = !!markerLabel && norm(markerLabel) === LAST_STAGE_SOLVED;
  if (stages.length < 2 || next >= stages.length) {
    // Already on the last stage: nothing to move to, but [STAGE:done] reports it solved. Re-marking it is harmless.
    if (stages.length >= 2 && solvedMarker) return { advanceTo: null, solvedLast: true };
    if (markerLabel && stageIndexOf(stages, markerLabel) !== currentIndex) return { advanceTo: null, ignoredLabel: markerLabel };
    return { advanceTo: null };
  }
  // [STAGE:done] before the last stage would skip the remaining stages: not accepted.
  if (solvedMarker) return { advanceTo: null, ignoredLabel: markerLabel };
  if (markerLabel) {
    const idx = stageIndexOf(stages, markerLabel);
    if (idx === next) return { advanceTo: next, via: "marker" };
    if (idx === currentIndex) return { advanceTo: null };
    return { advanceTo: null, ignoredLabel: markerLabel };
  }
  const text = norm(replyText);
  const cues = (stages[next].cues || []).map(norm).filter(Boolean);
  if (text && cues.some((c) => text.includes(c))) return { advanceTo: next, via: "cue" };
  return { advanceTo: null };
}

/**
 * The boxes for a puzzle phase. The stages before the current one are completed. The last stage is completed only when
 * the interviewer reported it solved ([STAGE:done], `lastSolved`): not when the puzzle merely ended, since the AI also
 * ends it to stop a stuck candidate, and not when the time ran out.
 */
export function stageProgress(
  stages: PuzzleStage[],
  currentIndex: number,
  phase: { status: string; endReason?: string | null },
  lastSolved: boolean
): StageProgress | null {
  if (stages.length < 2) return null;
  const labels = stages.map((s) => s.label);
  const idx = Math.min(Math.max(0, currentIndex), stages.length - 1);
  const completed = lastSolved && idx === stages.length - 1 ? stages.length : idx;
  if (phase.status === "active") return { labels, current: idx, completed };
  if (phase.status === "completed") return { labels, current: null, completed };
  return null;
}
