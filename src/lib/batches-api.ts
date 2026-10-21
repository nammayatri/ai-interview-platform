import { pool } from "./db";
import { batchPhase, batchWindow } from "./batches";

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
