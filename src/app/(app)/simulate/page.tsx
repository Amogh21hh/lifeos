import type { Metadata } from "next";
import { desc, eq } from "drizzle-orm";
import * as s from "@/server/db/schema";
import { getViewer } from "@/server/services/context";
import { PageHeader } from "@/components/ui/primitives";
import type { SimulationResult } from "@/lib/types";
import { Simulator } from "./simulator";

export const metadata: Metadata = { title: "Simulator" };

export default async function SimulatePage() {
  const { db, user } = await getViewer();
  const history = await db.select().from(s.simulations).where(eq(s.simulations.userId, user.id)).orderBy(desc(s.simulations.createdAt)).limit(10);
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader eyebrow="Daily simulation" title="What happens if…" description="Transparent models built from your own data. Every assumption is visible and adjustable; every output is an estimate, never a prediction." />
      <Simulator history={history.map((h) => ({ id: h.id, question: h.question, createdAt: h.createdAt.toISOString(), result: h.result as unknown as SimulationResult }))} />
    </div>
  );
}
