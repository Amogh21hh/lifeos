"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import type { ResultBlock } from "@/lib/types";
import { apiFetch } from "@/lib/client-api";
import { Button, Input } from "@/components/ui/primitives";
import { ResultBlocks } from "./blocks";

/** Runs an agent directly from a page (e.g. Project Autopilot, Opportunity Radar) and renders its blocks. */
export function AgentRunner({ agent, input, label, icon, variant = "primary", autoRun = false, promptPlaceholder, promptKey, examples = [] }: { agent: string; input: Record<string, unknown>; label: string; icon?: React.ReactNode; variant?: "primary" | "secondary" | "signal"; autoRun?: boolean; promptPlaceholder?: string; promptKey?: string; examples?: string[] }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ summary: string; blocks: ResultBlock[]; latencyMs: number; engine: string } | null>(null);
  const [prompt, setPrompt] = useState("");
  const started = useRef(false);

  async function run(p?: string) {
    setBusy(true);
    try {
      const body = promptKey ? { ...input, [promptKey]: p ?? prompt } : input;
      setResult(await apiFetch(`/api/agents/${agent}`, { body }));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (autoRun && !started.current) {
      started.current = true;
      void run();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRun]);

  return (
    <div className="space-y-4">
      {promptKey ? (
        <div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (prompt.trim()) run();
            }}
            className="flex gap-2"
          >
            <Input value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={promptPlaceholder} className="h-10" />
            <Button type="submit" variant={variant} disabled={busy || !prompt.trim()} className="h-10">
              {busy ? <Loader2 className="animate-spin" /> : (icon ?? <Sparkles />)} {label}
            </Button>
          </form>
          {examples.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {examples.map((x) => (
                <button
                  key={x}
                  onClick={() => {
                    setPrompt(x);
                    run(x);
                  }}
                  className="rounded-full border border-line bg-elev px-2.5 py-1 text-xs text-muted hover:text-fg"
                >
                  {x}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <Button variant={variant} onClick={() => run()} disabled={busy}>
          {busy ? <Loader2 className="animate-spin" /> : (icon ?? <Sparkles />)} {label}
        </Button>
      )}
      {result && (
        <div className="animate-fade-in space-y-4">
          <p className="text-sm text-fg">
            {result.summary} <span className="font-mono text-[11px] text-faint">· {result.latencyMs} ms · {result.engine}</span>
          </p>
          <ResultBlocks blocks={result.blocks} />
        </div>
      )}
    </div>
  );
}
