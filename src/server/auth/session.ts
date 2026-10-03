import { createHash, randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, gt, lt } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import * as s from "@/server/db/schema";

/**
 * Session auth.
 * - Opaque 256-bit random token in an httpOnly, SameSite=Lax cookie (Secure in production).
 * - Only sha256(token) is stored, so a database leak doesn't leak live sessions.
 * - Each session carries a CSRF token, mirrored in a readable SameSite=Strict cookie; mutating API
 *   requests must echo it in the `x-csrf-token` header (double-submit + server-side comparison).
 */
export const SESSION_COOKIE = "lifeos_session";
export const CSRF_COOKIE = "lifeos_csrf";
const TTL_MS = 14 * 86_400_000;

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");
const secure = process.env.NODE_ENV === "production" && process.env.LIFEOS_INSECURE_COOKIES !== "true";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  isDemo: boolean;
  csrfToken: string;
  sessionId: string;
}

export async function createSession(userId: string) {
  const db = await getDb();
  const token = randomBytes(32).toString("base64url");
  const csrfToken = randomBytes(24).toString("base64url");
  const h = await headers();
  await db.insert(s.sessions).values({
    id: sha256(token),
    userId,
    csrfToken,
    expiresAt: new Date(Date.now() + TTL_MS),
    userAgent: h.get("user-agent")?.slice(0, 200),
    ip: (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || null,
  });
  // Opportunistic cleanup of expired sessions.
  await db.delete(s.sessions).where(lt(s.sessions.expiresAt, new Date()));
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: TTL_MS / 1000 });
  jar.set(CSRF_COOKIE, csrfToken, { httpOnly: false, sameSite: "strict", secure, path: "/", maxAge: TTL_MS / 1000 });
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || token.length > 100) return null;
  const db = await getDb();
  const [row] = await db
    .select({ id: s.users.id, email: s.users.email, name: s.users.name, isDemo: s.users.isDemo, csrfToken: s.sessions.csrfToken, sessionId: s.sessions.id })
    .from(s.sessions)
    .innerJoin(s.users, eq(s.users.id, s.sessions.userId))
    .where(and(eq(s.sessions.id, sha256(token)), gt(s.sessions.expiresAt, new Date())));
  return row ?? null;
}

/** For server components / pages: redirect to /login when not signed in. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    const db = await getDb();
    await db.delete(s.sessions).where(eq(s.sessions.id, sha256(token)));
  }
  jar.delete(SESSION_COOKIE);
  jar.delete(CSRF_COOKIE);
}
