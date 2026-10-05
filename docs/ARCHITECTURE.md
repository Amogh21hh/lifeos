# Architecture

## Stack

| Layer | Choice | Why |
|---|---|---|
| App | Next.js 16 (App Router, Turbopack), React 19, TypeScript strict | Server components read data directly; route handlers form a clean API layer |
| UI | Tailwind v4 with semantic design tokens, Radix primitives (shadcn-style components), cmdk, Recharts, React Flow, lucide | Accessible primitives, dark/light themes, command palette |
| Database | PostgreSQL via Drizzle ORM. Embedded **PGlite** (WASM Postgres) by default; `DATABASE_URL` switches to node-postgres | Real Postgres semantics (FTS, pgvector, JSONB, FKs) with zero setup |
| Vector search | pgvector, HNSW cosine index | Hybrid retrieval alongside `tsvector` full-text search |
| Validation | Zod everywhere: API bodies, tool I/O, agent I/O, LLM structured output | One validation story end to end |
| AI | Provider abstraction: Anthropic SDK (structured outputs) or OpenAI-compatible; local engine when none | No vendor lock-in; no fake AI |
| Tests | Vitest (unit + integration on in-memory Postgres), Playwright (desktop + mobile E2E) | |

## Code map

```
src/
  app/
    (app)/                 authenticated pages (server components + small client islands)
    api/                   route handlers, all wrapped by security/api.ts
    login/                 public sign-in / demo entry
  components/
    ui/                    primitives (Button, Card, Dialog, Tabs, …)
    lifeos/                domain components: InsightCard, ApprovalCard, ResultBlocks, SimulationView…
    shell/                 app shell, nav, command palette, theme
  lib/                     shared types (Insight, Evidence, Provenance, ResultBlock), formatting
  server/
    db/                    schema.ts, client.ts (PGlite | Postgres), seed.ts, seed-docs.ts
    engine/                pure reasoning engines over a World snapshot
    search/                indexer (FTS + embeddings), hybrid search
    documents/             parse (validated), extract (rules with source spans), pipeline
    ai/                    llm.ts (providers), embeddings.ts
    tools/                 registry (permissions, approvals, audit) + definitions
    agents/                runtime (base.ts), agents.ts, orchestrator.ts
    integrations/          provider interfaces + mock adapters + sync
    auth/ security/ storage/ observability/ services/
drizzle/                   SQL migrations (generated from schema.ts)
tests/unit, tests/e2e
```

## Data model

The core entities are relational, with foreign keys and indexes: users, sessions, user_settings, goals, projects, tasks, habits/habit_logs, commitments, ideas, notes, companies, people, messages, skills, opportunities, opportunity_skills, applications, courses, credentials, accounts, transactions, assets, events, documents, document_fields, memories, decisions, decision_options, decision_criteria and decision_scores.

The intelligence layer adds these tables:

- **links**: typed graph edges (`from_type/from_id → to_type/to_id`, relation, strength, provenance, rationale). Structural foreign keys (project→goal, person→company, opportunity→skill) are also traversed as graph edges at query time.
- **activities**: the event stream behind "what changed", time allocation, neglect detection and postponement patterns.
- **search_index**: one row per entity, with a generated weighted `tsvector` (GIN) and `vector(256)` (HNSW).
- **insights**: user feedback on generated insights (dismissed / acted), keyed by a stable insight key.
- **ai_runs**, **tool_calls**, **approvals**: the full audit trail and the human-in-the-loop queue.
- **integrations**, **simulations**, **weekly_reports**.

JSONB is used only where the shape is genuinely open-ended: `decisions.model` (constraints, unknowns, risks, second-order effects), AI run payloads, approval payloads, integration config and stored reports.

## The reasoning model

```
             ┌──────────────── loadWorld(db, user) ────────────────┐
DB ─────────▶│ World: every entity + indexes + link adjacency       │  (~150 ms)
             └──────────────────────────────────────────────────────┘
                     │ pure functions (World, now) → explainable output
   ┌─────────┬───────┴──────┬──────────┬───────────┬──────────┬──────────┐
 signals   actions       missing     radar     decision   simulate   autopilot / weekly
 (fit,      (leverage    (17 det-    (routes,   (scenarios, (editable  (plans, reports,
 progress,  ranking)     ectors)     potentials) sensitivity) assumptions) changes)
 finance)
```

Every engine output is an `Insight` (or contains them): a conclusion, evidence tagged with `Provenance` (FACT, ESTIMATE, ASSUMPTION, USER INPUT, AI INFERENCE), assumptions, a confidence score, what would change the conclusion, a score breakdown, entity references and suggested actions. Detectors only fire when they can cite records. The integration tests assert this contract for every insight and check that an empty world produces none.

### Leverage scoring

`leverage = impact × urgency × confidence ÷ effort`

- **impact**: goal priority (0.2–1.0) plus fit and value bonuses
- **urgency**: `1 + 2·e^(−days/4)`; overdue items get 3.2
- **effort**: `1 + 0.5·log2(1 + minutes/30)`, dampened so important deep work isn't drowned out by trivial tasks

### Decision engine

Weights are normalised. Each option×criterion score has a pessimistic/base/optimistic range. The engine computes:

- weighted totals per scenario
- for each criterion, the weight at which the leader flips (scanning 0–2×)
- single-score swings that flip the leader
- the decision-quality checklist
- missing information
- lessons from past decisions and memories, matched semantically

New decisions are drafted heuristically, or by the LLM when configured. An open decision that already frames the same question is reused rather than duplicated.

### Search

`hybridSearch` parses the query for entity types, status filters (overdue, unfinished, blocked) and graph anchors ("connected to Priya", "demonstrate my Python skills"). It then retrieves candidates by FTS (OR-query, `ts_rank_cd`) and pgvector cosine, expands one to two hops from the anchor through links and foreign keys, and scores:

`0.45·keyword + 0.4·semantic + metadata + graph`

Every result lists its reasons.

## Request flow (Command Center)

```
POST /api/command ─▶ api() wrapper: session, rate limit, CSRF + origin, Zod body
   └▶ orchestrator.routeByRules(text)   (LLM classification into the same closed intent set if weak)
        └▶ runAgent(agent, input)       (ai_runs row, metered LLM, validated output)
             └▶ ctx.tool(name, input)   (registry: allowlist → Zod → permission gate)
                   read  → execute → tool_calls audit
                   write/external/destructive → approvals row → "pending_approval" block
POST /api/approvals/:id ─▶ resolveApproval → executes exactly the proposed payload, once
```

## AI usage, honestly

All ranking, detection, decision modelling, simulation and search are deterministic code over your data, so the product works fully offline and is testable. When a model is configured it does language work only:

- classifying ambiguous commands into a closed set of intents
- extracting document fields, with a verbatim quote per field that is located in the text to produce a source span (unverifiable fields are down-weighted)
- drafting decision structures
- narrating results from supplied facts only
- polishing message drafts

Every call goes through `llm.structured()` with a Zod schema, and every failure falls back to the deterministic path. Runs record engine, model, tokens, cost and latency.
