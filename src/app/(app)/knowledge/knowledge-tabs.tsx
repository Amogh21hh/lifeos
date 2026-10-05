"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { Brain, Check, Loader2, Network, Pencil, Search, ShieldAlert, StickyNote, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import type { SearchResult } from "@/lib/types";
import { apiFetch } from "@/lib/client-api";
import { cn } from "@/lib/cn";
import { Badge, Button, Card, EmptyState, Input, Skeleton, Textarea } from "@/components/ui/primitives";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/overlays";
import { SearchResults } from "@/components/lifeos/blocks";
import { CreateEntityDialog } from "@/components/lifeos/controls";
import { EntityLink } from "@/components/lifeos/entity";
import type { GraphData } from "./graph-view";

const GraphView = dynamic(() => import("./graph-view").then((m) => m.GraphView), { ssr: false, loading: () => <Skeleton className="h-[640px] w-full rounded-2xl" /> });

interface Memory {
  id: string;
  content: string;
  category: string;
  source: string;
  confidence: number;
  importance: number;
  status: string;
  createdAt: string;
  lastVerifiedAt: string | null;
  sourceRefType: string | null;
  sourceRefId: string | null;
  stale: boolean;
}
interface NoteItem {
  id: string;
  type: "note" | "idea";
  title: string;
  body: string;
  status?: string;
  date: string;
}

export function KnowledgeTabs({ initialTab, initialQuery, focus, memories, graph, notes }: { initialTab: string; initialQuery: string; focus: string | null; memories: Memory[]; graph: GraphData; notes: NoteItem[] }) {
  const [tab, setTab] = useState(initialTab);
  return (
    <Tabs value={tab} onValueChange={setTab}>
      <TabsList>
        <TabsTrigger value="search"><Search /> Search</TabsTrigger>
        <TabsTrigger value="memory"><Brain /> Memory <span className="font-mono text-[10px] text-faint">{memories.length}</span></TabsTrigger>
        <TabsTrigger value="graph"><Network /> Graph</TabsTrigger>
        <TabsTrigger value="notes"><StickyNote /> Notes & ideas</TabsTrigger>
      </TabsList>
      <TabsContent value="search"><SearchPanel initialQuery={initialQuery} /></TabsContent>
      <TabsContent value="memory"><MemoryPanel memories={memories} /></TabsContent>
      <TabsContent value="graph">{tab === "graph" && <GraphView data={graph} focus={focus} />}</TabsContent>
      <TabsContent value="notes"><NotesPanel notes={notes} /></TabsContent>
    </Tabs>
  );
}

const SEARCH_EXAMPLES = ["What did I decide about the laptop?", "Show me every document related to Halcyon Bank", "Where did I mention the notice deadline?", "What projects demonstrate my Python skills?", "Which commitments are currently overdue?", "Find everything connected to Priya Shah"];

function SearchPanel({ initialQuery }: { initialQuery: string }) {
  const [q, setQ] = useState(initialQuery);
  const [busy, setBusy] = useState(!!initialQuery);
  const [res, setRes] = useState<{ results: SearchResult[]; ms: number; parsed: { types: string[]; status: string | null; anchor: string | null } } | null>(null);
  async function run(query: string) {
    if (!query.trim()) return;
    setQ(query);
    setBusy(true);
    try {
      setRes(await apiFetch(`/api/search?q=${encodeURIComponent(query)}`));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  // Run a query passed in the URL (?q=…); state updates happen in the async callback.
  useEffect(() => {
    if (!initialQuery) return;
    let cancelled = false;
    apiFetch<NonNullable<typeof res>>(`/api/search?q=${encodeURIComponent(initialQuery)}`)
      .then((r) => !cancelled && setRes(r))
      .catch((e: Error) => toast.error(e.message))
      .finally(() => !cancelled && setBusy(false));
    return () => {
      cancelled = true;
    };
  }, [initialQuery]);
  return (
    <div className="space-y-4">
      <form onSubmit={(e) => { e.preventDefault(); run(q); }} className="flex gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search everything — decisions, documents, people, deadlines…" className="h-11" />
        <Button type="submit" variant="primary" className="h-11" disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : <Search />} Search</Button>
      </form>
      {!res && (
        <div className="flex flex-wrap gap-1.5">
          {SEARCH_EXAMPLES.map((x) => (
            <button key={x} onClick={() => run(x)} className="rounded-full border border-line bg-elev px-2.5 py-1 text-xs text-muted hover:text-fg">{x}</button>
          ))}
        </div>
      )}
      {res && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <span>{res.results.length} results in {res.ms} ms · hybrid: keyword + semantic + metadata + graph</span>
            {res.parsed.types.map((t) => <Badge key={t}>type: {t}</Badge>)}
            {res.parsed.status && <Badge tone="signal">status: {res.parsed.status}</Badge>}
            {res.parsed.anchor && <Badge tone="accent">connected to: {res.parsed.anchor}</Badge>}
          </div>
          <SearchResults results={res.results} />
        </div>
      )}
    </div>
  );
}

function MemoryPanel({ memories }: { memories: Memory[] }) {
  const [filter, setFilter] = useState<string>("all");
  const cats = ["all", ...new Set(memories.map((m) => m.category))];
  const shown = memories.filter((m) => filter === "all" || m.category === filter);
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-xl border border-line bg-elev p-4 sm:flex-row sm:items-center">
        <ShieldAlert className="size-5 shrink-0 text-accent" />
        <p className="flex-1 text-sm text-muted">
          LIFEOS only remembers what you told it, what was in your documents and decisions, or what it inferred <span className="text-fg">and you approved</span>. Every memory shows where it came from. Edit, dispute or delete anything.
        </p>
        <CreateEntityDialog
          type="memory"
          title="New memory"
          fields={[
            { name: "content", label: "What should LIFEOS remember?", type: "textarea", required: true },
            { name: "category", label: "Category", type: "select", required: true, options: ["preference", "fact", "lesson", "constraint", "pattern", "person", "goal"].map((v) => ({ value: v, label: v })) },
            { name: "importance", label: "Importance (1–5)", type: "number", defaultValue: "3" },
          ]}
        />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {cats.map((c) => (
          <button key={c} onClick={() => setFilter(c)} className={cn("rounded-full border px-2.5 py-1 text-xs", filter === c ? "border-accent/50 bg-accent-soft text-fg" : "border-line text-muted hover:text-fg")}>{c}</button>
        ))}
      </div>
      {shown.length === 0 ? <EmptyState icon={<Brain />} title="No memories" /> : <div className="space-y-2">{shown.map((m) => <MemoryRow key={m.id} m={m} />)}</div>}
    </div>
  );
}

function MemoryRow({ m }: { m: Memory }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(m.content);
  const router = useRouter();
  async function patch(body: Record<string, unknown>, ok: string) {
    try {
      await apiFetch(`/api/entities/memory/${m.id}`, { method: "PATCH", body });
      toast.success(ok);
      setEditing(false);
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  const stale = m.stale;
  return (
    <Card className={cn("p-4", m.status !== "active" && "opacity-60")}>
      {editing ? (
        <div className="space-y-2">
          <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} />
          <div className="flex gap-1">
            <Button size="sm" variant="primary" onClick={() => patch({ content: text }, "Memory corrected")}><Check /> Save</Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}><X /> Cancel</Button>
          </div>
        </div>
      ) : (
        <p className="text-sm text-fg">{m.content}</p>
      )}
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-5">
        <div><dt className="text-faint">Source</dt><dd className="text-muted">{m.source.replace("_", " ")}{m.sourceRefType && m.sourceRefId ? <> · <EntityLink entity={{ type: m.sourceRefType, id: m.sourceRefId, label: m.sourceRefType }} className="text-xs" /></> : null}</dd></div>
        <div><dt className="text-faint">Confidence</dt><dd className="font-mono text-muted">{Math.round(m.confidence * 100)}%</dd></div>
        <div><dt className="text-faint">Importance</dt><dd className="font-mono text-muted">{m.importance}/5</dd></div>
        <div><dt className="text-faint">Created</dt><dd className="font-mono text-muted">{m.createdAt.slice(0, 10)}</dd></div>
        <div><dt className="text-faint">Last verified</dt><dd className={cn("font-mono", stale ? "text-signal" : "text-muted")}>{m.lastVerifiedAt?.slice(0, 10) ?? "never"}</dd></div>
      </dl>
      <div className="mt-3 flex flex-wrap items-center gap-1">
        <Badge>{m.category}</Badge>
        {m.status !== "active" && <Badge tone={m.status === "disputed" ? "danger" : "neutral"}>{m.status}</Badge>}
        <span className="ml-auto flex flex-wrap gap-1">
          <Button size="sm" variant="ghost" onClick={() => patch({ action: "verify" }, "Verified")}><Check /> Still true</Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}><Pencil /> Correct</Button>
          {m.status === "active" ? (
            <Button size="sm" variant="ghost" onClick={() => patch({ status: "disputed" }, "Marked as wrong — LIFEOS will stop using it")}><X /> Wrong</Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => patch({ status: "active" }, "Restored")}>Restore</Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              if (!window.confirm("Permanently delete this memory?")) return;
              await apiFetch(`/api/entities/memory/${m.id}`, { method: "DELETE" }).then(() => { toast.success("Deleted"); router.refresh(); }).catch((e) => toast.error(e.message));
            }}
          >
            <Trash2 /> Delete
          </Button>
        </span>
      </div>
    </Card>
  );
}

function NotesPanel({ notes }: { notes: NoteItem[] }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <CreateEntityDialog type="note" title="New note" fields={[{ name: "title", label: "Title", required: true }, { name: "body", label: "Note", type: "textarea", required: true }]} />
        <CreateEntityDialog type="idea" title="New idea" trigger={<Button>New idea</Button>} fields={[{ name: "title", label: "Idea", required: true }, { name: "body", label: "Details", type: "textarea" }]} />
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {notes.map((n) => (
          <Card key={n.id} className="p-4">
            <div className="flex items-center gap-2">
              <Badge tone={n.type === "idea" ? "signal" : "neutral"}>{n.type}</Badge>
              {n.status && <Badge>{n.status}</Badge>}
              <span className="ml-auto font-mono text-[11px] text-faint">{n.date}</span>
            </div>
            <div className="mt-2 font-medium text-fg">{n.title}</div>
            {n.body && <p className="mt-1 text-sm whitespace-pre-wrap text-muted">{n.body}</p>}
          </Card>
        ))}
        {!notes.length && <EmptyState title="No notes yet" />}
      </div>
    </div>
  );
}
