import { and, eq, gte, inArray } from "drizzle-orm";
import type { DB } from "@/server/db/client";
import * as s from "@/server/db/schema";
import type { EntityRef, EntityType } from "@/lib/types";

/**
 * The World is an in-memory snapshot of everything LIFEOS knows about one user.
 * Engines are pure functions over (World, now) which makes them deterministic and testable.
 * Personal data volumes are small (thousands of rows), so a full snapshot per request is cheap.
 */
export interface World {
  now: Date;
  user: typeof s.users.$inferSelect;
  settings: typeof s.userSettings.$inferSelect;
  goals: (typeof s.goals.$inferSelect)[];
  projects: (typeof s.projects.$inferSelect)[];
  tasks: (typeof s.tasks.$inferSelect)[];
  people: (typeof s.people.$inferSelect)[];
  companies: (typeof s.companies.$inferSelect)[];
  opportunities: (typeof s.opportunities.$inferSelect)[];
  opportunitySkills: (typeof s.opportunitySkills.$inferSelect)[];
  applications: (typeof s.applications.$inferSelect)[];
  skills: (typeof s.skills.$inferSelect)[];
  courses: (typeof s.courses.$inferSelect)[];
  credentials: (typeof s.credentials.$inferSelect)[];
  accounts: (typeof s.accounts.$inferSelect)[];
  transactions: (typeof s.transactions.$inferSelect)[];
  assets: (typeof s.assets.$inferSelect)[];
  events: (typeof s.events.$inferSelect)[];
  commitments: (typeof s.commitments.$inferSelect)[];
  habits: (typeof s.habits.$inferSelect)[];
  habitLogs: (typeof s.habitLogs.$inferSelect)[];
  messages: (typeof s.messages.$inferSelect)[];
  documents: Omit<typeof s.documents.$inferSelect, "textContent">[];
  documentFields: (typeof s.documentFields.$inferSelect)[];
  decisions: (typeof s.decisions.$inferSelect)[];
  decisionOptions: (typeof s.decisionOptions.$inferSelect)[];
  decisionCriteria: (typeof s.decisionCriteria.$inferSelect)[];
  decisionScores: (typeof s.decisionScores.$inferSelect)[];
  memories: (typeof s.memories.$inferSelect)[];
  links: (typeof s.links.$inferSelect)[];
  activities: (typeof s.activities.$inferSelect)[];
  ideas: (typeof s.ideas.$inferSelect)[];
  idx: WorldIndex;
}

export interface WorldIndex {
  goal: Map<string, World["goals"][number]>;
  project: Map<string, World["projects"][number]>;
  task: Map<string, World["tasks"][number]>;
  person: Map<string, World["people"][number]>;
  company: Map<string, World["companies"][number]>;
  opportunity: Map<string, World["opportunities"][number]>;
  skill: Map<string, World["skills"][number]>;
  document: Map<string, World["documents"][number]>;
  decision: Map<string, World["decisions"][number]>;
  tasksByProject: Map<string, World["tasks"]>;
  linksFrom: Map<string, World["links"]>;
  linksTo: Map<string, World["links"]>;
}

function groupBy<T, K>(items: T[], key: (t: T) => K | null | undefined): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const it of items) {
    const k = key(it);
    if (k === null || k === undefined) continue;
    const arr = m.get(k);
    if (arr) arr.push(it);
    else m.set(k, [it]);
  }
  return m;
}

export async function loadWorld(db: DB, userId: string, now = new Date()): Promise<World> {
  const byUser = <T extends { userId: unknown }>(t: T) => eq(t.userId as never, userId);
  const activitySince = new Date(now.getTime() - 120 * 86_400_000);
  const [
    [user],
    [settings],
    goals,
    projects,
    tasks,
    people,
    companies,
    opportunities,
    applications,
    skills,
    courses,
    credentials,
    accounts,
    transactions,
    assets,
    events,
    commitments,
    habits,
    messages,
    documents,
    documentFields,
    decisions,
    memories,
    links,
    activities,
    ideas,
  ] = await Promise.all([
    db.select().from(s.users).where(eq(s.users.id, userId)),
    db.select().from(s.userSettings).where(eq(s.userSettings.userId, userId)),
    db.select().from(s.goals).where(byUser(s.goals)),
    db.select().from(s.projects).where(byUser(s.projects)),
    db.select().from(s.tasks).where(byUser(s.tasks)),
    db.select().from(s.people).where(byUser(s.people)),
    db.select().from(s.companies).where(byUser(s.companies)),
    db.select().from(s.opportunities).where(byUser(s.opportunities)),
    db.select().from(s.applications).where(byUser(s.applications)),
    db.select().from(s.skills).where(byUser(s.skills)),
    db.select().from(s.courses).where(byUser(s.courses)),
    db.select().from(s.credentials).where(byUser(s.credentials)),
    db.select().from(s.accounts).where(byUser(s.accounts)),
    db.select().from(s.transactions).where(byUser(s.transactions)),
    db.select().from(s.assets).where(byUser(s.assets)),
    db.select().from(s.events).where(byUser(s.events)),
    db.select().from(s.commitments).where(byUser(s.commitments)),
    db.select().from(s.habits).where(byUser(s.habits)),
    db.select().from(s.messages).where(byUser(s.messages)),
    db
      .select({
        id: s.documents.id,
        userId: s.documents.userId,
        title: s.documents.title,
        filename: s.documents.filename,
        mimeType: s.documents.mimeType,
        sizeBytes: s.documents.sizeBytes,
        sha256: s.documents.sha256,
        storageKey: s.documents.storageKey,
        kind: s.documents.kind,
        status: s.documents.status,
        summary: s.documents.summary,
        pageCount: s.documents.pageCount,
        extractionMethod: s.documents.extractionMethod,
        error: s.documents.error,
        uploadedAt: s.documents.uploadedAt,
        processedAt: s.documents.processedAt,
      })
      .from(s.documents)
      .where(byUser(s.documents)),
    db.select().from(s.documentFields).where(byUser(s.documentFields)),
    db.select().from(s.decisions).where(byUser(s.decisions)),
    db.select().from(s.memories).where(byUser(s.memories)),
    db.select().from(s.links).where(byUser(s.links)),
    db.select().from(s.activities).where(and(byUser(s.activities), gte(s.activities.occurredAt, activitySince))),
    db.select().from(s.ideas).where(byUser(s.ideas)),
  ]);
  if (!user) throw new Error("User not found");

  const oppIds = opportunities.map((o) => o.id);
  const decisionIds = decisions.map((d) => d.id);
  const habitIds = habits.map((h) => h.id);
  const [opportunitySkills, decisionOptions, decisionCriteria, habitLogs] = await Promise.all([
    oppIds.length ? db.select().from(s.opportunitySkills).where(inArray(s.opportunitySkills.opportunityId, oppIds)) : [],
    decisionIds.length ? db.select().from(s.decisionOptions).where(inArray(s.decisionOptions.decisionId, decisionIds)) : [],
    decisionIds.length ? db.select().from(s.decisionCriteria).where(inArray(s.decisionCriteria.decisionId, decisionIds)) : [],
    habitIds.length ? db.select().from(s.habitLogs).where(inArray(s.habitLogs.habitId, habitIds)) : [],
  ]);
  const optionIds = decisionOptions.map((o) => o.id);
  const decisionScores = optionIds.length ? await db.select().from(s.decisionScores).where(inArray(s.decisionScores.optionId, optionIds)) : [];

  const fallbackSettings: typeof s.userSettings.$inferSelect = {
    userId,
    aiMode: "auto",
    focusHoursPerWeek: 25,
    hourlyValueEstimate: 20,
    followUpDays: 5,
    neglectDays: 10,
    updatedAt: now,
  };

  const w: Omit<World, "idx"> = {
    now,
    user,
    settings: settings ?? fallbackSettings,
    goals,
    projects,
    tasks,
    people,
    companies,
    opportunities,
    opportunitySkills,
    applications,
    skills,
    courses,
    credentials,
    accounts,
    transactions,
    assets,
    events,
    commitments,
    habits,
    habitLogs,
    messages,
    documents,
    documentFields,
    decisions,
    decisionOptions,
    decisionCriteria,
    decisionScores,
    memories,
    links,
    activities,
    ideas,
  };
  return { ...w, idx: buildIndex(w) };
}

export function buildIndex(w: Omit<World, "idx">): WorldIndex {
  const key = (type: string, id: string) => `${type}:${id}`;
  return {
    goal: new Map(w.goals.map((x) => [x.id, x])),
    project: new Map(w.projects.map((x) => [x.id, x])),
    task: new Map(w.tasks.map((x) => [x.id, x])),
    person: new Map(w.people.map((x) => [x.id, x])),
    company: new Map(w.companies.map((x) => [x.id, x])),
    opportunity: new Map(w.opportunities.map((x) => [x.id, x])),
    skill: new Map(w.skills.map((x) => [x.id, x])),
    document: new Map(w.documents.map((x) => [x.id, x])),
    decision: new Map(w.decisions.map((x) => [x.id, x])),
    tasksByProject: groupBy(w.tasks, (t) => t.projectId),
    linksFrom: groupBy(w.links, (l) => key(l.fromType, l.fromId)),
    linksTo: groupBy(w.links, (l) => key(l.toType, l.toId)),
  };
}

/** Human label for any entity reference. */
export function refOf(w: World, type: EntityType, id: string): EntityRef {
  const label = (() => {
    switch (type) {
      case "goal":
        return w.idx.goal.get(id)?.title;
      case "project":
        return w.idx.project.get(id)?.title;
      case "task":
        return w.idx.task.get(id)?.title;
      case "person":
        return w.idx.person.get(id)?.name;
      case "company":
        return w.idx.company.get(id)?.name;
      case "opportunity":
        return w.idx.opportunity.get(id)?.title;
      case "skill":
        return w.idx.skill.get(id)?.name;
      case "document":
        return w.idx.document.get(id)?.title;
      case "decision":
        return w.idx.decision.get(id)?.title;
      case "commitment":
        return w.commitments.find((c) => c.id === id)?.title;
      case "event":
        return w.events.find((e) => e.id === id)?.title;
      case "message":
        return w.messages.find((m) => m.id === id)?.subject ?? "Message";
      case "memory":
        return w.memories.find((m) => m.id === id)?.content.slice(0, 60);
      case "course":
        return w.courses.find((c) => c.id === id)?.title;
      case "credential":
        return w.credentials.find((c) => c.id === id)?.name;
      default:
        return undefined;
    }
  })();
  return { type, id, label: label ?? type };
}

export function linksOf(w: World, type: string, id: string) {
  return [...(w.idx.linksFrom.get(`${type}:${id}`) ?? []), ...(w.idx.linksTo.get(`${type}:${id}`) ?? [])];
}
