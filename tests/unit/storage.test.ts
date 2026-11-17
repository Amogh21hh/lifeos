import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { closeDb } from "@/server/db/client";
import { DatabaseStorage } from "@/server/storage";

afterAll(() => closeDb());

describe("database storage driver", () => {
  const store = new DatabaseStorage();
  const key = `${randomUUID()}/${randomUUID()}`;

  it("round-trips, overwrites and deletes file bodies", async () => {
    const bytes = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0xff, 0x10]);
    await store.put(key, bytes, "application/pdf");
    const back = await store.get(key);
    expect(Buffer.isBuffer(back)).toBe(true);
    expect(back.equals(bytes)).toBe(true);

    await store.put(key, Buffer.from("second"), "text/plain");
    expect((await store.get(key)).toString()).toBe("second");

    await store.delete(key);
    await expect(store.get(key)).rejects.toThrow(/not found/);
  });

  it("rejects keys that are not server-generated", async () => {
    await expect(store.put("../etc/passwd", Buffer.from("x"), "text/plain")).rejects.toThrow(/Invalid storage key/);
  });
});
