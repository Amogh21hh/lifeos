import { describe, expect, it } from "vitest";
import { classify, extractDocument, findSkills, parseMoney } from "@/server/documents/extract";
import { findDates } from "@/server/documents/dates";
import { demoDocuments } from "@/server/db/seed-docs";

const NOW = new Date("2026-10-03T12:00:00Z");
const doc = (key: string) => demoDocuments(NOW).find((d) => d.key === key)!.text;
const field = (r: ReturnType<typeof extractDocument>, key: string) => r.fields.find((f) => f.key === key);

describe("dates", () => {
  it("parses ISO, long-form and UK dd/mm/yyyy dates with offsets", () => {
    const text = "Due 2026-10-14, exam 2 December 2026, renewal October 5, 2026, notice 03/11/2026.";
    const found = findDates(text);
    expect(found.map((d) => d.iso)).toEqual(["2026-10-14", "2026-12-02", "2026-10-05", "2026-11-03"]);
    for (const d of found) expect(text.slice(d.start, d.end)).toBe(d.raw);
  });
  it("rejects impossible dates", () => {
    expect(findDates("31/02/2026")).toHaveLength(0);
  });
});

describe("classification", () => {
  it.each([
    ["jd_halcyon", "job_description"],
    ["invoice_schweser", "invoice"],
    ["contract_ledgerly", "contract"],
    ["tenancy", "contract"],
    ["visa", "immigration"],
    ["cfa_reg", "course"],
    ["meridian_invite", "correspondence"],
    ["statement_sep", "bank_statement"],
  ])("%s → %s", (key, kind) => {
    const d = demoDocuments(NOW).find((x) => x.key === key)!;
    expect(classify(d.text, d.filename).kind).toBe(kind);
  });
});

describe("job description extraction", () => {
  const r = extractDocument(doc("jd_halcyon"), { knownSkills: ["Python", "SQL"] });
  it("extracts core fields", () => {
    expect(field(r, "company")?.value).toBe("Halcyon Bank");
    expect(field(r, "salary")?.value).toContain("£32,000");
    expect(field(r, "deadline")?.value).toBe("2026-10-07");
    expect(field(r, "visa")?.value).toMatch(/sponsorship is available/i);
    expect(field(r, "skills")?.value).toMatch(/Python/);
    expect(field(r, "requirements")?.value.split("\n").length).toBeGreaterThanOrEqual(4);
  });
  it("every span-backed field points at real source text", () => {
    const text = doc("jd_halcyon");
    for (const f of r.fields.filter((f) => f.sourceStart !== null)) {
      expect(f.sourceStart!).toBeGreaterThanOrEqual(0);
      expect(f.sourceEnd!).toBeLessThanOrEqual(text.length);
      expect(text.slice(f.sourceStart!, f.sourceEnd!).trim().length).toBeGreaterThan(0);
    }
  });
});

describe("invoice extraction", () => {
  it("finds total, VAT and due date even with wide column spacing", () => {
    const r = extractDocument(doc("invoice_schweser"));
    expect(field(r, "amount")?.value).toBe("299.00");
    expect(field(r, "vat")?.value).toBe("49.83");
    expect(field(r, "due_date")?.value).toBe("2026-10-04");
    expect(field(r, "category")?.value).toBe("Education");
  });
});

describe("contract extraction", () => {
  it("derives the last day to give notice from the end date and notice clause", () => {
    const r = extractDocument(doc("tenancy"));
    expect(field(r, "end_date")?.value).toBe("2026-12-12");
    expect(field(r, "notice_deadline")?.value).toBe("2026-10-12");
    expect(field(r, "clause_auto_renewal")).toBeDefined();
  });
  it("flags risky clauses with full clause text as evidence", () => {
    const r = extractDocument(doc("contract_ledgerly"));
    expect(field(r, "clause_non_compete")?.value).toMatch(/6 months/);
    expect(field(r, "clause_ip")?.value).toMatch(/templates/);
    expect(field(r, "risks")?.value).toMatch(/Non-compete/);
  });
});

describe("helpers", () => {
  it("parses money", () => {
    expect(parseMoney("£32,000")).toBe(32000);
    expect(parseMoney("£45k")).toBe(45000);
    expect(parseMoney("£299.00")).toBe(299);
  });
  it("matches skills on word boundaries", () => {
    expect(findSkills("Strong SQL and R skills; Excel").map((s) => s.name)).toEqual(expect.arrayContaining(["SQL", "R", "Excel"]));
    expect(findSkills("Our RIGOROUS process").map((s) => s.name)).not.toContain("R");
  });
});
