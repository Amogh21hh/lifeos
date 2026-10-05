# LIFEOS: Personal Opportunity & Decision Operating System

LIFEOS turns your goals, commitments, documents, opportunities, skills, money, projects and deadlines into one model of your world, then reasons over it continuously:

- **TODAY** ranks your highest-leverage actions and explains each one: impact × urgency × confidence ÷ effort.
- **What am I missing?** runs 17 independent detectors that find blind spots. Each one must cite records before it can speak.
- **LIFEOS Radar** is a radial map of your world with *potential opportunities* inferred from connections. Each shows why it exists, what supports it, what's missing, what could unlock it and the next action.
- **Decision engine** builds weighted models, pessimistic/base/optimistic scenarios, sensitivity flip-points, decisive unknowns and second-order effects. It never chooses for you.
- **Opportunity radar** maps an objective to ranked routes. Upside is labelled FACT, ESTIMATE or ASSUMPTION.
- **Simulator** answers "What happens if…" with every assumption exposed as a slider.
- **Project autopilot** produces a concrete plan that starts with the smallest useful next action.
- **Document intelligence** extracts fields from PDF, DOCX, XLSX, CSV, TXT and images, and links each field to the exact source text.
- **Hybrid search** combines keyword, semantic (pgvector), metadata and knowledge-graph signals, with match reasons.
- **Memory** has provenance on every item (source, confidence, last verified) and you can inspect, correct, dispute or delete anything.
- **Command Center** routes natural language to 10 specialised agents that use 28 permissioned, audited tools.
- **Human control:** writes, external sends and deletes are always *proposed → explained → approved → executed*.

## Quick start

Requirements: Node.js 20.9+ (tested on 24). Nothing else: no Docker, no Postgres, no API keys.

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:3000 and click **Enter the demo workspace**. On first boot LIFEOS creates an embedded Postgres database in `./.data/pglite`, applies migrations and seeds the demo world, which takes about 1 second.

Demo account, if you prefer the sign-in form: `demo@lifeos.app` / `lifeos-demo-2026`.

### Optional configuration

Copy `.env.example` to `.env.local`. Common options:

| Variable | Effect |
|---|---|
| `ANTHROPIC_API_KEY` | Adds Claude (`claude-opus-5-5` by default) for intent parsing, document extraction, decision drafting and grounded narration |
| `AI_PROVIDER=openai_compatible` + `OPENAI_COMPAT_BASE_URL` | Any OpenAI-compatible endpoint (Ollama, vLLM, Azure…) |
| `DATABASE_URL` | Use a real PostgreSQL with pgvector instead of embedded PGlite |
| `EMBEDDINGS_PROVIDER=openai_compatible` | Remote embeddings (requested at 256 dims) instead of the local hashing embedder |

Without an AI key, everything still works: all analysis runs on deterministic engines over your data. Settings → AI engine shows what's active, and you can force **Local only**.

### Production-style stack

```bash
docker compose up --build
```

This runs LIFEOS with PostgreSQL 17 and pgvector.

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build / serve |
| `npm test` | Unit and integration tests (Vitest, in-memory Postgres) |
| `npm run test:e2e` | End-to-end tests (Playwright; reuses a running dev server). Run `npx playwright install chromium` once first |
| `npm run typecheck` | TypeScript |
| `npm run db:reset` | Re-create the demo workspace. Stop the dev server first when using PGlite |
| `npm run db:generate` | Generate a migration after editing `src/server/db/schema.ts` |

## Documentation

- [Architecture](docs/ARCHITECTURE.md): stack, data model, engines, request flow
- [Agents & tools](docs/AGENTS_AND_TOOLS.md): every agent, every tool, permissions, approval flow
- [Security](docs/SECURITY.md): threat model and controls
- [Integrations roadmap](docs/ROADMAP.md): adapter interfaces and the path to real providers
- [Testing](docs/TESTING.md): what's covered and how to run it

## The demo world

Amogh is a fictional MSc Finance graduate in London on a Graduate visa. He is hunting for sponsor-licensed credit and FP&A roles, freelancing, and studying for CFA Level I. The demo includes 11 goals, 11 projects, 31 tasks, 16 opportunities, 11 people, 10 companies, 11 documents, 23 memories and 10 decisions, plus 3 months of transactions, events, messages and an activity history.

The data is deliberately imperfect: there are unanswered recruiters, an unlinked portfolio project, a postponed Ethics module, a buried tenancy notice deadline and a gym membership for a stalled goal. The engines find these themselves; nothing is hard-coded. All dates are relative to "now", so the demo is always current.
