/** Date parsing tuned for UK-centric documents (dd/mm/yyyy), with ISO and long-form support. */

const MONTHS: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4, jun: 5, june: 5,
  jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
};

const MONTH_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";

export const DATE_PATTERNS: RegExp[] = [
  /\b(\d{4})-(\d{2})-(\d{2})\b/gi, // ISO
  new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH_RE}\\.?,?\\s+(\\d{4})\\b`, "gi"), // 14 October 2026
  new RegExp(`\\b${MONTH_RE}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, "gi"), // October 14, 2026
  /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g, // 14/10/2026 (UK)
];

export interface FoundDate {
  iso: string;
  start: number;
  end: number;
  raw: string;
}

function iso(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

export function findDates(text: string): FoundDate[] {
  const out: FoundDate[] = [];
  const seen = new Set<number>();
  DATE_PATTERNS.forEach((pattern, pi) => {
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(text))) {
      if (seen.has(m.index)) continue;
      let value: string | null = null;
      if (pi === 0) value = iso(+m[1], +m[2] - 1, +m[3]);
      else if (pi === 1) value = iso(+m[3], MONTHS[m[2].toLowerCase().replace(".", "")] ?? -1, +m[1]);
      else if (pi === 2) value = iso(+m[3], MONTHS[m[1].toLowerCase().replace(".", "")] ?? -1, +m[2]);
      else value = iso(+m[3], +m[2] - 1, +m[1]);
      if (value) {
        seen.add(m.index);
        out.push({ iso: value, start: m.index, end: m.index + m[0].length, raw: m[0] });
      }
    }
  });
  return out.sort((a, b) => a.start - b.start);
}

export function parseDate(text: string): string | null {
  return findDates(text)[0]?.iso ?? null;
}

/** Format a Date as YYYY-MM-DD (UTC). */
export function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
