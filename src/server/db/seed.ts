/**
 * Demo workspace: a realistic fictional user ("Amogh", an MSc Finance graduate in London on a
 * Graduate visa, hunting for credit/FP&A roles while freelancing and studying for CFA Level I).
 *
 * Everything is relative to "now" so the briefing, deadlines and neglect signals are always live.
 * Relationships are deliberately imperfect (an unlinked project, missing follow-ups, a stale goal)
 * so the intelligence engines have real things to find — nothing is hard-coded in the engines.
 */
import { eq } from "drizzle-orm";
import type { DB } from "./client";
import * as s from "./schema";
import { hashPassword } from "@/server/auth/password";
import { reindexUser } from "@/server/search/indexer";
import { ingestDocument } from "@/server/documents/pipeline";
import { getStorage } from "@/server/storage";
import { logger } from "@/server/observability/logger";
import { demoDocuments, isoDate } from "./seed-docs";

export const DEMO_EMAIL = "demo@lifeos.app";
export const DEMO_PASSWORD = "lifeos-demo-2026";

const DAY = 86_400_000;

/** Deterministic PRNG so the demo is reproducible. */
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

export async function ensureDemoWorkspace(db: DB) {
  const existing = await db.select({ id: s.users.id }).from(s.users).limit(1);
  if (existing.length) return;
  logger.info("seed.demo_start");
  await seedDemo(db);
}

export async function resetDemo(db: DB) {
  const [demo] = await db.select().from(s.users).where(eq(s.users.email, DEMO_EMAIL));
  if (demo) {
    const docs = await db.select({ key: s.documents.storageKey }).from(s.documents).where(eq(s.documents.userId, demo.id));
    await Promise.all(docs.map((d) => getStorage().delete(d.key).catch(() => undefined)));
    await db.delete(s.users).where(eq(s.users.id, demo.id));
  }
  return seedDemo(db);
}

export async function seedDemo(db: DB, now = new Date()): Promise<string> {
  const rand = rng(42);
  const at = (daysOffset: number, hour = 10, minute = 0) => {
    const d = new Date(now.getTime() + daysOffset * DAY);
    d.setUTCHours(hour, minute, 0, 0);
    return d;
  };
  const D = (offset: number) => isoDate(offset, now);

  /* ── user ── */
  const [user] = await db
    .insert(s.users)
    .values({
      email: DEMO_EMAIL,
      name: "Amogh",
      passwordHash: await hashPassword(DEMO_PASSWORD),
      headline: "MSc Finance graduate · credit & FP&A · CFA Level I candidate",
      location: "London, UK",
      isDemo: true,
      createdAt: at(-300),
    })
    .returning();
  const userId = user.id;
  await db.insert(s.userSettings).values({ userId, focusHoursPerWeek: 25, hourlyValueEstimate: 22, followUpDays: 5, neglectDays: 10 });

  /* ── goals ── */
  const goalRows = await db
    .insert(s.goals)
    .values([
      { userId, title: "Land a graduate credit or FP&A role with visa sponsorship", description: "Secure an offer from a sponsor-licensed employer before the Graduate visa runs out, ideally in credit risk or private credit.", category: "career", horizon: "quarter", priority: 5, targetMetric: "Offers received", targetValue: 1, currentValue: 0, unit: "offer", targetDate: D(150), lastActivityAt: at(-1) },
      { userId, title: "Pass CFA Level I", description: "Score above 70% on mocks before the exam.", category: "learning", horizon: "quarter", priority: 4, targetMetric: "Mock exam score", targetValue: 70, currentValue: 61, unit: "%", targetDate: D(60), lastActivityAt: at(-1) },
      { userId, title: "Build a portfolio of 3 finance projects", description: "Public, well-documented projects that evidence modelling, valuation and Python credit analytics.", category: "career", horizon: "quarter", priority: 4, targetMetric: "Projects published", targetValue: 3, currentValue: 1, unit: "projects", targetDate: D(45), lastActivityAt: at(-2) },
      { userId, title: "Grow freelance income to £800/month", description: "Recurring modelling and bookkeeping clients rather than one-off jobs.", category: "finance", horizon: "year", priority: 3, targetMetric: "Monthly freelance income", targetValue: 800, currentValue: 310, unit: "£/month", targetDate: D(180), lastActivityAt: at(0, 9) },
      { userId, title: "Build a £6,000 emergency fund", description: "Six months of essential costs, protecting the job search runway.", category: "finance", horizon: "year", priority: 3, targetMetric: "Savings balance", targetValue: 6000, currentValue: 3800, unit: "£", targetDate: D(240), lastActivityAt: at(-12) },
      { userId, title: "Have 20 meaningful finance conversations", description: "Coffee chats, alumni calls and mentor sessions with people in credit and FP&A.", category: "relationships", horizon: "quarter", priority: 3, targetMetric: "Conversations", targetValue: 20, currentValue: 7, unit: "conversations", targetDate: D(90), lastActivityAt: at(-8) },
      { userId, title: "Run a half marathon", description: "Royal Parks Half next spring.", category: "health", horizon: "year", priority: 2, targetMetric: "Long run distance", targetValue: 21, currentValue: 9, unit: "km", targetDate: D(200), lastActivityAt: at(-19) },
      { userId, title: "Reach intermediate SQL", description: "Comfortable with joins, window functions and CTEs — repeatedly requested in analyst job specs.", category: "learning", horizon: "quarter", priority: 3, targetMetric: "Skill level", targetValue: 4, currentValue: 2, unit: "/5", targetDate: D(75), lastActivityAt: at(-16) },
      { userId, title: "Keep monthly spending under £1,600", description: "Includes rent. Protects runway while income is irregular.", category: "finance", horizon: "quarter", priority: 2, targetMetric: "Monthly spend", targetValue: 1600, currentValue: 1520, unit: "£", targetDate: D(90), lastActivityAt: at(-4) },
      { userId, title: "Read 12 books this year", description: "Mix of finance and fiction.", category: "personal", horizon: "year", priority: 1, targetMetric: "Books", targetValue: 12, currentValue: 7, unit: "books", targetDate: D(88), lastActivityAt: at(-6) },
      { userId, title: "Secure long-term UK work authorisation", description: "Switch from the Graduate route to Skilled Worker via a sponsoring employer.", category: "career", horizon: "year", priority: 4, targetMetric: "Visa route secured", targetValue: 1, currentValue: 0, unit: "", targetDate: D(400), lastActivityAt: at(-20) },
    ])
    .returning();
  const G = Object.fromEntries(["career", "cfa", "portfolio", "freelance", "fund", "network", "run", "sql", "spend", "read", "visa"].map((k, i) => [k, goalRows[i].id])) as Record<string, string>;

  /* ── companies ── */
  const companyRows = await db
    .insert(s.companies)
    .values([
      { userId, name: "Halcyon Bank", industry: "Banking", location: "London", size: "5,000+", notes: "UK challenger bank. Sponsor-licensed. Strong SME lending book." },
      { userId, name: "Northbridge Capital", industry: "Private credit", location: "London", size: "50-200", notes: "Direct lending fund. Daniel works here." },
      { userId, name: "Meridian Insurance", industry: "Insurance", location: "London", size: "1,000-5,000", notes: "Sponsor-licensed. FP&A graduate programme." },
      { userId, name: "Aster & Vale LLP", industry: "Audit & advisory", location: "London", size: "5,000+", notes: "Big audit firm. Graduate scheme sponsors visas." },
      { userId, name: "Kestrel Fintech", industry: "Fintech", location: "London", size: "200-500", notes: "Payments startup; finance team growing." },
      { userId, name: "Brightwater Asset Management", industry: "Asset management", location: "London", size: "500-1,000", notes: "Tom is an alum working in credit research here." },
      { userId, name: "Maya's Bakery", industry: "Food & beverage", location: "London E2", size: "1-10", notes: "Freelance client. Two shops, planning a third." },
      { userId, name: "Ledgerly", industry: "Freelance marketplace", location: "Remote", size: "50-200", notes: "Bookkeeping and modelling gig platform." },
      { userId, name: "Thamesbridge University", industry: "Education", location: "London", size: "1,000-5,000", notes: "Alma mater; part-time library job." },
      { userId, name: "Fernhill Consulting", industry: "Consulting", location: "London", size: "10-50", notes: "Previous internship. Marcus was my manager." },
    ])
    .returning();
  const C = Object.fromEntries(["halcyon", "northbridge", "meridian", "aster", "kestrel", "brightwater", "maya", "ledgerly", "thamesbridge", "fernhill"].map((k, i) => [k, companyRows[i].id])) as Record<string, string>;

  /* ── people ── */
  const peopleRows = await db
    .insert(s.people)
    .values([
      { userId, name: "Priya Shah", role: "Graduate Recruiter", companyId: C.halcyon, email: "priya.shah@halcyon.example", relationship: "recruiter", strength: 2, lastContactAt: at(-3, 9, 14), notes: "Reached out on LinkedIn about the Credit Risk graduate role." },
      { userId, name: "Daniel Okafor", role: "Credit Analyst", companyId: C.northbridge, email: "daniel.okafor@northbridge.example", relationship: "mentor", strength: 4, lastContactAt: at(-8), nextFollowUpAt: D(6), notes: "Mentor via CFA Society. Reviewing my DCF portfolio piece." },
      { userId, name: "Sophie Laurent", role: "Finance Talent Acquisition", companyId: C.meridian, relationship: "recruiter", strength: 2, lastContactAt: at(-6), notes: "Coordinating the FP&A second-round interview." },
      { userId, name: "Tom Becker", role: "Credit Research Associate", companyId: C.brightwater, relationship: "peer", strength: 4, lastContactAt: at(-74), notes: "MSc classmate. Offered to refer me at Brightwater back in summer." },
      { userId, name: "Maya Chen", role: "Owner", companyId: C.maya, email: "maya@mayasbakery.example", relationship: "client", strength: 3, lastContactAt: at(-1, 17), notes: "Happy with cashflow model; hinted at monthly management accounts." },
      { userId, name: "Ravi Menon", role: "CFA candidate", relationship: "friend", strength: 4, lastContactAt: at(-2), notes: "Study buddy for CFA. Wants an intro to Tom." },
      { userId, name: "Elena Petrova", role: "Talent Partner", companyId: C.kestrel, relationship: "recruiter", strength: 2, lastContactAt: at(-31), notes: "Said Finance Analyst role reopens in Q4; wants strong SQL." },
      { userId, name: "James Whitfield", role: "Graduate Recruitment Lead", companyId: C.aster, relationship: "recruiter", strength: 1, lastContactAt: at(-20), notes: "Met at university careers fair." },
      { userId, name: "Hannah Brooks", role: "Careers Consultant", companyId: C.thamesbridge, relationship: "mentor", strength: 3, lastContactAt: at(-25), notes: "Alumni careers service — offers CV reviews and mock interviews." },
      { userId, name: "Marcus Lee", role: "Senior Consultant", companyId: C.fernhill, email: "marcus.lee@fernhill.example", relationship: "manager", strength: 4, lastContactAt: at(-11), notes: "Ex-manager and referee. Floated a part-time analyst contract." },
      { userId, name: "Aisha Khan", role: "FP&A Analyst", companyId: C.kestrel, relationship: "peer", strength: 2, lastContactAt: at(-40), notes: "Met at CFA Society networking evening." },
    ])
    .returning();
  const P = Object.fromEntries(["priya", "daniel", "sophie", "tom", "maya", "ravi", "elena", "james", "hannah", "marcus", "aisha"].map((k, i) => [k, peopleRows[i].id])) as Record<string, string>;

  /* ── skills ── */
  const skillNames: [string, string, number, number | null, number][] = [
    ["Excel", "tool", 4, 5, -1],
    ["Financial modelling", "domain", 4, 5, -1],
    ["Valuation", "domain", 4, 4, -2],
    ["Python", "technical", 3, 4, -9],
    ["SQL", "technical", 2, 4, -16],
    ["Credit analysis", "domain", 3, 4, -9],
    ["Accounting", "domain", 4, 4, -5],
    ["Statistics", "technical", 3, 4, -9],
    ["Power BI", "tool", 2, 3, -40],
    ["Communication", "soft", 4, 4, -3],
    ["Data visualisation", "technical", 3, 4, -12],
    ["Forecasting", "domain", 3, 4, -1],
  ];
  const skillRows = await db
    .insert(s.skills)
    .values(skillNames.map(([name, category, level, targetLevel, practiced]) => ({ userId, name, category, level, targetLevel, lastPracticedAt: at(practiced) })))
    .returning();
  const K = Object.fromEntries(skillRows.map((k) => [k.name, k.id])) as Record<string, string>;

  /* ── projects ── */
  const projectRows = await db
    .insert(s.projects)
    .values([
      { userId, goalId: G.portfolio, title: "Rolls-Royce DCF valuation", description: "Full DCF on Rolls-Royce Holdings with WACC build-up, segment forecasts and scenario analysis.", status: "active", priority: 5, currentState: "Model complete; sensitivity table and chart export outstanding. Daniel reviews it next week.", startDate: D(-40), dueDate: D(6), lastActivityAt: at(-2) },
      { userId, goalId: G.portfolio, title: "Credit risk PD model (Python)", description: "Logistic regression + gradient boosting PD model on Lending Club data with calibration and a scorecard.", status: "blocked", priority: 4, currentState: "Feature engineering half done. Blocked: raw dataset needs re-download (old file corrupted).", startDate: D(-35), dueDate: D(30), lastActivityAt: at(-9) },
      { userId, goalId: G.portfolio, title: "Portfolio website", description: "Personal site presenting the finance projects with write-ups and downloadable models.", status: "active", priority: 3, currentState: "Layout done; needs DCF case study and credit model write-up.", startDate: D(-25), dueDate: D(40), lastActivityAt: at(-5) },
      { userId, goalId: G.cfa, title: "CFA Level I study plan", description: "Schweser notes + QBank + 3 full mocks before exam day.", status: "active", priority: 4, currentState: "Finished 6/10 topics. Ethics repeatedly postponed. Mock 1: 61%.", startDate: D(-120), dueDate: D(58), lastActivityAt: at(-1) },
      { userId, goalId: G.career, title: "Q4 application pipeline", description: "Targeted applications to sponsor-licensed employers in credit and FP&A.", status: "active", priority: 5, currentState: "4 live applications, 1 interview. Follow-ups lagging.", startDate: D(-30), dueDate: D(60), lastActivityAt: at(-3) },
      { userId, goalId: G.freelance, title: "Maya's Bakery cashflow model", description: "13-week cashflow model and scenario dashboard for a two-shop bakery.", status: "active", priority: 3, currentState: "Model delivered; invoice INV-0042 issued; handover call pending.", startDate: D(-21), dueDate: D(3), lastActivityAt: at(0, 9) },
      { userId, goalId: G.sql, title: "SQL fundamentals project", description: "Analyse a public loan-book dataset in SQL (joins, window functions, CTEs).", status: "active", priority: 3, currentState: "Course module 2 of 6 done. No progress for 2+ weeks.", startDate: D(-30), dueDate: D(50), lastActivityAt: at(-16) },
      { userId, goalId: G.run, title: "Half-marathon training block", description: "12-week plan: 3 runs/week.", status: "paused", priority: 2, currentState: "Stopped after week 4 when interview prep ramped up.", startDate: D(-50), dueDate: D(190), lastActivityAt: at(-19) },
      { userId, goalId: G.spend, title: "Personal budget system", description: "Categorised spending tracker with monthly review.", status: "done", priority: 2, currentState: "Live. Monthly review ritual in place.", startDate: D(-60), dueDate: D(-10), lastActivityAt: at(-10) },
      { userId, goalId: G.network, title: "Finance alumni outreach", description: "Reach out to 15 alumni in credit/FP&A for 20-minute calls.", status: "active", priority: 3, currentState: "7 conversations done; outreach paused for 8 days.", startDate: D(-45), dueDate: D(45), lastActivityAt: at(-8) },
      { userId, goalId: G.freelance, title: "Ledgerly café chain 3-statement model", description: "Freelance gig: integrated 3-statement model for a 5-site café chain.", status: "planning", priority: 3, currentState: "Brief received; not started. Pays £450.", startDate: D(-2), dueDate: D(9), lastActivityAt: at(-2) },
    ])
    .returning();
  const PR = Object.fromEntries(["dcf", "credit", "website", "cfa", "pipeline", "bakery", "sql", "run", "budget", "outreach", "cafe"].map((k, i) => [k, projectRows[i].id])) as Record<string, string>;

  /* ── tasks ── */
  type T = typeof s.tasks.$inferInsert;
  const task = (projectKey: string, goalKey: string, title: string, extra: Partial<T> = {}): T => ({ userId, projectId: PR[projectKey], goalId: G[goalKey], title, ...extra });
  const taskRows = await db
    .insert(s.tasks)
    .values([
      task("dcf", "portfolio", "Build WACC sensitivity table (7–11%) against terminal growth (1.5–3%)", { status: "todo", priority: 5, estimateMinutes: 45, dueDate: D(2), description: "Two-way data table on the valuation tab; conditional formatting on implied share price." }),
      task("dcf", "portfolio", "Export valuation football-field chart and attach to portfolio site", { status: "todo", priority: 4, estimateMinutes: 25, dueDate: D(4) }),
      task("dcf", "portfolio", "Send DCF draft to Daniel before review", { status: "todo", priority: 4, estimateMinutes: 10, dueDate: D(4) }),
      task("dcf", "portfolio", "Build segment revenue forecasts (Civil, Defence, Power Systems)", { status: "done", estimateMinutes: 180, completedAt: at(-12) }),
      task("dcf", "portfolio", "Build WACC from CAPM inputs", { status: "done", estimateMinutes: 90, completedAt: at(-6) }),
      task("dcf", "portfolio", "Write investment thesis summary (1 page)", { status: "done", estimateMinutes: 60, completedAt: at(-2) }),
      task("dcf", "portfolio", "Three-scenario analysis (bear/base/bull)", { status: "done", estimateMinutes: 120, completedAt: at(-3) }),
      task("dcf", "portfolio", "Reconcile historic financials to annual report", { status: "done", estimateMinutes: 150, completedAt: at(-20) }),
      task("credit", "portfolio", "Re-download Lending Club 2007–2018 dataset", { status: "todo", priority: 4, estimateMinutes: 20, description: "Old CSV is truncated at 1.2m rows; need full accepted_2007_to_2018 file." }),
      task("credit", "portfolio", "Engineer features: DTI buckets, credit history length, utilisation", { status: "blocked", priority: 4, estimateMinutes: 120, blockedReason: "Waiting on full dataset re-download" }),
      task("credit", "portfolio", "Train logistic regression baseline + calibration plot", { status: "todo", priority: 3, estimateMinutes: 150, dueDate: D(18) }),
      task("credit", "portfolio", "Exploratory data analysis notebook", { status: "done", estimateMinutes: 180, completedAt: at(-14) }),
      task("website", "portfolio", "Write DCF case study page", { status: "todo", priority: 3, estimateMinutes: 90, dueDate: D(10) }),
      task("website", "portfolio", "Set up custom domain and analytics", { status: "done", estimateMinutes: 40, completedAt: at(-5) }),
      task("cfa", "cfa", "Ethics & Professional Standards — reading 1–4", { status: "todo", priority: 4, estimateMinutes: 240, dueDate: D(-3), postponedCount: 4 }),
      task("cfa", "cfa", "Financial Statement Analysis — QBank 150 questions", { status: "in_progress", priority: 4, estimateMinutes: 300, dueDate: D(5) }),
      task("cfa", "cfa", "Mock exam 2 (timed)", { status: "todo", priority: 4, estimateMinutes: 270, dueDate: D(12) }),
      task("cfa", "cfa", "Fixed Income readings", { status: "done", estimateMinutes: 600, completedAt: at(-7) }),
      task("cfa", "cfa", "Pay Kaplan Schweser invoice (£299)", { status: "todo", priority: 3, estimateMinutes: 5, source: "user" }),
      task("pipeline", "career", "Tailor CV for Halcyon credit risk role", { status: "todo", priority: 5, estimateMinutes: 50, dueDate: D(3) }),
      task("pipeline", "career", "Prepare Meridian case study: budgeting & variance analysis", { status: "in_progress", priority: 5, estimateMinutes: 120, dueDate: D(1) }),
      task("pipeline", "career", "Research Kestrel finance team before role reopens", { status: "todo", priority: 2, estimateMinutes: 30, postponedCount: 2 }),
      task("bakery", "freelance", "Handover call with Maya — walk through scenario tab", { status: "todo", priority: 3, estimateMinutes: 30, dueDate: D(3) }),
      task("bakery", "freelance", "Send invoice INV-0042", { status: "done", estimateMinutes: 10, completedAt: at(-2) }),
      task("sql", "sql", "Complete module 3: joins & subqueries", { status: "todo", priority: 3, estimateMinutes: 90, dueDate: D(-5), postponedCount: 3 }),
      task("sql", "sql", "Load loan-book CSV into Postgres", { status: "todo", priority: 2, estimateMinutes: 45, dependsOnTaskId: null }),
      task("run", "run", "Restart with 3×5km easy week", { status: "todo", priority: 2, estimateMinutes: 90, postponedCount: 2 }),
      task("outreach", "network", "Message 3 alumni in private credit", { status: "todo", priority: 3, estimateMinutes: 30, dueDate: D(-1) }),
      task("outreach", "network", "Ask Tom about the Brightwater referral", { status: "todo", priority: 3, estimateMinutes: 10, postponedCount: 1 }),
      task("cafe", "freelance", "Kick-off: list model assumptions with café owner", { status: "todo", priority: 3, estimateMinutes: 40, dueDate: D(2) }),
      task("budget", "spend", "Set up monthly review template", { status: "done", estimateMinutes: 60, completedAt: at(-11) }),
    ])
    .returning();
  const byTitle = (prefix: string) => taskRows.find((t) => t.title.startsWith(prefix))!.id;
  // dependencies
  await db.update(s.tasks).set({ dependsOnTaskId: byTitle("Re-download Lending Club") }).where(eq(s.tasks.id, byTitle("Engineer features")));
  await db.update(s.tasks).set({ dependsOnTaskId: byTitle("Engineer features") }).where(eq(s.tasks.id, byTitle("Train logistic regression")));
  await db.update(s.tasks).set({ dependsOnTaskId: byTitle("Export valuation football-field") }).where(eq(s.tasks.id, byTitle("Write DCF case study")));
  await db.update(s.tasks).set({ dependsOnTaskId: byTitle("Complete module 3") }).where(eq(s.tasks.id, byTitle("Load loan-book CSV")));

  /* ── opportunities ── */
  type O = typeof s.opportunities.$inferInsert;
  const opp = (o: Omit<O, "userId">): O => ({ userId, ...o });
  const oppRows = await db
    .insert(s.opportunities)
    .values([
      opp({ title: "Graduate Credit Risk Analyst — Halcyon Bank", type: "job", status: "preparing", companyId: C.halcyon, contactPersonId: P.priya, location: "London (hybrid)", valueLow: 32000, valueHigh: 36000, valuePeriod: "per_year", effortHours: 3, difficulty: 3, deadline: D(4), source: "integration", description: "SME credit risk graduate role. Visa sponsorship available. Recruiter reached out directly.", discoveredAt: at(-3) }),
      opp({ title: "Junior Credit Analyst — Northbridge Capital", type: "job", status: "applied", companyId: C.northbridge, location: "London", valueLow: 38000, valueHigh: 45000, valuePeriod: "per_year", effortHours: 2, difficulty: 4, deadline: D(-6), source: "document", description: "Private credit underwriting. No visa sponsorship.", discoveredAt: at(-15) }),
      opp({ title: "FP&A Graduate Programme — Meridian Insurance", type: "job", status: "interviewing", companyId: C.meridian, contactPersonId: P.sophie, location: "London", valueLow: 30000, valueHigh: 33000, valuePeriod: "per_year", effortHours: 6, difficulty: 3, source: "user_input", description: "Two-year rotational FP&A programme. Sponsor-licensed.", discoveredAt: at(-28) }),
      opp({ title: "Audit & Assurance Graduate 2027 — Aster & Vale", type: "job", status: "applied", companyId: C.aster, location: "London", valueLow: 31000, valueHigh: 33000, valuePeriod: "per_year", effortHours: 2, difficulty: 2, source: "user_input", description: "Graduate audit scheme with ACA. Sponsors visas.", discoveredAt: at(-24) }),
      opp({ title: "Finance Analyst — Kestrel Fintech", type: "job", status: "identified", companyId: C.kestrel, contactPersonId: P.aisha, location: "London", valueLow: 35000, valueHigh: 40000, valuePeriod: "per_year", effortHours: 3, difficulty: 4, deadline: D(21), source: "user_input", description: "Reopens in Q4. Heavy SQL and Power BI use. Sponsorship case-by-case.", discoveredAt: at(-31) }),
      opp({ title: "Investment Operations Analyst — Brightwater AM", type: "job", status: "applied", companyId: C.brightwater, location: "London", valueLow: 30000, valueHigh: 34000, valuePeriod: "per_year", effortHours: 2, difficulty: 2, source: "integration", description: "Operations role with path into credit research. Tom works here.", discoveredAt: at(-12) }),
      opp({ title: "Café chain 3-statement model (Ledgerly gig)", type: "freelance", status: "won", companyId: C.ledgerly, valueLow: 450, valueHigh: 450, valuePeriod: "one_off", effortHours: 12, difficulty: 3, deadline: D(9), source: "integration", description: "Integrated 3-statement model for a 5-site café chain.", discoveredAt: at(-4) }),
      opp({ title: "Monthly management accounts — Maya's Bakery", type: "freelance", status: "identified", companyId: C.maya, contactPersonId: P.maya, valueLow: 150, valueHigh: 220, valuePeriod: "per_month", effortHours: 4, difficulty: 2, source: "ai_inference", description: "Maya hinted she wants monthly management accounts after the cashflow model. Recurring revenue.", discoveredAt: at(-1) }),
      opp({ title: "CFA Society UK Student Mentoring Programme", type: "networking", status: "identified", location: "London", effortHours: 0.3, cost: 0, difficulty: 1, deadline: D(2), source: "user_input", description: "Pairs candidates with charterholders for 6 months. Application is a short form.", discoveredAt: at(-10) }),
      opp({ title: "Thamesbridge Alumni Finance Networking Night", type: "event", status: "identified", companyId: C.thamesbridge, location: "London", effortHours: 0.2, cost: 0, difficulty: 1, deadline: D(5), source: "integration", description: "RSVP needed. Alumni from banks, funds and insurers attend.", discoveredAt: at(-6) }),
      opp({ title: "Sell Excel modelling templates online", type: "side_income", status: "identified", valueLow: 50, valueHigh: 300, valuePeriod: "per_month", effortHours: 25, cost: 30, difficulty: 3, source: "ai_inference", description: "Package anonymised cashflow and 3-statement templates. Check Ledgerly IP clause first.", discoveredAt: at(-14) }),
      opp({ title: "Python for finance tutoring", type: "side_income", status: "identified", valueLow: 25, valueHigh: 35, valuePeriod: "per_month", effortHours: 3, difficulty: 2, source: "user_input", description: "£25–35/hour tutoring MSc students; ~3h/week possible.", discoveredAt: at(-20) }),
      opp({ title: "Kaggle credit default prediction challenge", type: "event", status: "identified", deadline: D(20), effortHours: 15, cost: 0, difficulty: 4, source: "integration", description: "Public leaderboard; strong portfolio signal for credit risk roles.", discoveredAt: at(-5) }),
      opp({ title: "Part-time Financial Analyst contract — Fernhill", type: "freelance", status: "researching", companyId: C.fernhill, contactPersonId: P.marcus, valueLow: 180, valueHigh: 180, valuePeriod: "per_day", effortHours: 24, difficulty: 3, source: "user_input", description: "Marcus suggested 3 days/week for 3 months at £180/day.", discoveredAt: at(-11) }),
      opp({ title: "Bloomberg Market Concepts certificate", type: "course", status: "identified", effortHours: 8, cost: 0, difficulty: 1, source: "ai_inference", description: "Free via university Bloomberg terminals; commonly listed on credit analyst CVs.", discoveredAt: at(-9) }),
      opp({ title: "Halcyon Bank Insight Day", type: "event", status: "lost", companyId: C.halcyon, deadline: D(-20), effortHours: 1, difficulty: 1, source: "user_input", description: "Missed the registration deadline.", discoveredAt: at(-40) }),
    ])
    .returning();
  const OP = Object.fromEntries(["halcyon", "northbridge", "meridian", "aster", "kestrel", "brightwater", "cafe", "maya", "mentoring", "alumni", "templates", "tutoring", "kaggle", "fernhill", "bmc", "insight"].map((k, i) => [k, oppRows[i].id])) as Record<string, string>;
  // per_month valuation for tutoring stored per hour in description; normalise to monthly estimate
  await db.update(s.opportunities).set({ valueLow: 300, valueHigh: 420 }).where(eq(s.opportunities.id, OP.tutoring));

  const req = (o: string, skills: [string, number, boolean?][]) => skills.map(([name, level, essential = true]) => ({ opportunityId: OP[o], skillId: K[name], requiredLevel: level, essential }));
  await db.insert(s.opportunitySkills).values([
    ...req("halcyon", [["Credit analysis", 3], ["Python", 3], ["SQL", 3], ["Excel", 4], ["Financial modelling", 3], ["Communication", 3]]),
    ...req("northbridge", [["Financial modelling", 4], ["Valuation", 4], ["Credit analysis", 3], ["Excel", 4], ["Python", 2, false]]),
    ...req("meridian", [["Forecasting", 3], ["Excel", 4], ["Accounting", 3], ["Communication", 4], ["Power BI", 2, false]]),
    ...req("aster", [["Accounting", 4], ["Excel", 3], ["Communication", 3]]),
    ...req("kestrel", [["SQL", 4], ["Power BI", 3], ["Excel", 4], ["Forecasting", 3], ["Python", 2, false]]),
    ...req("brightwater", [["Excel", 4], ["Credit analysis", 2], ["Communication", 3], ["SQL", 2, false]]),
    ...req("cafe", [["Financial modelling", 4], ["Excel", 4], ["Accounting", 3]]),
    ...req("maya", [["Accounting", 3], ["Excel", 3]]),
    ...req("templates", [["Excel", 4], ["Financial modelling", 4]]),
    ...req("tutoring", [["Python", 3], ["Statistics", 3], ["Communication", 3]]),
    ...req("kaggle", [["Python", 4], ["Statistics", 3], ["Credit analysis", 3]]),
    ...req("fernhill", [["Financial modelling", 3], ["Excel", 4], ["Forecasting", 3]]),
  ]);

  /* ── applications ── */
  await db.insert(s.applications).values([
    { userId, opportunityId: OP.northbridge, status: "submitted", submittedAt: at(-12), nextStep: "Await screening call" },
    { userId, opportunityId: OP.meridian, status: "interview", submittedAt: at(-27), lastFollowUpAt: at(-14), nextStep: "Second-round interview" },
    { userId, opportunityId: OP.aster, status: "submitted", submittedAt: at(-20), nextStep: "Online tests invitation expected" },
    { userId, opportunityId: OP.brightwater, status: "submitted", submittedAt: at(-9), nextStep: "Ask Tom for referral" },
    { userId, opportunityId: OP.insight, status: "withdrawn", submittedAt: null, notes: "Missed registration." },
  ]);

  /* ── courses & credentials ── */
  await db.insert(s.courses).values([
    { userId, title: "SQL for Data Analysis", provider: "DataCamp", skillId: K.SQL, cost: 0, hoursTotal: 20, hoursDone: 4, status: "in_progress" },
    { userId, title: "Credit Risk Modelling in Python", provider: "Coursera", skillId: K["Credit analysis"], cost: 39, hoursTotal: 24, hoursDone: 17, status: "in_progress" },
    { userId, title: "CFA Level I Essential Self-Study Package", provider: "Kaplan Schweser", skillId: K.Valuation, cost: 299, hoursTotal: 300, hoursDone: 165, status: "in_progress" },
    { userId, title: "Power BI Data Analyst path", provider: "Microsoft Learn", skillId: K["Power BI"], cost: 0, hoursTotal: 30, hoursDone: 6, status: "planned" },
  ]);
  await db.insert(s.credentials).values([
    { userId, name: "MSc Finance (Merit)", issuer: "Thamesbridge University", kind: "degree", status: "earned", earnedAt: D(-110) },
    { userId, name: "CFA Level I", issuer: "CFA Institute", kind: "certification", status: "in_progress", examDate: D(60), cost: 940 },
    { userId, name: "UK Graduate visa", issuer: "Home Office", kind: "visa", status: "earned", earnedAt: D(-290), expiresAt: D(420) },
    { userId, name: "Microsoft Excel Expert (MO-201)", issuer: "Microsoft", kind: "certification", status: "earned", earnedAt: D(-200) },
    { userId, name: "Bloomberg Market Concepts", issuer: "Bloomberg", kind: "certification", status: "planned" },
  ]);

  /* ── money ── */
  const [current, savings, credit] = await db
    .insert(s.accounts)
    .values([
      { userId, name: "Monzo current", type: "current", institution: "Monzo", balance: 2140.32, provider: "mock-openbanking" },
      { userId, name: "Easy-access saver", type: "savings", institution: "Chase UK", balance: 3800, provider: "mock-openbanking" },
      { userId, name: "Amex credit card", type: "credit", institution: "American Express", balance: -215.6, provider: "mock-openbanking" },
    ])
    .returning();
  void savings;
  const tx: (typeof s.transactions.$inferInsert)[] = [];
  const add = (dayOffset: number, description: string, amount: number, category: string, extra: Partial<typeof s.transactions.$inferInsert> = {}) =>
    tx.push({ userId, accountId: current.id, occurredOn: D(dayOffset), description, merchant: description.split(" ")[0], amount: Number(amount.toFixed(2)), kind: amount >= 0 ? "income" : "expense", category, ...extra });
  for (let m = 0; m < 3; m++) {
    const base = -m * 30;
    add(base - 3, "Greenway Lettings rent", -850, "Rent", { recurring: true });
    add(base - 2, "PureGym membership", -34.99, "Fitness", { recurring: true });
    add(base - 5, "Spotify", -11.99, "Subscriptions", { recurring: true });
    add(base - 8, "Netflix", -10.99, "Subscriptions", { recurring: true });
    add(base - 21, "Notion", -8, "Subscriptions", { recurring: true });
    add(base - 14, "Octopus Energy", -62.4, "Utilities", { recurring: true });
    add(base - 16, "Giffgaff", -15, "Phone", { recurring: true });
    add(base - 18, "Thamesbridge Univ payroll", 1150, "Salary", { recurring: true });
    for (let w = 0; w < 4; w++) {
      add(base - w * 7 - 1, ["Tesco Express", "Sainsbury's", "Lidl", "Co-op"][w], -(28 + rand() * 30), "Groceries");
      add(base - w * 7 - 4, "TfL travel", -(24 + rand() * 8), "Transport");
      if (rand() > 0.35) add(base - w * 7 - 2, ["Pret A Manger", "Dishoom", "Wagamama", "Franco Manca"][w], -(8 + rand() * 40), "Eating out");
    }
  }
  add(-26, "Ledgerly payout - cafe chain model", 360, "Freelance");
  add(-58, "Maya's Bakery - budgeting workbook", 310, "Freelance");
  add(-47, "iFixit laptop repair", -180, "Equipment");
  add(-35, "Interview suit - M&S", -129, "Clothing");
  add(-12, "Coursera subscription", -39, "Education", { recurring: true });
  add(-42, "Coursera subscription", -39, "Education", { recurring: true });
  add(-72, "Coursera subscription", -39, "Education", { recurring: true });
  add(-9, "Transfer to savings", -150, "Savings", { kind: "transfer" });
  add(-39, "Transfer to savings", -150, "Savings", { kind: "transfer" });
  tx.push({ userId, accountId: credit.id, occurredOn: D(-6), description: "Amazon - finance books", merchant: "Amazon", amount: -46.5, kind: "expense", category: "Books" });
  await db.insert(s.transactions).values(tx);
  await db.insert(s.assets).values([
    { userId, name: "Stocks & Shares ISA (Vanguard)", type: "investment", value: 1250, acquiredOn: D(-200) },
    { userId, name: "MacBook Air (2022)", type: "equipment", value: 520, acquiredOn: D(-900), notes: "Repaired last month." },
  ]);

  /* ── events ── */
  await db.insert(s.events).values([
    { userId, title: "Meridian FP&A second-round interview", kind: "interview", startsAt: at(2, 9, 30), endsAt: at(2, 11, 0), location: "20 Gracechurch Street, EC3", personId: P.sophie, opportunityId: OP.meridian, provider: "mock-calendar", externalId: "cal-1" },
    { userId, title: "Portfolio review with Daniel", kind: "meeting", startsAt: at(6, 17, 30), endsAt: at(6, 18, 15), location: "Video call", personId: P.daniel, projectId: PR.dcf, provider: "mock-calendar", externalId: "cal-2" },
    { userId, title: "Thamesbridge Alumni Finance Networking Night", kind: "social", startsAt: at(9, 17, 30), endsAt: at(9, 20, 0), location: "Thamesbridge Business School", opportunityId: OP.alumni, provider: "mock-calendar", externalId: "cal-3" },
    { userId, title: "CFA Level I exam", kind: "exam", startsAt: at(60, 7, 30), endsAt: at(60, 12, 30), location: "Pearson VUE Holborn" },
    { userId, title: "CFA study session with Ravi", kind: "focus", startsAt: at(1, 18, 0), endsAt: at(1, 20, 0), personId: P.ravi, projectId: PR.cfa, provider: "mock-calendar", externalId: "cal-4" },
    { userId, title: "Handover call with Maya", kind: "meeting", startsAt: at(3, 15, 0), endsAt: at(3, 15, 30), personId: P.maya, projectId: PR.bakery, provider: "mock-calendar", externalId: "cal-5" },
    { userId, title: "Coffee with Marcus", kind: "meeting", startsAt: at(-11, 12, 30), endsAt: at(-11, 13, 30), personId: P.marcus },
    { userId, title: "Meridian first-round video interview", kind: "interview", startsAt: at(-14, 11, 0), endsAt: at(-14, 11, 45), personId: P.sophie, opportunityId: OP.meridian },
  ]);

  /* ── commitments ── */
  await db.insert(s.commitments).values([
    { userId, title: "Send Daniel the DCF draft before our review", toPersonId: P.daniel, dueDate: D(4), status: "open", source: "message" },
    { userId, title: "Introduce Ravi to Tom", toPersonId: P.ravi, dueDate: D(-10), status: "open", source: "user_input", notes: "Promised at the study session three weeks ago." },
    { userId, title: "Confirm attendance for Meridian interview", toPersonId: P.sophie, dueDate: D(0), status: "open", source: "document" },
    { userId, title: "Send Maya a proposal for monthly accounts", toPersonId: P.maya, dueDate: D(5), status: "open", source: "message" },
    { userId, title: "Share CFA Ethics notes with Ravi", toPersonId: P.ravi, dueDate: D(-4), status: "open", source: "user_input" },
    { userId, title: "Return library books", dueDate: D(-15), status: "done", source: "user_input" },
  ]);

  /* ── messages ── */
  await db.insert(s.messages).values([
    { userId, personId: P.priya, opportunityId: OP.halcyon, channel: "linkedin", direction: "in", subject: "Graduate Credit Risk Analyst — Halcyon Bank", body: "Hi Amogh, I came across your profile and your credit risk modelling work. We're hiring Graduate Credit Risk Analysts (visa sponsorship available) and applications close this Friday. Would you be free for a 15-minute call this week? Best, Priya", occurredAt: at(-3, 9, 14), needsReply: true, provider: "mock-linkedin", externalId: "li-1001" },
    { userId, personId: P.maya, channel: "email", direction: "in", subject: "Re: Cashflow model", body: "This is brilliant, thank you! Would you be able to do our management accounts every month? Happy to discuss a monthly fee.", occurredAt: at(-1, 17, 2), needsReply: true, provider: "mock-mail", externalId: "m-2001" },
    { userId, personId: P.daniel, channel: "email", direction: "out", subject: "DCF review next week", body: "Hi Daniel, thanks for offering to review my Rolls-Royce DCF. I'll send the draft before our call.", occurredAt: at(-8, 19), provider: "mock-mail", externalId: "m-2002" },
    { userId, personId: P.sophie, opportunityId: OP.meridian, channel: "email", direction: "in", subject: "FP&A Graduate Programme — second-round interview", body: "Invitation to second-round interview with a 45-minute case study. Please confirm your attendance.", occurredAt: at(-6, 11), needsReply: true, provider: "mock-mail", externalId: "m-2003" },
    { userId, personId: P.elena, opportunityId: OP.kestrel, channel: "linkedin", direction: "in", subject: "Finance Analyst role", body: "The Finance Analyst role reopens in Q4. The team will test SQL fairly heavily — worth brushing up.", occurredAt: at(-31), provider: "mock-linkedin", externalId: "li-1002" },
    { userId, personId: P.elena, channel: "linkedin", direction: "out", body: "Thanks Elena, I'll keep an eye out and work on my SQL.", occurredAt: at(-30), provider: "mock-linkedin", externalId: "li-1003" },
    { userId, personId: P.tom, channel: "whatsapp", direction: "in", body: "Happy to refer you at Brightwater whenever a role comes up — just send me the link.", occurredAt: at(-74), provider: "mock-chat", externalId: "wa-3001" },
    { userId, personId: P.marcus, channel: "meeting", direction: "out", subject: "Coffee — part-time contract", body: "Discussed 3 days/week analyst contract at £180/day for ~3 months. Need to reply with availability.", occurredAt: at(-11, 13), needsReply: true, provider: "manual" },
    { userId, personId: P.ravi, channel: "whatsapp", direction: "in", body: "Did you get a chance to ask Tom about the intro? Also can you share your ethics notes?", occurredAt: at(-5), needsReply: true, provider: "mock-chat", externalId: "wa-3002" },
    { userId, personId: P.hannah, channel: "email", direction: "in", subject: "Mock interview slots", body: "We have mock interview slots for finance roles next week if you'd like one before your Meridian interview.", occurredAt: at(-4), needsReply: false, provider: "mock-mail", externalId: "m-2004" },
  ]);

  /* ── habits ── */
  const habitRows = await db
    .insert(s.habits)
    .values([
      { userId, goalId: G.cfa, title: "CFA study (90 min)", cadence: "daily", targetPerPeriod: 1 },
      { userId, goalId: G.run, title: "Run", cadence: "weekly", targetPerPeriod: 3 },
      { userId, goalId: G.read, title: "Read 20 minutes", cadence: "daily", targetPerPeriod: 1 },
    ])
    .returning();
  const logs: { habitId: string; day: string }[] = [];
  for (let d = 1; d <= 28; d++) {
    if (d % 6 !== 0) logs.push({ habitId: habitRows[0].id, day: D(-d) });
    if (d > 19 && d % 2 === 0) logs.push({ habitId: habitRows[1].id, day: D(-d) });
    if (d % 3 === 0) logs.push({ habitId: habitRows[2].id, day: D(-d) });
  }
  await db.insert(s.habitLogs).values(logs);

  /* ── ideas & notes ── */
  await db.insert(s.ideas).values([
    { userId, title: "“Credit Notes” newsletter", body: "Weekly 5-minute breakdown of a UK credit story. Builds visible expertise for recruiters.", status: "exploring" },
    { userId, title: "Template shop for small-business models", body: "Anonymised cashflow and budget templates — check Ledgerly IP clause.", status: "raw" },
    { userId, title: "YouTube walkthroughs of credit memos", body: "Short videos explaining credit memo structure.", status: "parked" },
    { userId, title: "Automate Maya's bookkeeping with bank feeds", body: "Could make monthly accounts a 2-hour job.", status: "raw" },
  ]);
  await db.insert(s.notes).values([
    { userId, title: "Mentor call with Daniel — notes", body: "Daniel: private credit teams care about downside cases more than upside. Add a debt capacity view to the DCF. Recruiters at Northbridge rarely sponsor visas — prioritise banks and insurers that do. Follow up within 3–5 days after applying; most people don't.", createdAt: at(-8) },
    { userId, title: "Lessons from the Halcyon Insight Day miss", body: "Missed registration because the deadline was only in an email. Rule: every deadline found in an email or document becomes a task the same day.", createdAt: at(-19) },
    { userId, title: "Meridian first-round reflections", body: "Strong on technicals, weak on 'why insurance'. Prepare a story about risk pricing and the FP&A link to underwriting cycles.", createdAt: at(-13) },
    { userId, title: "Freelance pricing", body: "Cashflow models: £350–450. Monthly accounts: ~£180 for 4 hours. Never go below £35/hour effective.", createdAt: at(-30) },
  ]);

  /* ── decisions ── */
  async function decision(
    d: Omit<typeof s.decisions.$inferInsert, "userId">,
    options: { label: string; description?: string; upfrontCost?: number; monthlyCost?: number; upsideLow?: number; upsideHigh?: number; timeHours?: number; risk?: number; reversibility?: string }[],
    criteria: { name: string; weight: number; rationale?: string; goal?: string }[],
    scores: [number, number, number][][], // [option][criterion] = [score, low, high]
    chosen?: number,
  ) {
    const [row] = await db.insert(s.decisions).values({ userId, ...d }).returning();
    const opts = await db.insert(s.decisionOptions).values(options.map((o, i) => ({ decisionId: row.id, position: i, ...o }))).returning();
    const crits = await db
      .insert(s.decisionCriteria)
      .values(criteria.map((c) => ({ decisionId: row.id, name: c.name, weight: c.weight, rationale: c.rationale, linkedGoalId: c.goal ? G[c.goal] : null })))
      .returning();
    await db.insert(s.decisionScores).values(
      opts.flatMap((o, i) => crits.map((c, j) => ({ optionId: o.id, criterionId: c.id, score: scores[i][j][0], low: scores[i][j][1], high: scores[i][j][2], provenance: "estimate" }))),
    );
    if (chosen !== undefined) await db.update(s.decisions).set({ chosenOptionId: opts[chosen].id }).where(eq(s.decisions.id, row.id));
    return row.id;
  }

  await decision(
    {
      title: "Spend £500 on a financial modelling bootcamp?",
      question: "Should I spend £500 on the Corporate Finance Modelling Bootcamp?",
      context: "Online 6-week bootcamp with certificate. Overlaps with the last 6 weeks of CFA prep.",
      domain: "learning",
      stakes: "medium",
      reversibility: "partly",
      deadline: D(7),
      model: {
        objectives: ["Strengthen evidence of modelling skill for credit roles", "Protect CFA preparation time", "Preserve emergency fund"],
        constraints: [
          { text: "CFA exam in 60 days needs ~12h/week", hard: true, provenance: "fact" },
          { text: "Emergency fund target £6,000 (currently £3,800)", hard: false, provenance: "user_input" },
        ],
        facts: [
          { text: "Course costs £500 with a 14-day refund window", provenance: "user_input" },
          { text: "Financial modelling is already level 4/5 with a DCF portfolio project", provenance: "fact" },
        ],
        unknowns: [
          { question: "Do target employers value this certificate over portfolio work?", impact: "high", wouldChange: "If recruiters list it as preferred, career impact rises sharply." },
          { question: "Is there a student/early-bird discount?", impact: "medium" },
        ],
        risks: [{ text: "Bootcamp workload crowds out CFA mocks", likelihood: 0.5, impact: 4, mitigation: "Start after the exam" }],
        assumptions: [{ text: "Bootcamp requires ~6h/week", provenance: "assumption" }],
        secondOrder: [{ text: "Spending now reduces runway by ~2 weeks of essential costs", horizon: "3 months", provenance: "estimate" }],
      },
    },
    [
      { label: "Buy the bootcamp now", upfrontCost: 500, timeHours: 36, risk: 3, reversibility: "partly" },
      { label: "Use free resources for 6 weeks", upfrontCost: 0, timeHours: 30, risk: 2, reversibility: "reversible" },
      { label: "Defer until after the CFA exam", upfrontCost: 500, timeHours: 36, risk: 1, reversibility: "reversible" },
    ],
    [
      { name: "Career impact", weight: 0.35, goal: "career", rationale: "Directly supports the top-priority goal" },
      { name: "Cash & runway", weight: 0.25, goal: "fund" },
      { name: "Protects CFA prep", weight: 0.25, goal: "cfa" },
      { name: "Learning quality", weight: 0.15 },
    ],
    [
      [[7, 5, 8], [3, 2, 4], [3, 2, 5], [8, 7, 9]],
      [[5, 3, 6], [10, 9, 10], [6, 5, 7], [5, 3, 6]],
      [[6, 5, 8], [6, 5, 7], [9, 8, 10], [8, 7, 9]],
    ],
  );

  const decCar = await decision(
    {
      title: "Buy a used car?",
      question: "Should I buy a used Toyota Yaris for £4,500?",
      context: "Mostly to get to interviews and client meetings outside central London faster.",
      domain: "purchase",
      stakes: "high",
      reversibility: "partly",
      model: {
        objectives: ["Save commute time", "Protect emergency fund and runway"],
        constraints: [{ text: "Savings £3,800 — purchase would require finance or depleting the fund", hard: true, provenance: "fact" }],
        unknowns: [{ question: "How many trips per month actually need a car?", impact: "high", wouldChange: "Fewer than ~6 trips/month makes car clubs strictly cheaper." }],
        risks: [{ text: "Unexpected repair bills on a 9-year-old car", likelihood: 0.4, impact: 3 }],
        secondOrder: [{ text: "Insurance for a 23-year-old in London is often £1,200+/year", horizon: "1 year", provenance: "estimate" }],
      },
    },
    [
      { label: "Buy the Yaris", upfrontCost: 4500, monthlyCost: 165, risk: 4, reversibility: "partly" },
      { label: "Keep using public transport", upfrontCost: 0, monthlyCost: 115, risk: 1, reversibility: "reversible" },
      { label: "Car club for occasional trips", upfrontCost: 0, monthlyCost: 145, risk: 1, reversibility: "reversible" },
    ],
    [
      { name: "Total cost (12 months)", weight: 0.4, goal: "spend" },
      { name: "Emergency fund impact", weight: 0.25, goal: "fund" },
      { name: "Time saved", weight: 0.2 },
      { name: "Flexibility", weight: 0.15 },
    ],
    [
      [[2, 1, 3], [1, 0, 2], [8, 6, 9], [8, 7, 9]],
      [[9, 8, 10], [10, 10, 10], [4, 3, 5], [5, 4, 6]],
      [[7, 6, 8], [10, 9, 10], [6, 5, 7], [7, 6, 8]],
    ],
  );

  await decision(
    {
      title: "Which portfolio project should I prioritise?",
      question: "Which project should I work on for the next two weeks?",
      domain: "project",
      stakes: "medium",
      reversibility: "reversible",
      deadline: D(3),
      model: {
        objectives: ["Maximise interview conversion for credit roles", "Finish what is closest to done"],
        facts: [
          { text: "Rolls-Royce DCF is ~70% complete with a review in 6 days", provenance: "fact" },
          { text: "Credit risk PD model is blocked on a dataset download", provenance: "fact" },
          { text: "Halcyon and Kestrel both list SQL as a requirement", provenance: "fact" },
        ],
      },
    },
    [
      { label: "Finish the Rolls-Royce DCF", timeHours: 2, risk: 1 },
      { label: "Unblock and push the credit PD model", timeHours: 12, risk: 3 },
      { label: "Start the SQL loan-book project", timeHours: 15, risk: 2 },
    ],
    [
      { name: "Relevance to target roles", weight: 0.4, goal: "career" },
      { name: "Effort to finish", weight: 0.25 },
      { name: "Time to impact", weight: 0.2 },
      { name: "Skill growth", weight: 0.15, goal: "sql" },
    ],
    [
      [[7, 6, 8], [9, 8, 10], [9, 8, 10], [4, 3, 5]],
      [[9, 8, 10], [4, 3, 6], [5, 4, 6], [8, 7, 9]],
      [[7, 6, 8], [3, 2, 4], [3, 2, 5], [9, 8, 10]],
    ],
  );

  const decMeridian = await decision(
    {
      title: "Accept Meridian FP&A if offered?",
      question: "If Meridian offers me the FP&A programme, should I take it or hold out for a credit role?",
      domain: "career",
      stakes: "high",
      reversibility: "partly",
      model: {
        objectives: ["Secure visa sponsorship", "Build towards a credit career"],
        constraints: [{ text: "Graduate visa expires in ~14 months", hard: true, provenance: "fact" }],
        unknowns: [
          { question: "Can FP&A graduates rotate into Meridian's credit/investments team?", impact: "high", wouldChange: "An internal route to credit makes accepting dominant." },
          { question: "What is Halcyon's interview timeline?", impact: "medium" },
        ],
      },
    },
    [
      { label: "Accept Meridian", upsideLow: 30000, upsideHigh: 33000, risk: 2 },
      { label: "Decline and hold out for credit roles", upsideLow: 0, upsideHigh: 45000, risk: 4 },
      { label: "Accept, then pursue an internal move", upsideLow: 30000, upsideHigh: 36000, risk: 2 },
    ],
    [
      { name: "Visa security", weight: 0.35, goal: "visa" },
      { name: "Career alignment", weight: 0.3, goal: "career" },
      { name: "Salary", weight: 0.15 },
      { name: "Learning", weight: 0.2 },
    ],
    [
      [[9, 8, 10], [5, 4, 6], [6, 5, 7], [7, 6, 8]],
      [[3, 1, 6], [9, 7, 10], [7, 2, 9], [7, 5, 8]],
      [[9, 8, 10], [7, 5, 8], [6, 5, 7], [8, 7, 9]],
    ],
  );

  const decFernhill = await decision(
    {
      title: "Take the Fernhill part-time contract?",
      question: "Should I accept Marcus's 3-days-a-week analyst contract at £180/day?",
      domain: "career",
      stakes: "medium",
      reversibility: "reversible",
      deadline: D(5),
      model: {
        objectives: ["Increase income", "Keep enough time for applications and CFA"],
        facts: [{ text: "3 days × £180 × ~13 weeks ≈ £7,020 gross", provenance: "estimate" }],
        unknowns: [{ question: "Can the days be flexible around interviews?", impact: "high" }],
      },
    },
    [
      { label: "Accept 3 days/week", upsideLow: 6500, upsideHigh: 7020, timeHours: 312, risk: 3 },
      { label: "Negotiate 2 days/week", upsideLow: 4300, upsideHigh: 4680, timeHours: 208, risk: 2 },
      { label: "Decline", upsideLow: 0, upsideHigh: 0, timeHours: 0, risk: 1 },
    ],
    [
      { name: "Income", weight: 0.3, goal: "freelance" },
      { name: "Time for job search & CFA", weight: 0.35, goal: "career" },
      { name: "CV value", weight: 0.2 },
      { name: "Relationship with Marcus", weight: 0.15 },
    ],
    [
      [[9, 8, 10], [3, 2, 4], [7, 6, 8], [8, 7, 9]],
      [[7, 6, 8], [6, 5, 7], [7, 6, 8], [7, 6, 8]],
      [[1, 1, 1], [9, 9, 10], [3, 2, 4], [4, 3, 5]],
    ],
  );

  const decNewsletter = await decision(
    {
      title: "Start the “Credit Notes” newsletter?",
      question: "Should I start a weekly newsletter on UK credit stories?",
      domain: "general",
      stakes: "low",
      reversibility: "reversible",
      model: { objectives: ["Visible expertise", "Low time cost"] },
    },
    [
      { label: "Start weekly now", timeHours: 3, risk: 2 },
      { label: "Start monthly after CFA", timeHours: 1, risk: 1 },
      { label: "Park the idea", timeHours: 0, risk: 1 },
    ],
    [
      { name: "Recruiter visibility", weight: 0.5, goal: "career" },
      { name: "Time cost", weight: 0.5, goal: "cfa" },
    ],
    [
      [[7, 5, 8], [3, 2, 4]],
      [[5, 4, 7], [8, 7, 9]],
      [[1, 1, 2], [10, 10, 10]],
    ],
  );

  const decFlat = await decision(
    {
      title: "Move to a cheaper flat?",
      question: "Should I move to a cheaper flat further out to save £150/month?",
      domain: "finance",
      stakes: "medium",
      reversibility: "partly",
      status: "decided",
      decidedAt: at(-50),
      outcome: "Stayed. Moving costs (~£900 deposit gap + removals) wiped out 6 months of savings and added 50 min/day commuting.",
      lessons: "Count one-off switching costs and time costs, not just the monthly saving.",
      reviewOn: D(25),
    },
    [
      { label: "Move to Zone 4 flat", monthlyCost: 700, upfrontCost: 900, risk: 3 },
      { label: "Stay in current flat", monthlyCost: 850, risk: 1 },
    ],
    [
      { name: "Monthly cost", weight: 0.5, goal: "spend" },
      { name: "Time & energy", weight: 0.5 },
    ],
    [
      [[8, 7, 9], [3, 2, 4]],
      [[4, 4, 4], [8, 7, 9]],
    ],
    1,
  );
  await db.update(s.decisions).set({ status: "decided" }).where(eq(s.decisions.id, decFlat));

  const decCfa = await decision(
    {
      title: "Register for CFA Level I?",
      question: "Should I register for CFA Level I this cycle?",
      domain: "learning",
      stakes: "medium",
      reversibility: "irreversible",
      status: "decided",
      decidedAt: at(-125),
      outcome: "Registered (£940). Mentors and two recruiters said CFA progress strengthens credit applications.",
      lessons: "Commitment devices work: paying upfront increased weekly study hours.",
    },
    [
      { label: "Register now", upfrontCost: 940, risk: 2 },
      { label: "Wait a cycle", upfrontCost: 0, risk: 1 },
    ],
    [
      { name: "Career signal", weight: 0.6, goal: "career" },
      { name: "Cost", weight: 0.4, goal: "fund" },
    ],
    [
      [[8, 7, 9], [3, 3, 3]],
      [[4, 3, 5], [10, 10, 10]],
    ],
    0,
  );
  await db.update(s.decisions).set({ status: "decided" }).where(eq(s.decisions.id, decCfa));

  const decLedgerly = await decision(
    {
      title: "Freelance through Ledgerly or only direct clients?",
      question: "Should I keep using Ledgerly or only take direct clients?",
      domain: "finance",
      stakes: "low",
      reversibility: "reversible",
      status: "decided",
      decidedAt: at(-44),
      reviewOn: D(-4),
      outcome: "Do both: Ledgerly for deal flow, direct clients for better margins.",
      lessons: "Read IP and non-compete clauses before reusing templates across platforms.",
    },
    [
      { label: "Both channels", risk: 2 },
      { label: "Direct clients only", risk: 3 },
    ],
    [
      { name: "Deal flow", weight: 0.5, goal: "freelance" },
      { name: "Margin", weight: 0.5, goal: "freelance" },
    ],
    [
      [[8, 7, 9], [6, 5, 7]],
      [[4, 3, 5], [9, 8, 10]],
    ],
    0,
  );
  await db.update(s.decisions).set({ status: "decided" }).where(eq(s.decisions.id, decLedgerly));

  const decLaptop = await decision(
    {
      title: "Replace or repair the laptop?",
      question: "Should I buy a new £1,100 laptop or repair the current one for £180?",
      domain: "purchase",
      stakes: "low",
      reversibility: "reversible",
      status: "decided",
      decidedAt: at(-48),
      outcome: "Repaired for £180. Running fine; Python models train slower but acceptably.",
      lessons: "Repair first when the bottleneck isn't the tool.",
    },
    [
      { label: "Buy new laptop", upfrontCost: 1100, risk: 1 },
      { label: "Repair current laptop", upfrontCost: 180, risk: 2 },
    ],
    [
      { name: "Cost", weight: 0.6, goal: "fund" },
      { name: "Performance", weight: 0.4 },
    ],
    [
      [[2, 2, 2], [9, 8, 10]],
      [[9, 9, 9], [6, 5, 7]],
    ],
    1,
  );
  await db.update(s.decisions).set({ status: "decided" }).where(eq(s.decisions.id, decLaptop));
  void decCar;
  void decMeridian;
  void decFernhill;
  void decNewsletter;

  /* ── memories ── */
  type M = typeof s.memories.$inferInsert;
  const mem = (content: string, category: string, source: string, confidence: number, importance: number, verifiedDaysAgo: number | null, ref?: [string, string]): M => ({
    userId,
    content,
    category,
    source,
    confidence,
    importance,
    lastVerifiedAt: verifiedDaysAgo === null ? null : at(-verifiedDaysAgo),
    sourceRefType: ref?.[0],
    sourceRefId: ref?.[1],
    createdAt: at(-(verifiedDaysAgo ?? 30) - 5),
  });
  await db.insert(s.memories).values([
    mem("Prefers entry-level credit risk and private credit roles; FP&A is an acceptable second choice.", "preference", "user_profile", 0.95, 5, 13),
    mem("Needs a sponsor-licensed employer: Graduate visa expires in about 14 months.", "constraint", "document", 0.98, 5, 2, ["goal", G.visa]),
    mem("Works best in morning deep-work blocks; evenings are for CFA study.", "preference", "user_input", 0.8, 3, 30),
    mem("Minimum effective freelance rate: £35/hour.", "constraint", "user_input", 0.9, 4, 30),
    mem("Daniel Okafor (Northbridge) is a mentor and reviews portfolio work.", "person", "user_input", 0.95, 4, 8, ["person", P.daniel]),
    mem("Tom Becker offered a referral at Brightwater Asset Management.", "person", "integration", 0.85, 4, 74, ["person", P.tom]),
    mem("Missed the Halcyon Insight Day because a deadline lived only in an email.", "lesson", "user_input", 0.95, 4, 19),
    mem("When choosing between options, count one-off switching costs and time costs.", "lesson", "decision", 0.9, 3, 50, ["decision", decFlat]),
    mem("Repair before replace when the tool isn't the bottleneck.", "lesson", "decision", 0.85, 2, 48, ["decision", decLaptop]),
    mem("Paying upfront (commitment devices) increases weekly study hours.", "lesson", "decision", 0.75, 3, 125, ["decision", decCfa]),
    mem("Weak spot in interviews: explaining 'why insurance' / sector motivation.", "lesson", "user_input", 0.8, 4, 13),
    mem("Recruiters at Kestrel will test SQL heavily.", "fact", "integration", 0.85, 4, 31, ["person", P.elena]),
    mem("Private credit teams weigh downside scenarios more than upside.", "fact", "user_input", 0.8, 3, 8, ["person", P.daniel]),
    mem("Rent is £850/month; tenancy fixed term ends in roughly 10 weeks.", "fact", "document", 0.95, 4, 4),
    mem("Monthly essential costs are around £1,200.", "fact", "ai_inference", 0.7, 4, 4),
    mem("Tends to postpone Ethics study and SQL practice — both are 'dry' tasks.", "pattern", "ai_inference", 0.65, 3, 6),
    mem("Prefers concrete next actions over high-level advice.", "preference", "user_input", 0.9, 3, 20),
    mem("Ledgerly contract assigns template IP to the platform and has a 6-month non-compete on platform clients.", "constraint", "document", 0.9, 4, 41),
    mem("Maya's Bakery is happy with the work and open to a monthly retainer.", "fact", "integration", 0.85, 4, 1, ["person", P.maya]),
    mem("Target salary range £32k–£45k.", "preference", "user_profile", 0.85, 3, 13),
    mem("Prefers London-based or hybrid roles; open to Manchester for the right credit team.", "preference", "user_profile", 0.7, 2, 90),
    mem("Mock exam 1 score was 61%; FRA and Ethics are the weakest areas.", "fact", "user_input", 0.9, 4, 7),
    mem("Is interested in quantitative trading roles.", "preference", "ai_inference", 0.35, 1, null),
  ]);
  // One AI-inferred memory has been disputed by the user previously
  await db.update(s.memories).set({ status: "disputed" }).where(eq(s.memories.content, "Is interested in quantitative trading roles."));

  /* ── graph links ── */
  type Lk = typeof s.links.$inferInsert;
  const link = (fromType: string, fromId: string, toType: string, toId: string, relation: string, provenance = "user_input", rationale?: string, strength = 0.7): Lk => ({ userId, fromType, fromId, toType, toId, relation, provenance, rationale, strength });
  await db.insert(s.links).values([
    link("project", PR.dcf, "skill", K.Valuation, "evidences", "fact", "DCF model demonstrates valuation", 0.9),
    link("project", PR.dcf, "skill", K["Financial modelling"], "evidences", "fact", undefined, 0.9),
    link("project", PR.dcf, "skill", K.Excel, "evidences", "fact", undefined, 0.8),
    link("project", PR.dcf, "opportunity", OP.northbridge, "supports", "user_input", "Northbridge asks for valuation and modelling", 0.8),
    link("project", PR.credit, "skill", K.Python, "evidences", "fact", undefined, 0.9),
    link("project", PR.credit, "skill", K["Credit analysis"], "evidences", "fact", undefined, 0.85),
    link("project", PR.credit, "skill", K.Statistics, "evidences", "fact", undefined, 0.8),
    link("project", PR.bakery, "skill", K["Financial modelling"], "evidences", "fact", undefined, 0.8),
    link("project", PR.bakery, "skill", K.Forecasting, "evidences", "fact", undefined, 0.8),
    link("project", PR.sql, "skill", K.SQL, "evidences", "user_input", undefined, 0.5),
    link("project", PR.website, "project", PR.dcf, "requires", "user_input", "Case study needs DCF outputs", 0.8),
    link("person", P.priya, "opportunity", OP.halcyon, "introduced", "integration", "Recruiter message on LinkedIn", 0.9),
    link("person", P.marcus, "opportunity", OP.fernhill, "introduced", "user_input", undefined, 0.9),
    link("person", P.maya, "opportunity", OP.maya, "introduced", "integration", "Email asking for monthly accounts", 0.85),
    link("person", P.tom, "opportunity", OP.brightwater, "can_refer", "integration", "Offered referral in WhatsApp", 0.8),
    link("person", P.aisha, "opportunity", OP.kestrel, "related", "user_input", undefined, 0.5),
    link("person", P.ravi, "person", P.tom, "wants_intro", "user_input", "Ravi asked for an intro", 0.6),
    link("person", P.daniel, "project", PR.dcf, "reviews", "user_input", undefined, 0.8),
    link("person", P.hannah, "opportunity", OP.meridian, "can_help", "integration", "Offered mock interview slots", 0.6),
    link("opportunity", OP.kaggle, "project", PR.credit, "related", "ai_inference", "Same domain and dataset type", 0.6),
  ]);
  const oppGoal: [string, string][] = [
    ["halcyon", "career"], ["northbridge", "career"], ["meridian", "career"], ["aster", "career"], ["kestrel", "career"], ["brightwater", "career"],
    ["halcyon", "visa"], ["meridian", "visa"], ["aster", "visa"],
    ["cafe", "freelance"], ["maya", "freelance"], ["templates", "freelance"], ["tutoring", "freelance"], ["fernhill", "freelance"],
    ["mentoring", "network"], ["alumni", "network"], ["kaggle", "portfolio"], ["bmc", "career"],
  ];
  await db.insert(s.links).values(oppGoal.map(([o, g]) => link("opportunity", OP[o], "goal", G[g], "supports", "user_input")));

  /* ── activities (time allocation & change history) ── */
  type A = typeof s.activities.$inferInsert;
  const acts: A[] = [];
  const work = (daysAgo: number, entityType: string, entityId: string | null, goalKey: string | null, minutes: number, summary: string) =>
    acts.push({ userId, entityType, entityId, goalId: goalKey ? G[goalKey] : null, action: "worked", minutesSpent: minutes, summary, occurredAt: at(-daysAgo, 9 + Math.floor(rand() * 9)) });
  for (let d = 0; d < 21; d++) {
    if (d % 7 === 5) continue;
    work(d, "project", PR.cfa, "cfa", 60 + Math.round(rand() * 60), "CFA study session");
    if (d < 4 || (d > 6 && d < 12)) work(d, "project", PR.bakery, "freelance", 90 + Math.round(rand() * 60), "Bakery cashflow model");
    if (d < 3) work(d, "project", PR.cafe, "freelance", 45, "Café chain model brief");
    if (d % 2 === 0) work(d, "admin", null, null, 40, "Admin: email, bills, errands");
    if (d % 5 === 1) work(d, "project", PR.pipeline, "career", 35, "Job applications");
    if (d === 2 || d === 3 || d === 6 || d === 12) work(d, "project", PR.dcf, "portfolio", 100, "Rolls-Royce DCF modelling");
    if (d >= 19) work(d, "project", PR.run, "run", 45, "Training run");
    if (d === 16) work(d, "project", PR.sql, "sql", 50, "SQL course module 2");
  }
  for (const [days, title] of [[18, "Ethics & Professional Standards"], [13, "Ethics & Professional Standards"], [9, "Ethics & Professional Standards"], [3, "Ethics & Professional Standards"], [12, "Complete module 3"], [7, "Complete module 3"], [2, "Complete module 3"]] as const)
    acts.push({ userId, entityType: "task", entityId: byTitle(title), action: "postponed", summary: `Postponed “${title}”`, occurredAt: at(-days, 21) });
  acts.push(
    { userId, entityType: "task", entityId: byTitle("Write investment thesis"), action: "completed", summary: "Completed DCF investment thesis summary", occurredAt: at(-2, 16) },
    { userId, entityType: "task", entityId: byTitle("Three-scenario"), action: "completed", summary: "Completed three-scenario analysis", occurredAt: at(-3, 18) },
    { userId, entityType: "task", entityId: byTitle("Build WACC from CAPM"), action: "completed", summary: "Completed WACC build", occurredAt: at(-6, 15) },
    { userId, entityType: "task", entityId: byTitle("Fixed Income"), action: "completed", summary: "Finished Fixed Income readings", occurredAt: at(-7, 20) },
    { userId, entityType: "task", entityId: byTitle("Send invoice INV-0042"), action: "completed", summary: "Sent invoice INV-0042 to Maya's Bakery", occurredAt: at(-2, 11) },
    { userId, entityType: "opportunity", entityId: OP.halcyon, action: "created", summary: "New opportunity from LinkedIn: Halcyon Graduate Credit Risk Analyst", occurredAt: at(-3, 9, 20) },
    { userId, entityType: "opportunity", entityId: OP.cafe, action: "status_changed", summary: "Won Ledgerly café chain gig (£450)", occurredAt: at(-4, 14) },
    { userId, entityType: "opportunity", entityId: OP.meridian, action: "status_changed", summary: "Meridian moved to second-round interview", occurredAt: at(-6, 11) },
    { userId, entityType: "project", entityId: PR.credit, action: "status_changed", summary: "Credit PD model marked blocked (dataset)", occurredAt: at(-9, 18) },
    { userId, entityType: "person", entityId: P.daniel, action: "contacted", summary: "Emailed Daniel about DCF review", occurredAt: at(-8, 19) },
    { userId, entityType: "person", entityId: P.marcus, action: "contacted", summary: "Coffee with Marcus about part-time contract", occurredAt: at(-11, 13) },
    { userId, entityType: "goal", entityId: G.cfa, action: "updated", summary: "Mock exam 1 recorded: 61%", occurredAt: at(-7, 21) },
  );
  await db.insert(s.activities).values(acts);

  /* ── integrations ── */
  await db.insert(s.integrations).values([
    { userId, kind: "email", adapter: "mock-mail", status: "connected", lastSyncAt: at(0, 7), lastSyncSummary: "4 threads, 1 needs reply" },
    { userId, kind: "calendar", adapter: "mock-calendar", status: "connected", lastSyncAt: at(0, 7), lastSyncSummary: "5 upcoming events" },
    { userId, kind: "storage", adapter: "local-disk", status: "connected" },
    { userId, kind: "github", adapter: "mock-github", status: "disconnected" },
    { userId, kind: "linkedin", adapter: "mock-linkedin", status: "connected", lastSyncAt: at(-1, 8), lastSyncSummary: "2 messages" },
    { userId, kind: "job_board", adapter: "mock-jobs", status: "connected", lastSyncAt: at(-1, 8), lastSyncSummary: "3 new matching roles available" },
    { userId, kind: "banking", adapter: "mock-openbanking", status: "connected", lastSyncAt: at(0, 6), lastSyncSummary: "3 accounts" },
    { userId, kind: "notes", adapter: "mock-notes", status: "disconnected" },
    { userId, kind: "messaging", adapter: "mock-chat", status: "disconnected" },
  ]);

  /* ── documents (real ingestion pipeline) ── */
  for (const doc of demoDocuments(now)) {
    await ingestDocument(db, userId, { filename: doc.filename, buffer: Buffer.from(doc.text, "utf8"), title: doc.title, uploadedAt: at(-doc.uploadedDaysAgo, 12) });
  }

  /* ── search index ── */
  const indexed = await reindexUser(db, userId);
  logger.info("seed.demo_done", { userId, indexed });
  return userId;
}
