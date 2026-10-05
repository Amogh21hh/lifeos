import { mkdirSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { drizzle as drizzlePglite, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import * as schema from "./schema";
import { logger } from "@/server/observability/logger";

/**
 * Database access.
 *
 * - DATABASE_URL set (postgres://…)  → node-postgres pool against a real PostgreSQL + pgvector.
 * - otherwise                         → embedded PGlite (WASM Postgres + pgvector) persisted to PGLITE_DIR.
 *
 * Both expose the same Drizzle query API, so the rest of the app is driver-agnostic.
 * The query-builder surface is identical, so we expose a single DB type.
 */
export type DB = PgliteDatabase<typeof schema>;

interface DbState {
  db: DB;
  ready: Promise<void>;
  driver: "pglite" | "postgres";
  close: () => Promise<void>;
}

const g = globalThis as unknown as { __lifeosDb?: DbState };

function migrationsFolder() {
  return path.join(process.cwd(), "drizzle");
}

function create(): DbState {
  const url = process.env.DATABASE_URL;
  if (url && /^postgres(ql)?:\/\//.test(url)) {
    const pool = new Pool({ connectionString: url, max: Number(process.env.DATABASE_POOL_SIZE ?? 10) });
    const db = drizzlePg(pool, { schema }) as unknown as DB;
    const ready = (async () => {
      await pool.query("CREATE EXTENSION IF NOT EXISTS vector");
      await migratePg(db as never, { migrationsFolder: migrationsFolder() });
      logger.info("db.ready", { driver: "postgres" });
    })();
    return { db, ready, driver: "postgres", close: () => pool.end() };
  }

  const dataDir = process.env.PGLITE_DIR ?? path.join(process.cwd(), ".data", "pglite");
  if (dataDir !== ":memory:") mkdirSync(dataDir, { recursive: true });
  // Options-object form: passing `undefined` as the first positional arg would drop the extensions.
  const client = new PGlite({ dataDir: dataDir === ":memory:" ? "memory://" : dataDir, extensions: { vector } });
  const db = drizzlePglite(client, { schema });
  const ready = (async () => {
    await client.waitReady;
    await client.exec("CREATE EXTENSION IF NOT EXISTS vector");
    await migratePglite(db, { migrationsFolder: migrationsFolder() });
    logger.info("db.ready", { driver: "pglite", dataDir });
  })();
  return { db, ready, driver: "pglite", close: () => client.close() };
}

function state(): DbState {
  if (!g.__lifeosDb) g.__lifeosDb = create();
  return g.__lifeosDb;
}

let bootstrapped: Promise<void> | null = null;

/** Returns a ready database. On first use: migrate, then seed the demo workspace if the DB is empty. */
export async function getDb(): Promise<DB> {
  const s = state();
  await s.ready;
  if (!bootstrapped) {
    bootstrapped = (async () => {
      if (process.env.LIFEOS_AUTO_SEED === "false") return;
      const { ensureDemoWorkspace } = await import("./seed");
      await ensureDemoWorkspace(s.db);
    })().catch((err) => {
      bootstrapped = null;
      throw err;
    });
  }
  await bootstrapped;
  return s.db;
}

/** For scripts/tests that manage their own lifecycle. */
export async function getRawDb(): Promise<DB> {
  const s = state();
  await s.ready;
  return s.db;
}

export function dbDriver() {
  return state().driver;
}

export async function closeDb() {
  if (g.__lifeosDb) {
    await g.__lifeosDb.close();
    g.__lifeosDb = undefined;
    bootstrapped = null;
  }
}

export { schema };
