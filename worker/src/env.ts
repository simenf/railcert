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

export const DEFAULT_MODEL = "deepseek/deepseek-v4.1-flash-1017";
export const DEFAULT_LLM_BASE_URL = "https://openrouter.ai/api/v1";

export function vectorsEnabled(env: Env): boolean {
  return env.USE_VECTORS === "1" && !!env.VECTORS && !!env.AI;
}
