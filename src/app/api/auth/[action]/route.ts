import { eq } from "drizzle-orm";
import { z } from "zod";
import { api, ApiError } from "@/server/security/api";
import { createSession, destroySession } from "@/server/auth/session";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import * as s from "@/server/db/schema";
import { DEMO_EMAIL } from "@/server/db/seed";

const Login = z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200) });
const Signup = z.object({ name: z.string().trim().min(1).max(80), email: z.string().email().max(200), password: z.string().min(10, "Use at least 10 characters").max(200) });

// Constant-time-ish failure path: always run a hash comparison so timing doesn't reveal valid emails.
const DUMMY_HASH = "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$" + "A".repeat(86) + "==";

export const POST = api<unknown>({ auth: false, limit: "auth", body: z.unknown() }, async ({ db, body, params }) => {
  switch (params.action) {
    case "login": {
      const { email, password } = Login.parse(body);
      const [user] = await db.select().from(s.users).where(eq(s.users.email, email.toLowerCase()));
      const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
      if (!user || !ok) throw new ApiError(401, "Email or password is incorrect", "bad_credentials");
      await createSession(user.id);
      return { ok: true };
    }
    case "demo": {
      const [user] = await db.select().from(s.users).where(eq(s.users.email, DEMO_EMAIL));
      if (!user) throw new ApiError(404, "Demo workspace not available");
      await createSession(user.id);
      return { ok: true };
    }
    case "signup": {
      if (process.env.LIFEOS_ALLOW_SIGNUP === "false") throw new ApiError(403, "Sign-ups are disabled");
      const parsed = Signup.safeParse(body);
      if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message);
      const email = parsed.data.email.toLowerCase();
      const [exists] = await db.select({ id: s.users.id }).from(s.users).where(eq(s.users.email, email));
      if (exists) throw new ApiError(409, "An account with this email already exists");
      const [user] = await db.insert(s.users).values({ email, name: parsed.data.name, passwordHash: await hashPassword(parsed.data.password) }).returning();
      await db.insert(s.userSettings).values({ userId: user.id });
      await db.insert(s.integrations).values(
        ["email", "calendar", "storage", "github", "linkedin", "job_board", "banking", "notes", "messaging"].map((kind) => ({
          userId: user.id,
          kind,
          adapter: kind === "storage" ? "local-disk" : `mock-${{ email: "mail", calendar: "calendar", github: "github", linkedin: "linkedin", job_board: "jobs", banking: "openbanking", notes: "notes", messaging: "chat" }[kind as "email"]}`,
          status: kind === "storage" ? "connected" : "disconnected",
        })),
      );
      await createSession(user.id);
      return { ok: true };
    }
    case "logout":
      await destroySession();
      return { ok: true };
    default:
      throw new ApiError(404, "Unknown action");
  }
});
