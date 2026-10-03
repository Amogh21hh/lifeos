/**
 * Shared domain types for explainable intelligence.
 * Used by server engines and client renderers alike — no server imports here.
 */

/** Where a piece of information came from. Rendered as a tag on every evidence line. */
export type Provenance = "fact" | "estimate" | "assumption" | "user_input" | "ai_inference";

export const PROVENANCE_LABEL: Record<Provenance, string> = {
  fact: "FACT",
  estimate: "ESTIMATE",
  assumption: "ASSUMPTION",
  user_input: "USER INPUT",
  ai_inference: "AI INFERENCE",
};

export type EntityType =
  | "goal"
  | "project"
  | "task"
  | "person"
  | "company"
  | "opportunity"
  | "application"
  | "document"
  | "skill"
  | "course"
  | "credential"
  | "transaction"
  | "account"
  | "asset"
  | "event"
  | "commitment"
  | "habit"
  | "idea"
  | "note"
  | "message"
  | "decision"
  | "memory"
  | "user";

export interface EntityRef {
  type: EntityType;
  id: string;
  label: string;
}

export interface Evidence {
  text: string;
  provenance: Provenance;
  ref?: EntityRef;
}

export type Confidence = "low" | "medium" | "high";

export interface SuggestedAction {
  label: string;
  /** Natural-language command the Command Center can execute, or a route. */
  command?: string;
  href?: string;
  /** Estimated minutes to complete. */
  minutes?: number;
}

/**
 * The universal explainable unit. Every AI-generated conclusion in LIFEOS is an Insight:
 * conclusion + evidence + assumptions + confidence + what would change it.
 */
export interface Insight {
  key: string;
  kind: "action" | "blind_spot" | "pattern" | "radar" | "decision" | "simulation" | "project";
  title: string;
  conclusion: string;
  evidence: Evidence[];
  assumptions: string[];
  confidence: Confidence;
  confidenceScore: number; // 0..1
  wouldChange: string[];
  severity?: "info" | "watch" | "important" | "critical";
  score?: number;
  scoreBreakdown?: { factor: string; value: number; note: string }[];
  actions?: SuggestedAction[];
  refs?: EntityRef[];
  detector?: string;
}

export function confidenceFromScore(score: number): Confidence {
  if (score >= 0.75) return "high";
  if (score >= 0.45) return "medium";
  return "low";
}

/** Typed result blocks produced by agents and rendered by the Command Center. */
export type ResultBlock =
  | { type: "text"; title?: string; body: string }
  | { type: "insights"; title: string; items: Insight[] }
  | { type: "entities"; title: string; items: (EntityRef & { subtitle?: string; meta?: string; reason?: string })[] }
  | { type: "search"; title: string; results: SearchResult[] }
  | { type: "plan"; title: string; steps: PlanStep[]; rationale?: string }
  | { type: "approval"; approvalId: string; title: string; explanation: string; risk: string; tool: string; payload: Record<string, unknown> }
  | { type: "metrics"; title: string; items: { label: string; value: string; provenance: Provenance; hint?: string }[] }
  | { type: "decision"; decisionId: string; title: string }
  | { type: "simulation"; result: SimulationResult }
  | { type: "radar"; title: string; routes: OpportunityRoute[]; objective: string }
  | { type: "report"; reportId?: string; title: string; href: string }
  | { type: "memories"; title: string; items: { id: string; content: string; source: string; confidence: number }[] };

export interface PlanStep {
  title: string;
  detail: string;
  minutes?: number;
  why: string;
  refs?: EntityRef[];
  kind?: "do" | "decide" | "ask" | "prepare";
}

export interface SearchResult {
  ref: EntityRef;
  snippet: string;
  score: number;
  reasons: string[];
  signals: { keyword: number; semantic: number; metadata: number; graph: number };
}

export interface OpportunityRoute {
  id: string;
  title: string;
  kind: "existing" | "inferred";
  ref?: EntityRef;
  upside: { low: number; high: number; period: string; provenance: Provenance; note: string } | null;
  timeHours: { value: number; provenance: Provenance } | null;
  cost: { value: number; provenance: Provenance } | null;
  difficulty: number | null;
  confidence: Confidence;
  confidenceScore: number;
  fitScore: number;
  deadline: string | null;
  dependencies: string[];
  skillsMatched: string[];
  skillsMissing: string[];
  whyItFits: Evidence[];
  assumptions: string[];
  nextAction: string;
  expectedValueNote: string;
}

export interface SimulationAssumption {
  key: string;
  label: string;
  value: number;
  unit: string;
  provenance: Provenance;
  min?: number;
  max?: number;
  step?: number;
}

export interface SimulationResult {
  id?: string;
  question: string;
  scenarioType: "extra_hours" | "stop_project" | "spend" | "delay_deadline" | "learn_skill" | "income_change" | "unknown";
  headline: string;
  assumptions: SimulationAssumption[];
  effects: { label: string; before: string; after: string; delta: string; provenance: Provenance; direction: "up" | "down" | "flat" }[];
  timeline?: { label: string; base: number; scenario: number }[];
  timelineUnit?: string;
  risks: string[];
  secondOrder: string[];
  caveats: string[];
  confidence: Confidence;
}
