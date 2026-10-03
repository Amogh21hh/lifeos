/** Demo document texts. Dates are relative to "now" so the demo always feels current. */
const DAY = 86_400_000;

export function longDate(offsetDays: number, now = new Date()): string {
  const d = new Date(now.getTime() + offsetDays * DAY);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}
export function ukDate(offsetDays: number, now = new Date()): string {
  const d = new Date(now.getTime() + offsetDays * DAY);
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
}
export function isoDate(offsetDays: number, now = new Date()): string {
  return new Date(now.getTime() + offsetDays * DAY).toISOString().slice(0, 10);
}

export interface SeedDoc {
  key: string;
  filename: string;
  title: string;
  uploadedDaysAgo: number;
  text: string;
}

export function demoDocuments(now = new Date()): SeedDoc[] {
  const L = (d: number) => longDate(d, now);
  const U = (d: number) => ukDate(d, now);
  const I = (d: number) => isoDate(d, now);
  return [
    {
      key: "jd_halcyon",
      filename: "Halcyon_Bank_Graduate_Credit_Risk_Analyst.txt",
      title: "Halcyon Bank — Graduate Credit Risk Analyst (JD)",
      uploadedDaysAgo: 3,
      text: `Graduate Credit Risk Analyst
Company: Halcyon Bank
Location: London (hybrid, 3 days in office)
Salary: £32,000 – £36,000 + 10% bonus

About the role
Halcyon Bank's Credit Risk team assesses SME and mid-market lending exposures across the UK. You will join a team of 8 analysts and support the credit committee.

Responsibilities
- Prepare credit memos and financial spreading for new SME lending applications
- Monitor covenant compliance and early-warning indicators across the portfolio
- Build and maintain probability of default (PD) models in Python
- Present findings to senior credit officers

Requirements
- 2:1 degree or MSc in Finance, Economics or a quantitative subject
- Strong Excel and financial modelling skills
- Working knowledge of Python (pandas) and SQL
- Understanding of credit analysis and financial statements
- Clear written communication
- No prior experience required; internships in banking are an advantage

Visa sponsorship is available for this role under the Skilled Worker route.

Applications close on ${L(4)}. Interviews will be held in the following two weeks.`,
    },
    {
      key: "jd_northbridge",
      filename: "Northbridge_Junior_Credit_Analyst.txt",
      title: "Northbridge Capital — Junior Credit Analyst (JD)",
      uploadedDaysAgo: 15,
      text: `Junior Credit Analyst — Private Credit
Company: Northbridge Capital
Location: London
Salary: £38,000 - £45,000

What you'll do
- Support underwriting of direct lending deals (£10m–£75m tickets)
- Build three-statement and LBO-style debt capacity models in Excel
- Run downside and sensitivity scenarios on borrower cash flows
- Draft sections of investment committee papers

What you'll need
- 0-2 years' experience in credit, leveraged finance, audit or transaction services
- Excellent financial modelling and valuation (DCF) skills
- Credit analysis fundamentals; CFA progress is a plus
- Python is desirable but not essential

We are unable to offer visa sponsorship for this position; candidates must have the right to work in the UK for the duration of employment.

Closing date: ${L(-6)}`,
    },
    {
      key: "invoice_maya",
      filename: "INV-0042_Mayas_Bakery.txt",
      title: "Invoice INV-0042 — Maya's Bakery cashflow model",
      uploadedDaysAgo: 2,
      text: `Amogh — Financial Modelling Services
From: Amogh (sole trader)
Bill to: Maya's Bakery Ltd, 14 Columbia Road, London E2

Invoice number: INV-0042
Invoice date: ${L(-2)}
Due date: ${L(12)}

Description                                   Amount
13-week cashflow model & scenario dashboard   £420.00
Subtotal                                      £420.00
VAT: not VAT registered                        £0.00
Total due                                     £420.00

Payment terms: payment within 14 days by bank transfer.`,
    },
    {
      key: "invoice_schweser",
      filename: "Kaplan_Schweser_Invoice.txt",
      title: "Kaplan Schweser — CFA Level I Essential Package invoice",
      uploadedDaysAgo: 9,
      text: `Kaplan Schweser UK
Invoice number: KS-UK-778213
Invoice date: ${L(-9)}
Bill to: Amogh

CFA Level I Essential Self-Study Package (exam window ${L(60)})   £249.17
VAT (20%)                                                        £49.83
Total due                                                        £299.00

Payment due: ${L(1)}
Access to the online question bank will be suspended if payment is not received by the due date.`,
    },
    {
      key: "contract_ledgerly",
      filename: "Ledgerly_Freelancer_Agreement.txt",
      title: "Ledgerly — Freelance Services Agreement",
      uploadedDaysAgo: 41,
      text: `FREELANCE SERVICES AGREEMENT

This agreement is made between Ledgerly Ltd ("the Platform") and Amogh ("the Contractor") and is effective from ${L(-45)}.

1. Services. The Contractor shall provide financial modelling and bookkeeping services to clients introduced via the Platform.
2. Fees. The Platform shall pay the Contractor 80% of the client fee. Invoices are payable within 30 days of client approval.
3. Term. This agreement runs for 12 months and will automatically renew for successive 12-month periods unless either party gives 30 days' written notice before the renewal date of ${L(320)}.
4. Non-compete. For 6 months after termination the Contractor shall not directly or indirectly provide services to any client of the Platform introduced during the term.
5. Intellectual property. All work product, including templates and models created for clients, is assigned to the Platform on payment.
6. Termination. Either party may terminate this agreement with 14 days' written notice.
7. Confidentiality. The Contractor must keep all client information confidential.
8. Governing law. England and Wales.`,
    },
    {
      key: "cv",
      filename: "Amogh_CV_2026.md",
      title: "Curriculum Vitae (Sept 2026)",
      uploadedDaysAgo: 30,
      text: `Amogh — Curriculum Vitae
London · Graduate visa (valid until ${L(420)})

Profile
MSc Finance graduate focused on credit analysis and financial modelling.

Education
- MSc Finance, Thamesbridge University (Merit) — dissertation on SME default prediction
- BCom Accounting & Finance — First Class

Experience
- Financial Analyst Intern, Fernhill Consulting (3 months) — built budgeting models for 4 clients
- Freelance Financial Modeller — cashflow and 3-statement models for small businesses
- Library Assistant (part-time), Thamesbridge University

Projects
- Rolls-Royce DCF valuation (Excel) — WACC build, scenario analysis
- Credit risk PD model (Python, pandas, scikit-learn) — in progress

Technical skills
Excel, Financial modelling, Valuation, DCF, Python, SQL (basic), Power BI, Accounting, Statistics`,
    },
    {
      key: "visa",
      filename: "Home_Office_Graduate_Route_Grant.txt",
      title: "Home Office — Graduate Route grant letter",
      uploadedDaysAgo: 290,
      text: `UK Visas and Immigration — Home Office

Decision: Your application for permission to stay under the Graduate route has been granted.

Name: Amogh
Leave granted: Graduate route
Valid until: ${L(420)}

Conditions
- You may work, including self-employment
- You may not access public funds
- To remain in the UK after your leave expires you must switch to another route (e.g. Skilled Worker) before ${L(420)}.`,
    },
    {
      key: "cfa_reg",
      filename: "CFA_Institute_Exam_Confirmation.txt",
      title: "CFA Institute — Level I exam appointment",
      uploadedDaysAgo: 120,
      text: `CFA Institute — Exam Appointment Confirmation

Exam: CFA Program Level I
Candidate: Amogh
Exam date: ${L(60)}
Test centre: Pearson VUE, London Holborn
Registration fee paid: £940.00

Please arrive 30 minutes before your appointment. Rescheduling is possible until ${L(30)} for a fee.`,
    },
    {
      key: "meridian_invite",
      filename: "Meridian_Interview_Invitation.txt",
      title: "Meridian Insurance — interview invitation",
      uploadedDaysAgo: 6,
      text: `From: Sophie Laurent <sophie.laurent@meridian-insurance.example>
Subject: FP&A Graduate Programme — second-round interview

Dear Amogh,

Thank you for your application to the FP&A Graduate Programme. We would like to invite you to a second-round interview on ${L(2)} at 10:30 am.

The interview will include a 45-minute case study on budgeting and variance analysis, followed by a competency interview with the Head of FP&A.

Location: Meridian Insurance, 20 Gracechurch Street, London EC3

Please confirm your attendance by ${L(0)}.

Kind regards,
Sophie Laurent
Finance Talent Acquisition`,
    },
    {
      key: "tenancy",
      filename: "Tenancy_Agreement_Flat_3B.txt",
      title: "Assured Shorthold Tenancy — Flat 3B",
      uploadedDaysAgo: 300,
      text: `ASSURED SHORTHOLD TENANCY AGREEMENT

Landlord: Greenway Lettings Ltd
Tenant: Amogh
Property: Flat 3B, 41 Whitmore Road, London N1

Term: fixed term commencing ${L(-295)} and ending on ${L(70)}.
Rent: £850 per month, payable on the 1st of each month.

The Tenant must give at least two months' written notice to end the tenancy at the end of the fixed term. If no notice is given, the tenancy will automatically renew on a 12-month fixed term at a rent reviewed by the Landlord.

The Tenant shall keep the property in good repair. A late payment fee of £30 applies to rent received more than 7 days late.`,
    },
    {
      key: "statement_sep",
      filename: "Monzo_statement_last_month.csv",
      title: "Monzo current account — last month statement",
      uploadedDaysAgo: 4,
      text: `date,description,amount,category
${I(-33)},Greenway Lettings rent,-850.00,Rent
${I(-32)},PureGym membership,-34.99,Fitness
${I(-31)},Tesco Express,-23.40,Groceries
${I(-29)},TfL travel,-28.10,Transport
${I(-27)},Spotify,-11.99,Subscriptions
${I(-26)},Ledgerly payout - cafe chain model,360.00,Freelance
${I(-24)},Pret A Manger,-8.45,Eating out
${I(-22)},Netflix,-10.99,Subscriptions
${I(-20)},Sainsbury's,-41.80,Groceries
${I(-18)},Thamesbridge Univ payroll,1150.00,Salary
${I(-15)},Dishoom,-46.00,Eating out
${I(-12)},TfL travel,-27.40,Transport
${I(-9)},Notion,-8.00,Subscriptions
${I(-6)},Tesco Express,-19.75,Groceries`,
    },
  ];
}
