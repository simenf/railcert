import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-plugin";

export default defineConfig({
  plugins: [
    cloudflareTest({
      main: "./src/index.ts",
      miniflare: {
        compatibilityDate: "2026-11-01",
        compatibilityFlags: ["nodejs_compat"],
        d1Databases: ["DB"],
        r2Buckets: ["FILES"],
        bindings: { MODEL: "test/model", LLM_BASE_URL: "https://llm.test/v1", USE_VECTORS: "0", REQUIRE_ACCESS: "0" },
      },
    }),
  ],
  test: {
    root: ".",
    include: ["test/**/*.test.ts"],
  },
});
