import { EMBEDDING_DIM } from "@/server/db/schema";
import { logger } from "@/server/observability/logger";

/**
 * Embedding provider abstraction.
 *
 * Default: `local-hash` — a deterministic feature-hashing embedder (unigrams, bigrams,
 * character n-grams and a small concept lexicon) projected into EMBEDDING_DIM dimensions.
 * It needs no network, is fast, and gives useful "semantic-ish" recall (e.g. "income" ≈ "salary").
 *
 * Optional: any OpenAI-compatible /embeddings endpoint (OpenAI, Voyage via proxy, Ollama, LM Studio…)
 * configured with EMBEDDINGS_BASE_URL / EMBEDDINGS_API_KEY / EMBEDDINGS_MODEL. The provider is asked
 * for EMBEDDING_DIM dimensions so the pgvector column does not change. Re-index after switching.
 */
export interface EmbeddingProvider {
  name: string;
  dim: number;
  embed(texts: string[]): Promise<number[][]>;
}

/** Concept lexicon: words that should land near each other in vector space. */
const CONCEPTS: Record<string, string[]> = {
  money: ["income", "salary", "pay", "paid", "earn", "earning", "revenue", "wage", "compensation", "money", "cash", "£", "gbp", "fee", "rate", "retainer", "invoice", "profit"],
  job: ["job", "role", "position", "vacancy", "career", "hire", "hiring", "recruit", "recruiter", "graduate", "analyst", "employer", "application", "apply", "interview", "offer"],
  learning: ["learn", "learning", "course", "study", "skill", "training", "certificate", "certification", "exam", "cfa", "bootcamp", "tutorial", "module", "lesson"],
  deadline: ["deadline", "due", "close", "closing", "expire", "expiry", "expires", "renewal", "renew", "notice", "until", "by"],
  python: ["python", "pandas", "numpy", "scikit", "sklearn", "jupyter", "code", "coding", "programming", "script"],
  data: ["sql", "database", "query", "data", "dataset", "analytics", "dashboard", "power", "bi", "tableau"],
  credit: ["credit", "risk", "default", "pd", "lending", "loan", "debt", "rating", "covenant", "underwriting"],
  valuation: ["dcf", "valuation", "wacc", "discount", "multiple", "equity", "enterprise", "terminal", "model", "modelling", "modeling", "forecast"],
  spending: ["spend", "spending", "expense", "cost", "buy", "purchase", "price", "budget", "subscription", "bill", "rent"],
  person: ["person", "people", "contact", "mentor", "friend", "colleague", "manager", "network", "networking", "relationship", "intro", "introduction", "coffee"],
  decision: ["decide", "decision", "decided", "choose", "choice", "option", "should", "tradeoff", "trade"],
  visa: ["visa", "sponsor", "sponsorship", "immigration", "permit", "skilled", "worker", "graduate", "right", "work"],
  health: ["run", "running", "marathon", "gym", "fitness", "exercise", "training", "health", "sleep"],
  project: ["project", "portfolio", "build", "ship", "milestone", "progress", "deliverable", "evidence"],
  contract: ["contract", "agreement", "clause", "party", "parties", "terminate", "termination", "obligation", "liability", "non-compete", "ip"],
};

const CONCEPT_INDEX = new Map<string, string[]>();
for (const [concept, words] of Object.entries(CONCEPTS)) {
  for (const w of words) {
    const stem = stemWord(w);
    CONCEPT_INDEX.set(stem, [...(CONCEPT_INDEX.get(stem) ?? []), concept]);
  }
}

const STOP = new Set(
  "a an the and or of to in on for with at by from is are was were be been it this that these those i me my we our you your he she they them as do did does have has had not no yes so if but what which who whom where when how why all any can could should would will about into over than then there their".split(
    " ",
  ),
);

export function stemWord(w: string): string {
  if (w.length <= 3) return w;
  for (const suf of ["ations", "ation", "ings", "ing", "ments", "ment", "ness", "ies", "ied", "ers", "ed", "es", "ly", "s"]) {
    if (w.endsWith(suf) && w.length - suf.length >= 3) {
      return suf === "ies" || suf === "ied" ? w.slice(0, -3) + "y" : w.slice(0, -suf.length);
    }
  }
  return w;
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[£$€]/g, " £ ")
    .split(/[^a-z0-9£+#.-]+/)
    .map((t) => t.replace(/^[.-]+|[.-]+$/g, ""))
    .filter((t) => t.length > 1 && !STOP.has(t) || t === "£");
}

function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function addFeature(vec: Float64Array, feature: string, weight: number) {
  const h = fnv1a(feature);
  const idx = h % vec.length;
  const sign = (h >>> 31) & 1 ? -1 : 1;
  vec[idx] += sign * weight;
}

export function localEmbed(text: string, dim = EMBEDDING_DIM): number[] {
  const vec = new Float64Array(dim);
  const tokens = tokenize(text).map(stemWord);
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    addFeature(vec, `u:${t}`, 1);
    if (i + 1 < tokens.length) addFeature(vec, `b:${t}_${tokens[i + 1]}`, 0.5);
    if (t.length >= 5) for (let j = 0; j + 4 <= t.length; j++) addFeature(vec, `c:${t.slice(j, j + 4)}`, 0.15);
    for (const concept of CONCEPT_INDEX.get(t) ?? []) addFeature(vec, `k:${concept}`, 1.4);
  }
  let norm = 0;
  for (let i = 0; i < dim; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm) || 1;
  return Array.from(vec, (v) => Number((v / norm).toFixed(6)));
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

const localProvider: EmbeddingProvider = {
  name: "local-hash",
  dim: EMBEDDING_DIM,
  async embed(texts) {
    return texts.map((t) => localEmbed(t));
  },
};

function openAiCompatibleProvider(): EmbeddingProvider {
  const base = (process.env.EMBEDDINGS_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const model = process.env.EMBEDDINGS_MODEL ?? "text-embedding-3-small";
  return {
    name: `openai-compatible:${model}`,
    dim: EMBEDDING_DIM,
    async embed(texts) {
      const res = await fetch(`${base}/embeddings`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${process.env.EMBEDDINGS_API_KEY}` },
        body: JSON.stringify({ model, input: texts.map((t) => t.slice(0, 8000)), dimensions: EMBEDDING_DIM }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`embeddings HTTP ${res.status}`);
      const json = (await res.json()) as { data: { embedding: number[] }[] };
      return json.data.map((d) => d.embedding);
    },
  };
}

let cached: EmbeddingProvider | null = null;

export function getEmbeddingProvider(): EmbeddingProvider {
  if (cached) return cached;
  if (process.env.EMBEDDINGS_PROVIDER === "openai_compatible" && process.env.EMBEDDINGS_API_KEY) {
    const remote = openAiCompatibleProvider();
    // If the remote provider fails we return empty vectors (stored as NULL) rather than mixing
    // vector spaces; hybrid search then degrades gracefully to keyword + metadata + graph signals.
    cached = {
      name: remote.name,
      dim: remote.dim,
      async embed(texts) {
        try {
          return await remote.embed(texts);
        } catch (err) {
          logger.warn("embeddings.remote_failed", { error: String(err) });
          return texts.map(() => []);
        }
      },
    };
  } else {
    cached = localProvider;
  }
  return cached;
}
