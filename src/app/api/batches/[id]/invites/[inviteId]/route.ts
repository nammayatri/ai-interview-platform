import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { isUuid } from "@/lib/content-api";
import { requireRole } from "@/lib/rbac";

// Removes an invitation that has not been used. Someone who already logged in keeps their interview.
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string; inviteId: string }> }) {
  const auth = await requireRole(req, ["admin", "interviewer"]);
  if (auth instanceof NextResponse) return auth;
  const { id, inviteId } = await params;
  if (!isUuid(id) || !isUuid(inviteId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { rows } = await pool.query(
    `DELETE FROM interview_batch_invites v USING interview_batches b
     WHERE v.id = $1 AND v.batch_id = b.id AND b.id = $2 AND b.org_id = $3 RETURNING v.id`,
    [inviteId, id, auth.user.orgId]
  );
  if (rows.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
