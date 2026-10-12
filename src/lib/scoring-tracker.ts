import { pool } from "./db";

export async function startScoring(interviewId: string): Promise<boolean> {
  // Atomic check-and-set: only succeeds if not already generating
  // Also allows retry if stuck in 'generating' for >20 minutes (reasoning-model scoring of a long interview takes minutes) (server crash recovery)
  const { rowCount } = await pool.query(
    `UPDATE interviews SET scoring_status = 'generating', scoring_started_at = NOW()
     WHERE id = $1 AND (
       scoring_status IS NULL
       OR scoring_status != 'generating'
       OR scoring_started_at < NOW() - INTERVAL '20 minutes'
     )`,
    [interviewId]
  );
  return (rowCount ?? 0) > 0;
}

export async function completeScoring(interviewId: string): Promise<void> {
  await pool.query(
    "UPDATE interviews SET scoring_status = 'completed' WHERE id = $1",
    [interviewId]
  );
}

export async function failScoring(interviewId: string, error: string): Promise<void> {
  await pool.query(
    "UPDATE interviews SET scoring_status = 'failed' WHERE id = $1",
    [interviewId]
  );
  console.error(`[Scoring] Failed for ${interviewId}: ${error}`);
}

export async function getScoringStatus(interviewId: string): Promise<{ status: string }> {
  const { rows } = await pool.query(
    "SELECT scoring_status, scoring_started_at, scorecard IS NOT NULL as has_scorecard FROM interviews WHERE id = $1",
    [interviewId]
  );
  if (rows.length === 0) return { status: "not_found" };
  // A rescore regenerates a scorecard that already exists: while it runs, report "generating", not "completed".
  if (rows[0].scoring_status === "generating" && rows[0].scoring_started_at) {
    const elapsed = Date.now() - new Date(rows[0].scoring_started_at).getTime();
    if (elapsed <= 20 * 60 * 1000) return { status: "generating" };
    // stuck for more than 20 minutes: server crash recovery
    return rows[0].has_scorecard ? { status: "completed" } : { status: "failed" };
  }
  if (rows[0].has_scorecard) return { status: "completed" };

  return { status: rows[0].scoring_status || "not_started" };
}
