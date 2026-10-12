import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { isUuid } from "@/lib/content-api";
import { MAX_UPLOAD_BYTES, mapBulkRows, readSpreadsheet } from "@/lib/bulk-parse";
import { rateLimit } from "@/lib/rate-limit";
import { requireRole } from "@/lib/rbac";

// Step 1 of a bulk upload: read the file against the chosen template and report every row's problems. Creates nothing.
export async function POST(req: Request) {
  const auth = await requireRole(req, ["admin", "interviewer"]);
  if (auth instanceof NextResponse) return auth;
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!rateLimit(`bulk-parse:${ip}`, 20, 60000)) return NextResponse.json({ error: "Too many requests. Try again in a minute." }, { status: 429 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("file") as File | null;
  const templateId = String(form?.get("templateId") || "");
  if (!file || file.size === 0) return NextResponse.json({ error: "Choose a .csv or .xlsx file." }, { status: 400 });
  if (file.size > MAX_UPLOAD_BYTES) return NextResponse.json({ error: "The file is larger than 5 MB." }, { status: 400 });
  if (!isUuid(templateId)) return NextResponse.json({ error: "Choose a template first." }, { status: 400 });

  const { rows: tpl } = await pool.query("SELECT stages FROM interview_templates WHERE id = $1 AND org_id = $2 AND is_archived = false", [templateId, auth.user.orgId]);
  if (tpl.length === 0) return NextResponse.json({ error: "That template was not found." }, { status: 404 });
  const needCode = (tpl[0].stages as Array<{ key: string }>).some((s) => s.key === "parta");

  try {
    const table = await readSpreadsheet(Buffer.from(await file.arrayBuffer()), file.name);
    return NextResponse.json({ ...mapBulkRows(table, { needCode }), needCode });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message || "Could not read that file." }, { status: 400 });
  }
}
