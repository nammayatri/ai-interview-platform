import { NextResponse } from "next/server";
import { getInterview, updateInterview } from "@/lib/store";
import { validateAccess } from "@/lib/auth-check";
import { validateAccessPost } from "@/lib/auth-check";
import { activateFirstPhase } from "@/lib/phase-store";
import { getInterviewBatch } from "@/lib/batches-api";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // Check URL token first, then try body token
  const { authorized } = await validateAccess(req, id);
  if (!authorized) {
    // Try body token
    try {
      const body = await req.clone().json();
      if (body.token && await validateAccessPost(id, body.token)) {
        // OK
      } else {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    } catch {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const interview = await getInterview(id);
  if (!interview) {
    return NextResponse.json({ error: "Interview not found" }, { status: 404 });
  }
  if (interview.status === "completed") {
    return NextResponse.json({ error: "Interview already completed" }, { status: 400 });
  }

  // Interviews registered through a batch link cannot begin before the batch starts, or after its entry window closes.
  // One that has already begun is never blocked, so a reload or a dropped connection resumes normally.
  if (!interview.startedAt && interview.status !== "in_progress") {
    const batch = await getInterviewBatch(id);
    if (batch && (batch.phase === "not_open" || batch.phase === "open")) {
      return NextResponse.json({ error: "The test has not started yet. Please wait for the countdown to finish.", code: "batch_not_started", startsAt: batch.startsAt, serverNow: batch.serverNow }, { status: 409 });
    }
    if (batch && batch.phase === "closed") {
      return NextResponse.json({ error: "The entry window for this session has closed, so the test can no longer be started.", code: "batch_closed" }, { status: 410 });
    }
  }

  const isDsa = interview.roundType === "DSA Review";
  // DSA Review phase budgets hang off started_at, so a repeated start must not move the clock.
  if (!(isDsa && interview.startedAt)) {
    await updateInterview(id, {
      status: "in_progress",
      startedAt: new Date().toISOString(),
    });
  }
  if (isDsa) await activateFirstPhase(id);

  return NextResponse.json({ ok: true });
}
