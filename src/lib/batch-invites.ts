// Batch invitations: saving a candidate list for a batch, emailing each person the link and times, and reporting where
// each one is (invited, email sent or failed, logged in, started, completed).
import { pool } from "./db";
import { batchWindow } from "./batches";
import { sendBatchInvite } from "./email";
import { stagesDuration } from "./runbook";

export type InviteStatus = "invited" | "email_sent" | "email_failed" | "logged_in" | "started" | "completed";

/** The public site address, for links in emails (the server only sees its internal host). */
export function siteBase(req: Request): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL;
  if (configured) return configured.replace(/\/+$/, "");
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "localhost:3000";
  const proto = req.headers.get("x-forwarded-proto") || (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/** One person's progress, from what the invite and their interview (if any) say. */
export function inviteStatus(r: { email_status: string; interview_status?: string | null; started_at?: unknown; interview_id?: string | null }): InviteStatus {
  if (r.interview_id) {
    if (r.interview_status === "completed") return "completed";
    if (r.started_at || (r.interview_status && r.interview_status !== "waiting")) return "started";
    return "logged_in";
  }
  if (r.email_status === "sent") return "email_sent";
  if (r.email_status === "failed") return "email_failed";
  return "invited";
}

export async function listInvites(batchId: string) {
  const { rows } = await pool.query(
    `SELECT v.id, v.email, v.name, v.email_status, v.email_sent_at, v.email_error, v.email_attempts, v.created_at,
            i.id AS interview_id, i.status AS interview_status, i.created_at AS registered_at, i.started_at, i.ended_at
     FROM interview_batch_invites v
     LEFT JOIN interviews i ON i.batch_id = v.batch_id AND lower(i.candidate_email) = lower(v.email)
     WHERE v.batch_id = $1 ORDER BY v.created_at ASC, v.email ASC LIMIT 5000`,
    [batchId]
  );
  return rows.map((r) => ({
    id: r.id as string,
    email: r.email as string,
    name: r.name as string,
    emailStatus: r.email_status as string,
    emailSentAt: r.email_sent_at?.toISOString?.() ?? null,
    emailError: (r.email_error as string | null) || null,
    emailAttempts: Number(r.email_attempts ?? 0),
    invitedAt: r.created_at?.toISOString?.() ?? r.created_at,
    interviewId: (r.interview_id as string | null) || null,
    registeredAt: r.registered_at?.toISOString?.() ?? null,
    startedAt: r.started_at?.toISOString?.() ?? null,
    endedAt: r.ended_at?.toISOString?.() ?? null,
    status: inviteStatus(r),
  }));
}

/** Saves the rows (an email already invited to this batch is skipped) and returns what was added. */
export async function addInvites(batchId: string, rows: Array<{ email: string; name: string }>) {
  const added: Array<{ id: string; email: string; name: string }> = [];
  const existing: string[] = [];
  for (const r of rows) {
    const { rows: ins } = await pool.query(
      `INSERT INTO interview_batch_invites (batch_id, email, name) VALUES ($1,$2,$3)
       ON CONFLICT (batch_id, lower(email)) DO NOTHING RETURNING id, email, name`,
      [batchId, r.email, r.name]
    );
    if (ins[0]) added.push(ins[0]); else existing.push(r.email);
  }
  return { added, existing };
}

interface BatchForEmail { id: string; name: string; org_id: string; join_code: string; starts_at: Date; opens_before_min: number; late_entry_min: number; is_closed: boolean; stages: any }

/** Emails the given invites (a few at a time) and records sent or failed for each. Never throws for one bad address. */
export async function sendInviteEmails(batch: BatchForEmail, invites: Array<{ id: string; email: string; name: string }>, base: string) {
  const { rows: org } = await pool.query("SELECT name FROM organizations WHERE id = $1", [batch.org_id]);
  const w = batchWindow({ startsAt: batch.starts_at, opensBeforeMin: batch.opens_before_min, lateEntryMin: batch.late_entry_min, isClosed: batch.is_closed });
  const durationMin = stagesDuration(batch.stages || []);
  const joinUrl = `${base}/join/${batch.join_code}`;
  const results: Array<{ id: string; email: string; ok: boolean; error?: string }> = [];

  let next = 0;
  const worker = async () => {
    while (next < invites.length) {
      const inv = invites[next++];
      try {
        await sendBatchInvite({
          to: inv.email, name: inv.name, batchName: batch.name, joinUrl,
          startsAt: new Date(w.startsAt), opensAt: new Date(w.opensAt), closesAt: new Date(w.closesAt), durationMin, orgName: org[0]?.name,
        });
        await pool.query("UPDATE interview_batch_invites SET email_status='sent', email_sent_at=NOW(), email_error=NULL, email_attempts=email_attempts+1 WHERE id=$1", [inv.id]);
        results.push({ id: inv.id, email: inv.email, ok: true });
      } catch (err) {
        const msg = String((err as Error)?.message || err).slice(0, 500);
        await pool.query("UPDATE interview_batch_invites SET email_status='failed', email_error=$2, email_attempts=email_attempts+1 WHERE id=$1", [inv.id, msg]);
        results.push({ id: inv.id, email: inv.email, ok: false, error: msg });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(5, invites.length) }, worker));
  return results;
}

/** The counts shown on the batch list and detail pages. */
export const INVITE_COUNT_SQL = `
  (SELECT count(*) FROM interview_batch_invites v WHERE v.batch_id = b.id) AS invited,
  (SELECT count(*) FROM interview_batch_invites v WHERE v.batch_id = b.id AND v.email_status = 'sent') AS emails_sent,
  (SELECT count(*) FROM interview_batch_invites v WHERE v.batch_id = b.id AND v.email_status = 'failed') AS emails_failed,
  (SELECT count(*) FROM interview_batch_invites v JOIN interviews i ON i.batch_id = v.batch_id AND lower(i.candidate_email) = lower(v.email) WHERE v.batch_id = b.id) AS invited_logged_in`;
