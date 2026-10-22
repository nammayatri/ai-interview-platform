import { pool } from "./db";
import { batchPhase, batchWindow } from "./batches";
import { stagesDuration } from "./runbook";
import { INVITE_COUNT_SQL } from "./batch-invites";

/** A batch row from the database, shaped for the admin screens. */
/** The public link is /join/<code>; the screens add the site address from the browser (the server only sees its internal host). */
export function mapBatch(r: any) {
  const timing = { startsAt: r.starts_at, opensBeforeMin: r.opens_before_min, lateEntryMin: r.late_entry_min, isClosed: r.is_closed };
  const w = batchWindow(timing);
  return {
    id: r.id,
    name: r.name,
    joinCode: r.join_code,
    joinPath: `/join/${r.join_code}`,
    templateId: r.template_id,
    templateName: r.template_name,
    stages: r.stages,
    level: r.level,
    role: r.role,
    startsAt: new Date(w.startsAt).toISOString(),
    opensAt: new Date(w.opensAt).toISOString(),
    closesAt: new Date(w.closesAt).toISOString(),
    opensBeforeMin: r.opens_before_min,
    lateEntryMin: r.late_entry_min,
    maxCandidates: r.max_candidates,
    isClosed: r.is_closed,
    phase: batchPhase(timing),
    isArchived: r.is_archived === true,
    durationMin: stagesDuration(r.stages || []),
    createdByName: r.created_by_name || null,
    invited: Number(r.invited ?? 0),
    emailsSent: Number(r.emails_sent ?? 0),
    emailsFailed: Number(r.emails_failed ?? 0),
    invitedLoggedIn: Number(r.invited_logged_in ?? 0),
    registered: Number(r.registered ?? 0),
    started: Number(r.started ?? 0),
    completed: Number(r.completed ?? 0),
    createdAt: r.created_at?.toISOString?.() ?? r.created_at,
  };
}

export interface InterviewBatchInfo {
  name: string;
  phase: "not_open" | "open" | "live" | "closed";
  startsAt: string;
  closesAt: string;
  serverNow: string;
}

/** The batch an interview was registered through, with the live phase; null for an ordinary interview. */
export async function getInterviewBatch(interviewId: string, now: number = Date.now()): Promise<InterviewBatchInfo | null> {
  let rows: any[];
  try {
    ({ rows } = await pool.query(
      `SELECT b.name, b.starts_at, b.opens_before_min, b.late_entry_min, b.is_closed
       FROM interviews i JOIN interview_batches b ON b.id = i.batch_id WHERE i.id = $1`,
      [interviewId]
    ));
  } catch (err: any) {
    // 42P01 / 42703: migration 006 has not been applied yet. Ordinary interviews must keep working until it is.
    if (err?.code === "42P01" || err?.code === "42703") return null;
    throw err;
  }
  if (rows.length === 0) return null;
  const r = rows[0];
  const timing = { startsAt: r.starts_at, opensBeforeMin: r.opens_before_min, lateEntryMin: r.late_entry_min, isClosed: r.is_closed };
  const w = batchWindow(timing);
  return { name: r.name, phase: batchPhase(timing, now), startsAt: new Date(w.startsAt).toISOString(), closesAt: new Date(w.closesAt).toISOString(), serverNow: new Date(now).toISOString() };
}

const BASE_COUNTS = `
  (SELECT count(*) FROM interviews i WHERE i.batch_id = b.id) AS registered,
  (SELECT count(*) FROM interviews i WHERE i.batch_id = b.id AND i.status <> 'waiting') AS started,
  (SELECT count(*) FROM interviews i WHERE i.batch_id = b.id AND i.status = 'completed') AS completed`;

/** Batches with their counts. Falls back to the older shape until migration 007 (invites, archive) has been applied. */
export async function queryBatches(where: string, params: unknown[], tail = ""): Promise<any[]> {
  const run = (extra: string, creator: boolean) =>
    pool.query(`SELECT b.*, ${creator ? "(SELECT u.name FROM users u WHERE u.id = b.created_by) AS created_by_name," : ""} ${BASE_COUNTS}${extra} FROM interview_batches b WHERE ${where} ${tail}`, params);
  try {
    return (await run(`,${INVITE_COUNT_SQL}`, true)).rows;
  } catch (err: any) {
    if (err?.code !== "42P01" && err?.code !== "42703") throw err;
    return (await run("", true)).rows;
  }
}
