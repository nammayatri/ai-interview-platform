import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { isUuid } from "@/lib/content-api";
import { requireRole } from "@/lib/rbac";
import { listInvites, sendInviteEmails, siteBase } from "@/lib/batch-invites";
import { rateLimit } from "@/lib/rate-limit";

// Sends (or re-sends) invitation emails. With inviteIds: those people. Without: everyone whose email is not sent yet.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(req, ["admin", "interviewer"]);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!rateLimit(`invite-send:${auth.user.id}:${ip}`, 10, 60000)) return NextResponse.json({ error: "Too many requests. Try again in a minute." }, { status: 429 });
  const { rows: b } = await pool.query("SELECT * FROM interview_batches WHERE id = $1 AND org_id = $2", [id, auth.user.orgId]);
  if (b.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const ids: string[] | null = Array.isArray(body?.inviteIds) ? body.inviteIds.filter((x: unknown) => typeof x === "string" && isUuid(x)) : null;

  const { rows: targets } = ids
    ? await pool.query("SELECT id, email, name FROM interview_batch_invites WHERE batch_id = $1 AND id = ANY($2::uuid[])", [id, ids])
    : await pool.query("SELECT id, email, name FROM interview_batch_invites WHERE batch_id = $1 AND email_status <> 'sent'", [id]);
  if (targets.length === 0) return NextResponse.json({ error: "There is nobody to send to." }, { status: 400 });
  const results = await sendInviteEmails(b[0], targets, siteBase(req));
  return NextResponse.json({
    sent: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    firstError: results.find((r) => !r.ok)?.error || null,
    invites: await listInvites(id),
  });
}
