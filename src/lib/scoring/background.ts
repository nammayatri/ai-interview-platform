import { getInterview, updateInterview } from "../store";
import { startScoring, completeScoring, failScoring } from "../scoring-tracker";
import { buildScorecard } from "./run-scoring";
import { closePhasesOnEnd } from "../phase-store";

/** Scores a finished interview and notifies its creator. Safe to call more than once. */
export async function scoreInterviewInBackground(id: string, interview?: any): Promise<void> {
  if (!(await startScoring(id))) return;
  try {
    const source = interview ?? (await getInterview(id));
    if (!source) throw new Error("Interview not found");
    console.log(`[Auto-Score] Generating scorecard for interview ${id}...`);
    const scorecard = await buildScorecard(source);
    await updateInterview(id, { scorecard });
    await completeScoring(id);
    console.log(`[Auto-Score] Scorecard saved for interview ${id}`);

    try {
      const { pool } = await import("../db");
      const { sendInterviewComplete } = await import("../email");
      const { rows: userRows } = await pool.query(
        "SELECT u.email, u.name FROM users u JOIN interviews i ON u.id = i.created_by WHERE i.id = $1",
        [id]
      );
      if (userRows.length > 0 && userRows[0].email) {
        const reviewUrl = `${process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL}/review/${id}`;
        const candidateLabel = source.candidateName || source.candidateEmail || "A candidate";
        await sendInterviewComplete(userRows[0].email, userRows[0].name || "", candidateLabel, reviewUrl);
      }
    } catch (emailErr) {
      console.error("[Auto-Score] Failed to send notification email:", emailErr);
    }
  } catch (err) {
    await failScoring(id, (err as Error).message);
    console.error(`[Auto-Score] Failed for interview ${id}:`, err);
  }
}

/** Marks the interview completed, closes any DSA phases and schedules scoring 3s later (lets transcript saves land). */
export async function finishInterview(id: string, roundType?: string): Promise<void> {
  await updateInterview(id, { status: "completed", endedAt: new Date().toISOString() });
  if (roundType === "DSA Review") await closePhasesOnEnd(id);
  setTimeout(async () => {
    try {
      const fresh = await getInterview(id);
      if (fresh && fresh.transcript.length > 0 && !fresh.scorecard) await scoreInterviewInBackground(id, fresh);
    } catch (err) {
      console.error(`[Auto-Score] Failed to fetch interview ${id}:`, err);
    }
  }, 3000);
}
