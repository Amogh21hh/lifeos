# Security notes

## Authentication & sessions
- Passwords are hashed with scrypt (N=16384, r=8, p=1, 16-byte salt) and compared in constant time. Failed logins also run a dummy hash, so response timing doesn't reveal whether an email exists.
- Sessions use an opaque 256-bit random token in an `httpOnly`, `SameSite=Lax` cookie (`Secure` in production). Only `sha256(token)` is stored. Sessions expire after 14 days; expired rows are pruned when a new session is created.
- `proxy.ts` redirects unauthenticated page requests to `/login`. Every page and API call re-validates the session on the server.

## Authorization
- Every query is scoped by `user_id`. Entity routes verify ownership before reading or writing. Cross-user IDs return 404.
- User CRUD goes through per-type Zod whitelists (`services/entities.ts`). There's no mass assignment.

## CSRF & origin
- Every mutating request needs an `x-csrf-token` header matching the session's CSRF token (double-submit, compared in constant time). The browser `Origin` must also match the host.

## Rate limiting
- Token buckets per user or IP: auth 10/min, AI 30/min, uploads 20 per 5 min, general API 240 burst.
- They are in-memory. Swap in Redis for multi-instance deployments; the interface is a single function.

## Input validation
- All route bodies, tool inputs and outputs, agent inputs and outputs, and LLM outputs are Zod-validated. JSON bodies are capped at 256 KB.

## Files
- Allowed extensions are a short list, and each file's **magic bytes** must match its extension. Text files may not contain NUL bytes. Uploads are capped at 10 MB.
- Filenames are sanitised. Storage keys are server-generated (`<userId>/<uuid>`), and the local storage adapter re-checks path containment.
- Parsing uses pure-JS libraries (unpdf, mammoth, exceljs, papaparse). Nothing uploaded is ever executed.
- Downloads are served as attachments with `nosniff` and a sandboxing CSP. Inline viewing is limited to PDF, images and plain text.

## Output safety
- React escapes all rendered text. The one `dangerouslySetInnerHTML` (search highlights) escapes the snippet first and only re-inserts our own `<mark>` markers.
- Security headers: CSP (`frame-ancestors 'none'`, `object-src 'none'`, `connect-src 'self'`), X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy, and HSTS in production.

## Secrets
- API keys are read server-side only (`src/server/**`). They are never sent to the client and are redacted from structured logs by key name.

## AI boundaries
- Agents can only call allowlisted tools. Write, external and destructive tools never execute without an explicit user approval of the exact payload. External actions (sending messages, web search) always require approval.
- LLM routing is constrained to a closed set of intents.
- LLM document extraction must quote the source text. Unverifiable fields are down-weighted and shown without a source span.
- The narration prompt forbids inventing facts and receives only computed facts.
- The user can force **Local only** mode, which sends nothing to any model provider.
- Memory is never written silently. AI-proposed memories require approval, and every memory shows its provenance and can be edited, disputed or deleted.

## Known limitations
- In-memory rate limits reset on restart.
- There is no MFA or email verification yet.
- The CSP allows `'unsafe-inline'` scripts because the app doesn't use nonces yet.
- The mock integrations store no credentials. Real OAuth adapters must keep tokens encrypted at rest (see ROADMAP).
