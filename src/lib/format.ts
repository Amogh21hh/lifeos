/** Formatting helpers shared by server engines and client components. */

export const DAY_MS = 86_400_000;

export function money(value: number | null | undefined, currency = "GBP", opts: { compact?: boolean; sign?: boolean } = {}): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const abs = Math.abs(value);
  const formatted =
    opts.compact && abs >= 1000
      ? new Intl.NumberFormat("en-GB", { style: "currency", currency, notation: "compact", maximumFractionDigits: 1 }).format(abs)
      : new Intl.NumberFormat("en-GB", { style: "currency", currency, maximumFractionDigits: abs >= 100 || Number.isInteger(abs) ? 0 : 2 }).format(abs);
  const sign = value < 0 ? "−" : opts.sign && value > 0 ? "+" : "";
  return `${sign}${formatted}`;
}

/** Whole days from `now` (start of day UTC) to `date`. Negative = past. */
export function daysUntil(date: string | Date | null | undefined, now: Date = new Date()): number | null {
  if (!date) return null;
  const d = typeof date === "string" ? new Date(date.length === 10 ? `${date}T00:00:00Z` : date) : date;
  const startNow = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const startD = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.round((startD - startNow) / DAY_MS);
}

export function daysSince(date: string | Date | null | undefined, now: Date = new Date()): number | null {
  const d = daysUntil(date, now);
  return d === null ? null : -d;
}

export function relativeDay(date: string | Date | null | undefined, now: Date = new Date()): string {
  const d = daysUntil(date, now);
  if (d === null) return "no date";
  if (d === 0) return "today";
  if (d === 1) return "tomorrow";
  if (d === -1) return "yesterday";
  if (d > 1 && d < 14) return `in ${d} days`;
  if (d < -1 && d > -14) return `${-d} days ago`;
  if (d >= 14 && d < 60) return `in ${Math.round(d / 7)} weeks`;
  if (d <= -14 && d > -60) return `${Math.round(-d / 7)} weeks ago`;
  if (d >= 60) return `in ${Math.round(d / 30)} months`;
  return `${Math.round(-d / 30)} months ago`;
}

export function shortDate(date: string | Date | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date.length === 10 ? `${date}T00:00:00Z` : date) : date;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

export function longDate(date: string | Date | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date.length === 10 ? `${date}T00:00:00Z` : date) : date;
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export function pct(value: number, digits = 0): string {
  return `${(value * 100).toFixed(digits)}%`;
}

export function hours(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const h = minutes / 60;
  return `${h % 1 === 0 ? h : h.toFixed(1)} h`;
}

export function plural(n: number, word: string, pluralWord = `${word}s`) {
  return `${n} ${n === 1 ? word : pluralWord}`;
}

export function clamp(n: number, lo = 0, hi = 1) {
  return Math.max(lo, Math.min(hi, n));
}

export function titleCase(s: string) {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
