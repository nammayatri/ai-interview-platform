// Public: a candidate registers through the batch link. Creates a normal interview tied to the batch.
import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { batchPhase, batchWindow, interviewExpiry, readStoredStages, validateRegistration } from "@/lib/batches";
import { createStagedInterview, loadStagedInput, sendCandidateInvite } from "@/lib/staged-interview";
import { LIMITS, stagesDuration } from "@/lib/runbook";
import { readResume } from "@/lib/resume-text";

const fail = (error: string, status: number, extra: Record<string, unknown> = {}) => NextResponse.json({ error, ...extra }, { status });

export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  // Many candidates can sit behind one campus address, so this is generous per address.
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!rateLimit(`join-register:${ip}`, 90, 60_000)) return fail("Too many attempts. Wait a minute and try again.", 429);

  const { code } = await params;
  if (!/^[A-Za-z0-9_-]{6,40}$/.test(code)) return fail("This link is not valid.", 404);
  const { rows } = await pool.query(
    `SELECT b.*, COALESCE(o.name, '') AS org_name FROM interview_batches b LEFT JOIN organizations o ON o.id = b.org_id WHERE b.join_code = $1`,
    [code]
  );
  if (rows.length === 0) return fail("This link is not valid.", 404);
  const batch = rows[0];

  const timing = { startsAt: batch.starts_at, opensBeforeMin: batch.opens_before_min, lateEntryMin: batch.late_entry_min, isClosed: batch.is_closed };
  const phase = batchPhase(timing);
  if (phase === "not_open") return fail("Registration has not opened yet.", 403, { phase, opensAt: new Date(batchWindow(timing).opensAt).toISOString() });
  if (phase === "closed") return fail("Registration for this session is closed.", 410, { phase });

  const stages = readStoredStages(batch.stages);
  if (!stages) return fail("This session is not set up correctly. Please contact the organiser.", 500);
  const needCode = stages.some((s) => s.key === "parta");
  const duration = stagesDuration(stages);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail("Could not read the form. Please try again.", 400);
  }

  const reg = validateRegistration({ name: form.get("name"), email: form.get("email"), phone: form.get("phone") });
  if (!reg.ok) return fail(Object.values(reg.errors)[0], 400, { fields: reg.errors });

  const resumeFile = form.get("resume");
  if (!(resumeFile instanceof File) || resumeFile.size === 0) return fail("Upload your resume (PDF, DOCX or TXT).", 400, { fields: { resume: "Upload your resume" } });
  let resume: { text: string; fileName: string };
  try {
    resume = await readResume(resumeFile);
  } catch (e: any) {
    return fail(e?.message || "Could not read the resume.", 400, { fields: { resume: e?.message || "Could not read the resume" } });
  }

  let code_ = "";
  if (needCode) {
    code_ = String(form.get("partaCode") ?? "");
    if (!code_.trim()) return fail("Paste your Part A solution.", 400, { fields: { partaCode: "Paste your Part A solution" } });
    if (code_.length > LIMITS.codeChars) return fail(`Your Part A solution is too long (limit ${LIMITS.codeChars.toLocaleString()} characters).`, 400, { fields: { partaCode: "Too long" } });
  }

  // The same email again means the same person coming back: let them into their own interview, never a second one.
  const origin = req.headers.get("origin") || process.env.NEXT_PUBLIC_APP_URL || "";
  const back = (r: { id: string; token: string; candidate_name: string | null }) =>
    NextResponse.json({ ok: true, existing: true, id: r.id, url: `/interview/${r.id}?token=${r.token}`, name: r.candidate_name || reg.value.name });
  const dup = await pool.query("SELECT id, token, candidate_name FROM interviews WHERE batch_id = $1 AND lower(candidate_email) = lower($2)", [batch.id, reg.value.email]);
  if (dup.rows.length > 0) return back(dup.rows[0]);

  if (batch.max_candidates) {
    const { rows: c } = await pool.query("SELECT count(*)::int AS n FROM interviews WHERE batch_id = $1", [batch.id]);
    if (c[0].n >= batch.max_candidates) return fail("This session is full.", 409, { full: true });
  }

  const input = await loadStagedInput(stages, needCode ? { code: code_ } : undefined, batch.org_id, duration);
  if ("error" in input) {
    console.error(`[Join] batch ${batch.id} cannot create interviews: ${input.error}`);
    return fail("This session is not set up correctly. Please contact the organiser.", 500);
  }

  try {
    const made = await createStagedInterview({
      orgId: batch.org_id,
      userId: batch.created_by || "",
      role: batch.role,
      level: batch.level,
      duration,
      candidateEmail: reg.value.email,
      candidateName: reg.value.name,
      candidatePhone: reg.value.phone,
      resumeText: resume.text,
      resumeFileName: resume.fileName,
      input,
      batchId: batch.id,
      expiresAt: interviewExpiry({ startsAt: batch.starts_at, lateEntryMin: batch.late_entry_min }, duration),
    });
    sendCandidateInvite({ origin, url: made.url, candidateEmail: reg.value.email, candidateName: reg.value.name, role: batch.role, level: batch.level, duration, orgName: batch.org_name }).catch(console.error);
    return NextResponse.json({ ok: true, id: made.id, url: made.url, name: reg.value.name }, { status: 201 });
  } catch (err: any) {
    if (err?.code === "23505") {
      // Two registrations with the same email at the same moment: the other one won.
      const again = await pool.query("SELECT id, token, candidate_name FROM interviews WHERE batch_id = $1 AND lower(candidate_email) = lower($2)", [batch.id, reg.value.email]);
      if (again.rows.length > 0) return back(again.rows[0]);
    }
    console.error("[Join] registration failed:", err);
    return fail("Could not complete your registration. Please try again.", 500);
  }
}
