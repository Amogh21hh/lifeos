# Testing

## Unit & integration (Vitest)

```bash
npm test
```

Runs on an **in-memory PGlite** database seeded with the full demo world. No dev data, network or AI provider is touched. 75 tests across four files:

- `tests/unit/extract.test.ts`: date parsing, document classification for all demo document types, JD/invoice/contract extraction, derived notice deadlines, the guarantee that every source span points at real text, and money/skill helpers.
- `tests/unit/storage.test.ts`: the database storage driver used on serverless hosts (round-trip, overwrite, delete, key validation).
- `tests/unit/security.test.ts`: password hashing, upload validation (spoofed extensions, unknown types, empty files, binary disguised as text), filename sanitisation, rate limiting, LLM schema sanitising.
- `tests/unit/engine.test.ts`:
  - demo data volumes
  - the **explainability contract** (every insight has evidence, a valid provenance, a confidence and a unique key)
  - leverage maths and ranking
  - the briefing
  - all major blind-spot detectors, plus "no invented problems in an empty world"
  - fit and visa penalty
  - decision analysis and drafting
  - all simulation types and assumption overrides
  - radar and inferred potentials
  - autopilot's smallest next action
  - the weekly report
  - hybrid search answers with match reasons
  - **tool permissions**: reads are audited, non-allowlisted tools are denied, writes are queued and executed once on approval, rejections change nothing, invalid input is rejected
  - orchestrator routing and an end-to-end command

## End-to-end (Playwright)

```bash
npx playwright install chromium
```

```bash
npm run test:e2e
```

This reuses a running `npm run dev` server or starts one. Seven tests:

- the auth redirect
- the TODAY explanation panel
- every main page rendering
- the Command Center propose → approve → executed → memory visible flow
- explained search results
- the Radar's potential-opportunity reasoning panel
- mobile: no horizontal overflow on key pages, and the bottom navigation works

Note: the E2E suite writes to the database used by the dev server (approvals, a memory). Use **Settings → Reset demo workspace** to restore the original demo.

## Type checking

```bash
npm run typecheck
```

On machines with little free RAM:

```bash
NODE_OPTIONS="--max-semi-space-size=1 --max-old-space-size=1536" npm run typecheck
```
