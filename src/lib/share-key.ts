// Read-only share links for a finished interview. The old link was /review/<id>?share=true, and the id is also in the
// candidate's own interview address, so a candidate could open their own scorecard. The link now carries a key that is
// derived from the id with a server secret, so the id alone is not enough.
import { createHmac, timingSafeEqual } from "crypto";

function secret(): string {
  return process.env.NEXTAUTH_SECRET || "";
}

export function shareKeyFor(interviewId: string): string | null {
  const s = secret();
  if (!s) return null;
  return createHmac("sha256", s).update(`share:${interviewId}`).digest("base64url").slice(0, 32);
}

export function isValidShareKey(interviewId: string, key: string | null | undefined): boolean {
  const expected = shareKeyFor(interviewId);
  if (!expected || !key || key.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(key), Buffer.from(expected));
}
