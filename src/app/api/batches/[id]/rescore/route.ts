// Re-scores the candidates of a batch that finished but have no scorecard (scoring failed or got stuck), without
// touching the ones that already have one. Scoring runs in the background on this pod, a few at a time.
import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { isUuid } from "@/lib/content-api";
import { requireRole } from "@/lib/rbac";
import { getInterview } from "@/lib/store";
import { startScoring } from "@/lib/scoring-tracker";
import { runScoring } from "@/lib/scoring/background";
import { closePhasesOnEnd, getPhases } from "@/lib/phase-store";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(req, ["admin", "interviewer"]);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { rows: owner } = await pool.query("SELECT 1 FROM interview_batches WHERE id = $1 AND org_id = $2", [id, auth.user.orgId]);
  if (owner.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { rows } = await pool.query(
    `SELECT i.id FROM interviews i
     WHERE i.batch_id = $1 AND i.status = 'completed' AND i.scorecard IS NULL
       AND EXISTS (SELECT 1 FROM transcript_entries t WHERE t.interview_id = i.id)
       AND (i.scoring_status IS NULL OR i.scoring_status <> 'generating' OR i.scoring_started_at < NOW() - INTERVAL '20 minutes')
     ORDER BY i.ended_at`,
    [id]
  );

  let started = 0;
  for (const r of rows) {
    if (!(await startScoring(r.id))) continue; // someone else got there first
    started++;
    // Fire and forget: each run reads its own interview, so this request returns right away.
    void (async () => {
      try {
        const interview = await getInterview(r.id);
        if (interview?.roundType === "DSA Review") {
          await closePhasesOnEnd(r.id);
          interview.phases = await getPhases(r.id);
        }
        await runScoring(r.id, interview ?? undefined, { notify: false });
      } catch (err) {
        console.error(`[Batch rescore] ${r.id}:`, err);
      }
    })();
  }
  return NextResponse.json({ started, found: rows.length }, { status: 202 });
}
