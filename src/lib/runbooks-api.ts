// CRUD for reusable interview runbooks (how the AI asks questions in a stage), one library per stage type.
import { NextResponse } from "next/server";
import { pool } from "./db";
import { isUuid } from "./content-api";
import { ANY_ROLE, requireRole } from "./rbac";
import { STAGE_KEYS, validateInterviewRunbook } from "./runbook";

function mapRow(r: any) {
  return {
    id: r.id,
    kind: r.kind,
    name: r.name,
    description: r.description,
    instructions: r.instructions,
    probes: r.probes || [],
    rubric: r.rubric || [],
    version: r.version,
    isArchived: r.is_archived,
    createdAt: r.created_at?.toISOString?.() ?? r.created_at,
    updatedAt: r.updated_at?.toISOString?.() ?? r.updated_at,
  };
}
const bad = (errors: string[]) => NextResponse.json({ error: errors[0], errors }, { status: 400 });
const kindOf = (v: unknown) => (typeof v === "string" && (STAGE_KEYS as string[]).includes(v) ? v : null);

export const runbookHandlers = {
  async list(req: Request) {
    const auth = await requireRole(req, ANY_ROLE);
    if (auth instanceof NextResponse) return auth;
    const url = new URL(req.url);
    const kind = kindOf(url.searchParams.get("kind"));
    const includeArchived = url.searchParams.get("archived") === "true";
    const { rows } = await pool.query(
      `SELECT * FROM runbooks WHERE org_id = $1 ${kind ? "AND kind = $2" : ""} ${includeArchived ? "" : "AND is_archived = false"} ORDER BY kind, name`,
      kind ? [auth.user.orgId, kind] : [auth.user.orgId]
    );
    return NextResponse.json(rows.map(mapRow));
  },

  async create(req: Request) {
    const auth = await requireRole(req, ["admin"]);
    if (auth instanceof NextResponse) return auth;
    const body = await req.json().catch(() => null);
    const kind = kindOf(body?.kind);
    if (!kind) return bad(["kind must be parta, dsa or puzzle"]);
    const v = validateInterviewRunbook(body);
    if (!v.ok) return bad(v.errors);
    const { rows } = await pool.query(
      `INSERT INTO runbooks (org_id, kind, name, description, instructions, probes, rubric, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [auth.user.orgId, kind, v.value.name, v.value.description, v.value.instructions, JSON.stringify(v.value.probes), JSON.stringify(v.value.rubric), auth.user.id]
    );
    return NextResponse.json(mapRow(rows[0]), { status: 201 });
  },

  async get(req: Request, id: string) {
    const auth = await requireRole(req, ANY_ROLE);
    if (auth instanceof NextResponse) return auth;
    if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const { rows } = await pool.query("SELECT * FROM runbooks WHERE id = $1 AND org_id = $2", [id, auth.user.orgId]);
    if (rows.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(mapRow(rows[0]));
  },

  async update(req: Request, id: string) {
    const auth = await requireRole(req, ["admin"]);
    if (auth instanceof NextResponse) return auth;
    if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const body = await req.json().catch(() => null);
    const v = validateInterviewRunbook(body);
    if (!v.ok) return bad(v.errors);
    const archived = typeof body?.isArchived === "boolean" ? body.isArchived : null;
    const { rows } = await pool.query(
      `UPDATE runbooks SET name=$3, description=$4, instructions=$5, probes=$6, rubric=$7, version = version + 1,
         is_archived = COALESCE($8, is_archived), updated_at = NOW() WHERE id=$1 AND org_id=$2 RETURNING *`,
      [id, auth.user.orgId, v.value.name, v.value.description, v.value.instructions, JSON.stringify(v.value.probes), JSON.stringify(v.value.rubric), archived]
    );
    if (rows.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(mapRow(rows[0]));
  },

  async archive(req: Request, id: string) {
    const auth = await requireRole(req, ["admin"]);
    if (auth instanceof NextResponse) return auth;
    if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const { rowCount } = await pool.query("UPDATE runbooks SET is_archived = true, updated_at = NOW() WHERE id = $1 AND org_id = $2", [id, auth.user.orgId]);
    if (!rowCount) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ success: true });
  },
};
