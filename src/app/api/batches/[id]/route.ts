import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { isUuid } from "@/lib/content-api";
import { ANY_ROLE, requireRole } from "@/lib/rbac";
import { interviewExpiry, MAX_LATE_ENTRY_MIN, MAX_OPENS_BEFORE_MIN, MAX_BATCH_CANDIDATES } from "@/lib/batches";
import { stagesDuration } from "@/lib/runbook";
import { mapBatch } from "@/lib/batches-api";

async function loadBatch(id: string, orgId: string) {
  const { rows } = await pool.query(
    `SELECT b.*,
       (SELECT count(*) FROM interviews i WHERE i.batch_id = b.id) AS registered,
       (SELECT count(*) FROM interviews i WHERE i.batch_id = b.id AND i.status <> 'waiting') AS started,
       (SELECT count(*) FROM interviews i WHERE i.batch_id = b.id AND i.status = 'completed') AS completed
     FROM interview_batches b WHERE b.id = $1 AND b.org_id = $2`,
    [id, orgId]
  );
  return rows[0] || null;
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(req, ANY_ROLE);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const b = await loadBatch(id, auth.user.orgId);
  if (!b) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { rows } = await pool.query(
    `SELECT i.id, i.candidate_name, i.candidate_email, i.candidate_phone, i.resume_file_name, i.role, i.level, i.status,
            i.created_at, i.started_at, i.ended_at, i.scoring_status,
            i.scorecard->>'recommendation' AS recommendation, i.scorecard->>'overall' AS overall,
            (SELECT count(*) FROM proctoring_events p WHERE p.interview_id = i.id AND p.severity = 'flag') AS flags,
            (SELECT count(*) FROM proctoring_events p WHERE p.interview_id = i.id AND p.severity = 'warning') AS warnings
     FROM interviews i WHERE i.batch_id = $1 ORDER BY i.created_at DESC LIMIT 5000`,
    [id]
  );
  return NextResponse.json({
    ...mapBatch(b),
    candidates: rows.map((r) => ({
      id: r.id,
      name: r.candidate_name || "",
      email: r.candidate_email || "",
      phone: r.candidate_phone || "",
      resumeFileName: r.resume_file_name || "",
      role: r.role || "",
      level: r.level || "",
      status: r.status,
      registeredAt: r.created_at?.toISOString?.() ?? r.created_at,
      startedAt: r.started_at?.toISOString?.() ?? r.started_at ?? null,
      endedAt: r.ended_at?.toISOString?.() ?? r.ended_at ?? null,
      scoringStatus: r.scoring_status || null,
      recommendation: r.recommendation || null,
      overall: r.overall !== null && r.overall !== undefined ? Number(r.overall) : null,
      flags: Number(r.flags ?? 0),
      warnings: Number(r.warnings ?? 0),
    })),
  });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(req, ["admin", "interviewer"]);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const current = await loadBatch(id, auth.user.orgId);
  if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const errors: string[] = [];
  let name = current.name;
  if (body.name !== undefined) {
    name = String(body.name).trim();
    if (!name || name.length > 255) errors.push("Give the batch a name (up to 255 characters)");
  }
  let startsAt: Date = new Date(current.starts_at);
  if (body.startsAt !== undefined) {
    startsAt = new Date(body.startsAt);
    if (Number.isNaN(startsAt.getTime())) errors.push("Choose a valid start date and time");
  }
  const int = (v: unknown, fallback: number, lo: number, hi: number, label: string) => {
    if (v === undefined) return fallback;
    const n = Number(v);
    if (!Number.isInteger(n) || n < lo || n > hi) { errors.push(`${label} must be ${lo} to ${hi}`); return fallback; }
    return n;
  };
  const opensBeforeMin = int(body.opensBeforeMin, current.opens_before_min, 0, MAX_OPENS_BEFORE_MIN, "Registration opens before");
  const lateEntryMin = int(body.lateEntryMin, current.late_entry_min, 0, MAX_LATE_ENTRY_MIN, "Late entry");
  let maxCandidates: number | null = current.max_candidates;
  if (body.maxCandidates !== undefined) {
    if (body.maxCandidates === null || body.maxCandidates === "") maxCandidates = null;
    else {
      const n = Number(body.maxCandidates);
      if (!Number.isInteger(n) || n < 1 || n > MAX_BATCH_CANDIDATES) errors.push(`The candidate limit must be 1 to ${MAX_BATCH_CANDIDATES}`);
      else maxCandidates = n;
    }
  }
  let isClosed: boolean = current.is_closed;
  if (body.isClosed !== undefined) isClosed = body.isClosed === true;
  if (errors.length) return NextResponse.json({ error: errors[0], errors }, { status: 400 });

  const duration = stagesDuration(current.stages || []);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE interview_batches SET name=$1, starts_at=$2, opens_before_min=$3, late_entry_min=$4, max_candidates=$5, is_closed=$6, updated_at=NOW() WHERE id=$7`,
      [name, startsAt.toISOString(), opensBeforeMin, lateEntryMin, maxCandidates, isClosed, id]
    );
    // Candidates who have not started keep a link that lasts as long as the batch does.
    await client.query("UPDATE interviews SET expires_at = $1 WHERE batch_id = $2 AND status = 'waiting'", [
      interviewExpiry({ startsAt, lateEntryMin }, duration).toISOString(),
      id,
    ]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  return NextResponse.json(mapBatch(await loadBatch(id, auth.user.orgId)));
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(req, ["admin", "interviewer"]);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const b = await loadBatch(id, auth.user.orgId);
  if (!b) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (Number(b.registered) > 0) return NextResponse.json({ error: "This batch already has registered candidates. Close it instead of deleting it." }, { status: 409 });
  await pool.query("DELETE FROM interview_batches WHERE id = $1", [id]);
  return NextResponse.json({ ok: true });
}
