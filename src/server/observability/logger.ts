/**
 * Structured JSON logger. One line per event so logs can be shipped to any
 * collector (Datadog, Loki, CloudWatch) without parsing changes.
 * Secrets are redacted by key name before serialisation.
 */
type Level = "debug" | "info" | "warn" | "error";
const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const minLevel = (process.env.LOG_LEVEL as Level) ?? (process.env.NODE_ENV === "production" ? "info" : "info");
const REDACT = /pass(word)?|secret|token|api[-_]?key|authorization|cookie/i;

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = REDACT.test(k) ? "[redacted]" : redact(v, depth + 1);
  }
  return out;
}

export type ErrorHook = (err: unknown, context: Record<string, unknown>) => void;
const errorHooks: ErrorHook[] = [];

/** Register an error tracker (Sentry, Honeybadger, …). Called for every logger.error. */
export function registerErrorHook(hook: ErrorHook) {
  errorHooks.push(hook);
}

function emit(level: Level, event: string, data?: Record<string, unknown>) {
  if (LEVELS[level] < LEVELS[minLevel]) return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...(redact(data ?? {}) as object) });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (event: string, data?: Record<string, unknown>) => emit("debug", event, data),
  info: (event: string, data?: Record<string, unknown>) => emit("info", event, data),
  warn: (event: string, data?: Record<string, unknown>) => emit("warn", event, data),
  error: (event: string, err: unknown, data?: Record<string, unknown>) => {
    const e = err instanceof Error ? { message: err.message, stack: err.stack?.split("\n").slice(0, 6).join("\n") } : { message: String(err) };
    emit("error", event, { ...data, error: e });
    for (const hook of errorHooks) {
      try {
        hook(err, { event, ...data });
      } catch {
        /* never let a tracker crash the request */
      }
    }
  },
};

/** Measure an async operation and log its latency. */
export async function timed<T>(event: string, fn: () => Promise<T>, data?: Record<string, unknown>): Promise<T> {
  const start = performance.now();
  try {
    const result = await fn();
    logger.debug(event, { ...data, ms: Math.round(performance.now() - start) });
    return result;
  } catch (err) {
    logger.error(event, err, { ...data, ms: Math.round(performance.now() - start) });
    throw err;
  }
}
