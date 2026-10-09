// Database side of the phase engine: loading phases/submissions, logging events and
// running phase transitions. All timing decisions are delegated to phase-engine.ts.
import type { Pool, PoolClient } from "pg";
import { pool } from "./db";
import {
  CLOSE_RESERVE_MIN,
  selectDsaProblem,
  selectPuzzle,
  type EndReason,
  type HintUse,
  type PhaseKey,
  type PhaseRow,
} from "./phase-engine";
import type { DsaPhaseConfig, PuzzlePhaseConfig, SubmissionInput } from "./runbook";

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
    scratchpad: r.scratchpad || "",
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

/** Inserts the Part A submission. Must run inside the caller's transaction. */
export async function insertSubmission(client: PoolClient, interviewId: string, problemId: string, s: SubmissionInput): Promise<string> {
  const { rows } = await client.query(
    `INSERT INTO submissions (interview_id, problem_id, problem_title, language, code, outcome, score, tests_passed, tests_total, external_url, notes, is_primary)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true) RETURNING id`,
    [interviewId, problemId, s.problemTitle, s.language || null, s.code, s.outcome, s.score ?? null, s.testsPassed ?? null, s.testsTotal ?? null, s.externalUrl || null, s.notes || null]
  );
  return rows[0].id;
}

export interface PhaseInsert {
  phaseKey: PhaseKey;
  budgetMin: number;
  graceMin: number;
  earlyDoneAfterMin: number | null;
  weight: number;
  config: unknown;
}

/** Inserts one pending phase row per stage, numbered in the order given. Must run inside the caller's transaction. */
export async function insertPhaseRows(client: PoolClient, interviewId: string, phases: PhaseInsert[]): Promise<void> {
  let seq = 1;
  for (const p of phases) {
    await client.query(
      `INSERT INTO interview_phases (interview_id, phase_key, sequence, status, budget_min, grace_min, early_done_after_min, config, score_weight)
       VALUES ($1, $2, $3, 'pending', $4, $5, $6, $7, $8)`,
      [interviewId, p.phaseKey, seq++, p.budgetMin, p.graceMin, p.earlyDoneAfterMin, JSON.stringify(p.config), p.weight]
    );
  }
}

// ─── Transitions ────────────────────────────────────────────────────────────

/**
 * Activates the first pending phase that can run (choosing its random item, capping its time to what is left),
 * skipping any that cannot. Shared by interview start and every later transition.
 * Returns the key of the phase that became active, or null when nothing is left to run.
 */
async function activateNext(
  client: PoolClient,
  interviewId: string,
  pending: PhaseRow[],
  now: Date,
  remainingTotalMin: number,
  skipped: PhaseTransition["skipped"]
): Promise<PhaseKey | null> {
  for (const next of pending.slice().sort((a, b) => a.sequence - b.sequence)) {
    const remainingForPhase = remainingTotalMin - CLOSE_RESERVE_MIN;
    if (remainingForPhase < Math.max(1, next.minRemainingMin ?? 0)) {
      await skipPhase(client, interviewId, next, "skipped_no_time", now);
      skipped.push({ key: next.phaseKey, reason: "skipped_no_time" });
      continue;
    }
    // The stage time the interviewer set, capped by what the interview has left.
    const budget = Math.max(1, Math.min(next.budgetMin ?? Math.floor(remainingForPhase), Math.floor(remainingForPhase)));
    let config: unknown = next.config;
    let selectedPuzzleId: string | null = null;

    if (next.phaseKey === "dsa") {
      const cfg = next.config as DsaPhaseConfig;
      const picked = selectDsaProblem(cfg.pool, `${interviewId}:dsa`, cfg.selection);
      if (!picked) {
        await skipPhase(client, interviewId, next, "skipped_no_pool", now);
        skipped.push({ key: next.phaseKey, reason: "skipped_no_pool" });
        continue;
      }
      config = { ...cfg, selected: { problemId: picked.problemId, title: picked.title, runbook: picked.runbook } } satisfies DsaPhaseConfig;
      await logEvent(client, interviewId, "dsa", "problem_selected", { problemId: picked.problemId, title: picked.title });
    } else if (next.phaseKey === "puzzle") {
      const cfg = next.config as PuzzlePhaseConfig;
      const picked = selectPuzzle(cfg.pool, budget, interviewId, cfg.selection);
      if (!picked) {
        await skipPhase(client, interviewId, next, "skipped_no_pool", now);
        skipped.push({ key: next.phaseKey, reason: "skipped_no_pool" });
        continue;
      }
      config = { ...cfg, selected: { puzzleId: picked.puzzleId, title: picked.title, runbook: picked.runbook } } satisfies PuzzlePhaseConfig;
      selectedPuzzleId = picked.puzzleId;
      await logEvent(client, interviewId, "puzzle", "puzzle_selected", { puzzleId: picked.puzzleId, title: picked.title });
    }

    await client.query(
      `UPDATE interview_phases SET status = 'active', started_at = $2, budget_min = $3, selected_puzzle_id = $4, config = $5 WHERE id = $1`,
      [next.id, now, budget, selectedPuzzleId, JSON.stringify(config)]
    );
    await logEvent(client, interviewId, next.phaseKey, "phase_start", { budgetMin: budget });
    return next.phaseKey;
  }
  return null;
}

/** Activates the first stage when the interview starts. Idempotent. */
export async function activateFirstPhase(interviewId: string, now: Date = new Date()): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: iv } = await client.query("SELECT duration FROM interviews WHERE id = $1 FOR UPDATE", [interviewId]);
    const phases = await getPhases(interviewId, client);
    if (iv.length === 0 || phases.length === 0 || phases.some((p) => p.status !== "pending")) {
      await client.query("ROLLBACK");
      return false;
    }
    await activateNext(client, interviewId, phases, now, iv[0].duration, []);
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
 * Completes the active phase and activates (or skips) the next ones, in one transaction.
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

    // Each stage keeps its own scratchpad: snapshot it onto the finished phase, then start the next one empty.
    await client.query(
      `UPDATE interview_phases SET status = 'completed', ended_at = $2, end_reason = $3,
         scratchpad = (SELECT COALESCE(scratchpad, '') FROM interviews WHERE id = $4) WHERE id = $1`,
      [active.id, now, reason, interviewId]
    );
    await client.query("UPDATE interviews SET scratchpad = '' WHERE id = $1", [interviewId]);
    await logEvent(client, interviewId, active.phaseKey, "phase_end", { reason, elapsedMin: round1(elapsedMin) });
    if (reason === "forced") await logEvent(client, interviewId, active.phaseKey, "forced_transition", {});

    const transition: PhaseTransition = { from: active.phaseKey, to: null, reason, skipped: [] };
    const pending = phases.filter((p) => p.status === "pending");
    transition.to = await activateNext(client, interviewId, pending, now, remainingTotalMin, transition.skipped);

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
        await client.query(
          `UPDATE interview_phases SET status = 'completed', ended_at = $2, end_reason = 'interview_end',
             scratchpad = (SELECT COALESCE(scratchpad, '') FROM interviews WHERE id = $3) WHERE id = $1`,
          [p.id, now, interviewId]
        );
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

