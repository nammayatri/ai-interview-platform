import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { isUuid } from "@/lib/content-api";
import { requireRole } from "@/lib/rbac";
import { MAX_INVITE_ROWS, validateInviteRows } from "@/lib/bulk-parse";
import { addInvites, listInvites, sendInviteEmails, siteBase } from "@/lib/batch-invites";
import { rateLimit } from "@/lib/rate-limit";

// Adds candidates to a batch and (optionally) emails each one the link and the times.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(req, ["admin", "interviewer"]);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!rateLimit(`invite-add:${auth.user.id}:${ip}`, 10, 60000)) return NextResponse.json({ error: "Too many requests. Try again in a minute." }, { status: 429 });

  const { rows: b } = await pool.query("SELECT * FROM interview_batches WHERE id = $1 AND org_id = $2", [id, auth.user.orgId]);
  if (b.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await req.json().catch(() => null);
  const input = Array.isArray(body?.rows) ? body.rows.slice(0, MAX_INVITE_ROWS + 1) : [];
  if (input.length === 0) return NextResponse.json({ error: "There are no candidates to add." }, { status: 400 });
  if (input.length > MAX_INVITE_ROWS) return NextResponse.json({ error: `Add up to ${MAX_INVITE_ROWS} candidates at a time.` }, { status: 400 });

  // Validated again here: the browser's check is a convenience, not a guarantee.
  const rows = validateInviteRows(input.map((r: any, i: number) => ({ rowNumber: Number(r?.rowNumber) || i + 2, email: String(r?.email ?? ""), name: String(r?.name ?? "") })));
  const good = rows.filter((r) => r.errors.length === 0);
  const skippedInvalid = rows.length - good.length;
  const { added, existing } = await addInvites(id, good.map((r) => ({ email: r.email, name: r.name })));

  let emails: Array<{ id: string; email: string; ok: boolean; error?: string }> = [];
  if (body?.sendEmail === true && added.length > 0) emails = await sendInviteEmails(b[0], added, siteBase(req));
  return NextResponse.json({
    added: added.length,
    alreadyInvited: existing.length,
    invalid: skippedInvalid,
    emailsSent: emails.filter((e) => e.ok).length,
    emailsFailed: emails.filter((e) => !e.ok).length,
    firstEmailError: emails.find((e) => !e.ok)?.error || null,
    invites: await listInvites(id),
  });
}
