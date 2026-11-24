# railcert-ask Worker

A team-only "ask the library" agent over the railway-regulation library, running as one Cloudflare Worker.
The source of truth for bindings, API, tools and search behaviour is [`CONTRACT.md`](CONTRACT.md) and [`schema.sql`](schema.sql).

## Architecture

```
browser (public/ chat UI)
   │  every request: Cloudflare Access → Worker (run_worker_first: true)
   ▼
src/index.ts   auth (Access JWT) → router → security headers
 ├─ /api/search  src/search.ts   FTS5 bm25 + aliases + locator lookup (+ Vectorize/bge-m3) → RRF → boosts → per-doc cap
 ├─ /api/ask     src/agent.ts    OpenAI-compatible tool loop (src/llm.ts, src/tools.ts) → SSE step/token/done/error
 ├─ /api/doc, /api/chunk, /api/health   src/api.ts
 ├─ /files/*     src/files.ts    originals from private R2, Range/HEAD, only keys listed in docs.r2_key
 └─ everything else → ASSETS (public/)
D1  DB      docs, chunks, chunks_fts, edges, standards, aliases, trv, meta
R2  FILES   original documents (private)
Vectorize VECTORS + Workers AI AI   production only (semantic search)
```

Source files: `query.ts` (FTS5 query sanitising, locators, identifiers), `rank.ts` (RRF, snippets),
`docs.ts` (in-isolate docs cache, Hit/URL building), `citations.ts` (`[c:id]` → `[n]`, quote checks),
`prompt.ts` (system prompt), `auth.ts` (Access JWT, RS256, cached JWKS).

### Search, in short

1. The query is tokenised the same way as the FTS table (`unicode61`, tokenchars `./-`); every term is emitted as a quoted
   FTS5 string, so no user input can become FTS syntax. Identifiers (`2023/1695`, `SUBSET-026`, `3.5.3.7`) stay single
   prefix tokens; `15(8)` becomes the phrase `"15 8"`; short exact words also match their sentence-final form (`"å."`).
2. n-grams of the query are looked up in `aliases`; a matched span is OR-expanded with the document's other aliases, and the
   named document gets its own scoped search. Identifiers like `SUBSET-026` or `FOR-2021-09-09-2742` name documents too.
3. Ranked lists: keyword (AND, then OR fill), locator lookup on the `locator` column, named-document search, and (when
   `USE_VECTORS=1` and the bindings exist) Vectorize top-50. Fused with RRF (k=60).
4. Boosts: exact/range/parent locator matches (ranges like `Art. 15(7)–(9)` contain `Art. 15(8)`), named documents.
   `repealed`/`historical` are demoted ×0.35 unless `include_repealed=1`, a status filter asks for them, the query is about
   old versions ("repealed", "replaced", "tidligere" …) or it names that ERTMS set ("Set 3").
5. Byte-identical duplicates (`duplicate_of`) are collapsed, max 3 hits per document (unless `doc=` is given).

### Agent, in short

Up to 10 tool rounds (max 6 calls per round), then a forced final answer (`tool_choice: "none"`). Every round is requested
with `stream: true`; content is held back until 160 characters arrive without a tool call, then streamed live, so tool-round
preambles are not shown. Non-streaming providers (JSON responses) work too. Tool output is capped at 120k characters per
question; `read` returns ≤ 12k characters with `[c:123] CCS TSI — Annex A §4.2 (p. 14-15)` headers. Citations are renumbered
while streaming; ids no tool returned are dropped. Quotes of ≥ 6 words followed by a citation are checked against the cited
chunk text (`quote_checks`). Usage sums `usage` (incl. OpenRouter `cost`) over all rounds. History: last 12 messages, ≤ 8k
characters each, ≤ 40k total. LLM idle timeout 60 s; after 150 s the next round is forced to answer.

## Local development

Needs Node 20+ and the index build outputs.

```bash
python3 -I tools/rag/build_index.py          # → .build/rag/out/ (schema.sql, data-*.sql, …)
cd worker && npm install
bash scripts/load_local.sh                   # or by hand:
#   for f in ../.build/rag/out/schema.sql ../.build/rag/out/data-*.sql; do npx wrangler d1 execute DB --local --file="$f" -y; done
cp .dev.vars.example .dev.vars               # put your OPENROUTER_API_KEY in it (git-ignored) – optional for search
npm run dev                                  # = wrangler dev --var REQUIRE_ACCESS:0 → http://localhost:8787, no Cloudflare login needed
```

Local dev uses the top-level config: local D1 and local R2 (empty unless you upload files with
`npx wrangler r2 object put railcert-library/<key> --file=… --local`), keyword-only search.

The top-level config **fails closed**: it sets `REQUIRE_ACCESS="1"` (and the Worker treats a missing or empty
`REQUIRE_ACCESS` as `"1"` too), so without Access vars every request gets 403 "Access is not configured". Local dev turns
that off with `REQUIRE_ACCESS=0`, either via `npm run dev` (passes `--var REQUIRE_ACCESS:0`, which also wins over
`.dev.vars`) or via the `REQUIRE_ACCESS=0` line in `.dev.vars` (from `.dev.vars.example`) for plain `npx wrangler dev`.
Access is then off and a warning is logged. The top level is also named `railcert-ask-dev`, has `workers_dev` and
`preview_urls` off and keeps the placeholder D1 id, so an accidental `wrangler deploy` without `--env production` fails
(no such database) and could never serve the library publicly.

Tests and type check:

```bash
npm test          # vitest in workerd (query sanitising, RRF, citations, quotes, JWT, guards, /api/* integration with a fixture D1
                  # and a mocked LLM), then node --test test/ui-md.test.mjs (UI markdown/link/highlight rendering)
python3 -I ../tools/rag/test_embed.py   # embed.py freshness guards (offline)
npm run typecheck
python3 -I ../tools/rag/eval/run_eval.py --base http://localhost:8787   # retrieval eval on the real index (add --ask for answers)
```

## Production setup (owner)

`bash worker/scripts/deploy.sh` creates the resources, loads D1, uploads R2, upserts vectors and deploys. The production
config is the `env.production` section of `wrangler.jsonc` – always deploy with `--env production` (a plain
`wrangler deploy` targets the fail-closed `railcert-ask-dev` top level and fails on its placeholder D1 id).

- The `d1` stage is **destructive and causes downtime**: `schema.sql` drops every table, so the live Worker returns errors
  or empty answers until the last data file is loaded (minutes). It asks you to type `yes`; non-interactive runs need
  `CONFIRM_D1_RELOAD=1`.
- The `vectors` stage refuses to upsert when `vectors.ndjson` was embedded from a different `chunks.jsonl` than the current
  one (chunk ids are per build; checked with `python3 -I tools/rag/embed.py --check-fresh`). Re-embed with
  `embed.py --restart`. `embed.py` likewise refuses to resume an existing `vectors.ndjson` without a matching
  `embed_progress.json`.

By hand:

1. `npx wrangler d1 create railcert-ask` → put the `database_id` in the **`env.production`** D1 entry of `wrangler.jsonc`
   only. Leave the top-level placeholder `00000000-…` as it is (local dev needs nothing else, and it makes an accidental
   top-level deploy fail).
2. `npx wrangler r2 bucket create railcert-library` – keep it **private** (no custom domain, no r2.dev URL).
3. `npx wrangler vectorize create railcert-chunks --dimensions=1024 --metric=cosine` and metadata indexes for filters:
   `npx wrangler vectorize create-metadata-index railcert-chunks --property-name=area --type=string` (same for `ertms_set`,
   `status`; `doc_id` as `number`). Without them filtered vector queries fall back to unfiltered + post-filter.
4. Load D1 with `wrangler d1 execute DB --remote --env production --file=…` per file (downtime: see above), upload R2 from `r2_manifest.tsv`,
   upsert `vectors.ndjson` (`tools/rag/embed.py` produces it).
5. Secret: `npx wrangler secret put OPENROUTER_API_KEY --env production`.
6. AI Gateway (recommended for logging, caching and spend limits): create a gateway and set `LLM_BASE_URL` to
   `https://gateway.ai.cloudflare.com/v1/<account_id>/<gateway>/openrouter`.
7. Cloudflare Access: create a self-hosted Access application for the Worker's hostname covering the whole host (UI,
   `/api/*`, `/files/*`), with a policy for the team. Put the team domain (`<team>.cloudflareaccess.com`) and the
   application's AUD tag in `ACCESS_TEAM_DOMAIN` / `ACCESS_AUD`. `REQUIRE_ACCESS=1` makes the Worker refuse every request
   until both are set. Turn `workers_dev` off (already `false`) so the only route is the Access-protected hostname.
8. `npx wrangler deploy --env production`.

Optional vars: `ALLOWED_MODELS` (comma-separated allow-list for the `model` override in `/api/ask`; unset = default-deny,
only `MODEL` is accepted, so a client cannot pick a pricier model on the owner's key), `APP_URL` (sent as `HTTP-Referer`
to OpenRouter).

## Costs

See the cost notes in the project plan / `CONTRACT.md`. Rough drivers: LLM tokens per question (several tool rounds,
typically 20–60k prompt tokens with the default DeepSeek flash model; the exact cost per answer is in `done.usage.cost_usd`
and shown in the UI), Workers AI embeddings (one bge-m3 call per search), Vectorize queries, D1 rows read (FTS queries read
index pages, not whole tables) and Workers requests. R2 storage of ~1.2 GB is within the free tier; egress from R2 is free.

## Security notes

- The documents are **licensed to the team**. The R2 bucket must stay private; files are only served by `/files/*` behind
  Access, and only for keys that appear in `docs.r2_key` (no listing, no path traversal).
- **Access is mandatory in production.** The Worker verifies `Cf-Access-Jwt-Assertion` itself (RS256 against
  `https://<team>/cdn-cgi/access/certs`, JWKS cached for 1 h and refreshed on unknown `kid`; `aud`, `iss`, `exp`, `nbf`
  checked) for every route including static assets (`run_worker_first: true`).
- Security headers on every response (CSP `default-src 'self'`, `nosniff`, `X-Frame-Options: SAMEORIGIN`, HSTS,
  `Referrer-Policy`, COOP/CORP). Every library file except PDFs (HTML, SVG, XML, text, images, office files, unknown
  types) is served with a script-free `sandbox` CSP so it cannot run script on the app origin; PDFs are exempt because the
  sandbox breaks Chrome's PDF viewer.
- The chat UI renders model output with its own small markdown renderer: everything is escaped, link URLs must be
  `http(s)`, `mailto:` or same-origin paths, and external markdown links show their host in grey after the link text
  (e.g. "(eur-lex.europa.eu)") so a prompt-injected link is visible for what it is.
- No secrets in the repo: `OPENROUTER_API_KEY` lives in `.dev.vars` (git-ignored) or `wrangler secret`.
- Tool arguments from the model are validated and all SQL is parameterised; FTS input is always quoted.
