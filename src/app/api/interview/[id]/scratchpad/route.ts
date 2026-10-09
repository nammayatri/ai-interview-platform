import { NextResponse } from "next/server";
import { validateAccess, validateAccessPost } from "@/lib/auth-check";
import { getInterview } from "@/lib/store";
import { persistScratchpad } from "@/lib/dsa-turn";
import { getPhases } from "@/lib/phase-store";
import { LIMITS } from "@/lib/runbook";

// Candidate scratchpad (typed notes / pseudocode). The client debounces to at most one call per 15 seconds.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({} as any));

  let authorized = (await validateAccess(req, id)).authorized;
  if (!authorized && body?.token) authorized = await validateAccessPost(id, body.token);
  if (!authorized) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (typeof body?.content !== "string") return NextResponse.json({ error: "content is required" }, { status: 400 });
  if (body.content.length > LIMITS.scratchpadChars * 2) return NextResponse.json({ error: "Scratchpad too large" }, { status: 413 });

  const interview = await getInterview(id);
  if (!interview || interview.roundType !== "DSA Review") return NextResponse.json({ error: "Not available" }, { status: 404 });
  if (interview.status === "completed") return NextResponse.json({ error: "Interview already completed" }, { status: 400 });

  const phases = interview.phases || (await getPhases(id));
  const active = phases.find((p) => p.status === "active");
  const saved = await persistScratchpad(id, body.content, active ? active.phaseKey : null);
  return NextResponse.json({ ok: true, length: saved.length });
}
