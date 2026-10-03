"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, TerminalSquare } from "lucide-react";
import { cn } from "@/lib/cn";

export function QuickAsk({ placeholder = "Ask LIFEOS… e.g. “Should I take the Fernhill contract?”", suggestions = [], className, context }: { placeholder?: string; suggestions?: string[]; className?: string; context?: { type: string; id: string } }) {
  const [q, setQ] = useState("");
  const router = useRouter();
  const go = (text: string) => {
    if (!text.trim()) return;
    const ctx = context ? `&ctx=${context.type}:${context.id}` : "";
    router.push(`/command?q=${encodeURIComponent(text.trim())}${ctx}`);
  };
  return (
    <div className={className}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          go(q);
        }}
        className="flex items-center gap-2 rounded-xl border border-line bg-elev px-3 py-1.5 focus-within:border-accent/60 focus-within:shadow-[0_0_0_3px_var(--accent-soft)]"
      >
        <TerminalSquare className="size-4 shrink-0 text-accent" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} className="h-8 min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-faint" aria-label="Ask LIFEOS" />
        <button type="submit" className={cn("rounded-lg p-1.5 text-muted transition-colors hover:bg-hover hover:text-fg", q && "text-accent")} aria-label="Run command">
          <ArrowRight className="size-4" />
        </button>
      </form>
      {suggestions.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {suggestions.map((s) => (
            <button key={s} onClick={() => go(s)} className="rounded-full border border-line bg-elev px-2.5 py-1 text-xs text-muted transition-colors hover:border-accent/40 hover:text-fg">
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
