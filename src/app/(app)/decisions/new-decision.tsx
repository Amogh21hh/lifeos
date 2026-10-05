"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Scale } from "lucide-react";
import { toast } from "sonner";
import { apiFetch } from "@/lib/client-api";
import { Button, Input } from "@/components/ui/primitives";

const EXAMPLES = ["Should I spend £500 on a financial modelling course?", "Should I take the Fernhill contract?", "Which project should I work on?", "Should I buy a new laptop for £1,100?"];

export function NewDecision() {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  async function go(question: string) {
    if (question.trim().length < 5) return;
    setBusy(true);
    try {
      const r = await apiFetch<{ decisionId: string | null; error?: string }>("/api/decisions", { body: { question } });
      if (!r.decisionId) throw new Error(r.error ?? "Could not frame this decision");
      router.push(`/decisions/${r.decisionId}`);
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          go(q);
        }}
        className="flex gap-2"
      >
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Should I…?" className="h-10" maxLength={400} />
        <Button type="submit" variant="primary" className="h-10" disabled={busy || q.trim().length < 5}>
          {busy ? <Loader2 className="animate-spin" /> : <Scale />} Frame it
        </Button>
      </form>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {EXAMPLES.map((x) => (
          <button key={x} onClick={() => go(x)} disabled={busy} className="rounded-full border border-line bg-elev px-2.5 py-1 text-xs text-muted hover:text-fg">
            {x}
          </button>
        ))}
      </div>
    </div>
  );
}
