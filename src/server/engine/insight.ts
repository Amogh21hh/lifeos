import { confidenceFromScore, type Evidence, type Insight } from "@/lib/types";
import type { World } from "./world";
import { refOf } from "./world";
import type { EntityType } from "@/lib/types";

/** Build an Insight with sensible defaults. Confidence label always derives from the numeric score. */
export function insight(p: Omit<Insight, "confidence" | "assumptions" | "wouldChange"> & Partial<Pick<Insight, "assumptions" | "wouldChange">>): Insight {
  return {
    assumptions: [],
    wouldChange: [],
    ...p,
    confidence: confidenceFromScore(p.confidenceScore),
  };
}

export function fact(w: World, text: string, type?: EntityType, id?: string): Evidence {
  return { text, provenance: "fact", ref: type && id ? refOf(w, type, id) : undefined };
}
export function estimate(text: string): Evidence {
  return { text, provenance: "estimate" };
}
export function inference(text: string): Evidence {
  return { text, provenance: "ai_inference" };
}
export function userInput(w: World, text: string, type?: EntityType, id?: string): Evidence {
  return { text, provenance: "user_input", ref: type && id ? refOf(w, type, id) : undefined };
}

export const SEVERITY_RANK = { critical: 4, important: 3, watch: 2, info: 1 } as const;
