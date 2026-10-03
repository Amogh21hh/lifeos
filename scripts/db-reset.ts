/**
 * Re-creates the demo workspace. Stop `npm run dev` first when using embedded PGlite
 * (a PGlite data directory must only be opened by one process at a time).
 */
import "dotenv/config";
import { closeDb, getRawDb } from "../src/server/db/client";
import { resetDemo } from "../src/server/db/seed";

async function main() {
  const db = await getRawDb();
  const started = Date.now();
  const userId = await resetDemo(db);
  console.log(`Demo workspace ready (user ${userId}) in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  await closeDb();
}

main().catch(async (err) => {
  console.error(err);
  await closeDb();
  process.exit(1);
});
