# Integrations & roadmap

## Adapter architecture (`src/server/integrations`)

Each service category is a TypeScript interface:

| Interface | Methods |
|---|---|
| `EmailProvider` | `listMessages(since)`, `send(to, subject, body)` |
| `CalendarProvider` | `listEvents(from, to)`, `createEvent(e)` |
| `JobBoardProvider` | `search(query)` |
| `BankingProvider` | `listTransactions(since)` |
| `CodeHostProvider` | `recentActivity()` |
| `MessagingProvider` | `listMessages(since)`, `send(to, body)` |
| `WebSearchProvider` | `search(query)` (disabled by default) |
| `StorageProvider` (`src/server/storage`) | `put`, `get`, `delete` |

`syncIntegration(kind)` pulls from the adapter, normalises the results into LIFEOS entities, deduplicates them (by external ID, title or amount+date), indexes them for search and logs an activity. This build ships deterministic **mock adapters**, so the full pipeline runs for real: syncing the job board adds three new matching roles, with skills, to the radar.

## Path to real providers

| Category | Adapter | Notes |
|---|---|---|
| Email | Gmail API / Microsoft Graph | OAuth 2.0 with read scope by default; send scope requested only when the user enables sending. Sending still goes through approvals |
| Calendar | Google Calendar / Outlook | Push notifications (webhooks) → incremental sync |
| Banking | TrueLayer / Plaid (Open Banking) | 90-day consent renewal; categorisation via merchant codes |
| GitHub | REST + webhooks | Commits become project activity and skill evidence |
| Job boards | Adzuna, Reed, Greenhouse/Lever public boards | Fit computed on import |
| Notes | Notion / Obsidian (vault folder) | Notes indexed for search; ideas extracted |
| Messaging | Slack / WhatsApp Business | Needs-reply detection |
| LinkedIn | Data-export import | No public messaging API |
| Storage | S3 / GCS / Azure Blob | Implement `StorageProvider`; keep server-generated keys |

Requirements for every real adapter:

- encrypted token storage (envelope encryption, per-user data key)
- least-privilege scopes
- idempotent sync with external IDs
- rate-limit backoff
- an integration-level kill switch in Settings

## Product roadmap
1. **Background intelligence**: a scheduled worker re-runs detectors and stores insight deltas, so TODAY can show what's *new* since the last visit, plus a daily digest notification.
2. **Learning from outcomes**: use decision outcomes and accepted/dismissed insights to calibrate detector thresholds and leverage weights per user.
3. **Calendar-aware planning**: place focus-plan steps into free calendar slots (with approval).
4. **Richer document understanding**: OCR for scanned PDFs, table extraction from statements into transactions (with approval), contract obligation tracking.
5. **Multi-device**: PWA install and offline read-only cache.
6. **Team/advisor sharing**: share a decision workspace read-only with a mentor.
7. **Security hardening**: MFA (WebAuthn), Redis rate limits, CSP nonces, encrypted columns for sensitive fields.
