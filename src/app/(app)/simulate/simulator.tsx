"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FlaskConical, History, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { SimulationResult } from "@/lib/types";
import { apiFetch } from "@/lib/client-api";
import { Button, Input } from "@/components/ui/primitives";
import { SimulationView } from "@/components/lifeos/simulation-view";

const EXAMPLES = [
  "What happens if I work 10 extra hours this month?",
  "What happens if I stop the half-marathon training?",
  "What happens if I spend £300 on a course?",
  "What happens if I delay the WACC sensitivity table by 5 days?",
  "What happens if I learn SQL?",
  "What happens if I earn £180 per month from a retainer?",
];

export function Simulator({ history }: { history: { id: string; question: string; createdAt: string; result: SimulationResult }[] }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SimulationResult | null>(null);
  const router = useRouter();

  async function run(question: string) {
    if (question.trim().length < 3) return;
    setQ(question);
    setBusy(true);
    try {
      const r = await apiFetch<{ result: SimulationResult }>("/api/simulate", { body: { question, save: true } });
      setResult(r.result);
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(q);
          }}
          className="flex gap-2"
        >
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="What happens if…" className="h-11" maxLength={500} />
          <Button type="submit" variant="primary" className="h-11" disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <FlaskConical />} Simulate
          </Button>
        </form>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {EXAMPLES.map((x) => (
            <button key={x} onClick={() => run(x)} className="rounded-full border border-line bg-elev px-2.5 py-1 text-xs text-muted hover:text-fg">
              {x}
            </button>
          ))}
        </div>
      </div>

      {result && <SimulationView initial={result} />}

      {history.length > 0 && (
        <div>
          <h2 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.14em] text-muted uppercase">
            <History className="size-3.5" /> Previous simulations
          </h2>
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-elev">
            {history.map((h) => (
              <li key={h.id} className="flex items-center gap-3 px-4 py-2.5">
                <button onClick={() => setResult(h.result)} className="min-w-0 flex-1 text-left">
                  <div className="truncate text-sm text-fg">{h.question}</div>
                  <div className="truncate text-xs text-muted">{h.result.headline}</div>
                </button>
                <span className="shrink-0 font-mono text-[11px] text-faint">{h.createdAt.slice(0, 10)}</span>
                <button
                  onClick={async () => {
                    await apiFetch(`/api/simulate?id=${h.id}`, { method: "DELETE" }).catch(() => undefined);
                    router.refresh();
                  }}
                  className="text-faint hover:text-danger"
                  aria-label="Delete simulation"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
