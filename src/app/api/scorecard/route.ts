import { NextResponse } from "next/server";
import { getInterview, updateInterview } from "@/lib/store";
import { startScoring, completeScoring, failScoring } from "@/lib/scoring-tracker";
import { runScoring } from "@/lib/scoring/background";
import { closePhasesOnEnd, getPhases } from "@/lib/phase-store";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function POST(req: Request) {
  // Read body ONCE up-front so we can reference interviewId from the catch handler
  // without cloning the request (which throws "unusable" after the body stream is consumed).
  let interviewId: string | undefined;
  try {
    const body = await req.json().catch(() => ({} as any));
    interviewId = body?.interviewId;

    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!interviewId) {
      return NextResponse.json({ error: "Missing interviewId" }, { status: 400 });
    }

    const interview = await getInterview(interviewId);
    if (!interview) {
      return NextResponse.json({ error: "Interview not found" }, { status: 404 });
    }

    // Authorization: admin OR the user who created this interview
    const userId = (session.user as any).id;
    const role = (session.user as any).role;
    const createdBy = (interview as any).createdBy;
    if (role !== "admin" && createdBy !== userId) {
      return NextResponse.json({ error: "Only admin or interview creator can re-score" }, { status: 403 });
    }

    // Atomic check-and-set
    if (!(await startScoring(interviewId))) {
      return NextResponse.json({ error: "Scoring already in progress" }, { status: 409 });
    }

    // A rescore on an interview that is still open closes its phases first so they can be scored.
    if (interview.roundType === "DSA Review") {
      await closePhasesOnEnd(interviewId);
      interview.phases = await getPhases(interviewId);
    }
    await updateInterview(interviewId, { status: "completed", ...(interview.endedAt ? {} : { endedAt: new Date().toISOString() }) });

    // Scoring with a reasoning model takes minutes: run it in the background and let the page poll the status.
    void runScoring(interviewId, interview, { notify: false });
    return NextResponse.json({ status: "started" }, { status: 202 });
  } catch (error) {
    console.error("Scorecard generation error:", error);
    if (interviewId) {
      try { await failScoring(interviewId, (error as Error).message); } catch {}
    }
    return NextResponse.json({ error: "Failed to generate scorecard" }, { status: 500 });
  }
}
