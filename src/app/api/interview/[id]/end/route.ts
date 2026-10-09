import { NextResponse } from "next/server";
import { getInterview, updateInterview } from "@/lib/store";
import { scoreInterviewInBackground } from "@/lib/scoring/background";
import { closePhasesOnEnd } from "@/lib/phase-store";
import { validateAccess } from "@/lib/auth-check";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // Try session-based auth first, then token from body
  let { authorized } = await validateAccess(req, id);
  if (!authorized) {
    try {
      const body = await req.json().catch(() => ({} as any));
      if (body?.token) {
        const { validateAccessPost } = await import("@/lib/auth-check");
        authorized = await validateAccessPost(id, body.token);
      }
    } catch {}
  }
  if (!authorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const interview = await getInterview(id);
  if (!interview) {
    return NextResponse.json({ error: "Interview not found" }, { status: 404 });
  }

  // Log who's calling this — helps debug the "refresh completes interview" issue
  const caller = req.headers.get("referer") || "unknown";
  const ua = req.headers.get("user-agent")?.substring(0, 40) || "unknown";
  console.log(`[Interview/end] ${id} called from referer=${caller} ua=${ua} currentStatus=${interview.status}`);

  if (interview.status === "completed") {
    return NextResponse.json({ error: "Interview already completed" }, { status: 400 });
  }

  // Mark as completed (DSA Review also closes the active phase and skips pending ones), then score in the background
  await updateInterview(id, {
    status: "completed",
    endedAt: new Date().toISOString(),
  });
  if (interview.roundType === "DSA Review") await closePhasesOnEnd(id);

  // Return immediately — candidate doesn't wait
  const response = NextResponse.json({ ok: true });

  // Auto-generate scorecard in background after 3s delay
  setTimeout(async () => {
    try {
      const freshInterview = await getInterview(id);
      if (freshInterview && freshInterview.transcript.length > 0 && !freshInterview.scorecard) {
        scoreInterviewInBackground(id, freshInterview);
      }
    } catch (err) {
      console.error(`[Auto-Score] Failed to fetch interview ${id}:`, err);
    }
  }, 3000);

  return response;
}
