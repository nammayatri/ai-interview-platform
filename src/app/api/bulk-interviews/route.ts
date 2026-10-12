import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { isUuid } from "@/lib/content-api";
import { MAX_BULK_ROWS, validateBulkRows } from "@/lib/bulk-parse";
import { rateLimit } from "@/lib/rate-limit";
import { requireRole } from "@/lib/rbac";
import { stagesDuration, type StagePlan } from "@/lib/runbook";
import { createStagedInterview, loadStagedInput, sendCandidateInvite } from "@/lib/staged-interview";

export const maxDuration = 300;

interface RowResult {
  rowNumber: number;
  email: string;
  status: "created" | "skipped" | "error";
  id?: string;
  url?: string;
  error?: string;
}

// Step 2 of a bulk upload: create one interview per valid row, using the template's stage plan.
// Rows with problems are skipped and reported; one bad row never stops the others.
export async function POST(req: Request) {
  const auth = await requireRole(req, ["admin", "interviewer"]);
  if (auth instanceof NextResponse) return auth;
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!rateLimit(`bulk-create:${ip}`, 5, 60000)) return NextResponse.json({ error: "Too many requests. Try again in a minute." }, { status: 429 });

  const body = await req.json().catch(() => null);
  const templateId = String(body?.templateId || "");
  const emailTemplateId = body?.emailTemplateId ? String(body.emailTemplateId) : "";
  if (!isUuid(templateId)) return NextResponse.json({ error: "Choose a template." }, { status: 400 });
  if (emailTemplateId && !isUuid(emailTemplateId)) return NextResponse.json({ error: "Invalid email template." }, { status: 400 });
  if (!Array.isArray(body?.rows) || body.rows.length === 0) return NextResponse.json({ error: "There are no rows to create." }, { status: 400 });
  if (body.rows.length > MAX_BULK_ROWS) return NextResponse.json({ error: `At most ${MAX_BULK_ROWS} interviews per upload.` }, { status: 400 });

  const orgId = auth.user.orgId;
  const { rows: tpl } = await pool.query("SELECT name, level, stages FROM interview_templates WHERE id = $1 AND org_id = $2 AND is_archived = false", [templateId, orgId]);
  if (tpl.length === 0) return NextResponse.json({ error: "That template was not found." }, { status: 404 });
  const stages: StagePlan[] = tpl[0].stages;
  const level: string = tpl[0].level;
  const duration = stagesDuration(stages);
  const needCode = stages.some((s) => s.key === "parta");
  const origin = req.headers.get("origin") || "";

  const checked = validateBulkRows(body.rows, needCode);

  // A problem with the template itself (an archived question, a deleted runbook) would fail every row: say so once.
  const probe = await loadStagedInput(stages, needCode ? { code: "x" } : undefined, orgId, duration);
  if ("error" in probe) return NextResponse.json({ error: `The template "${tpl[0].name}" cannot be used: ${probe.error}` }, { status: 400 });

  const results: RowResult[] = [];
  for (const r of checked) {
    if (r.errors.length > 0) {
      results.push({ rowNumber: r.rowNumber, email: r.email, status: "skipped", error: r.errors.join("; ") });
      continue;
    }
    try {
      const input = await loadStagedInput(stages, needCode ? { code: r.code } : undefined, orgId, duration);
      if ("error" in input) {
        results.push({ rowNumber: r.rowNumber, email: r.email, status: "error", error: input.error });
        continue;
      }
      const made = await createStagedInterview({ orgId, userId: auth.user.id, role: r.role, level, duration, candidateEmail: r.email, candidateName: r.name, input });
      results.push({ rowNumber: r.rowNumber, email: r.email, status: "created", id: made.id, url: made.url });
      sendCandidateInvite({ origin, url: made.url, candidateEmail: r.email, candidateName: r.name, role: r.role, level, duration, orgName: (auth.user as any).orgName, emailTemplateId: emailTemplateId || undefined }).catch(console.error);
    } catch (err) {
      console.error(`[Bulk] row ${r.rowNumber} failed:`, err);
      results.push({ rowNumber: r.rowNumber, email: r.email, status: "error", error: "Could not create this interview" });
    }
  }

  return NextResponse.json({
    template: tpl[0].name,
    created: results.filter((x) => x.status === "created").length,
    skipped: results.filter((x) => x.status === "skipped").length,
    failed: results.filter((x) => x.status === "error").length,
    results,
  });
}
