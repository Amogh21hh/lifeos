import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    setupFiles: ["tests/unit/setup.ts"],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // One worker: the integration suite boots an in-memory Postgres (PGlite) per file.
    pool: "forks",
    maxWorkers: 1,
    fileParallelism: false,
  },
});
