/**
 * Rule-based document intelligence.
 *
 * Every field carries the exact character span it was read from (sourceStart/sourceEnd),
 * so the UI can highlight the evidence and the user can verify or correct it.
 * When an LLM is configured, the DocumentAgent augments these results; rules always run
 * first so the system works offline and LLM output can be cross-checked against text spans.
 */
import { findDates, type FoundDate } from "./dates";

export type DocumentKind =
  | "job_description"
  | "invoice"
  | "contract"
  | "cv"
  | "bank_statement"
  | "offer_letter"
  | "correspondence"
  | "course"
  | "immigration"
  | "spreadsheet"
  | "note"
  | "image"
  | "other";

export interface ExtractedField {
  key: string;
  label: string;
  value: string;
  valueType: "text" | "money" | "date" | "list" | "number" | "percent";
  confidence: number;
  sourceText: string | null;
  sourceStart: number | null;
  sourceEnd: number | null;
  method: "rule" | "llm" | "user";
}

export interface ExtractionResult {
  kind: DocumentKind;
  kindConfidence: number;
  kindSignals: string[];
  fields: ExtractedField[];
  summary: string;
}

const KIND_SIGNALS: Record<Exclude<DocumentKind, "spreadsheet" | "note" | "image" | "other">, string[]> = {
  job_description: ["responsibilities", "requirements", "about the role", "we are looking", "candidate", "apply", "salary", "experience", "what you'll do", "what you will do", "key skills", "the role"],
  invoice: ["invoice", "amount due", "bill to", "invoice number", "invoice no", "vat", "subtotal", "payment terms", "balance due", "remit"],
  contract: ["agreement", "parties", "hereby", "shall", "terminate", "termination", "governing law", "clause", "obligations", "tenancy", "landlord", "tenant", "indemn"],
  cv: ["curriculum vitae", "education", "work experience", "references available", "profile", "technical skills", "msc", "bsc", "achievements"],
  bank_statement: ["statement", "opening balance", "closing balance", "sort code", "account number", "money in", "money out", "date,description,amount"],
  offer_letter: ["pleased to offer", "offer of employment", "start date", "your salary", "accept this offer", "probation"],
  correspondence: ["dear", "invite you", "invitation", "kind regards", "best regards", "interview", "look forward"],
  course: ["syllabus", "module", "enrol", "learning outcomes", "registration", "exam window", "candidate number", "exam"],
  immigration: ["visa", "home office", "leave to remain", "biometric residence", "brp", "graduate route", "skilled worker", "immigration"],
};

export function classify(text: string, filename = ""): { kind: DocumentKind; confidence: number; signals: string[] } {
  const lower = `${filename.toLowerCase()} ${text.toLowerCase().slice(0, 20000)}`;
  let best: { kind: DocumentKind; score: number; signals: string[] } = { kind: "other", score: 0, signals: [] };
  let total = 0;
  for (const [kind, signals] of Object.entries(KIND_SIGNALS)) {
    const hit = signals.filter((sig) => lower.includes(sig));
    const score = hit.length + (filename.toLowerCase().includes(kind.split("_")[0]) ? 2 : 0);
    total += score;
    if (score > best.score) best = { kind: kind as DocumentKind, score, signals: hit };
  }
  if (best.score < 2) return { kind: text.trim().length < 400 ? "note" : "other", confidence: 0.3, signals: best.signals };
  const confidence = Math.min(0.95, 0.45 + (best.score / Math.max(total, 1)) * 0.35 + Math.min(best.score, 8) * 0.03);
  return { kind: best.kind, confidence: Number(confidence.toFixed(2)), signals: best.signals };
}

/* ───────────────────────────── helpers ───────────────────────────── */

function field(
  key: string,
  label: string,
  value: string,
  valueType: ExtractedField["valueType"],
  confidence: number,
  span?: { start: number; end: number; text: string } | null,
): ExtractedField {
  return {
    key,
    label,
    value: value.trim(),
    valueType,
    confidence: Number(confidence.toFixed(2)),
    sourceText: span?.text ?? null,
    sourceStart: span?.start ?? null,
    sourceEnd: span?.end ?? null,
    method: "rule",
  };
}

/** "Label: value" lines. Returns the value and its span. */
export function findLabeled(text: string, labels: string[]): { value: string; start: number; end: number; text: string } | null {
  const re = new RegExp(`^[ \\t>*•-]*(?:${labels.map(escapeRe).join("|")})\\s*[:\\-–]\\s*(.+)$`, "gim");
  const m = re.exec(text);
  if (!m) return null;
  return { value: m[1].trim(), start: m.index, end: m.index + m[0].length, text: m[0].trim() };
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Collect bullet/short lines under a heading until the next heading or blank gap. */
export function sectionItems(text: string, headings: string[]): { items: string[]; start: number; end: number } | null {
  const re = new RegExp(`^[ \\t#*]*(?:${headings.map(escapeRe).join("|")})[^\\n]{0,30}$`, "gim");
  const m = re.exec(text);
  if (!m) return null;
  const after = text.slice(m.index + m[0].length);
  const lines = after.split("\n");
  const items: string[] = [];
  let consumed = 0;
  let blankRun = 0;
  for (const raw of lines) {
    consumed += raw.length + 1;
    const line = raw.trim();
    if (!line) {
      if (items.length && ++blankRun >= 1) break;
      continue;
    }
    blankRun = 0;
    const isBullet = /^([-•*▪◦]|\d+[.)])\s+/.test(line);
    const looksHeading = !isBullet && line.length < 45 && /:$|^[A-Z][A-Za-z' ]+$/.test(line) && items.length > 0;
    if (looksHeading) break;
    if (isBullet || line.length < 160) items.push(line.replace(/^([-•*▪◦]|\d+[.)])\s+/, ""));
    if (items.length >= 15) break;
  }
  if (!items.length) return null;
  return { items, start: m.index, end: m.index + m[0].length + consumed };
}

const MONEY_RE = /£\s?\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?\s?k?\b|£\s?\d+(?:\.\d{1,2})?\s?k?\b/gi;

export function parseMoney(raw: string): number | null {
  const m = raw.replace(/\s/g, "").match(/£?([\d,]+(?:\.\d+)?)(k)?/i);
  if (!m) return null;
  const n = parseFloat(m[1].replace(/,/g, ""));
  return m[2] ? n * 1000 : n;
}

function moneyNear(text: string, labels: string[]): { amount: number; raw: string; start: number; end: number; line: string } | null {
  const re = new RegExp(`(?:${labels.map(escapeRe).join("|")})[^\\n£]{0,90}(£\\s?[\\d,]+(?:\\.\\d{1,2})?)`, "gi");
  let m: RegExpExecArray | null;
  let last: { amount: number; raw: string; start: number; end: number; line: string } | null = null;
  while ((m = re.exec(text))) {
    const amount = parseMoney(m[1]);
    if (amount !== null) last = { amount, raw: m[1], start: m.index, end: m.index + m[0].length, line: m[0] };
  }
  return last;
}

function dateNear(text: string, dates: FoundDate[], labels: string[], window = 80): FoundDate | null {
  const lower = text.toLowerCase();
  let best: { d: FoundDate; dist: number } | null = null;
  for (const label of labels) {
    let idx = lower.indexOf(label);
    while (idx >= 0) {
      for (const d of dates) {
        const dist = d.start - idx;
        if (dist >= 0 && dist <= window && (!best || dist < best.dist)) best = { d, dist };
      }
      idx = lower.indexOf(label, idx + 1);
    }
  }
  return best?.d ?? null;
}

function spanOf(text: string, start: number, end: number) {
  const s = Math.max(0, start);
  const e = Math.min(text.length, end);
  return { start: s, end: e, text: text.slice(s, e).trim() };
}

function lineAround(text: string, index: number) {
  const start = text.lastIndexOf("\n", index) + 1;
  const endIdx = text.indexOf("\n", index);
  const end = endIdx === -1 ? text.length : endIdx;
  return spanOf(text, start, end);
}

export const SKILL_LEXICON = [
  "Python", "SQL", "Excel", "VBA", "Power BI", "Tableau", "R", "Financial modelling", "Financial modeling", "Valuation", "DCF",
  "Credit analysis", "Credit risk", "Accounting", "IFRS", "Statistics", "Machine learning", "Communication", "Stakeholder management",
  "Bloomberg", "Data visualisation", "Forecasting", "Budgeting", "Audit", "Risk management", "Pandas", "Git", "PowerPoint", "Presentation",
];

export function findSkills(text: string, extra: string[] = []): { name: string; start: number; end: number }[] {
  const out: { name: string; start: number; end: number }[] = [];
  const seen = new Set<string>();
  for (const name of [...extra, ...SKILL_LEXICON]) {
    const key = name.toLowerCase().replace("modeling", "modelling");
    if (seen.has(key)) continue;
    const re = new RegExp(`(?<![A-Za-z])${escapeRe(name)}(?![A-Za-z])`, name.length <= 2 ? "g" : "gi");
    const m = re.exec(text);
    if (m) {
      seen.add(key);
      out.push({ name: name.replace(/modeling/i, "modelling"), start: m.index, end: m.index + m[0].length });
    }
  }
  return out;
}

/* ───────────────────────────── extractors ───────────────────────────── */

function extractJob(text: string, dates: FoundDate[], knownSkills: string[]): ExtractedField[] {
  const f: ExtractedField[] = [];
  const role = findLabeled(text, ["Role", "Job title", "Position", "Title"]);
  if (role) f.push(field("role", "Role", role.value, "text", 0.9, role));
  else {
    const first = text.split("\n").find((l) => l.trim().length > 3);
    if (first) f.push(field("role", "Role", first, "text", 0.55, spanOf(text, text.indexOf(first), text.indexOf(first) + first.length)));
  }
  const company = findLabeled(text, ["Company", "Employer", "Organisation", "Organization", "Hiring company"]);
  if (company) f.push(field("company", "Company", company.value, "text", 0.9, company));
  else {
    const m = /\b(?:About|Join|at)\s+([A-Z][\w&]+(?:\s+[A-Z&][\w&]+){0,3})/.exec(text);
    if (m) f.push(field("company", "Company", m[1], "text", 0.5, spanOf(text, m.index, m.index + m[0].length)));
  }
  const salaryLine = findLabeled(text, ["Salary", "Compensation", "Pay", "Package"]);
  const moneyInText = [...text.matchAll(MONEY_RE)];
  if (salaryLine) f.push(field("salary", "Salary", salaryLine.value, "money", 0.9, salaryLine));
  else if (moneyInText.length) {
    const m = moneyInText[0];
    f.push(field("salary", "Salary", lineAround(text, m.index!).text, "money", 0.55, lineAround(text, m.index!)));
  }
  const location = findLabeled(text, ["Location", "Based in", "Office"]);
  if (location) f.push(field("location", "Location", location.value, "text", 0.9, location));
  else {
    const m = /\b(London|Manchester|Birmingham|Leeds|Edinburgh|Glasgow|Bristol|Remote|Hybrid)\b/.exec(text);
    if (m) f.push(field("location", "Location", m[1], "text", 0.55, lineAround(text, m.index)));
  }
  const deadline = dateNear(text, dates, ["closing date", "apply by", "deadline", "applications close", "closes on", "close on"]);
  if (deadline) f.push(field("deadline", "Application deadline", deadline.iso, "date", 0.88, lineAround(text, deadline.start)));
  const exp = /(\d+)\+?\s*(?:-\s*\d+\s*)?years?['’]?\s+(?:of\s+)?(?:relevant\s+)?experience/i.exec(text) ?? /(no (?:prior )?experience (?:required|necessary)|graduate|entry[- ]level)/i.exec(text);
  if (exp) f.push(field("experience", "Experience required", exp[0], "text", 0.75, lineAround(text, exp.index)));
  const visa = /[^.\n]*(visa sponsorship|sponsor(?:ship)?|right to work|skilled worker)[^.\n]*/i.exec(text);
  if (visa)
    f.push(field("visa", "Visa / right to work", visa[0].trim(), "text", 0.85, spanOf(text, visa.index, visa.index + visa[0].length)));
  const reqs = sectionItems(text, ["Requirements", "What you'll need", "What you will need", "Essential", "About you", "Qualifications", "Skills and experience"]);
  if (reqs) f.push(field("requirements", "Requirements", reqs.items.join("\n"), "list", 0.8, spanOf(text, reqs.start, reqs.end)));
  const resp = sectionItems(text, ["Responsibilities", "What you'll do", "What you will do", "Key responsibilities", "The role", "Your day"]);
  if (resp) f.push(field("responsibilities", "Responsibilities", resp.items.join("\n"), "list", 0.8, spanOf(text, resp.start, resp.end)));
  const skills = findSkills(text, knownSkills);
  if (skills.length)
    f.push(field("skills", "Skills mentioned", skills.map((s) => s.name).join(", "), "list", 0.82, spanOf(text, skills[0].start, skills[0].end)));
  return f;
}

function extractInvoice(text: string, dates: FoundDate[]): ExtractedField[] {
  const f: ExtractedField[] = [];
  const vendor = findLabeled(text, ["From", "Vendor", "Supplier", "Seller", "Issued by"]);
  if (vendor) f.push(field("vendor", "Vendor", vendor.value, "text", 0.85, vendor));
  else {
    const first = text.split("\n").find((l) => l.trim().length > 2);
    if (first) f.push(field("vendor", "Vendor", first, "text", 0.5, spanOf(text, text.indexOf(first), text.indexOf(first) + first.length)));
  }
  const billTo = findLabeled(text, ["Bill to", "Billed to", "To", "Customer", "Client"]);
  if (billTo) f.push(field("bill_to", "Billed to", billTo.value, "text", 0.8, billTo));
  const number = /invoice\s*(?:no\.?|number|#)\s*[:\-]?\s*([A-Z0-9-]{3,})/i.exec(text);
  if (number) f.push(field("invoice_number", "Invoice number", number[1], "text", 0.9, lineAround(text, number.index)));
  const issued = dateNear(text, dates, ["invoice date", "date of issue", "issued", "date:"]);
  if (issued) f.push(field("invoice_date", "Invoice date", issued.iso, "date", 0.85, lineAround(text, issued.start)));
  const due = dateNear(text, dates, ["due date", "payment due", "due by", "pay by", "due:"]);
  if (due) f.push(field("due_date", "Due date", due.iso, "date", 0.88, lineAround(text, due.start)));
  const total = moneyNear(text, ["total due", "amount due", "balance due", "total"]);
  if (total) f.push(field("amount", "Total amount", total.amount.toFixed(2), "money", 0.88, lineAround(text, total.start)));
  const vat = moneyNear(text, ["vat"]);
  if (vat) f.push(field("vat", "VAT", vat.amount.toFixed(2), "money", 0.8, lineAround(text, vat.start)));
  else if (/not vat registered|no vat|vat:\s*n\/?a/i.test(text)) {
    const m = /not vat registered|no vat|vat:\s*n\/?a/i.exec(text)!;
    f.push(field("vat", "VAT", "0.00 (not VAT registered)", "money", 0.8, lineAround(text, m.index)));
  }
  const lower = text.toLowerCase();
  const categories: [string, string[]][] = [
    ["Education", ["course", "exam", "study", "tuition", "cfa", "training"]],
    ["Software", ["subscription", "licence", "license", "saas", "software"]],
    ["Professional services", ["consulting", "modelling", "bookkeeping", "management accounts", "services rendered"]],
    ["Travel", ["train", "flight", "hotel", "taxi"]],
    ["Equipment", ["laptop", "monitor", "hardware", "repair"]],
  ];
  const cat = categories.find(([, kws]) => kws.some((k) => lower.includes(k)));
  if (cat) {
    const kw = cat[1].find((k) => lower.includes(k))!;
    f.push(field("category", "Category", cat[0], "text", 0.65, lineAround(text, lower.indexOf(kw))));
  }
  return f;
}

const CLAUSE_TYPES: { key: string; label: string; pattern: RegExp; risk?: string }[] = [
  { key: "auto_renewal", label: "Auto-renewal", pattern: /automatically renew|auto[- ]renew|shall renew|rolling basis/i, risk: "Renews automatically unless you act before the notice window." },
  { key: "non_compete", label: "Non-compete", pattern: /non[- ]compete|shall not (?:directly or indirectly )?(?:provide|engage|work)[^.]{0,80}(?:competitor|competing|clients? of)/i, risk: "Restricts working with competitors or the counterparty's clients after the contract ends." },
  { key: "ip", label: "Intellectual property", pattern: /intellectual property|all work product|assigns? (?:all )?rights/i, risk: "Broad IP assignment may cover templates or work you reuse elsewhere." },
  { key: "liability", label: "Liability", pattern: /unlimited liability|indemnif(?:y|ies)|liable for all/i, risk: "Indemnity or uncapped liability exposes you to losses beyond the contract value." },
  { key: "termination", label: "Termination", pattern: /terminat(?:e|ion)[^.]{0,120}(?:notice|days|weeks|months)/i },
  { key: "payment_terms", label: "Payment terms", pattern: /(?:payment|invoices?)[^.]{0,60}(?:within|net)\s*\d+\s*days/i },
  { key: "confidentiality", label: "Confidentiality", pattern: /confidential/i },
  { key: "notice_period", label: "Notice period", pattern: /(?:give|provide|serve)[^.]{0,30}(?:\d+|one|two|three|four|six)\s*(?:days|weeks|months)['’]?\s*(?:written\s*)?notice/i },
  { key: "penalty", label: "Penalty / fees", pattern: /late (?:payment )?fee|penalt(?:y|ies)|early termination fee/i, risk: "Financial penalty applies on late payment or early exit." },
];

function extractContract(text: string, dates: FoundDate[]): ExtractedField[] {
  const f: ExtractedField[] = [];
  const between = /between\s+(.{3,80}?)\s*(?:\(["“]?[^)]{0,30}["”]?\))?\s+and\s+(.{3,80}?)(?:\s*\(|[.,;\n])/i.exec(text);
  if (between) f.push(field("parties", "Parties", `${between[1].trim()}; ${between[2].trim()}`, "list", 0.82, spanOf(text, between.index, between.index + between[0].length)));
  else {
    const landlord = findLabeled(text, ["Landlord", "Party A", "Client", "Provider"]);
    const tenant = findLabeled(text, ["Tenant", "Party B", "Contractor", "Consultant"]);
    if (landlord || tenant)
      f.push(field("parties", "Parties", [landlord?.value, tenant?.value].filter(Boolean).join("; "), "list", 0.7, landlord ?? tenant));
  }
  const effective = dateNear(text, dates, ["effective", "commenc", "start date", "dated", "begins on", "starting", "from"]);
  if (effective) f.push(field("start_date", "Start / effective date", effective.iso, "date", 0.78, lineAround(text, effective.start)));
  const end = dateNear(text, dates, ["end date", "expires", "expiry", "until", "ends on", "ending on", "term ends", "renewal date", "fixed term ending"]);
  if (end && end !== effective) f.push(field("end_date", "End / expiry date", end.iso, "date", 0.8, lineAround(text, end.start)));
  const value = moneyNear(text, ["fee", "rent", "rate", "value", "price", "per month", "per day"]);
  if (value) f.push(field("value", "Contract value / rate", lineAround(text, value.start).text, "money", 0.7, lineAround(text, value.start)));

  const obligations = [...text.matchAll(/[^.\n]*\b(?:shall|must|agrees? to|is responsible for)\b[^.\n]*\./gi)].slice(0, 6);
  if (obligations.length)
    f.push(
      field(
        "obligations",
        "Key obligations",
        obligations.map((o) => o[0].trim()).join("\n"),
        "list",
        0.7,
        spanOf(text, obligations[0].index!, obligations[0].index! + obligations[0][0].length),
      ),
    );
  const risks: string[] = [];
  for (const c of CLAUSE_TYPES) {
    const m = c.pattern.exec(text);
    if (!m) continue;
    const sentenceStart = Math.max(text.lastIndexOf(".", m.index) + 1, text.lastIndexOf("\n", m.index) + 1);
    const sentenceEndIdx = text.indexOf(".", m.index);
    let span = spanOf(text, sentenceStart, sentenceEndIdx === -1 ? m.index + 160 : sentenceEndIdx + 1);
    // Headings like "4. Non-compete." are too short to be useful evidence: use the whole clause line.
    if (span.text.length < 40) {
      const line = lineAround(text, m.index);
      span = spanOf(text, line.start, Math.min(line.end, line.start + 400));
    }
    f.push(field(`clause_${c.key}`, `Clause: ${c.label}`, span.text, "text", 0.75, span));
    if (c.risk) risks.push(`${c.label}: ${c.risk}`);
  }
  if (risks.length) f.push(field("risks", "Potential risks", risks.join("\n"), "list", 0.65, null));

  // Derived: last day to serve notice = end date − notice period (only when both are explicit in the text).
  const notice = f.find((x) => x.key === "clause_notice_period") ?? f.find((x) => x.key === "clause_auto_renewal");
  const noticeMatch = notice ? /(\d+|one|two|three|four|six)\s*(days|weeks|months)['’]?\s*(?:written\s*)?notice/i.exec(notice.value) : null;
  if (end && notice && noticeMatch) {
    const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, six: 6 };
    const n = Number(noticeMatch[1]) || words[noticeMatch[1].toLowerCase()] || 0;
    const d = new Date(`${end.iso}T00:00:00Z`);
    if (/day/i.test(noticeMatch[2])) d.setUTCDate(d.getUTCDate() - n);
    else if (/week/i.test(noticeMatch[2])) d.setUTCDate(d.getUTCDate() - n * 7);
    else d.setUTCMonth(d.getUTCMonth() - n);
    f.push(
      field("notice_deadline", "Last day to give notice (derived)", d.toISOString().slice(0, 10), "date", 0.7, {
        start: notice.sourceStart ?? 0,
        end: notice.sourceEnd ?? 0,
        text: notice.sourceText ?? "",
      }),
    );
  }
  return f;
}

function extractBankStatement(text: string): ExtractedField[] {
  const f: ExtractedField[] = [];
  const rows = text.split("\n").filter((l) => /^\s*\d{4}-\d{2}-\d{2}|^\s*\d{1,2}\/\d{1,2}\/\d{4}/.test(l));
  if (rows.length) {
    f.push(field("transaction_count", "Transactions", String(rows.length), "number", 0.9, spanOf(text, text.indexOf(rows[0]), text.indexOf(rows[0]) + rows[0].length)));
    let inflow = 0;
    let outflow = 0;
    for (const r of rows) {
      const nums = r.match(/-?£?\d[\d,]*\.\d{2}/g);
      if (!nums) continue;
      const v = parseFloat(nums[0].replace(/[£,]/g, ""));
      if (v >= 0) inflow += v;
      else outflow += -v;
    }
    f.push(field("money_in", "Money in", inflow.toFixed(2), "money", 0.8, null));
    f.push(field("money_out", "Money out", outflow.toFixed(2), "money", 0.8, null));
    const ds = findDates(rows.join("\n"));
    if (ds.length) f.push(field("period", "Statement period", `${ds[0].iso} → ${ds[ds.length - 1].iso}`, "text", 0.85, null));
  }
  return f;
}

function extractCorrespondence(text: string, dates: FoundDate[]): ExtractedField[] {
  const f: ExtractedField[] = [];
  const from = /(?:^from:\s*(.+)$)|(?:(?:kind|best|warm) regards,?\s*\n\s*([^\n]+))/im.exec(text);
  if (from) f.push(field("from", "From", (from[1] ?? from[2]).trim(), "text", 0.75, spanOf(text, from.index, from.index + from[0].length)));
  const when = dateNear(text, dates, ["on ", "scheduled", "interview", "date", "meeting"], 120);
  if (when) f.push(field("event_date", "Event date", when.iso, "date", 0.78, lineAround(text, when.start)));
  const time = /\b(\d{1,2}[:.]\d{2}\s?(?:am|pm)?|\d{1,2}\s?(?:am|pm))\b/i.exec(text);
  if (time) f.push(field("event_time", "Time", time[1], "text", 0.7, lineAround(text, time.index)));
  const format = /[^.\n]*(case study|assessment centre|video interview|panel|competency|technical test)[^.\n]*/i.exec(text);
  if (format) f.push(field("format", "Format", format[0].trim(), "text", 0.72, spanOf(text, format.index, format.index + format[0].length)));
  const location = findLabeled(text, ["Location", "Venue", "Address", "Where"]);
  if (location) f.push(field("location", "Location", location.value, "text", 0.8, location));
  const reply = dateNear(text, dates, ["confirm by", "reply by", "let us know by", "respond by"]);
  if (reply) f.push(field("reply_by", "Reply needed by", reply.iso, "date", 0.82, lineAround(text, reply.start)));
  return f;
}

function extractImmigration(text: string, dates: FoundDate[]): ExtractedField[] {
  const f: ExtractedField[] = [];
  const type = /[^.\n]*(graduate (?:route|visa)|skilled worker|student visa|leave to remain)[^.\n]*/i.exec(text);
  if (type) f.push(field("visa_type", "Visa type", type[1], "text", 0.85, spanOf(text, type.index, type.index + type[0].length)));
  const expiry = dateNear(text, dates, ["valid until", "expires", "expiry", "leave expires", "until"], 60);
  if (expiry) f.push(field("expiry", "Leave expires", expiry.iso, "date", 0.88, lineAround(text, expiry.start)));
  const cond = sectionItems(text, ["Conditions", "Conditions of leave"]);
  if (cond) f.push(field("conditions", "Conditions", cond.items.join("\n"), "list", 0.75, spanOf(text, cond.start, cond.end)));
  return f;
}

function extractCourse(text: string, dates: FoundDate[]): ExtractedField[] {
  const f: ExtractedField[] = [];
  const name = findLabeled(text, ["Exam", "Course", "Programme", "Qualification"]);
  if (name) f.push(field("course", "Course / exam", name.value, "text", 0.85, name));
  const examDate = dateNear(text, dates, ["exam date", "appointment", "scheduled for", "sitting", "test date"], 100);
  if (examDate) f.push(field("exam_date", "Exam date", examDate.iso, "date", 0.86, lineAround(text, examDate.start)));
  const fee = moneyNear(text, ["fee", "paid", "cost", "total"]);
  if (fee) f.push(field("fee", "Fee", fee.amount.toFixed(2), "money", 0.8, lineAround(text, fee.start)));
  const loc = findLabeled(text, ["Test centre", "Location", "Venue"]);
  if (loc) f.push(field("location", "Location", loc.value, "text", 0.8, loc));
  return f;
}

function extractCv(text: string, knownSkills: string[]): ExtractedField[] {
  const f: ExtractedField[] = [];
  const skills = findSkills(text, knownSkills);
  if (skills.length) f.push(field("skills", "Skills evidenced", skills.map((s) => s.name).join(", "), "list", 0.8, spanOf(text, skills[0].start, skills[0].end)));
  const edu = sectionItems(text, ["Education"]);
  if (edu) f.push(field("education", "Education", edu.items.join("\n"), "list", 0.78, spanOf(text, edu.start, edu.end)));
  const exp = sectionItems(text, ["Experience", "Work experience", "Employment"]);
  if (exp) f.push(field("experience", "Experience", exp.items.join("\n"), "list", 0.75, spanOf(text, exp.start, exp.end)));
  const projects = sectionItems(text, ["Projects", "Portfolio"]);
  if (projects) f.push(field("projects", "Projects", projects.items.join("\n"), "list", 0.75, spanOf(text, projects.start, projects.end)));
  return f;
}

/** Deadlines mentioned anywhere: any date in the future-tense context of due/deadline/by/expire. */
function extractGenericDeadlines(text: string, dates: FoundDate[], already: Set<string>): ExtractedField[] {
  const out: ExtractedField[] = [];
  for (const d of dates) {
    if (already.has(d.iso)) continue;
    const ctx = text.slice(Math.max(0, d.start - 70), d.start).toLowerCase();
    if (/(deadline|due|by|before|expire|expiry|until|close|notice|no later than|renew)/.test(ctx)) {
      out.push(field(`deadline_${out.length + 1}`, "Mentioned deadline", d.iso, "date", 0.62, lineAround(text, d.start)));
      already.add(d.iso);
    }
    if (out.length >= 5) break;
  }
  return out;
}

function summarise(kind: DocumentKind, fields: ExtractedField[]): string {
  const get = (k: string) => fields.find((f) => f.key === k)?.value;
  switch (kind) {
    case "job_description":
      return [get("role"), get("company") && `at ${get("company")}`, get("salary") && `· ${get("salary")}`, get("deadline") && `· closes ${get("deadline")}`]
        .filter(Boolean)
        .join(" ");
    case "invoice":
      return `Invoice${get("invoice_number") ? ` ${get("invoice_number")}` : ""} from ${get("vendor") ?? "unknown vendor"}${get("amount") ? ` for £${get("amount")}` : ""}${get("due_date") ? `, due ${get("due_date")}` : ""}.`;
    case "contract": {
      const risks = fields.filter((f) => f.key.startsWith("clause_")).map((f) => f.label.replace("Clause: ", "")).join(", ");
      return `Agreement between ${get("parties") ?? "unidentified parties"}${get("end_date") ? `, ends ${get("end_date")}` : ""}${risks ? `. Clauses detected: ${risks}.` : "."}`;
    }
    case "immigration":
      return `${get("visa_type") ?? "Immigration document"}${get("expiry") ? ` — leave expires ${get("expiry")}` : ""}.`;
    case "course":
      return `${get("course") ?? "Course/exam document"}${get("exam_date") ? ` — exam on ${get("exam_date")}` : ""}.`;
    case "correspondence":
      return `Message${get("from") ? ` from ${get("from")}` : ""}${get("event_date") ? ` about an event on ${get("event_date")}` : ""}.`;
    case "bank_statement":
      return `Statement with ${get("transaction_count") ?? "?"} transactions (${get("period") ?? "period unknown"}).`;
    case "cv":
      return `CV evidencing: ${get("skills") ?? "no recognised skills"}.`;
    default:
      return fields.length ? `${fields.length} fields extracted.` : "No structured fields recognised.";
  }
}

export function extractDocument(text: string, opts: { filename?: string; knownSkills?: string[]; forceKind?: DocumentKind } = {}): ExtractionResult {
  const cls = opts.forceKind ? { kind: opts.forceKind, confidence: 1, signals: ["user selected"] } : classify(text, opts.filename);
  const dates = findDates(text);
  const known = opts.knownSkills ?? [];
  let fields: ExtractedField[] = [];
  switch (cls.kind) {
    case "job_description":
      fields = extractJob(text, dates, known);
      break;
    case "invoice":
      fields = extractInvoice(text, dates);
      break;
    case "contract":
      fields = extractContract(text, dates);
      break;
    case "bank_statement":
      fields = extractBankStatement(text);
      break;
    case "correspondence":
    case "offer_letter":
      fields = extractCorrespondence(text, dates);
      break;
    case "immigration":
      fields = extractImmigration(text, dates);
      break;
    case "course":
      fields = extractCourse(text, dates);
      break;
    case "cv":
      fields = extractCv(text, known);
      break;
  }
  const used = new Set(fields.filter((f) => f.valueType === "date").map((f) => f.value));
  fields.push(...extractGenericDeadlines(text, dates, used));
  return { kind: cls.kind, kindConfidence: cls.confidence, kindSignals: cls.signals, fields, summary: summarise(cls.kind, fields) };
}
