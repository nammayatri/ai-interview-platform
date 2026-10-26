// Server side: the settings that apply to one interview. A batch interview reads its batch's stored settings, any
// other interview uses the defaults. Read on every call (one small query) so a change by an admin reaches interviews
// that are already running.
import { pool } from "./db";
import { normalizeBatchSettings, type BatchSettings } from "./batch-settings";

export async function getInterviewSettings(interviewId: string): Promise<BatchSettings> {
  try {
    const { rows } = await pool.query(
      "SELECT b.settings FROM interviews i JOIN interview_batches b ON b.id = i.batch_id WHERE i.id = $1",
      [interviewId]
    );
    return normalizeBatchSettings(rows[0]?.settings);
  } catch (err: any) {
    // 42P01 / 42703: migration 006 or 008 has not been applied yet. Interviews must keep working until it is.
    if (err?.code === "42P01" || err?.code === "42703") return normalizeBatchSettings(undefined);
    console.error("[Settings] Could not read the batch settings, using the defaults:", err?.message || err);
    return normalizeBatchSettings(undefined);
  }
}
