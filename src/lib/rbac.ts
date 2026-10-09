import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import type { Session } from "next-auth";
import { authOptions } from "./auth";

export type Role = "admin" | "interviewer" | "member";

export interface AuthedSession extends Session {
  user: NonNullable<Session["user"]> & { id: string; orgId: string; role: Role; orgName?: string };
}

/**
 * Returns the session when the caller is logged in and holds one of `roles`,
 * otherwise a 401 (no session) or 403 (wrong role) response.
 *   const auth = await requireRole(req, ["admin"]);
 *   if (auth instanceof NextResponse) return auth;
 */
export async function requireRole(_req: Request | null, roles: Role[]): Promise<AuthedSession | NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const role = ((session.user as any).role || "member") as Role;
  if (!roles.includes(role)) {
    return NextResponse.json({ error: `Requires role: ${roles.join(" or ")}` }, { status: 403 });
  }
  return session as AuthedSession;
}

export const ANY_ROLE: Role[] = ["admin", "interviewer", "member"];
