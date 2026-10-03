/**
 * LIFEOS relational schema.
 *
 * Core entities are relational with explicit foreign keys and indexes.
 * JSONB is used only where the shape is genuinely open-ended (evidence lists
 * on insights, AI run payloads, integration config, decision model extras).
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  customType,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";

export const EMBEDDING_DIM = 256;

const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

const money = (name: string) => numeric(name, { precision: 14, scale: 2, mode: "number" });

const id = () => uuid("id").primaryKey().defaultRandom();
const userRef = () =>
  uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" });
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

/* ───────────────────────────── Identity ───────────────────────────── */

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  headline: text("headline"),
  location: text("location"),
  timezone: text("timezone").notNull().default("Europe/London"),
  currency: text("currency").notNull().default("GBP"),
  isDemo: boolean("is_demo").notNull().default(false),
  createdAt: createdAt(),
});

export const userSettings = pgTable("user_settings", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  aiMode: text("ai_mode").notNull().default("auto"), // auto | local
  focusHoursPerWeek: integer("focus_hours_per_week").notNull().default(25),
  hourlyValueEstimate: money("hourly_value_estimate").notNull().default(20),
  followUpDays: integer("follow_up_days").notNull().default(5),
  neglectDays: integer("neglect_days").notNull().default(10),
  updatedAt: updatedAt(),
});

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(), // sha256(token)
    userId: userRef(),
    csrfToken: text("csrf_token").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    userAgent: text("user_agent"),
    ip: text("ip"),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

/* ───────────────────────────── Direction ───────────────────────────── */

export const goals = pgTable(
  "goals",
  {
    id: id(),
    userId: userRef(),
    title: text("title").notNull(),
    description: text("description"),
    category: text("category").notNull(), // career | finance | learning | health | relationships | personal
    horizon: text("horizon").notNull().default("quarter"), // week | quarter | year | multi_year
    status: text("status").notNull().default("active"), // active | paused | achieved | abandoned
    priority: integer("priority").notNull().default(3), // 1 (low) .. 5 (critical)
    targetMetric: text("target_metric"),
    targetValue: doublePrecision("target_value"),
    currentValue: doublePrecision("current_value"),
    unit: text("unit"),
    targetDate: date("target_date"),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("goals_user_status_idx").on(t.userId, t.status)],
);

export const projects = pgTable(
  "projects",
  {
    id: id(),
    userId: userRef(),
    goalId: uuid("goal_id").references(() => goals.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    description: text("description"),
    status: text("status").notNull().default("active"), // planning | active | blocked | paused | done
    priority: integer("priority").notNull().default(3),
    currentState: text("current_state"),
    startDate: date("start_date"),
    dueDate: date("due_date"),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("projects_user_status_idx").on(t.userId, t.status),
    index("projects_goal_idx").on(t.goalId),
  ],
);

export const tasks = pgTable(
  "tasks",
  {
    id: id(),
    userId: userRef(),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    goalId: uuid("goal_id").references(() => goals.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    description: text("description"),
    status: text("status").notNull().default("todo"), // todo | in_progress | blocked | done | cancelled
    priority: integer("priority").notNull().default(3),
    estimateMinutes: integer("estimate_minutes"),
    dueDate: date("due_date"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    postponedCount: integer("postponed_count").notNull().default(0),
    blockedReason: text("blocked_reason"),
    dependsOnTaskId: uuid("depends_on_task_id"),
    source: text("source").notNull().default("user"), // user | ai | import | document
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("tasks_user_status_idx").on(t.userId, t.status),
    index("tasks_project_idx").on(t.projectId),
    index("tasks_due_idx").on(t.userId, t.dueDate),
  ],
);

export const habits = pgTable("habits", {
  id: id(),
  userId: userRef(),
  goalId: uuid("goal_id").references(() => goals.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  cadence: text("cadence").notNull().default("daily"), // daily | weekly
  targetPerPeriod: integer("target_per_period").notNull().default(1),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
});

export const habitLogs = pgTable(
  "habit_logs",
  {
    habitId: uuid("habit_id")
      .notNull()
      .references(() => habits.id, { onDelete: "cascade" }),
    day: date("day").notNull(),
  },
  (t) => [primaryKey({ columns: [t.habitId, t.day] })],
);

export const commitments = pgTable(
  "commitments",
  {
    id: id(),
    userId: userRef(),
    title: text("title").notNull(),
    toPersonId: uuid("to_person_id").references(() => people.id, { onDelete: "set null" }),
    dueDate: date("due_date"),
    status: text("status").notNull().default("open"), // open | done | broken | renegotiated
    source: text("source").notNull().default("user_input"),
    notes: text("notes"),
    createdAt: createdAt(),
  },
  (t) => [index("commitments_user_status_idx").on(t.userId, t.status)],
);

export const ideas = pgTable("ideas", {
  id: id(),
  userId: userRef(),
  title: text("title").notNull(),
  body: text("body"),
  status: text("status").notNull().default("raw"), // raw | exploring | parked | converted
  createdAt: createdAt(),
});

export const notes = pgTable("notes", {
  id: id(),
  userId: userRef(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/* ───────────────────────────── Network ───────────────────────────── */

export const companies = pgTable(
  "companies",
  {
    id: id(),
    userId: userRef(),
    name: text("name").notNull(),
    industry: text("industry"),
    location: text("location"),
    website: text("website"),
    size: text("size"),
    notes: text("notes"),
    createdAt: createdAt(),
  },
  (t) => [index("companies_user_idx").on(t.userId)],
);

export const people = pgTable(
  "people",
  {
    id: id(),
    userId: userRef(),
    name: text("name").notNull(),
    role: text("role"),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
    email: text("email"),
    relationship: text("relationship").notNull().default("other"), // recruiter | mentor | peer | manager | client | friend | family | other
    strength: integer("strength").notNull().default(2), // 1..5
    lastContactAt: timestamp("last_contact_at", { withTimezone: true }),
    nextFollowUpAt: date("next_follow_up_at"),
    notes: text("notes"),
    createdAt: createdAt(),
  },
  (t) => [index("people_user_idx").on(t.userId), index("people_company_idx").on(t.companyId)],
);

export const messages = pgTable(
  "messages",
  {
    id: id(),
    userId: userRef(),
    personId: uuid("person_id").references(() => people.id, { onDelete: "set null" }),
    opportunityId: uuid("opportunity_id").references(() => opportunities.id, { onDelete: "set null" }),
    channel: text("channel").notNull(), // email | linkedin | whatsapp | call | meeting
    direction: text("direction").notNull(), // in | out
    subject: text("subject"),
    body: text("body"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    needsReply: boolean("needs_reply").notNull().default(false),
    provider: text("provider"),
    externalId: text("external_id"),
    createdAt: createdAt(),
  },
  (t) => [
    index("messages_user_time_idx").on(t.userId, t.occurredAt),
    index("messages_person_idx").on(t.personId),
    uniqueIndex("messages_external_idx").on(t.userId, t.provider, t.externalId),
  ],
);

/* ───────────────────────────── Opportunity ───────────────────────────── */

export const skills = pgTable(
  "skills",
  {
    id: id(),
    userId: userRef(),
    name: text("name").notNull(),
    category: text("category"), // technical | domain | soft | tool
    level: integer("level").notNull().default(0), // 0..5 self/evidenced level
    targetLevel: integer("target_level"),
    lastPracticedAt: timestamp("last_practiced_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("skills_user_name_idx").on(t.userId, t.name)],
);

export const opportunities = pgTable(
  "opportunities",
  {
    id: id(),
    userId: userRef(),
    title: text("title").notNull(),
    type: text("type").notNull(), // job | internship | freelance | side_income | course | scholarship | event | networking | investment | grant
    status: text("status").notNull().default("identified"), // identified | researching | preparing | applied | interviewing | offer | won | lost | dismissed
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
    contactPersonId: uuid("contact_person_id").references(() => people.id, { onDelete: "set null" }),
    description: text("description"),
    location: text("location"),
    url: text("url"),
    valueLow: money("value_low"),
    valueHigh: money("value_high"),
    valuePeriod: text("value_period"), // per_year | per_month | one_off
    effortHours: doublePrecision("effort_hours"),
    cost: money("cost"),
    difficulty: integer("difficulty"), // 1..5
    deadline: date("deadline"),
    source: text("source").notNull().default("user_input"), // user_input | document | integration | ai_inference
    sourceDocumentId: uuid("source_document_id"),
    discoveredAt: timestamp("discovered_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("opps_user_status_idx").on(t.userId, t.status),
    index("opps_deadline_idx").on(t.userId, t.deadline),
  ],
);

export const opportunitySkills = pgTable(
  "opportunity_skills",
  {
    opportunityId: uuid("opportunity_id")
      .notNull()
      .references(() => opportunities.id, { onDelete: "cascade" }),
    skillId: uuid("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" }),
    requiredLevel: integer("required_level").notNull().default(3),
    essential: boolean("essential").notNull().default(true),
  },
  (t) => [primaryKey({ columns: [t.opportunityId, t.skillId] })],
);

export const applications = pgTable(
  "applications",
  {
    id: id(),
    userId: userRef(),
    opportunityId: uuid("opportunity_id")
      .notNull()
      .references(() => opportunities.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("submitted"), // draft | submitted | screening | interview | offer | rejected | withdrawn
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    lastFollowUpAt: timestamp("last_follow_up_at", { withTimezone: true }),
    nextStep: text("next_step"),
    notes: text("notes"),
    createdAt: createdAt(),
  },
  (t) => [index("applications_user_idx").on(t.userId, t.status)],
);

export const courses = pgTable("courses", {
  id: id(),
  userId: userRef(),
  title: text("title").notNull(),
  provider: text("provider"),
  skillId: uuid("skill_id").references(() => skills.id, { onDelete: "set null" }),
  cost: money("cost"),
  hoursTotal: doublePrecision("hours_total"),
  hoursDone: doublePrecision("hours_done").notNull().default(0),
  status: text("status").notNull().default("planned"), // planned | in_progress | completed | dropped
  url: text("url"),
  createdAt: createdAt(),
});

export const credentials = pgTable("credentials", {
  id: id(),
  userId: userRef(),
  name: text("name").notNull(),
  issuer: text("issuer"),
  kind: text("kind").notNull().default("certification"), // certification | degree | licence | visa | membership
  status: text("status").notNull().default("planned"), // planned | in_progress | earned | expired
  examDate: date("exam_date"),
  earnedAt: date("earned_at"),
  expiresAt: date("expires_at"),
  cost: money("cost"),
  createdAt: createdAt(),
});

/* ───────────────────────────── Money ───────────────────────────── */

export const accounts = pgTable("accounts", {
  id: id(),
  userId: userRef(),
  name: text("name").notNull(),
  type: text("type").notNull(), // current | savings | credit | investment
  institution: text("institution"),
  balance: money("balance").notNull().default(0),
  currency: text("currency").notNull().default("GBP"),
  provider: text("provider").notNull().default("manual"),
  updatedAt: updatedAt(),
});

export const transactions = pgTable(
  "transactions",
  {
    id: id(),
    userId: userRef(),
    accountId: uuid("account_id").references(() => accounts.id, { onDelete: "set null" }),
    documentId: uuid("document_id"),
    occurredOn: date("occurred_on").notNull(),
    description: text("description").notNull(),
    merchant: text("merchant"),
    amount: money("amount").notNull(), // signed: + income, - expense
    kind: text("kind").notNull(), // income | expense | transfer
    category: text("category").notNull(),
    recurring: boolean("recurring").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("tx_user_date_idx").on(t.userId, t.occurredOn), index("tx_user_cat_idx").on(t.userId, t.category)],
);

export const assets = pgTable("assets", {
  id: id(),
  userId: userRef(),
  name: text("name").notNull(),
  type: text("type").notNull(), // cash | investment | vehicle | equipment | property | other
  value: money("value").notNull(),
  acquiredOn: date("acquired_on"),
  notes: text("notes"),
  createdAt: createdAt(),
});

/* ───────────────────────────── Time ───────────────────────────── */

export const events = pgTable(
  "events",
  {
    id: id(),
    userId: userRef(),
    title: text("title").notNull(),
    kind: text("kind").notNull().default("meeting"), // meeting | interview | exam | deadline | social | focus
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    location: text("location"),
    personId: uuid("person_id").references(() => people.id, { onDelete: "set null" }),
    opportunityId: uuid("opportunity_id").references(() => opportunities.id, { onDelete: "set null" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    provider: text("provider"),
    externalId: text("external_id"),
    createdAt: createdAt(),
  },
  (t) => [index("events_user_time_idx").on(t.userId, t.startsAt)],
);

/* ───────────────────────────── Knowledge ───────────────────────────── */

export const documents = pgTable(
  "documents",
  {
    id: id(),
    userId: userRef(),
    title: text("title").notNull(),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text("sha256").notNull(),
    storageKey: text("storage_key").notNull(),
    kind: text("kind").notNull().default("other"), // job_description | invoice | contract | cv | bank_statement | offer_letter | course | spreadsheet | note | image | other
    status: text("status").notNull().default("uploaded"), // uploaded | processing | processed | failed
    textContent: text("text_content"),
    summary: text("summary"),
    pageCount: integer("page_count"),
    extractionMethod: text("extraction_method"), // rules | llm | rules+llm
    error: text("error"),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (t) => [index("documents_user_idx").on(t.userId, t.uploadedAt), index("documents_sha_idx").on(t.userId, t.sha256)],
);

export const documentFields = pgTable(
  "document_fields",
  {
    id: id(),
    userId: userRef(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    label: text("label").notNull(),
    value: text("value").notNull(),
    valueType: text("value_type").notNull().default("text"), // text | money | date | list | number | percent
    confidence: doublePrecision("confidence").notNull(),
    sourceText: text("source_text"),
    sourceStart: integer("source_start"),
    sourceEnd: integer("source_end"),
    method: text("method").notNull(), // rule | llm | user
    verified: boolean("verified").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("docfields_doc_idx").on(t.documentId), index("docfields_user_key_idx").on(t.userId, t.key)],
);

export const memories = pgTable(
  "memories",
  {
    id: id(),
    userId: userRef(),
    content: text("content").notNull(),
    category: text("category").notNull(), // preference | fact | lesson | constraint | pattern | person | goal
    source: text("source").notNull(), // user_profile | user_input | document | decision | integration | ai_inference
    sourceRefType: text("source_ref_type"),
    sourceRefId: uuid("source_ref_id"),
    confidence: doublePrecision("confidence").notNull(), // 0..1
    importance: integer("importance").notNull().default(3), // 1..5
    status: text("status").notNull().default("active"), // active | disputed | archived
    lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("memories_user_status_idx").on(t.userId, t.status)],
);

/** Typed edges of the personal knowledge graph. */
export const links = pgTable(
  "links",
  {
    id: id(),
    userId: userRef(),
    fromType: text("from_type").notNull(),
    fromId: uuid("from_id").notNull(),
    toType: text("to_type").notNull(),
    toId: uuid("to_id").notNull(),
    relation: text("relation").notNull(), // supports | evidences | requires | blocks | works_at | introduced | mentions | targets | teaches | related
    strength: doublePrecision("strength").notNull().default(0.6),
    provenance: text("provenance").notNull().default("user_input"), // user_input | fact | document | ai_inference
    rationale: text("rationale"),
    createdAt: createdAt(),
  },
  (t) => [
    index("links_from_idx").on(t.userId, t.fromType, t.fromId),
    index("links_to_idx").on(t.userId, t.toType, t.toId),
    uniqueIndex("links_unique_idx").on(t.userId, t.fromType, t.fromId, t.toType, t.toId, t.relation),
  ],
);

/** Activity stream: the raw signal for "what changed", neglect and time allocation. */
export const activities = pgTable(
  "activities",
  {
    id: id(),
    userId: userRef(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    action: text("action").notNull(), // created | updated | completed | status_changed | worked | contacted | postponed | uploaded | decided
    summary: text("summary").notNull(),
    minutesSpent: integer("minutes_spent"),
    goalId: uuid("goal_id"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("activities_user_time_idx").on(t.userId, t.occurredAt),
    index("activities_entity_idx").on(t.userId, t.entityType, t.entityId),
  ],
);

/* ───────────────────────────── Decisions ───────────────────────────── */

export const decisions = pgTable(
  "decisions",
  {
    id: id(),
    userId: userRef(),
    title: text("title").notNull(),
    question: text("question").notNull(),
    context: text("context"),
    domain: text("domain").notNull().default("general"), // purchase | career | learning | project | finance | general
    status: text("status").notNull().default("open"), // open | decided | revisit
    stakes: text("stakes").notNull().default("medium"), // low | medium | high
    reversibility: text("reversibility").notNull().default("partly"), // reversible | partly | irreversible
    deadline: date("deadline"),
    chosenOptionId: uuid("chosen_option_id"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    reviewOn: date("review_on"),
    outcome: text("outcome"),
    lessons: text("lessons"),
    /** Open-ended structured model: constraints, unknowns, risks, assumptions, second-order effects. */
    model: jsonb("model").$type<DecisionModelExtras>().notNull().default({} as DecisionModelExtras),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("decisions_user_status_idx").on(t.userId, t.status)],
);

export interface DecisionModelExtras {
  objectives?: string[];
  constraints?: { text: string; hard: boolean; provenance: string }[];
  facts?: { text: string; provenance: string; ref?: { type: string; id: string } }[];
  unknowns?: { question: string; impact: "low" | "medium" | "high"; wouldChange?: string }[];
  risks?: { text: string; likelihood: number; impact: number; mitigation?: string }[];
  assumptions?: { text: string; provenance: string }[];
  secondOrder?: { text: string; horizon: string; provenance: string }[];
  dependencies?: string[];
}

export const decisionOptions = pgTable(
  "decision_options",
  {
    id: id(),
    decisionId: uuid("decision_id")
      .notNull()
      .references(() => decisions.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    description: text("description"),
    upfrontCost: money("upfront_cost"),
    monthlyCost: money("monthly_cost"),
    upsideLow: money("upside_low"),
    upsideHigh: money("upside_high"),
    timeHours: doublePrecision("time_hours"),
    risk: integer("risk"), // 1..5
    reversibility: text("reversibility"),
    position: integer("position").notNull().default(0),
  },
  (t) => [index("decision_options_decision_idx").on(t.decisionId)],
);

export const decisionCriteria = pgTable(
  "decision_criteria",
  {
    id: id(),
    decisionId: uuid("decision_id")
      .notNull()
      .references(() => decisions.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    weight: doublePrecision("weight").notNull(), // 0..1 normalised at analysis time
    rationale: text("rationale"),
    linkedGoalId: uuid("linked_goal_id"),
  },
  (t) => [index("decision_criteria_decision_idx").on(t.decisionId)],
);

export const decisionScores = pgTable(
  "decision_scores",
  {
    optionId: uuid("option_id")
      .notNull()
      .references(() => decisionOptions.id, { onDelete: "cascade" }),
    criterionId: uuid("criterion_id")
      .notNull()
      .references(() => decisionCriteria.id, { onDelete: "cascade" }),
    score: doublePrecision("score").notNull(), // 0..10
    low: doublePrecision("low"), // pessimistic score
    high: doublePrecision("high"), // optimistic score
    rationale: text("rationale"),
    provenance: text("provenance").notNull().default("estimate"),
  },
  (t) => [primaryKey({ columns: [t.optionId, t.criterionId] })],
);

/* ───────────────────────────── Intelligence ───────────────────────────── */

export const searchIndex = pgTable(
  "search_index",
  {
    id: id(),
    userId: userRef(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    meta: jsonb("meta").$type<Record<string, string | number | boolean | null>>().notNull().default({}),
    tsv: tsvector("tsv").generatedAlwaysAs(
      sql`setweight(to_tsvector('english', coalesce(title, '')), 'A') || setweight(to_tsvector('english', coalesce(body, '')), 'B')`,
    ),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIM }),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("search_entity_idx").on(t.userId, t.entityType, t.entityId),
    index("search_tsv_idx").using("gin", t.tsv),
    index("search_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
  ],
);

export const insights = pgTable(
  "insights",
  {
    id: id(),
    userId: userRef(),
    key: text("key").notNull(), // stable dedupe key, e.g. "followup:application:<id>"
    kind: text("kind").notNull(), // action | blind_spot | pattern | radar
    title: text("title").notNull(),
    status: text("status").notNull().default("new"), // new | seen | dismissed | acted
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    firstSeenAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("insights_key_idx").on(t.userId, t.key)],
);

export const aiRuns = pgTable(
  "ai_runs",
  {
    id: id(),
    userId: userRef(),
    parentRunId: uuid("parent_run_id"),
    agent: text("agent").notNull(),
    intent: text("intent"),
    input: jsonb("input").$type<unknown>(),
    output: jsonb("output").$type<unknown>(),
    status: text("status").notNull(), // ok | error | partial
    engine: text("engine").notNull(), // local | anthropic | openai_compatible
    model: text("model"),
    latencyMs: integer("latency_ms"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    costUsd: doublePrecision("cost_usd").notNull().default(0),
    error: text("error"),
    createdAt: createdAt(),
  },
  (t) => [index("ai_runs_user_time_idx").on(t.userId, t.createdAt)],
);

export const toolCalls = pgTable(
  "tool_calls",
  {
    id: id(),
    userId: userRef(),
    runId: uuid("run_id"),
    agent: text("agent"),
    tool: text("tool").notNull(),
    permission: text("permission").notNull(), // read | write | external | destructive
    input: jsonb("input").$type<unknown>(),
    outputSummary: text("output_summary"),
    entitiesAccessed: jsonb("entities_accessed").$type<string[]>().notNull().default([]),
    status: text("status").notNull(), // ok | error | denied | pending_approval
    error: text("error"),
    latencyMs: integer("latency_ms"),
    createdAt: createdAt(),
  },
  (t) => [index("tool_calls_user_time_idx").on(t.userId, t.createdAt), index("tool_calls_run_idx").on(t.runId)],
);

export const approvals = pgTable(
  "approvals",
  {
    id: id(),
    userId: userRef(),
    runId: uuid("run_id"),
    agent: text("agent"),
    tool: text("tool").notNull(),
    title: text("title").notNull(),
    explanation: text("explanation").notNull(),
    risk: text("risk").notNull().default("low"), // low | medium | high
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: text("status").notNull().default("pending"), // pending | approved | rejected | executed | failed
    result: jsonb("result").$type<unknown>(),
    createdAt: createdAt(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (t) => [index("approvals_user_status_idx").on(t.userId, t.status)],
);

export const integrations = pgTable(
  "integrations",
  {
    id: id(),
    userId: userRef(),
    kind: text("kind").notNull(), // email | calendar | storage | github | linkedin | job_board | banking | notes | messaging
    adapter: text("adapter").notNull(), // e.g. mock-mail
    status: text("status").notNull().default("disconnected"), // connected | disconnected | error
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    lastSyncSummary: text("last_sync_summary"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("integrations_user_kind_idx").on(t.userId, t.kind)],
);

export const simulations = pgTable("simulations", {
  id: id(),
  userId: userRef(),
  question: text("question").notNull(),
  scenario: jsonb("scenario").$type<Record<string, unknown>>().notNull(),
  result: jsonb("result").$type<Record<string, unknown>>().notNull(),
  createdAt: createdAt(),
});

export const weeklyReports = pgTable(
  "weekly_reports",
  {
    id: id(),
    userId: userRef(),
    weekStart: date("week_start").notNull(),
    content: jsonb("content").$type<Record<string, unknown>>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("weekly_user_week_idx").on(t.userId, t.weekStart)],
);
