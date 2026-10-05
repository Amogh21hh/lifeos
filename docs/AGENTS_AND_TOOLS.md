# Agents & tools

## Agent runtime (`src/server/agents/base.ts`)

Each agent declares:

| Field | Meaning |
|---|---|
| `name`, `description`, `responsibilities` | What it's for |
| `input` | Zod schema, validated before `run` |
| `output` | Zod schema (default `{ summary, blocks[] }`), validated after `run` |
| `tools` | Allowlist. The registry denies anything else and audits the denial |
| `run(ctx, input)` | Uses `ctx.tool()` / `ctx.need()` for tools and `ctx.llmStructured()` for optional LLM calls |

`runAgent` records an `ai_runs` row covering:

- status: ok / partial (LLM failed, fell back) / error
- engine and model
- tokens, cost and latency
- the full trace: tool calls, LLM calls and notes

Errors become structured error blocks, never silent failures.

## Agents

| Agent | Responsibility | Tools |
|---|---|---|
| ResearchAgent | Hybrid search, graph exploration, memory recall, web search (with approval) | search_everything, search_memory, find_relationships, search_web |
| PlannerAgent | Weekly focus plans, weekly report, time/project simulations, deadlines | rank_actions, what_am_i_missing, find_deadlines, weekly_review, generate_report, calculate_scenario |
| DocumentAgent | Explain extractions, create projects/tasks from documents, LLM extraction enhancer | analyze_document, create_project_from_document, create_task, search_documents |
| DecisionAgent | Draft and analyse decision models; reuse matching open decisions | create_decision, analyze_decision, search_memory, finance_overview |
| OpportunityAgent | Objective → routes; fit analysis | opportunity_radar, analyze_opportunity, create_opportunity, rank_actions |
| MemoryAgent | Recall with provenance; propose memories (never silent) | search_memory, create_memory |
| ProjectAgent | Autopilot plans, unfinished/stalled lists, task proposals, evidence links, breaking down stuck tasks | get_project, list_projects, move_project_forward, create_task, link_entities, what_am_i_missing |
| FinanceAgent | Position, runway, money scenarios. No investment advice | finance_overview, calculate_scenario |
| ReflectionAgent | What am I missing, what changed, explain a recommendation, missing information | what_am_i_missing, what_changed, rank_actions, analyze_decision |
| OutreachAgent | Grounded message drafts; proposes sends | draft_message, send_message, what_am_i_missing |

## Orchestrator (`orchestrator.ts`)

Ordered regex rules map a command to `{ intent, agent, input }`. If no rule matches confidently and an LLM is configured, the LLM classifies the command into the **same closed intent set** using structured output. It therefore cannot reach an agent or tool outside the routing table. Page context (for example, the current project) fills in the target entity.

Example commands: "Show me everything related to my finance career", "Find unfinished projects", "What should I focus on this week?", "Analyze this opportunity Halcyon", "Create a project from the Halcyon document", "Find missing information", "Explain why you recommended replying to Priya", "Show me what changed since last week", "Prepare my weekly review", "Should I buy this car?", "I want to increase my income", "What happens if I work 10 extra hours this month?", "Draft a reply to Maya", "Remember that…", "Break down task …".

## Tool registry (`src/server/tools`)

Every tool has a name, description, Zod input/output schemas, a permission level, an optional `propose()` (the human-readable approval text), `summarize()` and `entities()` for the audit log.

| Permission | Behaviour |
|---|---|
| `read` | Runs immediately |
| `write` | Queued in `approvals` unless `autoApprove` (only derived, non-destructive artefacts: `create_decision` workspaces requested by the user, `generate_report`) |
| `external` | Always queued (data leaves LIFEOS) |
| `destructive` | Always queued, marked high risk |

**Read tools:**

- search_everything, search_documents, search_memory
- get_project, list_projects, get_goal
- find_deadlines, find_relationships, analyze_document
- rank_actions, what_am_i_missing, what_changed, weekly_review
- calculate_scenario, opportunity_radar, analyze_opportunity
- move_project_forward, analyze_decision, finance_overview, draft_message

**Write tools:**

- create_task, update_task, create_opportunity
- create_decision (auto), create_memory, link_entities
- create_project_from_document, generate_report (auto)

**External tools:** send_message, search_web.

**Destructive tools:** delete_entity.

Every call, including denials, validation errors and pending approvals, is written to `tool_calls` with its permission, status, latency, output summary and the entity IDs it accessed. Approving an item executes exactly the stored payload, once; a second approval is rejected. Settings → Tool registry and AI activity show all of this in the UI, and `GET /api/account/tools` returns the full JSON Schemas.

## Adding a tool

```ts
defineTool({
  name: "my_tool",
  description: "…",
  permission: "write",
  input: z.object({ … }),
  output: z.object({ … }),
  propose: (input) => ({ title: "…", explanation: "…" }),
  async handler(ctx, input) { … },
});
```

Then add its name to the `tools` allowlist of the agent(s) that may use it.
