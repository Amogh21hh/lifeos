"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, Bot, ChevronDown, Cpu, History, Loader2, Wrench } from "lucide-react";
import type { ResultBlock } from "@/lib/types";
import { cn } from "@/lib/cn";
import { apiFetch } from "@/lib/client-api";
import { Badge } from "@/components/ui/primitives";
import { ResultBlocks } from "@/components/lifeos/blocks";

interface TraceStep {
  kind: string;
  name: string;
  status: string;
  ms?: number;
  detail?: string;
}
interface CommandResult {
  runId: string;
  intent: string;
  agent: string;
  summary: string;
  blocks: ResultBlock[];
  status: string;
  engine: string;
  model: string | null;
  latencyMs: number;
  usage: { inputTokens: number; outputTokens: number; costUsd: number };
  trace: TraceStep[];
}
interface Turn {
  id: number;
  text: string;
  result?: CommandResult;
  error?: string;
}

const EXAMPLES = [
  "Show me everything related to my finance career.",
  "Find unfinished projects.",
  "What should I focus on this week?",
  "Analyze this opportunity Halcyon",
  "Create a project from the Halcyon document",
  "Find missing information.",
  "Explain why you recommended replying to Priya",
  "Show me what changed since last week.",
  "Prepare my weekly review.",
  "Should I spend £500 on a modelling course?",
  "Draft a reply to Maya",
  "Remember that I prefer hybrid roles",
];

export function CommandCenter({ initialQuery, context, recent }: { initialQuery: string; context?: { entityType: string; entityId: string }; recent: string[] }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const ran = useRef<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  async function run(q: string) {
    const query = q.trim();
    if (!query || busy) return;
    const id = Date.now();
    setTurns((t) => [...t, { id, text: query }]);
    setText("");
    setBusy(true);
    try {
      const result = await apiFetch<CommandResult>("/api/command", { body: { text: query, context } });
      setTurns((t) => t.map((x) => (x.id === id ? { ...x, result } : x)));
    } catch (e) {
      setTurns((t) => t.map((x) => (x.id === id ? { ...x, error: (e as Error).message } : x)));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (initialQuery && ran.current !== initialQuery) {
      ran.current = initialQuery;
      void run(initialQuery);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns]);

  return (
    <div>
      {turns.length === 0 && (
        <div className="mb-6 space-y-4">
          <div>
            <div className="mb-2 text-[11px] font-semibold tracking-[0.14em] text-muted uppercase">Try</div>
            <div className="flex flex-wrap gap-2">
              {EXAMPLES.map((e) => (
                <button key={e} onClick={() => run(e)} className="rounded-full border border-line bg-elev px-3 py-1.5 text-xs text-muted transition-colors hover:border-accent/40 hover:text-fg">
                  {e}
                </button>
              ))}
            </div>
          </div>
          {recent.length > 0 && (
            <div>
              <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.14em] text-muted uppercase">
                <History className="size-3.5" /> Recent
              </div>
              <div className="flex flex-wrap gap-2">
                {recent.map((e) => (
                  <button key={e} onClick={() => run(e)} className="max-w-full truncate rounded-full border border-dashed border-line px-3 py-1.5 text-xs text-faint hover:text-fg">
                    {e}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="space-y-8">
        {turns.map((t) => (
          <div key={t.id} className="animate-fade-in">
            <div className="mb-3 flex justify-end">
              <div className="max-w-[85%] rounded-2xl rounded-br-md bg-accent px-4 py-2 text-sm text-accent-fg">{t.text}</div>
            </div>
            {!t.result && !t.error && (
              <div className="flex items-center gap-2 text-sm text-muted">
                <Loader2 className="size-4 animate-spin text-accent" /> Routing to an agent and running tools…
              </div>
            )}
            {t.error && <div className="rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">{t.error}</div>}
            {t.result && <ResultView r={t.result} />}
          </div>
        ))}
        <div ref={bottom} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(text);
        }}
        className="sticky bottom-20 mt-8 flex items-end gap-2 rounded-2xl border border-line bg-elev p-2 shadow-card lg:bottom-6"
      >
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              run(text);
            }
          }}
          rows={1}
          placeholder="Ask, decide, plan, search, simulate…"
          className="max-h-40 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-sm text-fg outline-none placeholder:text-faint"
          aria-label="Command"
        />
        <button type="submit" disabled={busy || !text.trim()} className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-fg disabled:opacity-40" aria-label="Run">
          {busy ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
        </button>
      </form>
    </div>
  );
}

function ResultView({ r }: { r: CommandResult }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-accent/30 bg-accent-soft">
          <Bot className="size-4 text-accent" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone="accent">{r.agent}</Badge>
            <Badge>{r.intent.replace(/_/g, " ")}</Badge>
            {r.status !== "ok" && <Badge tone={r.status === "error" ? "danger" : "warning"}>{r.status}</Badge>}
            <span className="font-mono text-[11px] text-faint">
              {r.latencyMs} ms · {r.engine === "local" ? "local engine" : r.model}
              {r.usage.inputTokens ? ` · ${r.usage.inputTokens + r.usage.outputTokens} tok · $${r.usage.costUsd.toFixed(4)}` : ""}
            </span>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-fg">{r.summary}</p>
          <button onClick={() => setOpen((o) => !o)} className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-faint hover:text-muted">
            <ChevronDown className={cn("size-3 transition-transform", open && "rotate-180")} /> Reasoning trace ({r.trace.length} steps)
          </button>
          {open && (
            <ol className="mt-2 space-y-1 rounded-lg border border-line bg-sunken p-2.5 font-mono text-[11px]">
              {r.trace.map((s, i) => (
                <li key={i} className="flex items-start gap-2 text-muted">
                  {s.kind === "tool" ? <Wrench className="mt-0.5 size-3 text-accent" /> : s.kind === "llm" ? <Cpu className="mt-0.5 size-3 text-p-ai" /> : <span className="mt-1 size-1.5 rounded-full bg-faint" />}
                  <span className="text-fg">{s.name}</span>
                  <span className={cn(s.status === "ok" ? "text-success" : s.status === "pending_approval" ? "text-signal" : s.status === "error" || s.status === "denied" ? "text-danger" : "text-faint")}>{s.status}</span>
                  {s.ms !== undefined && <span className="text-faint">{s.ms}ms</span>}
                  {s.detail && <span className="min-w-0 truncate text-faint">{s.detail}</span>}
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
      <ResultBlocks blocks={r.blocks} />
    </div>
  );
}
