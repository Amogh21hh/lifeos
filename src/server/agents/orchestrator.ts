/**
 * Orchestrator: natural language → intent → agent(s) → structured result blocks.
 *
 * Routing is rule-first (fast, deterministic, explainable). When a rule match is weak and an LLM is
 * configured, the LLM classifies the request into the same closed set of intents (structured output),
 * so it can never invoke an agent or tool outside the routing table.
 */
import { z } from "zod";
import type { DB } from "@/server/db/client";
import type { ResultBlock } from "@/lib/types";
import { getLLM } from "@/server/ai/llm";
import { AGENTS } from "./agents";
import { runAgent, type TraceStep } from "./base";

export interface Route {
  intent: string;
  agent: keyof typeof AGENTS;
  input: Record<string, unknown>;
  confidence: number;
  matchedBy: "rule" | "llm" | "default";
  rule?: string;
}

type Rule = { intent: string; re: RegExp; agent: keyof typeof AGENTS; input: (text: string, m: RegExpMatchArray) => Record<string, unknown>; confidence: number };

const MONEY = /£|\bspend|\bbuy\b|\bcost|\bpay\b|\bearn|\bincome|\bsalary|\bmoney|\bsaving/i;

export const RULES: Rule[] = [
  { intent: "search", re: /^(show|find|search|list|get)( me)?.*(everything|all|every)|(related to|connected to|linked to)/i, agent: "ResearchAgent", input: (t) => ({ query: t }), confidence: 0.8 },
  { intent: "missing_info", re: /\bmissing information\b|what (info|information) (is|am i) missing/i, agent: "ReflectionAgent", input: (t) => ({ op: "missing_info", text: t }), confidence: 0.92 },
  { intent: "what_am_i_missing", re: /\b(what am i missing|blind spots?|what('?s| is) slipping|overlook)/i, agent: "ReflectionAgent", input: (t) => ({ op: "missing", text: t }), confidence: 0.95 },
  { intent: "what_changed", re: /\b(what('?s| has)? changed|what'?s new|since last (week|month)|recent changes)\b/i, agent: "ReflectionAgent", input: (t) => ({ op: "changes", text: t }), confidence: 0.9 },
  { intent: "explain", re: /\b(explain|why did you|why (is|was) .* recommend|reasoning behind)\b/i, agent: "ReflectionAgent", input: (t) => ({ op: "explain", text: t }), confidence: 0.85 },
  { intent: "weekly_review", re: /\b(weekly (review|report)|week in review|review (of )?my week)\b/i, agent: "PlannerAgent", input: () => ({ op: "weekly" }), confidence: 0.95 },
  { intent: "simulate_money", re: /\b(what happens if|what if|simulate)\b.*(£|spend|buy|pay|earn|income|retainer|cost)/i, agent: "FinanceAgent", input: (t) => ({ op: "simulate", question: t }), confidence: 0.92 },
  { intent: "simulate", re: /\b(what happens if|what if|simulate)\b/i, agent: "PlannerAgent", input: (t) => ({ op: "simulate", question: t }), confidence: 0.9 },
  { intent: "draft_message", re: /\b(draft|write|compose)\b.*\b(reply|message|email|follow[- ]?ups?|note|check[- ]?in)\b|\breply to\b/i, agent: "OutreachAgent", input: (t) => ({ text: t }), confidence: 0.9 },
  { intent: "project_from_document", re: /\bcreate (a )?project from\b/i, agent: "DocumentAgent", input: (t) => ({ op: "project_from_document", text: t }), confidence: 0.92 },
  { intent: "task_from_document", re: /\bcreate (a )?task for the .+ in\b/i, agent: "DocumentAgent", input: (t) => ({ op: "task_for_deadline", text: t }), confidence: 0.9 },
  { intent: "break_down", re: /\bbreak (down|up)\b/i, agent: "ProjectAgent", input: (t) => ({ op: "breakdown", text: t }), confidence: 0.88 },
  { intent: "link_evidence", re: /\blink\b.+\bto\b.+\b(opportunit|application|role)/i, agent: "ProjectAgent", input: (t) => ({ op: "link_evidence", text: t }), confidence: 0.85 },
  { intent: "create_task", re: /^(please )?(create|add) (a )?(task|todo|to-do)|^remind me to\b/i, agent: "ProjectAgent", input: (t) => ({ op: "create_task", text: t }), confidence: 0.9 },
  { intent: "move_project", re: /\b(move|push|get)\b.+\bforward\b|\bunstick\b|\bnext step for\b.+\bproject\b/i, agent: "ProjectAgent", input: (t) => ({ op: "autopilot", text: t }), confidence: 0.9 },
  { intent: "list_projects", re: /\b(unfinished|stalled|incomplete|open|stuck) projects?\b|\bfind .*projects\b/i, agent: "ProjectAgent", input: (t) => ({ op: "list", text: t }), confidence: 0.85 },
  { intent: "remember", re: /^(please )?(remember|note) (that )?/i, agent: "MemoryAgent", input: (t) => ({ op: "remember", text: t }), confidence: 0.9 },
  { intent: "recall", re: /\b(what do you (know|remember) about me|my memories|what have you learned about me)\b/i, agent: "MemoryAgent", input: (t) => ({ op: "recall", text: t }), confidence: 0.9 },
  { intent: "focus", re: /\b(what should i (focus|work) on|focus (on )?this week|prioriti[sz]e|plan my (week|day)|what should i do (today|next|this week))\b/i, agent: "PlannerAgent", input: () => ({ op: "focus" }), confidence: 0.9 },
  { intent: "deadlines", re: /\b(deadlines?|what'?s due|due (this|next) week)\b/i, agent: "PlannerAgent", input: () => ({ op: "deadlines" }), confidence: 0.7 },
  { intent: "analyze_opportunity", re: /\banaly[sz]e (this |the )?(opportunity|role|job|gig)\b|\banaly[sz]e opportunity\b/i, agent: "OpportunityAgent", input: (t) => ({ op: "analyze", name: t.replace(/.*?analy[sz]e (this |the )?(opportunity|role|job|gig)?\s*/i, "").replace(/["“”]/g, "") }), confidence: 0.85 },
  { intent: "opportunity_radar", re: /\b(increase|grow|boost|raise) my (income|earnings|salary|career)|\bways to (earn|make money|grow)|\bhow (can|could) i (earn|make|get|land)|\bopportunit(y|ies) (to|for)\b|\bi want to\b/i, agent: "OpportunityAgent", input: (t) => ({ op: "radar", objective: t }), confidence: 0.85 },
  { intent: "decision", re: /^(should i|which .+ should i|is it worth|would it be better)\b|\bshould i\b/i, agent: "DecisionAgent", input: (t) => ({ question: t }), confidence: 0.85 },
  { intent: "finance", re: /\b(runway|budget|finances?|cash ?flow|spending|net worth|money situation)\b/i, agent: "FinanceAgent", input: () => ({ op: "overview" }), confidence: 0.8 },
];

export function routeByRules(text: string): Route {
  const t = text.trim();
  for (const r of RULES) {
    const m = t.match(r.re);
    if (m) return { intent: r.intent, agent: r.agent, input: r.input(t, m), confidence: r.confidence, matchedBy: "rule", rule: r.re.source.slice(0, 60) };
  }
  if (MONEY.test(t) && /\?$/.test(t)) return { intent: "finance", agent: "FinanceAgent", input: { op: "overview" }, confidence: 0.5, matchedBy: "default" };
  return { intent: "search", agent: "ResearchAgent", input: { query: t }, confidence: 0.55, matchedBy: "default" };
}

const INTENTS = ["search", ...new Set(RULES.map((r) => r.intent))] as [string, ...string[]];
const IntentSchema = z.object({ intent: z.enum(INTENTS), confidence: z.number() });

async function routeWithLLM(text: string, mode: "auto" | "local"): Promise<Route | null> {
  const llm = getLLM(mode);
  if (!llm) return null;
  try {
    const { data } = await llm.structured({
      system: `Classify a LIFEOS command into exactly one intent. Intents: ${[...new Set(RULES.map((r) => r.intent)), "search"].join(", ")}. "search" = find/show information. "decision" = the user weighs a choice. "opportunity_radar" = the user states an objective and wants routes.`,
      prompt: text,
      schema: IntentSchema,
      maxTokens: 300,
    });
    if (data.intent === "search") return { intent: "search", agent: "ResearchAgent", input: { query: text }, confidence: data.confidence, matchedBy: "llm" };
    const rule = RULES.find((r) => r.intent === data.intent)!;
    return { intent: rule.intent, agent: rule.agent, input: rule.input(text, [] as unknown as RegExpMatchArray), confidence: data.confidence, matchedBy: "llm" };
  } catch {
    return null;
  }
}

export interface CommandResult {
  runId: string;
  intent: string;
  agent: string;
  route: Route;
  summary: string;
  blocks: ResultBlock[];
  status: string;
  engine: string;
  model: string | null;
  latencyMs: number;
  usage: { inputTokens: number; outputTokens: number; costUsd: number };
  trace: TraceStep[];
}

export async function runCommand(db: DB, userId: string, text: string, opts: { aiMode?: "auto" | "local"; context?: { entityType?: string; entityId?: string } } = {}): Promise<CommandResult> {
  let route = routeByRules(text);
  if (route.confidence < 0.6) route = (await routeWithLLM(text, opts.aiMode ?? "auto")) ?? route;
  // Page context (e.g. a project page) fills in the target entity when the command says "this".
  if (opts.context?.entityType === "project" && route.agent === "ProjectAgent") route.input.projectId = opts.context.entityId;
  if (opts.context?.entityType === "document" && route.agent === "DocumentAgent") route.input.documentId = opts.context.entityId;

  const agent = AGENTS[route.agent];
  const res = await runAgent(db, userId, agent as never, route.input, { intent: route.intent, aiMode: opts.aiMode });
  const out = res.output as { summary: string; blocks: ResultBlock[] };
  return {
    runId: res.runId,
    intent: route.intent,
    agent: route.agent,
    route,
    summary: out.summary,
    blocks: out.blocks,
    status: res.status,
    engine: res.engine,
    model: res.model,
    latencyMs: res.latencyMs,
    usage: res.usage,
    trace: [{ kind: "note", name: "routing", status: route.matchedBy, detail: `${route.intent} → ${route.agent} (${Math.round(route.confidence * 100)}% via ${route.matchedBy})` }, ...res.trace],
  };
}
