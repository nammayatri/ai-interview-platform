import { NextResponse } from "next/server";
import { requireRole } from "@/lib/rbac";
import { getInterview } from "@/lib/store";
import { advancePhase, logEvent } from "@/lib/phase-store";
import { pool } from "@/lib/db";

// Internal hook for a later live-observer view: force the active phase to end now.
// Not exposed in the UI in v1. Admin, or the interviewer who created the interview.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(req, ["admin", "interviewer"]);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;

  const interview = await getInterview(id);
  if (!interview || (interview.orgId && interview.orgId !== auth.user.orgId)) {
    return NextResponse.json({ error: "Interview not found" }, { status: 404 });
  }
  if (auth.user.role !== "admin" && interview.createdBy !== auth.user.id) {
    return NextResponse.json({ error: "Only an admin or the interview creator can force a phase change" }, { status: 403 });
  }
  if (interview.roundType !== "DSA Review") return NextResponse.json({ error: "Not a DSA Review interview" }, { status: 400 });
  if (interview.status === "completed") return NextResponse.json({ error: "Interview already completed" }, { status: 400 });

  const body = await req.json().catch(() => ({} as any));
  const transition = await advancePhase(id, "forced");
  if (!transition) return NextResponse.json({ error: "No active phase" }, { status: 409 });
  if (typeof body?.reason === "string" && body.reason.trim()) {
    await logEvent(pool, id, transition.from, "forced_transition", { note: body.reason.trim().slice(0, 500), by: auth.user.id });
  }
  return NextResponse.json({ ok: true, transition });
}
