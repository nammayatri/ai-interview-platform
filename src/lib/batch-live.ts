// Live view of the interviews that are running in a batch: which stage each candidate is in, how far they got, whether
// they are still connected, and their proctoring strikes. Read-only; three small queries for the whole batch.
import { pool } from "./db";
import { STRIKE_WEIGHT_SQL } from "./store";

export interface LiveStatus {
  /** The phases of this interview in order, with their status (pending | active | completed | skipped). */
  phases: { key: string; status: string }[];
  /** The phase running now (parta | dsa | puzzle), or null. */
  currentPhase: string | null;
  /** The puzzle stage the interviewer last presented (1, 1B, 2, BONUS, 3 ...), or null. */
  stage: string | null;
  hintsUsed: number;
  lastMessageAt: string | null;
  /** Seconds since the candidate's browser last checked in. */
  secondsSinceHeartbeat: number | null;
  strikes: number;
}

export async function loadLiveStatus(interviewIds: string[], disabledTypes: string[]): Promise<Map<string, LiveStatus>> {
  const out = new Map<string, LiveStatus>();
  if (interviewIds.length === 0) return out;
  const [phases, stages, activity, strikes] = await Promise.all([
    pool.query(
      `SELECT interview_id, phase_key, status, sequence, jsonb_array_length(hints_used) AS hints
       FROM interview_phases WHERE interview_id = ANY($1::uuid[]) ORDER BY interview_id, sequence`,
      [interviewIds]
    ).catch(() => ({ rows: [] as any[] })),
    pool.query(
      `SELECT DISTINCT ON (interview_id, phase_key) interview_id, phase_key, payload->>'label' AS label
       FROM interview_events WHERE interview_id = ANY($1::uuid[]) AND type = 'stage'
       ORDER BY interview_id, phase_key, id DESC`,
      [interviewIds]
    ).catch(() => ({ rows: [] as any[] })),
    pool.query(
      `SELECT i.id, i.last_heartbeat_at, (SELECT max(t.created_at) FROM transcript_entries t WHERE t.interview_id = i.id) AS last_message_at
       FROM interviews i WHERE i.id = ANY($1::uuid[])`,
      [interviewIds]
    ),
    pool.query(
      `SELECT interview_id, COALESCE(SUM(${STRIKE_WEIGHT_SQL}), 0) AS strikes
       FROM proctoring_events WHERE interview_id = ANY($1::uuid[]) AND severity = 'flag' AND NOT (type = ANY($2::text[]))
       GROUP BY interview_id`,
      [interviewIds, disabledTypes]
    ),
  ]);

  for (const id of interviewIds) out.set(id, { phases: [], currentPhase: null, stage: null, hintsUsed: 0, lastMessageAt: null, secondsSinceHeartbeat: null, strikes: 0 });
  for (const r of phases.rows) {
    const live = out.get(r.interview_id);
    if (!live) continue;
    live.phases.push({ key: r.phase_key, status: r.status });
    live.hintsUsed += Number(r.hints ?? 0);
    if (r.status === "active") live.currentPhase = r.phase_key;
  }
  for (const r of stages.rows) {
    const live = out.get(r.interview_id);
    if (live && live.currentPhase === r.phase_key) live.stage = r.label || null;
  }
  for (const r of activity.rows) {
    const live = out.get(r.id);
    if (!live) continue;
    live.lastMessageAt = r.last_message_at ? new Date(r.last_message_at).toISOString() : null;
    live.secondsSinceHeartbeat = r.last_heartbeat_at ? Math.max(0, Math.round((Date.now() - new Date(r.last_heartbeat_at).getTime()) / 1000)) : null;
  }
  for (const r of strikes.rows) {
    const live = out.get(r.interview_id);
    if (live) live.strikes = Math.round(parseFloat(r.strikes) * 100) / 100;
  }
  return out;
}
