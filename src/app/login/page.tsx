import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth/session";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await getSessionUser()) redirect("/");
  return (
    <div className="bg-grid relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
      <div className="pointer-events-none absolute top-1/2 left-1/2 size-[900px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-accent/10" />
      <div className="pointer-events-none absolute top-1/2 left-1/2 size-[620px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-accent/10" />
      <div className="pointer-events-none absolute top-1/2 left-1/2 size-[340px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-accent/15" />
      <div className="pointer-events-none absolute top-1/2 left-1/2 size-[900px] -translate-x-1/2 -translate-y-1/2">
        <div className="animate-sweep size-full rounded-full bg-[conic-gradient(from_0deg,transparent_0deg,var(--accent-soft)_40deg,transparent_60deg)]" />
      </div>
      <div className="relative grid w-full max-w-5xl items-center gap-10 lg:grid-cols-[1.1fr_1fr]">
        <div className="hidden lg:block">
          <div className="font-mono text-xs tracking-[0.3em] text-accent uppercase">Personal intelligence OS</div>
          <h1 className="mt-3 text-4xl leading-tight font-semibold tracking-tight text-fg">
            Your goals, commitments, documents and opportunities —
            <span className="text-accent"> reasoned over continuously.</span>
          </h1>
          <ul className="mt-6 space-y-3 text-sm text-muted">
            {[
              "Ranks today's highest-leverage actions and shows exactly why",
              "Finds blind spots — every one backed by evidence from your data",
              "Turns “should I…?” into transparent decision models",
              "Never sends, spends, deletes or commits without your approval",
            ].map((t) => (
              <li key={t} className="flex gap-3">
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-accent shadow-[0_0_10px_var(--accent)]" />
                {t}
              </li>
            ))}
          </ul>
        </div>
        <Suspense>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}
