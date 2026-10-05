import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { sanitizeFilename, UploadRejected, validateUpload } from "@/server/documents/parse";
import { rateLimit } from "@/server/security/api";
import { toProviderSchema } from "@/server/ai/llm";
import { z } from "zod";

describe("passwords", () => {
  it("hashes with a random salt and verifies", async () => {
    const a = await hashPassword("correct horse battery");
    const b = await hashPassword("correct horse battery");
    expect(a).not.toBe(b);
    expect(a.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("correct horse battery", a)).toBe(true);
    expect(await verifyPassword("wrong", a)).toBe(false);
    expect(await verifyPassword("x", "garbage")).toBe(false);
  });
});

describe("upload validation", () => {
  const pdf = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(10)]);
  it("accepts a real PDF signature", () => {
    expect(validateUpload("a.pdf", pdf).family).toBe("pdf");
  });
  it("rejects extension/content mismatch, unknown types, empty and binary text", () => {
    expect(() => validateUpload("evil.pdf", Buffer.from("MZ\0\0"))).toThrow(UploadRejected);
    expect(() => validateUpload("run.exe", Buffer.from("MZ"))).toThrow(/Unsupported/);
    expect(() => validateUpload("a.txt", Buffer.alloc(0))).toThrow(/empty/);
    expect(() => validateUpload("a.txt", Buffer.from([0x41, 0x00, 0x42]))).toThrow(/do not match/);
  });
  it("sanitises filenames (no paths, no control characters)", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFilename("C:\\Users\\x\\cv<script>.pdf")).toBe("cv_script_.pdf");
    expect(sanitizeFilename("...hidden")).toBe("hidden");
  });
});

describe("rate limiting", () => {
  it("allows a burst up to capacity then rejects with retry-after", () => {
    const key = `test:${Math.random()}`;
    let ok = 0;
    let last = { ok: true, retryAfter: 0 };
    for (let i = 0; i < 15; i++) {
      last = rateLimit(key, "auth");
      if (last.ok) ok++;
    }
    expect(ok).toBe(10);
    expect(last.ok).toBe(false);
    expect(last.retryAfter).toBeGreaterThan(0);
  });
});

describe("LLM structured-output schema", () => {
  it("strips provider-unsupported keywords and closes objects", () => {
    const schema = toProviderSchema(z.object({ name: z.string().min(1).max(10), n: z.number().min(0) }));
    const json = JSON.stringify(schema);
    expect(json).not.toMatch(/minLength|maxLength|minimum/);
    expect((schema as { additionalProperties?: boolean }).additionalProperties).toBe(false);
  });
});
