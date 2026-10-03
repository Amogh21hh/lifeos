import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getSessionUser, type SessionUser } from "@/server/auth/session";
import { getDb, type DB } from "@/server/db/client";
import { logger } from "@/server/observability/logger";
import { UploadRejected } from "@/server/documents/parse";

/* ───────────── rate limiting ───────────── */

/**
 * Fixed-window-with-burst token bucket, in memory. Suitable for a single instance; for horizontal
 * scaling swap `buckets` for Redis (INCR + PEXPIRE) behind the same function signature.
 */
const buckets = new Map<string, { tokens: number; updated: number }>();
export const LIMITS = {
  auth: { capacity: 10, refillPerSec: 10 / 60 },
  ai: { capacity: 30, refillPerSec: 30 / 60 },
  upload: { capacity: 20, refillPerSec: 20 / 300 },
  api: { capacity: 240, refillPerSec: 4 },
} as const;

export function rateLimit(key: string, kind: keyof typeof LIMITS): { ok: boolean; retryAfter: number } {
  const { capacity, refillPerSec } = LIMITS[kind];
  const now = Date.now();
  const b = buckets.get(key) ?? { tokens: capacity, updated: now };
  b.tokens = Math.min(capacity, b.tokens + ((now - b.updated) / 1000) * refillPerSec);
  b.updated = now;
  if (b.tokens < 1) {
    buckets.set(key, b);
    return { ok: false, retryAfter: Math.ceil((1 - b.tokens) / refillPerSec) };
  }
  b.tokens -= 1;
  buckets.set(key, b);
  if (buckets.size > 10_000) for (const [k, v] of buckets) if (now - v.updated > 600_000) buckets.delete(k);
  return { ok: true, retryAfter: 0 };
}

export function clientIp(req: NextRequest) {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "local";
}

/* ───────────── errors ───────────── */

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = "error",
  ) {
    super(message);
  }
}

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Same-origin check for state-changing requests (defence in depth alongside the CSRF token). */
function sameOrigin(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (!origin) return true; // non-browser clients; the CSRF token still applies
  try {
    return new URL(origin).host === (req.headers.get("x-forwarded-host") ?? req.headers.get("host"));
  } catch {
    return false;
  }
}

export interface HandlerCtx<B> {
  req: NextRequest;
  db: DB;
  user: SessionUser;
  body: B;
  params: Record<string, string>;
}

interface Options<B> {
  auth?: boolean; // default true
  body?: z.ZodType<B>;
  limit?: keyof typeof LIMITS;
  /** multipart uploads parse their own body */
  rawBody?: boolean;
}

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Wraps a route handler with: authentication, per-user/IP rate limiting, CSRF + origin checks for
 * mutations, Zod body validation, structured error responses and request logging.
 */
export function api<B = undefined>(opts: Options<B>, handler: (ctx: HandlerCtx<B>) => Promise<unknown>) {
  return async (req: NextRequest, routeCtx?: { params: Promise<Record<string, string>> }) => {
    const started = performance.now();
    const path = req.nextUrl.pathname;
    try {
      const user = opts.auth === false ? null : await getSessionUser();
      if (opts.auth !== false && !user) throw new ApiError(401, "Not signed in", "unauthenticated");
      const rl = rateLimit(`${opts.limit ?? "api"}:${user?.id ?? clientIp(req)}`, opts.limit ?? "api");
      if (!rl.ok) return NextResponse.json({ error: "Too many requests", code: "rate_limited" }, { status: 429, headers: { "retry-after": String(rl.retryAfter) } });
      if (MUTATING.has(req.method)) {
        if (!sameOrigin(req)) throw new ApiError(403, "Cross-origin request rejected", "bad_origin");
        if (user && !safeEqual(req.headers.get("x-csrf-token") ?? "", user.csrfToken)) throw new ApiError(403, "Invalid CSRF token", "csrf");
      }
      let body = undefined as B;
      if (opts.body && !opts.rawBody) {
        const len = Number(req.headers.get("content-length") ?? 0);
        if (len > 256 * 1024) throw new ApiError(413, "Request body too large");
        const text = await req.text();
        let json: unknown = {};
        if (text.trim()) {
          try {
            json = JSON.parse(text);
          } catch {
            throw new ApiError(400, "Invalid JSON body");
          }
        }
        const parsed = opts.body.safeParse(json);
        if (!parsed.success) throw new ApiError(400, parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "), "invalid_body");
        body = parsed.data;
      }
      const db = await getDb();
      const params = routeCtx ? await routeCtx.params : {};
      const result = await handler({ req, db, user: user!, body, params });
      logger.info("api.request", { method: req.method, path, status: 200, ms: Math.round(performance.now() - started), user: user?.id });
      if (result instanceof Response) return result;
      return NextResponse.json(result ?? { ok: true });
    } catch (err) {
      const status = err instanceof ApiError ? err.status : err instanceof UploadRejected ? 400 : 500;
      const message = err instanceof ApiError || err instanceof UploadRejected ? err.message : "Internal error";
      if (status >= 500) logger.error("api.error", err, { method: req.method, path });
      else logger.warn("api.rejected", { method: req.method, path, status, message });
      return NextResponse.json({ error: message, code: err instanceof ApiError ? err.code : status === 400 ? "bad_request" : "internal" }, { status });
    }
  };
}
