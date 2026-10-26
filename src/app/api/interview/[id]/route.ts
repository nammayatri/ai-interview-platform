import { NextResponse } from "next/server";
import { getInterview, getInterviewWithPhotos } from "@/lib/store";
import { validateAccess } from "@/lib/auth-check";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { pool } from "@/lib/db";
import { projectInterviewForCandidate } from "@/lib/candidate-projection";
import { getInterviewBatch } from "@/lib/batches-api";
import { isValidShareKey, shareKeyFor } from "@/lib/share-key";
import { candidateProctoringView } from "@/lib/batch-settings";
import { getInterviewSettings } from "@/lib/interview-settings";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(req.url);

  // Share mode: read-only access for completed interviews — strip all PII
  // The link must carry the key made for this interview; the interview id alone (which the candidate also has) is not enough.
  const shareParam = url.searchParams.get("share");
  if (shareParam) {
    if (!isValidShareKey(id, shareParam)) return NextResponse.json({ error: "Not available for sharing" }, { status: 404 });
    const interview = await getInterview(id);
    if (interview && interview.status === "completed") {
      return NextResponse.json({
        role: interview.role,
        level: interview.level,
        focusAreas: interview.focusAreas,
        duration: interview.duration,
        roundType: interview.roundType,
        status: interview.status,
        scorecard: interview.scorecard,
        transcript: interview.transcript,
        // Events carry type, severity and message only; photos are never included in a shared view.
        proctoring: (interview.proctoring ?? []).map((e) => ({ type: e.type, severity: e.severity, message: e.message, timestamp: e.timestamp })),
        // PII stripped: no email, name, phone, resume, token, proctoring photos
      });
    }
    return NextResponse.json({ error: "Not available for sharing" }, { status: 404 });
  }

  const { authorized, session } = await validateAccess(req, id);
  if (!authorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const includePhotos = url.searchParams.get("photos") === "true";

  const interview = includePhotos
    ? await getInterviewWithPhotos(id)
    : await getInterview(id);
  if (!interview) {
    return NextResponse.json({ error: "Interview not found" }, { status: 404 });
  }

  // Expiration only applies to candidates (token-based access).
  // Interviewers (session-based) can always view past interviews.
  if (!session && interview.expiresAt && new Date(interview.expiresAt) < new Date()) {
    return NextResponse.json({ error: "This interview link has expired", expired: true }, { status: 410 });
  }

  // The candidate room always passes ?token=, so anything fetched that way is projected, even when the browser
  // also holds an interviewer session (e.g. an interviewer previewing the link). Interviewer pages omit the token.
  const candidateView = !session || !!url.searchParams.get("token");
  const batch = await getInterviewBatch(id);
  // A candidate never receives the scorecard, even though the room reads the rest of this record.
  const body: any = candidateView ? { ...projectInterviewForCandidate(interview), scorecard: null } : { ...interview, shareKey: shareKeyFor(id) };
  if (candidateView) body.proctoringRules = candidateProctoringView(await getInterviewSettings(id));
  if (batch && candidateView) delete batch.passMark; // the candidate never sees the passing mark
  return NextResponse.json(batch ? { ...body, batch } : body);
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const { authorized, session } = await validateAccess(req, id);
  if (!authorized || !session) {
    return NextResponse.json({ error: "Unauthorized — admin access required" }, { status: 401 });
  }

  // Delete cascade handles transcript_entries, proctoring_events, interview_rounds
  await pool.query("DELETE FROM interviews WHERE id = $1", [id]);

  return NextResponse.json({ ok: true });
}
