// CRUD for interview templates (saved stage plans). Admins and interviewers manage them; members can read.
import { NextResponse } from "next/server";
import { pool } from "./db";
import { isUuid } from "./content-api";
import { ANY_ROLE, requireRole } from "./rbac";
import { BUILTIN_RUNBOOKS, stagesDuration, validateTemplate, type StagePlan } from "./runbook";

const WRITERS = ["admin", "interviewer"] as const;
const bad = (errors: string[]) => NextResponse.json({ error: errors[0], errors }, { status: 400 });

/** Names of the items a template points at, and whether they still exist, so the UI can show and warn. */
async function describeStages(orgId: string, stages: StagePlan[]) {
  const ids = (k: "parta" | "dsa" | "puzzle") => stages.filter((s) => s.key === k && s.itemId).map((s) => s.itemId as string);
  const rbIds = stages.filter((s) => s.runbookId).map((s) => s.runbookId as string);
  const [problems, puzzles, runbooks] = await Promise.all([
    pool.query("SELECT id, title, is_archived FROM problems WHERE org_id = $1 AND id = ANY($2::uuid[])", [orgId, [...ids("parta"), ...ids("dsa")]]),
    pool.query("SELECT id, title, is_archived FROM puzzles WHERE org_id = $1 AND id = ANY($2::uuid[])", [orgId, ids("puzzle")]),
    pool.query("SELECT id, name, is_archived FROM runbooks WHERE org_id = $1 AND id = ANY($2::uuid[])", [orgId, rbIds]),
  ]);
  const item = new Map<string, { title: string; archived: boolean }>();
  problems.rows.concat(puzzles.rows).forEach((r) => item.set(r.id, { title: r.title, archived: r.is_archived }));
  const rb = new Map<string, { name: string; archived: boolean }>();
  runbooks.rows.forEach((r) => rb.set(r.id, { name: r.name, archived: r.is_archived }));
  return stages.map((s) => {
    const it = s.itemId ? item.get(s.itemId) : null;
    const r = s.runbookId ? rb.get(s.runbookId) : null;
    return {
      key: s.key,
      budgetMin: s.budgetMin,
      graceMin: s.graceMin,
      mode: s.mode,
      itemTitle: s.mode === "random" ? "Random" : it?.title ?? "(missing)",
      itemProblem: s.mode !== "random" && (!it || it.archived),
      runbookName: s.runbookId ? r?.name ?? "(missing)" : BUILTIN_RUNBOOKS[s.key].name + " (built-in)",
      runbookProblem: !!s.runbookId && (!r || r.archived),
    };
  });
}

async function mapRow(orgId: string, r: any) {
  const stages: StagePlan[] = r.stages || [];
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    level: r.level,
    stages,
    summary: await describeStages(orgId, stages),
    durationMin: stagesDuration(stages),
    version: r.version,
    isArchived: r.is_archived,
    createdAt: r.created_at?.toISOString?.() ?? r.created_at,
    updatedAt: r.updated_at?.toISOString?.() ?? r.updated_at,
  };
}

export const templateHandlers = {
  async list(req: Request) {
    const auth = await requireRole(req, ANY_ROLE);
    if (auth instanceof NextResponse) return auth;
    const includeArchived = new URL(req.url).searchParams.get("archived") === "true";
    const { rows } = await pool.query(
      `SELECT * FROM interview_templates WHERE org_id = $1 ${includeArchived ? "" : "AND is_archived = false"} ORDER BY name`,
      [auth.user.orgId]
    );
    return NextResponse.json(await Promise.all(rows.map((r) => mapRow(auth.user.orgId, r))));
  },

  async create(req: Request) {
    const auth = await requireRole(req, [...WRITERS]);
    if (auth instanceof NextResponse) return auth;
    const body = await req.json().catch(() => null);
    const v = validateTemplate(body);
    if (!v.ok) return bad(v.errors);
    const { rows } = await pool.query(
      `INSERT INTO interview_templates (org_id, name, description, level, stages, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [auth.user.orgId, v.value.name, v.value.description, v.value.level, JSON.stringify(v.value.stages), auth.user.id]
    );
    return NextResponse.json(await mapRow(auth.user.orgId, rows[0]), { status: 201 });
  },

  async get(req: Request, id: string) {
    const auth = await requireRole(req, ANY_ROLE);
    if (auth instanceof NextResponse) return auth;
    if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const { rows } = await pool.query("SELECT * FROM interview_templates WHERE id = $1 AND org_id = $2", [id, auth.user.orgId]);
    if (rows.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(await mapRow(auth.user.orgId, rows[0]));
  },

  async update(req: Request, id: string) {
    const auth = await requireRole(req, [...WRITERS]);
    if (auth instanceof NextResponse) return auth;
    if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const body = await req.json().catch(() => null);
    const v = validateTemplate(body);
    if (!v.ok) return bad(v.errors);
    const archived = typeof body?.isArchived === "boolean" ? body.isArchived : null;
    const { rows } = await pool.query(
      `UPDATE interview_templates SET name=$3, description=$4, level=$5, stages=$6, version = version + 1,
         is_archived = COALESCE($7, is_archived), updated_at = NOW() WHERE id=$1 AND org_id=$2 RETURNING *`,
      [id, auth.user.orgId, v.value.name, v.value.description, v.value.level, JSON.stringify(v.value.stages), archived]
    );
    if (rows.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(await mapRow(auth.user.orgId, rows[0]));
  },

  async archive(req: Request, id: string) {
    const auth = await requireRole(req, [...WRITERS]);
    if (auth instanceof NextResponse) return auth;
    if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const { rowCount } = await pool.query("UPDATE interview_templates SET is_archived = true, updated_at = NOW() WHERE id = $1 AND org_id = $2", [id, auth.user.orgId]);
    if (!rowCount) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ success: true });
  },
};
