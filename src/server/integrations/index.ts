/**
 * Integration layer.
 *
 * Each external service category is an interface. The initial release ships mock adapters backed by
 * deterministic fixtures so the full sync → normalise → dedupe → index pipeline is exercised for real.
 * A production adapter (Gmail, Google Calendar, Plaid/TrueLayer, GitHub…) implements the same
 * interface and is registered in ADAPTERS — no other code changes.
 */
import { and, eq } from "drizzle-orm";
import type { DB } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { indexEntities } from "@/server/search/indexer";
import { isoDate } from "@/server/db/seed-docs";

export type IntegrationKind = "email" | "calendar" | "storage" | "github" | "linkedin" | "job_board" | "banking" | "notes" | "messaging";

export interface ExternalMessage {
  externalId: string;
  fromEmail?: string;
  fromName: string;
  subject?: string;
  body: string;
  occurredAt: Date;
  needsReply: boolean;
}
export interface ExternalEvent {
  externalId: string;
  title: string;
  startsAt: Date;
  endsAt?: Date;
  location?: string;
  kind: string;
}
export interface JobPosting {
  externalId: string;
  title: string;
  company: string;
  location: string;
  salaryLow?: number;
  salaryHigh?: number;
  deadline?: string;
  description: string;
  skills: string[];
}
export interface BankTransaction {
  externalId: string;
  date: string;
  description: string;
  amount: number;
  category: string;
}
export interface SendResult {
  externalId: string;
  deliveredAt: Date;
}

export interface EmailProvider {
  listMessages(since: Date): Promise<ExternalMessage[]>;
  send(to: string, subject: string, body: string): Promise<SendResult>;
}
export interface CalendarProvider {
  listEvents(from: Date, to: Date): Promise<ExternalEvent[]>;
  createEvent(e: Omit<ExternalEvent, "externalId">): Promise<{ externalId: string }>;
}
export interface JobBoardProvider {
  search(query: string): Promise<JobPosting[]>;
}
export interface BankingProvider {
  listTransactions(since: Date): Promise<BankTransaction[]>;
}
export interface CodeHostProvider {
  recentActivity(): Promise<{ repo: string; summary: string; at: Date }[]>;
}
export interface MessagingProvider {
  listMessages(since: Date): Promise<ExternalMessage[]>;
  send(to: string, body: string): Promise<SendResult>;
}
export interface WebSearchProvider {
  search(query: string): Promise<{ title: string; url: string; snippet: string }[]>;
}

const DAY = 86_400_000;
const daysAgo = (n: number, h = 9) => {
  const d = new Date(Date.now() - n * DAY);
  d.setUTCHours(h, 0, 0, 0);
  return d;
};

/* ───────────── mock adapters ───────────── */

const mockMail: EmailProvider = {
  async listMessages() {
    return [
      { externalId: "m-2005", fromName: "Hannah Brooks", fromEmail: "h.brooks@thamesbridge.example", subject: "Mock interview slot confirmed?", body: "Hi Amogh, I can hold Thursday 2pm for a mock FP&A interview before your Meridian round. Shall I book it?", occurredAt: daysAgo(0, 8), needsReply: true },
    ];
  },
  async send(to, subject) {
    return { externalId: `sent-${Buffer.from(`${to}${subject}${Date.now()}`).toString("base64url").slice(0, 16)}`, deliveredAt: new Date() };
  },
};

const mockCalendar: CalendarProvider = {
  async listEvents() {
    return [{ externalId: "cal-6", title: "Mock interview with Hannah (Careers)", startsAt: new Date(Date.now() + 1 * DAY + 5 * 3600_000), kind: "meeting", location: "Thamesbridge Careers Centre" }];
  },
  async createEvent() {
    return { externalId: `cal-${Date.now()}` };
  },
};

const mockJobs: JobBoardProvider = {
  async search() {
    return [
      { externalId: "job-501", title: "Credit Analyst (Graduate) — Albion Building Society", company: "Albion Building Society", location: "Manchester", salaryLow: 29000, salaryHigh: 32000, deadline: isoDate(12), description: "Graduate credit analyst supporting residential and SME lending. Visa sponsorship available. Excel and credit analysis essential; SQL desirable.", skills: ["Credit analysis", "Excel", "SQL"] },
      { externalId: "job-502", title: "Junior FP&A Analyst — Corvid Logistics", company: "Corvid Logistics", location: "London", salaryLow: 33000, salaryHigh: 36000, deadline: isoDate(18), description: "Budgeting, forecasting and variance analysis for a logistics group. Power BI preferred. Right to work in the UK required; sponsorship considered.", skills: ["Forecasting", "Excel", "Power BI"] },
      { externalId: "job-503", title: "Risk Analytics Graduate — Halcyon Bank", company: "Halcyon Bank", location: "London", salaryLow: 33000, salaryHigh: 35000, deadline: isoDate(25), description: "Model monitoring for PD/LGD models in Python. Visa sponsorship available.", skills: ["Python", "Statistics", "Credit analysis"] },
    ];
  },
};

const mockBank: BankingProvider = {
  async listTransactions() {
    return [{ externalId: "tx-9001", date: isoDate(-1), description: "Pret A Manger", amount: -7.95, category: "Eating out" }];
  },
};

const mockGithub: CodeHostProvider = {
  async recentActivity() {
    return [{ repo: "credit-pd-model", summary: "Pushed 2 commits: EDA notebook cleanup", at: daysAgo(14) }];
  },
};

const mockChat: MessagingProvider = {
  async listMessages() {
    return [];
  },
  async send(to) {
    return { externalId: `chat-${to}-${Date.now()}`, deliveredAt: new Date() };
  },
};

const disabledWeb: WebSearchProvider = {
  async search() {
    throw new Error("No web search provider configured. Set WEB_SEARCH_PROVIDER to enable (see docs/INTEGRATIONS.md).");
  },
};

export const ADAPTERS = {
  "mock-mail": mockMail,
  "mock-calendar": mockCalendar,
  "mock-jobs": mockJobs,
  "mock-openbanking": mockBank,
  "mock-github": mockGithub,
  "mock-chat": mockChat,
  "mock-linkedin": mockChat,
  "mock-notes": mockChat,
} as const;

export const CATALOG: { kind: IntegrationKind; label: string; adapter: string; description: string; production: string }[] = [
  { kind: "email", label: "Email", adapter: "mock-mail", description: "Inbox threads, replies and deadlines in emails", production: "Gmail / Microsoft Graph adapter" },
  { kind: "calendar", label: "Calendar", adapter: "mock-calendar", description: "Interviews, meetings and exams", production: "Google Calendar / Outlook adapter" },
  { kind: "storage", label: "Cloud storage", adapter: "local-disk", description: "Where uploaded documents are stored", production: "S3 / GCS / Azure Blob adapter" },
  { kind: "github", label: "GitHub", adapter: "mock-github", description: "Commits as evidence of project activity", production: "GitHub REST adapter" },
  { kind: "linkedin", label: "LinkedIn", adapter: "mock-linkedin", description: "Recruiter messages", production: "Export import (no public messaging API)" },
  { kind: "job_board", label: "Job boards", adapter: "mock-jobs", description: "Roles matching your skills", production: "Adzuna / Reed / Greenhouse adapters" },
  { kind: "banking", label: "Banking", adapter: "mock-openbanking", description: "Transactions and balances", production: "TrueLayer / Plaid Open Banking adapter" },
  { kind: "notes", label: "Notes", adapter: "mock-notes", description: "Notes from your notes app", production: "Notion / Obsidian adapter" },
  { kind: "messaging", label: "Messaging", adapter: "mock-chat", description: "WhatsApp / Slack conversations", production: "Slack / WhatsApp Business adapter" },
];

export function webSearchProvider(): WebSearchProvider {
  return disabledWeb;
}

/** Pull from a connected integration, normalise and import idempotently. Returns a human summary. */
export async function syncIntegration(db: DB, userId: string, kind: IntegrationKind): Promise<string> {
  const [row] = await db.select().from(s.integrations).where(and(eq(s.integrations.userId, userId), eq(s.integrations.kind, kind)));
  if (!row || row.status !== "connected") throw new Error(`${kind} is not connected`);
  let summary = "Nothing new";
  const since = row.lastSyncAt ?? new Date(Date.now() - 30 * DAY);

  if (kind === "email") {
    const people = await db.select().from(s.people).where(eq(s.people.userId, userId));
    const msgs = await mockMail.listMessages(since);
    const inserted = await db
      .insert(s.messages)
      .values(msgs.map((m) => ({ userId, personId: people.find((p) => p.name === m.fromName)?.id ?? null, channel: "email", direction: "in", subject: m.subject, body: m.body, occurredAt: m.occurredAt, needsReply: m.needsReply, provider: row.adapter, externalId: m.externalId })))
      .onConflictDoNothing()
      .returning({ id: s.messages.id });
    await indexEntities(db, userId, "message", inserted.map((i) => i.id));
    summary = `${inserted.length} new email(s)`;
  } else if (kind === "calendar") {
    const evs = await mockCalendar.listEvents(new Date(), new Date(Date.now() + 30 * DAY));
    const existing = await db.select({ externalId: s.events.externalId }).from(s.events).where(eq(s.events.userId, userId));
    const fresh = evs.filter((e) => !existing.some((x) => x.externalId === e.externalId));
    if (fresh.length) {
      const ins = await db.insert(s.events).values(fresh.map((e) => ({ userId, title: e.title, kind: e.kind, startsAt: e.startsAt, endsAt: e.endsAt, location: e.location, provider: row.adapter, externalId: e.externalId }))).returning({ id: s.events.id });
      await indexEntities(db, userId, "event", ins.map((i) => i.id));
    }
    summary = `${fresh.length} new event(s)`;
  } else if (kind === "job_board") {
    const postings = await mockJobs.search("credit analyst OR fp&a graduate london");
    const opps = await db.select({ title: s.opportunities.title }).from(s.opportunities).where(eq(s.opportunities.userId, userId));
    const companies = await db.select().from(s.companies).where(eq(s.companies.userId, userId));
    const skills = await db.select().from(s.skills).where(eq(s.skills.userId, userId));
    let added = 0;
    for (const p of postings) {
      if (opps.some((o) => o.title === p.title)) continue;
      let company = companies.find((c) => c.name === p.company);
      if (!company) {
        [company] = await db.insert(s.companies).values({ userId, name: p.company, location: p.location, notes: "Imported from job board" }).returning();
        companies.push(company);
        await indexEntities(db, userId, "company", [company.id]);
      }
      const [o] = await db
        .insert(s.opportunities)
        .values({ userId, title: p.title, type: "job", status: "identified", companyId: company.id, location: p.location, valueLow: p.salaryLow, valueHigh: p.salaryHigh, valuePeriod: "per_year", deadline: p.deadline, description: p.description, source: "integration", effortHours: 2.5, difficulty: 3 })
        .returning();
      const req = p.skills.map((name) => skills.find((k) => k.name === name)).filter(Boolean).map((k, i) => ({ opportunityId: o.id, skillId: k!.id, requiredLevel: 3, essential: i < 2 }));
      if (req.length) await db.insert(s.opportunitySkills).values(req).onConflictDoNothing();
      await db.insert(s.activities).values({ userId, entityType: "opportunity", entityId: o.id, action: "created", summary: `Job board match: ${o.title}` });
      await indexEntities(db, userId, "opportunity", [o.id]);
      added++;
    }
    summary = `${added} new matching role(s)`;
  } else if (kind === "banking") {
    const [acct] = await db.select().from(s.accounts).where(and(eq(s.accounts.userId, userId), eq(s.accounts.type, "current")));
    const txs = await mockBank.listTransactions(since);
    const existing = await db.select().from(s.transactions).where(eq(s.transactions.userId, userId));
    const fresh = txs.filter((t) => !existing.some((e) => e.occurredOn === t.date && e.description === t.description && e.amount === t.amount));
    if (fresh.length) await db.insert(s.transactions).values(fresh.map((t) => ({ userId, accountId: acct?.id, occurredOn: t.date, description: t.description, merchant: t.description.split(" ")[0], amount: t.amount, kind: t.amount >= 0 ? "income" : "expense", category: t.category })));
    summary = `${fresh.length} new transaction(s)`;
  } else if (kind === "github") {
    const act = await mockGithub.recentActivity();
    summary = `${act.length} recent repository event(s) — ${act.map((a) => a.summary).join("; ")}`;
  } else {
    summary = "Connected — no new items from this source";
  }
  await db.update(s.integrations).set({ lastSyncAt: new Date(), lastSyncSummary: summary }).where(eq(s.integrations.id, row.id));
  await db.insert(s.activities).values({ userId, entityType: "integration", entityId: row.id, action: "updated", summary: `Synced ${kind}: ${summary}` });
  return summary;
}

export function messagingFor(channel: string): { send(to: string, subject: string, body: string): Promise<SendResult> } {
  if (channel === "email") return mockMail;
  return { send: (to, _subject, body) => mockChat.send(to, body) };
}
