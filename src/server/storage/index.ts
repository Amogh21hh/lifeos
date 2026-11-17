import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * File storage abstraction. Local disk by default; an S3/GCS/Azure adapter only needs to
 * implement these three methods. Keys are always server-generated (`<userId>/<uuid>`),
 * never derived from user-supplied filenames, which rules out path traversal.
 */
export interface StorageProvider {
  name: string;
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

const KEY_RE = /^[a-f0-9-]{36}\/[a-f0-9-]{36}$/;

function assertKey(key: string) {
  if (!KEY_RE.test(key)) throw new Error("Invalid storage key");
}

class LocalDiskStorage implements StorageProvider {
  name = "local-disk";
  constructor(private root: string) {}
  private resolve(key: string) {
    assertKey(key);
    const full = path.resolve(this.root, key);
    if (!full.startsWith(path.resolve(this.root))) throw new Error("Invalid storage path");
    return full;
  }
  async put(key: string, data: Buffer) {
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, data);
  }
  async get(key: string) {
    return readFile(this.resolve(key));
  }
  async delete(key: string) {
    await rm(this.resolve(key), { force: true });
  }
}

/**
 * Stores file bodies in the `stored_files` table. Use on hosts without a durable disk (Vercel and
 * other serverless platforms): uploads survive redeploys and are visible to every instance.
 */
export class DatabaseStorage implements StorageProvider {
  name = "database";
  private async db() {
    const { getRawDb, schema } = await import("@/server/db/client");
    return { db: await getRawDb(), t: schema.storedFiles };
  }
  async put(key: string, data: Buffer, contentType: string) {
    assertKey(key);
    const { db, t } = await this.db();
    await db
      .insert(t)
      .values({ key, contentType, sizeBytes: data.length, content: data })
      .onConflictDoUpdate({ target: t.key, set: { contentType, sizeBytes: data.length, content: data } });
  }
  async get(key: string) {
    assertKey(key);
    const { db, t } = await this.db();
    const { eq } = await import("drizzle-orm");
    const [row] = await db.select({ content: t.content }).from(t).where(eq(t.key, key));
    if (!row) throw new Error("File not found");
    return row.content;
  }
  async delete(key: string) {
    assertKey(key);
    const { db, t } = await this.db();
    const { eq } = await import("drizzle-orm");
    await db.delete(t).where(eq(t.key, key));
  }
}

let provider: StorageProvider | null = null;

/** STORAGE_DRIVER=database keeps files in Postgres; anything else (default) uses local disk under STORAGE_DIR. */
export function getStorage(): StorageProvider {
  if (!provider) {
    provider =
      process.env.STORAGE_DRIVER === "database"
        ? new DatabaseStorage()
        : new LocalDiskStorage(process.env.STORAGE_DIR ?? path.join(process.cwd(), ".data", "uploads"));
  }
  return provider;
}
