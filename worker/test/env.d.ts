declare module "*.sql?raw" {
  const s: string;
  export default s;
}
declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    FILES: R2Bucket;
    MODEL: string;
    LLM_BASE_URL: string;
    USE_VECTORS: string;
  }
}
