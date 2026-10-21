// Public: what the join page may show for a batch link. No candidate data, no question content.
import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { publicBatchView, readStoredStages } from "@/lib/batches";
import { rateLimit } from "@/lib/rate-limit";

export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!rateLimit(`join-info:${ip}`, 240, 60_000)) return NextResponse.json({ error: "Too many requests. Try again in a moment." }, { status: 429 });
  const { code } = await params;
  if (!/^[A-Za-z0-9_-]{6,40}$/.test(code)) return NextResponse.json({ error: "This link is not valid." }, { status: 404 });
  const { rows } = await pool.query(
    `SELECT b.name, b.stages, b.starts_at, b.opens_before_min, b.late_entry_min, b.is_closed, COALESCE(o.name, '') AS org_name
     FROM interview_batches b LEFT JOIN organizations o ON o.id = b.org_id WHERE b.join_code = $1`,
    [code]
  );
  if (rows.length === 0) return NextResponse.json({ error: "This link is not valid." }, { status: 404 });
  const r = rows[0];
  const stages = readStoredStages(r.stages);
  if (!stages) return NextResponse.json({ error: "This session is not set up correctly. Please contact the organiser." }, { status: 500 });
  const view = publicBatchView({ name: r.name, stages, startsAt: r.starts_at, opensBeforeMin: r.opens_before_min, lateEntryMin: r.late_entry_min, isClosed: r.is_closed }, r.org_name);
  return NextResponse.json(view, { headers: { "Cache-Control": "no-store" } });
}
