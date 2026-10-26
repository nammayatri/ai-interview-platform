// Interview batches (one shared join link for many candidates). Admins and interviewers manage them; members can read.
import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { ANY_ROLE, requireRole } from "@/lib/rbac";
import { loadStagedInput } from "@/lib/staged-interview";
import { batchPhase, newJoinCode, readStoredStages, validateBatchInput } from "@/lib/batches";
import { stagesDuration, type StagePlan } from "@/lib/runbook";
import { mapBatch, queryBatches } from "@/lib/batches-api";
import { validateBatchSettings } from "@/lib/batch-settings";

export async function GET(req: Request) {
  const auth = await requireRole(req, ANY_ROLE);
  if (auth instanceof NextResponse) return auth;
  const rows = await queryBatches("b.org_id = $1", [auth.user.orgId], "ORDER BY b.starts_at DESC LIMIT 200");
  return NextResponse.json(rows.map((r) => mapBatch(r)));
}

export async function POST(req: Request) {
  const auth = await requireRole(req, ["admin", "interviewer"]);
  if (auth instanceof NextResponse) return auth;
  const body = await req.json().catch(() => null);
  const v = validateBatchInput(body);
  if (!v.ok) return NextResponse.json({ error: v.errors[0], errors: v.errors }, { status: 400 });

  // Optional settings at creation (proctoring rules, passing mark); omitted = the defaults.
  let settingsJson: string | null = null;
  if (body && typeof body === "object" && (body as any).settings !== undefined) {
    const sv = validateBatchSettings((body as any).settings);
    if (!sv.ok) return NextResponse.json({ error: sv.errors[0], errors: sv.errors }, { status: 400 });
    settingsJson = JSON.stringify(sv.value);
  }

  const { rows: tpl } = await pool.query("SELECT id, name, level, stages FROM interview_templates WHERE id = $1 AND org_id = $2 AND is_archived = false", [v.value.templateId, auth.user.orgId]);
  if (tpl.length === 0) return NextResponse.json({ error: "That template was not found." }, { status: 404 });
  const stages = readStoredStages(tpl[0].stages);
  if (!stages) return NextResponse.json({ error: "That template has no valid stages. Open it and save it again." }, { status: 400 });

  // Fail now, not when the first candidate registers: every question and runbook the template points at must exist.
  const hasPartA = stages.some((s: StagePlan) => s.key === "parta");
  const probe = await loadStagedInput(stages, hasPartA ? { code: "x" } : undefined, auth.user.orgId, stagesDuration(stages));
  if ("error" in probe) return NextResponse.json({ error: `The template "${tpl[0].name}" cannot be used: ${probe.error}` }, { status: 400 });

  const { rows } = await pool.query(
    `INSERT INTO interview_batches (org_id, name, join_code, template_id, template_name, stages, level, role, starts_at, opens_before_min, late_entry_min, max_candidates, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [auth.user.orgId, v.value.name, newJoinCode(), tpl[0].id, tpl[0].name, JSON.stringify(stages), tpl[0].level, v.value.role, v.value.startsAt.toISOString(), v.value.opensBeforeMin, v.value.lateEntryMin, v.value.maxCandidates, auth.user.id]
  );
  if (settingsJson) {
    try {
      await pool.query("UPDATE interview_batches SET settings = $1::jsonb WHERE id = $2", [settingsJson, rows[0].id]);
      rows[0].settings = JSON.parse(settingsJson);
    } catch (err: any) {
      if (err?.code !== "42703") throw err; // migration 008 not applied yet: the batch keeps the defaults
    }
  }
  return NextResponse.json(mapBatch({ ...rows[0], registered: 0, started: 0, completed: 0 }), { status: 201 });
}
