import type { Metadata } from "next";
import { buildRadarMap } from "@/server/engine/radar";
import { getWorld } from "@/server/services/context";
import { PageHeader } from "@/components/ui/primitives";
import { RadarMap } from "./radar-map";

export const metadata: Metadata = { title: "LIFEOS Radar" };

export default async function RadarPage() {
  const w = await getWorld();
  const map = buildRadarMap(w);
  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        eyebrow="LIFEOS Radar"
        title="Your world, as one connected map"
        description="You at the centre; goals, projects, opportunities, people, skills, documents and decisions around you. Pulsing amber nodes are potential opportunities LIFEOS inferred from connections in your data — click one to see why it exists."
      />
      <RadarMap nodes={map.nodes} edges={map.edges} potentials={map.potentials} />
    </div>
  );
}
