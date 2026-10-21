// Public: someone who already registered in this batch types their email on the same join link and is taken straight
// back to their own interview (new tab, another device, lost link). No second registration.
import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";

export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  // Many candidates can sit behind one campus address, so this is generous per address.
  if (!rateLimit(`join-login:${ip}`, 120, 60_000)) return NextResponse.json({ error: "Too many attempts. Wait a minute and try again." }, { status: 429 });

  const { code } = await params;
  if (!/^[A-Za-z0-9_-]{6,40}$/.test(code)) return NextResponse.json({ error: "This link is not valid." }, { status: 404 });
  const body = await req.json().catch(() => null);
  const email = String(body?.email ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  if (!rateLimit(`join-login-email:${code}:${email}`, 20, 10 * 60_000)) return NextResponse.json({ error: "Too many attempts for this email. Try again in a few minutes." }, { status: 429 });

  const { rows } = await pool.query(
    `SELECT i.id, i.token, i.candidate_name
     FROM interviews i JOIN interview_batches b ON b.id = i.batch_id
     WHERE b.join_code = $1 AND lower(i.candidate_email) = $2`,
    [code, email]
  );
  if (rows.length === 0) return NextResponse.json({ error: "No registration found for this email.", registered: false }, { status: 404 });
  const r = rows[0];
  return NextResponse.json({ ok: true, registered: true, id: r.id, url: `/interview/${r.id}?token=${r.token}`, name: r.candidate_name || "" });
}
