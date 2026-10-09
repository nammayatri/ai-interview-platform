// Database side of the phase engine: loading phases/submissions, logging events and
// running phase transitions. All timing decisions are delegated to phase-engine.ts.
import type { Pool, PoolClient } from "pg";
import { pool } from "./db";
import {
  CLOSE_RESERVE_MIN,
  selectPuzzle,
  type EndReason,
  type HintUse,
  type PhaseKey,
  type PhaseRow,
} from "./phase-engine";
import {
  DEFAULT_PHASE_WEIGHTS,
  type DsaPhaseConfig,
  type PhasePlan,
  type PuzzlePhaseConfig,
  type SubmissionInput,
  type ProblemRunbook,
  type PuzzleRunbook,
  snapshotDsaConfig,
  snapshotPuzzleConfig,
} from "./runbook";

type Db = Pool | PoolClient;

export interface Submission {
  id: string;
  problemId: string | null;
  problemTitle: string;
  language: string;
  code: string;
  outcome: "passed" | "partial" | "failed";
  score: number | null;
  testsPassed: number | null;
  testsTotal: number | null;
  externalUrl: string;
  notes: string;
  isPrimary: boolean;
}

export interface PhaseTransition {
  from: PhaseKey;
  to: PhaseKey | null;
  reason: EndReason;
  skipped: Array<{ key: PhaseKey; reason: EndReason }>;
}

const iso = (d: any): string | null => (d ? new Date(d).toISOString() : null);

export function mapPhaseRow(r: any): PhaseRow {
  return {
    id: r.id,
    interviewId: r.interview_id,
    phaseKey: r.phase_key,
    sequence: r.sequence,
    status: r.status,
    budgetMin: r.budget_min,
    graceMin: r.grace_min ?? 0,
    earlyDoneAfterMin: r.early_done_after_min,
    minRemainingMin: r.min_remaining_min,
    startedAt: iso(r.started_at),
    endedAt: iso(r.ended_at),
    endReason: r.end_reason,
    config: r.config,
    selectedPuzzleId: r.selected_puzzle_id,
    hintsUsed: Array.isArray(r.hints_used) ? r.hints_used : [],
    weakAnswers: r.weak_answers ?? 0,
    scoreWeight: Number(r.score_weight ?? 1),
    scorecard: r.scorecard ?? null,
  };
}

export async function getPhases(interviewId: string, db: Db = pool): Promise<PhaseRow[]> {
  const { rows } = await db.query("SELECT * FROM interview_phases WHERE interview_id = $1 ORDER BY sequence ASC", [interviewId]);
  return rows.map(mapPhaseRow);
}

const num = (v: any): number | null => (v === null || v === undefined ? null : Number(v));

export function mapSubmissionRow(r: any): Submission {
  return {
    id: r.id,
    problemId: r.problem_id,
    problemTitle: r.problem_title,
    language: r.language || "",
    code: r.code,
    outcome: r.outcome,
    score: num(r.score),
    testsPassed: num(r.tests_passed),
    testsTotal: num(r.tests_total),
    externalUrl: r.external_url || "",
    notes: r.notes || "",
    isPrimary: r.is_primary,
  };
}

export async function getSubmissions(interviewId: string, db: Db = pool): Promise<Submission[]> {
  const { rows } = await db.query(
    "SELECT * FROM submissions WHERE interview_id = $1 ORDER BY is_primary DESC, created_at ASC",
    [interviewId]
  );
  return rows.map(mapSubmissionRow);
}

export async function logEvent(
  db: Db,
  interviewId: string,
  phaseKey: PhaseKey | null,
  type: string,
  payload: Record<string, any> = {}
): Promise<void> {
  await db.query("INSERT INTO interview_events (interview_id, phase_key, type, payload) VALUES ($1, $2, $3, $4)", [
    interviewId,
    phaseKey,
    type,
    JSON.stringify(payload),
  ]);
}

export async function getEvents(interviewId: string, types?: string[]) {
  const { rows } = await pool.query(
    `SELECT id, phase_key, type, payload, created_at FROM interview_events
     WHERE interview_id = $1 ${types ? "AND type = ANY($2)" : ""} ORDER BY id ASC`,
    types ? [interviewId, types] : [interviewId]
  );
  return rows.map((r) => ({ id: String(r.id), phaseKey: r.phase_key as PhaseKey | null, type: r.type as string, payload: r.payload, createdAt: iso(r.created_at) }));
}

export async function hasEvent(interviewId: string, phaseKey: PhaseKey, type: string): Promise<boolean> {
  const { rows } = await pool.query("SELECT 1 FROM interview_events WHERE interview_id = $1 AND phase_key = $2 AND type = $3 LIMIT 1", [interviewId, phaseKey, type]);
  return rows.length > 0;
}

// ─── Creation ───────────────────────────────────────────────────────────────

export interface ProblemSnapshotSource {
  id: string;
  version: number;
  title: string;
  runbook: ProblemRunbook;
}
export interface PuzzleSnapshotSource {
  id: string;
  version: number;
  title: string;
  runbook: PuzzleRunbook;
}

/** Inserts submissions and the two phase rows. Must run inside the caller's transaction. */
export async function insertDsaReviewRows(
  client: PoolClient,
  args: {
    interviewId: string;
    submissions: SubmissionInput[];
    problem: ProblemSnapshotSource;
    puzzles: PuzzleSnapshotSource[];
    plan: PhasePlan;
  }
): Promise<{ primarySubmissionId: string }> {
  const { interviewId, submissions, problem, puzzles, plan } = args;
  let primaryId = "";
  const contextIds: string[] = [];
  for (const s of submissions) {
    const { rows } = await client.query(
      `INSERT INTO submissions (interview_id, problem_id, problem_title, language, code, outcome, score, tests_passed, tests_total, external_url, notes, is_primary)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [
        interviewId,
        s.isPrimary ? problem.id : s.problemId || null,
        s.problemTitle,
        s.language || null,
        s.code,
        s.outcome,
        s.score ?? null,
        s.testsPassed ?? null,
        s.testsTotal ?? null,
        s.externalUrl || null,
        s.notes || null,
        s.isPrimary,
      ]
    );
    if (s.isPrimary) primaryId = rows[0].id;
    else contextIds.push(rows[0].id);
  }

  const w = plan.phaseWeights || DEFAULT_PHASE_WEIGHTS;
  const dsaConfig = snapshotDsaConfig(problem, primaryId, contextIds);
  await client.query(
    `INSERT INTO interview_phases (interview_id, phase_key, sequence, status, budget_min, grace_min, early_done_after_min, config, score_weight)
     VALUES ($1, 'dsa', 1, 'pending', $2, $3, $4, $5, $6)`,
    [interviewId, plan.dsaBudgetMin, plan.graceMin, plan.earlyDoneAfterMin, JSON.stringify(dsaConfig), w.dsa]
  );
  const puzzleConfig = snapshotPuzzleConfig(puzzles, plan.puzzleSelection);
  await client.query(
    `INSERT INTO interview_phases (interview_id, phase_key, sequence, status, grace_min, min_remaining_min, config, score_weight)
     VALUES ($1, 'puzzle', 2, 'pending', 0, $2, $3, $4)`,
    [interviewId, plan.puzzleMinRemainingMin, JSON.stringify(puzzleConfig), w.puzzle]
  );
  return { primarySubmissionId: primaryId };
}

// ─── Transitions ────────────────────────────────────────────────────────────

/** Activates the dsa phase when the interview starts. Idempotent. */
export async function activateFirstPhase(interviewId: string, now: Date = new Date()): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT id FROM interviews WHERE id = $1 FOR UPDATE", [interviewId]);
    const phases = await getPhases(interviewId, client);
    const first = phases[0];
    if (!first || phases.some((p) => p.status !== "pending")) {
      await client.query("ROLLBACK");
      return false;
    }
    await client.query("UPDATE interview_phases SET status = 'active', started_at = $2 WHERE id = $1", [first.id, now]);
    await logEvent(client, interviewId, first.phaseKey, "phase_start", { budgetMin: first.budgetMin });
    await client.query("COMMIT");
    return true;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Completes the active phase and activates (or skips) the next one, in one transaction.
 * Returns null when there is no active phase (or it is not the expected one), which makes
 * concurrent callers safe: only one of them performs the transition.
 */
export async function advancePhase(
  interviewId: string,
  reason: EndReason,
  opts: { expectedKey?: PhaseKey; now?: Date } = {}
): Promise<PhaseTransition | null> {
  const now = opts.now || new Date();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: iv } = await client.query("SELECT duration, started_at FROM interviews WHERE id = $1 FOR UPDATE", [interviewId]);
    if (iv.length === 0) {
      await client.query("ROLLBACK");
      return null;
    }
    const phases = await getPhases(interviewId, client);
    const active = phases.find((p) => p.status === "active");
    if (!active || (opts.expectedKey && active.phaseKey !== opts.expectedKey)) {
      await client.query("ROLLBACK");
      return null;
    }

    const startedMs = iv[0].started_at ? new Date(iv[0].started_at).getTime() : now.getTime();
    const remainingTotalMin = Math.max(0, iv[0].duration - (now.getTime() - startedMs) / 60000);
    const elapsedMin = active.startedAt ? (now.getTime() - new Date(active.startedAt).getTime()) / 60000 : 0;

    await client.query("UPDATE interview_phases SET status = 'completed', ended_at = $2, end_reason = $3 WHERE id = $1", [active.id, now, reason]);
    await logEvent(client, interviewId, active.phaseKey, "phase_end", { reason, elapsedMin: round1(elapsedMin) });
    if (reason === "forced") await logEvent(client, interviewId, active.phaseKey, "forced_transition", {});

    const transition: PhaseTransition = { from: active.phaseKey, to: null, reason, skipped: [] };
    const pending = phases.filter((p) => p.status === "pending").sort((a, b) => a.sequence - b.sequence);

    for (const next of pending) {
      if (next.phaseKey === "puzzle") {
        const cfg = next.config as PuzzlePhaseConfig;
        const remainingForPuzzle = remainingTotalMin - CLOSE_RESERVE_MIN;
        if (remainingForPuzzle < Math.max(1, next.minRemainingMin ?? 0)) {
          await skipPhase(client, interviewId, next, "skipped_no_time", now);
          transition.skipped.push({ key: "puzzle", reason: "skipped_no_time" });
          continue;
        }
        const picked = selectPuzzle(cfg.pool, remainingForPuzzle, interviewId, cfg.selection);
        if (!picked) {
          await skipPhase(client, interviewId, next, "skipped_no_pool", now);
          transition.skipped.push({ key: "puzzle", reason: "skipped_no_pool" });
          continue;
        }
        const budget = Math.max(1, Math.min(picked.runbook.expectedMin, Math.floor(remainingForPuzzle)));
        const newCfg: PuzzlePhaseConfig = { ...cfg, selected: { puzzleId: picked.puzzleId, title: picked.title, runbook: picked.runbook } };
        await client.query(
          `UPDATE interview_phases SET status = 'active', started_at = $2, budget_min = $3, grace_min = 0,
             selected_puzzle_id = $4, config = $5 WHERE id = $1`,
          [next.id, now, budget, picked.puzzleId, JSON.stringify(newCfg)]
        );
        await logEvent(client, interviewId, "puzzle", "puzzle_selected", { puzzleId: picked.puzzleId, title: picked.title });
        await logEvent(client, interviewId, "puzzle", "phase_start", { budgetMin: budget });
        transition.to = "puzzle";
        break;
      }
      await client.query("UPDATE interview_phases SET status = 'active', started_at = $2 WHERE id = $1", [next.id, now]);
      await logEvent(client, interviewId, next.phaseKey, "phase_start", { budgetMin: next.budgetMin });
      transition.to = next.phaseKey;
      break;
    }

    await client.query("COMMIT");
    return transition;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function skipPhase(client: PoolClient, interviewId: string, p: PhaseRow, reason: EndReason, now: Date) {
  await client.query("UPDATE interview_phases SET status = 'skipped', ended_at = $2, end_reason = $3 WHERE id = $1", [p.id, now, reason]);
  await logEvent(client, interviewId, p.phaseKey, "phase_end", { reason, skipped: true });
}

/** Called when the interview ends: active phase closes with interview_end, pending phases are skipped. */
export async function closePhasesOnEnd(interviewId: string, now: Date = new Date()): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT id FROM interviews WHERE id = $1 FOR UPDATE", [interviewId]);
    const phases = await getPhases(interviewId, client);
    for (const p of phases) {
      if (p.status === "active") {
        await client.query("UPDATE interview_phases SET status = 'completed', ended_at = $2, end_reason = 'interview_end' WHERE id = $1", [p.id, now]);
        await logEvent(client, interviewId, p.phaseKey, "phase_end", { reason: "interview_end" });
      } else if (p.status === "pending") {
        await skipPhase(client, interviewId, p, "interview_end", now);
      }
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ─── Per-turn bookkeeping ───────────────────────────────────────────────────

export async function incrementWeakAnswers(phaseId: string): Promise<void> {
  await pool.query("UPDATE interview_phases SET weak_answers = weak_answers + 1 WHERE id = $1", [phaseId]);
}

export async function appendHintUse(phaseId: string, use: HintUse): Promise<void> {
  await pool.query("UPDATE interview_phases SET hints_used = hints_used || $2::jsonb WHERE id = $1", [phaseId, JSON.stringify([use])]);
}

export async function savePhaseScorecard(phaseId: string, scorecard: any): Promise<void> {
  await pool.query("UPDATE interview_phases SET scorecard = $2 WHERE id = $1", [phaseId, JSON.stringify(scorecard)]);
}

export async function saveScratchpad(interviewId: string, content: string): Promise<void> {
  await pool.query("UPDATE interviews SET scratchpad = $2 WHERE id = $1", [interviewId, content]);
}

export async function getScratchpad(interviewId: string): Promise<string> {
  const { rows } = await pool.query("SELECT scratchpad FROM interviews WHERE id = $1", [interviewId]);
  return rows[0]?.scratchpad || "";
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export type { DsaPhaseConfig, PuzzlePhaseConfig };
