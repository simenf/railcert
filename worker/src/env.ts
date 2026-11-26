/** Bindings and vars (see wrangler.jsonc and CONTRACT.md). VECTORS and AI are optional: absent in local dev. */
export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  ASSETS?: Fetcher;
  VECTORS?: VectorizeIndex;
  AI?: Ai;
  MODEL?: string;
  LLM_BASE_URL?: string;
  USE_VECTORS?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  /** Refuse to serve anything when the Access vars are missing (fail closed). Missing/empty counts as "1"; only "0" opens it (local dev). */
  REQUIRE_ACCESS?: string;
  OPENROUTER_API_KEY?: string;
  /** Optional comma-separated allow-list for the `model` override in /api/ask. Empty = only MODEL is accepted (default-deny). */
  ALLOWED_MODELS?: string;
  /** Optional: public origin sent as HTTP-Referer to OpenRouter. */
  APP_URL?: string;
}

export const DEFAULT_MODEL = "meta/muse-ember";

/** Display names for the model picker; unknown ids are shown as-is. */
export const MODEL_LABELS: Record<string, string> = {
  "meta/muse-ember": "Meta Muse Ember",
  "tencent/hy4-flash": "Tencent Hy4 Flash",
  "deepseek/deepseek-v4.1-flash-1017": "DeepSeek V4.1 Flash",
};

/** The default model first, then the other ALLOWED_MODELS, without duplicates. */
export function modelChoices(env: { MODEL?: string; ALLOWED_MODELS?: string }): { id: string; label: string; default: boolean }[] {
  const def = env.MODEL || DEFAULT_MODEL;
  const ids = [def, ...(env.ALLOWED_MODELS ?? "").split(",").map((s) => s.trim()).filter(Boolean)];
  return [...new Set(ids)].map((id) => ({ id, label: MODEL_LABELS[id] ?? id, default: id === def }));
}
export const DEFAULT_LLM_BASE_URL = "https://openrouter.ai/api/v1";

export function vectorsEnabled(env: Env): boolean {
  return env.USE_VECTORS === "1" && !!env.VECTORS && !!env.AI;
}
