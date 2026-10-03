"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowRight, Loader2, Sparkles } from "lucide-react";
import { apiFetch } from "@/lib/client-api";
import { Button, Card, Input, Label } from "@/components/ui/primitives";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/overlays";

export function LoginForm() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const params = useSearchParams();
  const next = params.get("next");
  const destination = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";

  async function submit(action: "login" | "signup" | "demo", form?: FormData) {
    setBusy(action);
    setError(null);
    try {
      const body = form ? Object.fromEntries(form.entries()) : {};
      await apiFetch(`/api/auth/${action}`, { body });
      window.location.href = destination;
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  return (
    <Card className="relative mx-auto w-full max-w-md p-6 sm:p-8">
      <div className="mb-6 flex items-center gap-3">
        <span className="relative flex size-9 items-center justify-center rounded-xl border border-accent/40 bg-accent-soft">
          <span className="absolute size-2.5 rounded-full bg-accent shadow-[0_0_14px_var(--accent)]" />
          <span className="absolute size-6 rounded-full border border-accent/30" />
        </span>
        <div>
          <div className="font-mono text-sm font-semibold tracking-[0.3em] text-fg">LIFEOS</div>
          <div className="text-xs text-muted">Opportunity & decision operating system</div>
        </div>
      </div>

      <Button variant="primary" size="lg" className="w-full" onClick={() => submit("demo")} disabled={!!busy}>
        {busy === "demo" ? <Loader2 className="animate-spin" /> : <Sparkles />} Enter the demo workspace
      </Button>
      <p className="mt-2 text-center text-xs text-faint">A fictional finance graduate's world, pre-loaded and fully interactive.</p>

      <div className="my-6 flex items-center gap-3 text-[11px] tracking-widest text-faint uppercase">
        <span className="h-px flex-1 bg-line" /> or use your account <span className="h-px flex-1 bg-line" />
      </div>

      <Tabs defaultValue="login">
        <TabsList className="w-full">
          <TabsTrigger value="login">Sign in</TabsTrigger>
          <TabsTrigger value="signup">Create account</TabsTrigger>
        </TabsList>
        <TabsContent value="login">
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              submit("login", new FormData(e.currentTarget));
            }}
          >
            <div className="space-y-1">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" autoComplete="email" required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="password">Password</Label>
              <Input id="password" name="password" type="password" autoComplete="current-password" required />
            </div>
            <Button type="submit" className="w-full" disabled={!!busy}>
              {busy === "login" ? <Loader2 className="animate-spin" /> : <ArrowRight />} Sign in
            </Button>
          </form>
        </TabsContent>
        <TabsContent value="signup">
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              submit("signup", new FormData(e.currentTarget));
            }}
          >
            <div className="space-y-1">
              <Label htmlFor="name">Name</Label>
              <Input id="name" name="name" autoComplete="name" required maxLength={80} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="su-email">Email</Label>
              <Input id="su-email" name="email" type="email" autoComplete="email" required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="su-password">Password</Label>
              <Input id="su-password" name="password" type="password" autoComplete="new-password" required minLength={10} />
              <p className="text-[11px] text-faint">At least 10 characters. Stored as a salted scrypt hash.</p>
            </div>
            <Button type="submit" className="w-full" disabled={!!busy}>
              {busy === "signup" ? <Loader2 className="animate-spin" /> : <ArrowRight />} Create empty workspace
            </Button>
          </form>
        </TabsContent>
      </Tabs>
      {error && <p className="mt-4 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">{error}</p>}
    </Card>
  );
}
