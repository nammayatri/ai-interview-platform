// What the "Current stage" card on the interview View page shows: the parts of a Coding Evaluation interview (Part A,
// DSA, Puzzle) with when each started, the puzzle's stage boxes when it has a stage list, whether the candidate is
// offline, and the overall state (Not started / Running / Completed, whatever the reason it ended).
//
// buildInterviewProgress is pure (no database) so it is unit-tested; loadInterviewProgress reads the data for it.
import { pool } from "./db";
import { getPhases } from "./phase-store";
import { getPuzzleStageProgress } from "./dsa-turn";
import { puzzleStages, stageIndexOf, type StageProgress } from "./puzzle-stages";
import type { PhaseRow } from "./phase-engine";
import type { PuzzlePhaseConfig } from "./runbook";

export const OFFLINE_AFTER_SECONDS = 60; // the same rule as the batch page's live view

export type PartKey = "parta" | "dsa" | "puzzle";
export type PartStatus = "done" | "current" | "pending" | "skipped";

const PART_LABEL: Record<PartKey, string> = { parta: "Part A", dsa: "DSA", puzzle: "Puzzle" };

export interface ProgressPart {
  key: PartKey;
  label: string;
  status: PartStatus;
  startedAt: string | null;
}

export interface PuzzleStagesView extends StageProgress {
  /** When each stage started (null for a stage not reached). */
  startedAt: (string | null)[];
}

export type InterviewProgress =
  | { show: false }
  | {
      show: true;
      state: "not_started" | "running" | "completed";
      /** While running: "DSA", "Puzzle · Stage 2 of 3", "Wrapping up". */
      now: string | null;
      /** While running and the candidate's browser has not checked in for over a minute: how long, in seconds. */
      offlineSeconds: number | null;
      parts: ProgressPart[];
      /** Only for a puzzle with a stage list that has started. */
      puzzleStages: PuzzleStagesView | null;
    };

export interface ProgressInput {
  roundType: string;
  status: string;
  lastHeartbeatAt: string | null;
  phases: Pick<PhaseRow, "phaseKey" | "status" | "startedAt" | "sequence">[];
  /** The puzzle's stage boxes (from getPuzzleStageProgress), or null. */
  stageProgress: StageProgress | null;
  /** When each puzzle stage started, by index; null entries for stages not reached. */
  stageStarts: (string | null)[] | null;
}

function stageText(labels: string[], index: number): string {
  const label = labels[index];
  const position = `${index + 1} of ${labels.length}`;
  return label === String(index + 1) ? `Stage ${position}` : `Stage ${label} (${position})`;
}

export function buildInterviewProgress(input: ProgressInput, now: Date = new Date()): InterviewProgress {
  if (input.roundType !== "DSA Review" || input.phases.length === 0) return { show: false };

  const state = input.status === "completed" ? "completed" : input.status === "in_progress" ? "running" : "not_started";
  const ordered = input.phases.slice().sort((a, b) => a.sequence - b.sequence);

  const parts: ProgressPart[] = ordered.map((p) => {
    let status: PartStatus = "pending";
    if (p.status === "completed") status = "done";
    else if (p.status === "skipped") status = "skipped";
    else if (p.status === "active") status = state === "running" ? "current" : state === "completed" ? "done" : "pending";
    return { key: p.phaseKey as PartKey, label: PART_LABEL[p.phaseKey as PartKey] || p.phaseKey, status, startedAt: state === "not_started" ? null : p.startedAt };
  });

  const sp = input.stageProgress;
  const puzzleStagesView: PuzzleStagesView | null = sp
    ? { ...sp, startedAt: sp.labels.map((_, i) => input.stageStarts?.[i] ?? null) }
    : null;

  let nowText: string | null = null;
  if (state === "running") {
    const active = parts.find((p) => p.status === "current");
    if (!active) nowText = "Wrapping up";
    else if (active.key === "puzzle" && sp && sp.current !== null) nowText = `Puzzle · ${stageText(sp.labels, sp.current)}`;
    else nowText = active.label;
  }

  let offlineSeconds: number | null = null;
  if (state === "running" && input.lastHeartbeatAt) {
    const seconds = Math.round((now.getTime() - new Date(input.lastHeartbeatAt).getTime()) / 1000);
    if (seconds > OFFLINE_AFTER_SECONDS) offlineSeconds = seconds;
  }

  return { show: true, state, now: nowText, offlineSeconds, parts, puzzleStages: puzzleStagesView };
}

/**
 * When each puzzle stage started: stage 1 when the puzzle part started, each later stage at the first accepted
 * "stage" event naming it.
 */
export function stageStartTimes(labels: string[], puzzleStartedAt: string | null, events: { label: string; at: string }[]): (string | null)[] {
  const starts: (string | null)[] = labels.map(() => null);
  if (labels.length) starts[0] = puzzleStartedAt;
  for (const e of events) {
    const i = stageIndexOf(labels.map((label) => ({ label, questionMd: "" })), e.label);
    if (i > 0 && !starts[i]) starts[i] = e.at;
  }
  return starts;
}

/** Reads and builds the card for one interview of the caller's organisation; null when it does not exist there. */
export async function loadInterviewProgress(interviewId: string, orgId: string | null | undefined): Promise<InterviewProgress | null> {
  const { rows } = await pool.query("SELECT org_id, status, round_type, last_heartbeat_at FROM interviews WHERE id = $1", [interviewId]);
  const row = rows[0];
  if (!row) return null;
  if (row.org_id && orgId && row.org_id !== orgId) return null;
  if (row.round_type !== "DSA Review") return { show: false };

  const phases = await getPhases(interviewId);
  const stageProgress = await getPuzzleStageProgress(interviewId, phases);

  let stageStarts: (string | null)[] | null = null;
  if (stageProgress) {
    const puzzle = phases.find((p) => p.phaseKey === "puzzle");
    const labels = puzzleStages((puzzle?.config as PuzzlePhaseConfig | undefined)?.selected?.runbook).map((s) => s.label);
    const ev = await pool.query(
      "SELECT payload->>'label' AS label, created_at FROM interview_events WHERE interview_id = $1 AND phase_key = 'puzzle' AND type = 'stage' ORDER BY id",
      [interviewId]
    );
    stageStarts = stageStartTimes(labels, puzzle?.startedAt ?? null, ev.rows.map((r) => ({ label: r.label, at: new Date(r.created_at).toISOString() })));
  }

  return buildInterviewProgress({
    roundType: row.round_type,
    status: row.status,
    lastHeartbeatAt: row.last_heartbeat_at ? new Date(row.last_heartbeat_at).toISOString() : null,
    phases,
    stageProgress,
    stageStarts,
  });
}
