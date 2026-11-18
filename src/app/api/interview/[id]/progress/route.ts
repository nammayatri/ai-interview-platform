// The "Current stage" card on the interview View page polls this every few seconds. Logged-in staff only (any role,
// same organisation); a candidate's interview link has no session and is refused. Returns no transcript, scores or photos.
import { NextResponse } from "next/server";
import { requireRole, ANY_ROLE } from "@/lib/rbac";
import { loadInterviewProgress } from "@/lib/interview-progress";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(req, ANY_ROLE);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  try {
    const progress = await loadInterviewProgress(id, auth.user.orgId);
    if (!progress) return NextResponse.json({ error: "Interview not found" }, { status: 404 });
    return NextResponse.json(progress, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error(`[Progress] ${id}:`, err);
    return NextResponse.json({ error: "Failed to load progress" }, { status: 500 });
  }
}
