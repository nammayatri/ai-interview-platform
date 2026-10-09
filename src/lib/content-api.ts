// Shared CRUD handlers for org-scoped, admin-authored, versioned content (problems and puzzles).
import { NextResponse } from "next/server";
import { pool } from "./db";
import { ANY_ROLE, requireRole } from "./rbac";
import { validateProblemRunbook, validatePuzzleRunbook, type ValidationResult } from "./runbook";

type Kind = "problem" | "puzzle";

const TABLE: Record<Kind, string> = { problem: "problems", puzzle: "puzzles" };

const DIFFICULTIES = ["easy", "medium", "hard"];

function validateRunbook(kind: Kind, raw: unknown): ValidationResult<any> {
  return kind === "problem" ? validateProblemRunbook(raw) : validatePuzzleRunbook(raw);
}

function mapRow(kind: Kind, r: any) {
  return {
    id: r.id,
    title: r.title,
    difficulty: r.difficulty,
    tags: r.tags || [],
    runbook: r.runbook,
    version: r.version,
    isArchived: r.is_archived,
    createdAt: r.created_at?.toISOString?.() ?? r.created_at,
    updatedAt: r.updated_at?.toISOString?.() ?? r.updated_at,
    ...(kind === "puzzle" ? { expectedMin: r.expected_min } : {}),
  };
}

function parseBasics(body: any): { ok: true; title: string; difficulty: string | null; tags: string[] } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  if (!title) errors.push("title is required");
  if (title.length > 255) errors.push("title must be at most 255 characters");
  const difficulty = body?.difficulty ? String(body.difficulty).toLowerCase() : null;
  if (difficulty && !DIFFICULTIES.includes(difficulty)) errors.push("difficulty must be easy, medium or hard");
  const tags = Array.isArray(body?.tags) ? body.tags.map((t: any) => String(t).trim()).filter(Boolean).slice(0, 20) : [];
  if (errors.length) return { ok: false, errors };
  return { ok: true, title, difficulty, tags };
}

const bad = (errors: string[]) => NextResponse.json({ error: errors[0], errors }, { status: 400 });

export function contentHandlers(kind: Kind) {
  const table = TABLE[kind];

  return {
    async list(req: Request) {
      const auth = await requireRole(req, ANY_ROLE);
      if (auth instanceof NextResponse) return auth;
      const includeArchived = new URL(req.url).searchParams.get("archived") === "true";
      const { rows } = await pool.query(
        `SELECT * FROM ${table} WHERE org_id = $1 ${includeArchived ? "" : "AND is_archived = false"} ORDER BY title ASC`,
        [auth.user.orgId]
      );
      return NextResponse.json(rows.map((r) => mapRow(kind, r)));
    },

    async create(req: Request) {
      const auth = await requireRole(req, ["admin"]);
      if (auth instanceof NextResponse) return auth;
      const body = await req.json().catch(() => null);
      const basics = parseBasics(body);
      if (!basics.ok) return bad(basics.errors);
      const rb = validateRunbook(kind, body?.runbook);
      if (!rb.ok) return bad(rb.errors);

      const { rows } =
        kind === "puzzle"
          ? await pool.query(
              `INSERT INTO puzzles (org_id, title, difficulty, tags, expected_min, runbook, created_by)
               VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
              [auth.user.orgId, basics.title, basics.difficulty, basics.tags, rb.value.expectedMin, JSON.stringify(rb.value), auth.user.id]
            )
          : await pool.query(
              `INSERT INTO problems (org_id, title, difficulty, tags, runbook, created_by)
               VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
              [auth.user.orgId, basics.title, basics.difficulty, basics.tags, JSON.stringify(rb.value), auth.user.id]
            );
      return NextResponse.json(mapRow(kind, rows[0]), { status: 201 });
    },

    async get(req: Request, id: string) {
      const auth = await requireRole(req, ANY_ROLE);
      if (auth instanceof NextResponse) return auth;
      if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
      const { rows } = await pool.query(`SELECT * FROM ${table} WHERE id = $1 AND org_id = $2`, [id, auth.user.orgId]);
      if (rows.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
      return NextResponse.json(mapRow(kind, rows[0]));
    },

    async update(req: Request, id: string) {
      const auth = await requireRole(req, ["admin"]);
      if (auth instanceof NextResponse) return auth;
      if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
      const body = await req.json().catch(() => null);
      const basics = parseBasics(body);
      if (!basics.ok) return bad(basics.errors);
      const rb = validateRunbook(kind, body?.runbook);
      if (!rb.ok) return bad(rb.errors);
      const archived = typeof body?.isArchived === "boolean" ? body.isArchived : null;

      const { rows } =
        kind === "puzzle"
          ? await pool.query(
              `UPDATE puzzles SET title=$3, difficulty=$4, tags=$5, expected_min=$6, runbook=$7, version = version + 1,
                 is_archived = COALESCE($8, is_archived), updated_at = NOW()
               WHERE id=$1 AND org_id=$2 RETURNING *`,
              [id, auth.user.orgId, basics.title, basics.difficulty, basics.tags, rb.value.expectedMin, JSON.stringify(rb.value), archived]
            )
          : await pool.query(
              `UPDATE problems SET title=$3, difficulty=$4, tags=$5, runbook=$6, version = version + 1,
                 is_archived = COALESCE($7, is_archived), updated_at = NOW()
               WHERE id=$1 AND org_id=$2 RETURNING *`,
              [id, auth.user.orgId, basics.title, basics.difficulty, basics.tags, JSON.stringify(rb.value), archived]
            );
      if (rows.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
      return NextResponse.json(mapRow(kind, rows[0]));
    },

    /** Soft delete: submissions.problem_id references problems, so hard delete is not offered. */
    async archive(req: Request, id: string) {
      const auth = await requireRole(req, ["admin"]);
      if (auth instanceof NextResponse) return auth;
      if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
      const { rowCount } = await pool.query(
        `UPDATE ${table} SET is_archived = true, updated_at = NOW() WHERE id = $1 AND org_id = $2`,
        [id, auth.user.orgId]
      );
      if (!rowCount) return NextResponse.json({ error: "Not found" }, { status: 404 });
      return NextResponse.json({ success: true });
    },
  };
}

export const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
