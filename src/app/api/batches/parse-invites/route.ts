import { NextResponse } from "next/server";
import { MAX_UPLOAD_BYTES, mapInviteRows, readSpreadsheet } from "@/lib/bulk-parse";
import { rateLimit } from "@/lib/rate-limit";
import { requireRole } from "@/lib/rbac";

// Reads a candidate list (CSV or Excel) for a batch and reports each row's problems. Saves and sends nothing.
export async function POST(req: Request) {
  const auth = await requireRole(req, ["admin", "interviewer"]);
  if (auth instanceof NextResponse) return auth;
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!rateLimit(`invite-parse:${ip}`, 20, 60000)) return NextResponse.json({ error: "Too many requests. Try again in a minute." }, { status: 429 });
  const form = await req.formData().catch(() => null);
  const file = form?.get("file") as File | null;
  if (!file || file.size === 0) return NextResponse.json({ error: "Choose a .csv or .xlsx file." }, { status: 400 });
  if (file.size > MAX_UPLOAD_BYTES) return NextResponse.json({ error: "The file is larger than 5 MB." }, { status: 400 });
  try {
    const table = await readSpreadsheet(Buffer.from(await file.arrayBuffer()), file.name);
    return NextResponse.json(mapInviteRows(table));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message || "Could not read that file." }, { status: 400 });
  }
}
