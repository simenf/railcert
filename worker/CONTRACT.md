# railcert-ask: shared contract

A team-only "ask the library" agent on Cloudflare (option 2). The library documents are licensed
to the team and **must never be publicly reachable**: in production the Worker sits behind
Cloudflare Access, and it also verifies the Access JWT itself when `ACCESS_AUD` is set.

The pieces and who owns them:

| Piece | Path | Language |
|---|---|---|
| Index builder: page-aware text, structure-aware chunks, D1 SQL, R2 manifest, embeddings | `tools/rag/` | Python 3 stdlib (+ `pdftotext`) |
| D1 schema | `worker/schema.sql` | SQL (this file pair is the source of truth) |
| Worker: search API, agent loop, file serving, auth | `worker/src/`, `worker/wrangler.jsonc`, `worker/package.json` | TypeScript |
| Chat UI | `worker/public/` | Vanilla HTML/CSS/JS, no build step |
| Map integration (local edition only) | `tools/map_template.html`, `tools/navigator.py` | — |
| Eval set and runner | `tools/rag/eval/` | Python 3 stdlib |

## Build outputs (`.build/rag/`, git-ignored)

- `text/<path with / → __>.pages.json` — per-file cache: `{"src_mtime":…, "kind":"pdf|zip|html|docx|txt", "pages":[{"inner_file":null|"x.pdf","page":1,"text":"…"}]}`
- `out/schema.sql` — copy of `worker/schema.sql`
- `out/data-0001.sql …` — INSERT batches. Every single SQL statement < 90 KB (D1 limit is 100 KB);
  files ≤ ~50 MB. The last file rebuilds FTS: `INSERT INTO chunks_fts(chunks_fts) VALUES('rebuild');`
- `out/chunks.jsonl` — `{"id":…, "text": "<heading>\n<text>"}` input for embeddings
- `out/vectors.ndjson` — Vectorize upsert format `{"id":"<chunk id>","values":[…],"metadata":{"doc_id":…,"area":"…","ertms_set":"…","status":"…"}}` (written by `tools/rag/embed.py`, only when it is run against Workers AI)
- `out/r2_manifest.tsv` — `key<TAB>local_path<TAB>content_type` for every original file to upload (key = library path)
- `out/stats.json`

Commands (documented in `worker/README.md`):

```
python3 -I tools/rag/build_index.py [--only <path-prefix>] [--limit N]   # text cache + SQL + jsonl + manifest
python3 -I tools/rag/embed.py            # needs CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN; Workers AI @cf/baai/bge-m3 (1024 dims)
bash worker/scripts/load_local.sh        # wrangler d1 execute --local for schema + data files
python3 -I tools/rag/embed.py --check-fresh   # exit 0 iff vectors.ndjson was embedded from the current chunks.jsonl
bash worker/scripts/deploy.sh            # remote: create resources, load D1, upload R2, upsert vectors, deploy (run by the owner)
                                         # d1 stage drops+reloads (downtime), needs typed "yes" or CONFIRM_D1_RELOAD=1;
                                         # vectors stage refuses stale vectors (embed.py --check-fresh)
```

## Worker bindings and vars (`worker/wrangler.jsonc`)

Two configs: the top level is **local dev only** and fails closed if deployed (name `railcert-ask-dev`, `workers_dev` and
`preview_urls` false, `REQUIRE_ACCESS="1"`, placeholder D1 id that must stay); `env.production` (name `railcert-ask`) is the
only deploy target (`wrangler deploy --env production`) and the only place the real D1 id goes. Local dev sets
`REQUIRE_ACCESS=0` via `npm run dev` (`--var REQUIRE_ACCESS:0`) or `.dev.vars`.

| Name | Kind | Notes |
|---|---|---|
| `DB` | D1 | database `railcert-ask` |
| `FILES` | R2 | bucket `railcert-library` (private, no public URL, no r2.dev) |
| `VECTORS` | Vectorize | index `railcert-chunks`, 1024 dims, cosine. Optional: absent/unusable in local dev |
| `AI` | Workers AI | query embeddings with `@cf/baai/bge-m3`. Optional in local dev |
| `ASSETS` | static assets | `worker/public` |
| `MODEL` | var | default `deepseek/deepseek-v4.1-flash-1017` |
| `LLM_BASE_URL` | var | `https://openrouter.ai/api/v1` locally; in prod the AI Gateway URL `https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/openrouter` |
| `USE_VECTORS` | var | `"1"` to enable semantic search; `"0"` → keyword-only (local default) |
| `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` | vars | when both set, every request must carry a valid `Cf-Access-Jwt-Assertion` |
| `REQUIRE_ACCESS` | var | `"1"` (default, also when missing or empty): refuse every request with 403 while the Access vars are unset. Only exactly `"0"` lets requests through unauthenticated (local dev only, from `.dev.vars` or `--var`) |
| `ALLOWED_MODELS` | var, optional | comma-separated ids accepted for the `model` field of `/api/ask` in addition to `MODEL`. Unset/empty = only `MODEL` (default-deny; anything else → 400 `model not allowed`) |
| `OPENROUTER_API_KEY` | secret | `.dev.vars` locally (git-ignored), `wrangler secret put` in prod — set by the owner |

## HTTP API

All JSON. Errors: `{"error": "…"}` with 4xx/5xx.

- `GET /api/health` → `{"ok":true,"docs":N,"chunks":N,"vectors":bool,"model":"…","build_date":"…"}`
- `GET /api/search?q=…&k=20&area=…&ertms_set=…&status=…&include_repealed=0&doc=<path>` →
  `{"query":"…","mode":"hybrid|keyword","results":[Hit]}`
- `GET /api/doc?path=…` → doc row + `cites`, `cited_by` counts
- `GET /api/chunk?id=…` → chunk + doc
- `POST /api/ask` body `{"messages":[{"role":"user"|"assistant","content":"…"}], "model"?: "…"}` →
  `text/event-stream`. Events (each `event: <type>\ndata: <json>\n\n`):
  - `step` `{"n":1,"tool":"search","args":{…},"summary":"Searching “Art. 15(8) DeBo” — 12 hits"}`
  - `token` `{"t":"…"}` — streamed answer text (may be emitted all at once if streaming is unavailable)
  - `done` `{"answer":"…full markdown…","citations":[Citation],"quote_checks":[{"quote":"…","chunk_id":…,"ok":bool}],"usage":{"prompt_tokens":…,"completion_tokens":…,"cost_usd"?:…},"steps":N}`
  - `error` `{"message":"…"}`
- `GET /files/<library path>` → streams the original file from R2 (Range support, correct content type,
  `Content-Disposition: inline`). Only keys listed in `docs.r2_key`. 404 otherwise. Every response except
  `application/pdf` carries a script-free `sandbox` CSP.
- `GET /` and other paths → static assets (chat UI).

`Hit` = `{"chunk_id","doc_path","doc_title","short_name","reference","status","area","ertms_set","locator","heading","page_start","page_end","inner_file","anchor","snippet","score","file_url","official_url"}`
where `file_url` = `/files/<path>#page=<page_start>` for PDFs (or `#<anchor>` for HTML; no page link for zips, link the zip) and `official_url` = `docs.url`.

`Citation` = `{"n":1,"chunk_id":…, …Hit fields without snippet/score}` — the numbered sources the answer refers to.

## Agent

- OpenAI-compatible `/chat/completions` with `tools` against `LLM_BASE_URL`, model `MODEL`.
  Headers: `Authorization: Bearer <OPENROUTER_API_KEY>`, `HTTP-Referer`, `X-Title: Railcert Ask`.
- Max 10 tool rounds, then force a final answer without tools. Hard cap on total tool-result
  characters per request (~120k) — truncate with a note.
- Tools:
  - `search(query, area?, ertms_set?, status?, include_repealed?, doc_path?, k?)` — hybrid search, returns hits with chunk ids and snippets
  - `read(chunk_id?, doc_path?, locator?, pages?, around?)` — full text of a chunk (and N neighbours), a page range, or the chunks matching a locator in a document; ≤ 12k chars
  - `doc_info(doc_or_name)` — resolve a short name / reference / number via `aliases`, return the doc row, amendments/consolidated versions (same reference number family), duplicates
  - `citations(doc_path, direction: "cites"|"cited_by", limit?)` — from `edges`
  - `standard(ref)` — row from `standards`
  - `trv(req_id)` — Bane NOR requirement text and page
  - `list_docs(area?, ertms_set?, status?, text?)` — browse the catalogue
- Answers cite sources inline as `[c:<chunk_id>]`; the Worker renumbers them to `[1] [2]…` and returns
  `citations`. Only chunk ids that a tool actually returned in this request may be cited; others are dropped.
- Verbatim quotes in the answer (text in “…” or `"…"` of ≥ 6 words followed by a citation) are checked
  against the cited chunk text (whitespace/quote/hyphen-normalised) → `quote_checks`.
- System prompt rules: prefer in-force and consolidated texts; name the ERTMS baseline/set when relevant;
  distinguish EU law, Norwegian law, ERA guidance and standards; answer in the user's language
  (Norwegian or English); say clearly when the library does not contain the answer; never invent
  article numbers; paid standards are not in the library (only who cites them).

## Search

- Keyword: FTS5 `bm25(chunks_fts, 1.0, 0.5, 2.0)` over a sanitised query (quote tokens containing
  punctuation such as `2023/1695`, `SUBSET-026`, `3.5.3.7`; OR-expand aliases from `aliases`).
- Semantic (when `USE_VECTORS=1`): embed the query with `@cf/baai/bge-m3`, `VECTORS.query(topK=50, filter)`.
- Fuse with reciprocal rank fusion (k=60); boost exact locator/identifier matches; demote
  `repealed`/`historical` unless asked; collapse `duplicate_of` copies; max 3 hits per document by default.

## Answer presentation v2 (additions to the `done` event)

All additions are optional fields; old clients ignore them.

- `citations[i].excerpt` — up to ~700 chars of the cited chunk text (whitespace-collapsed), centred on the first
  verified quote from that chunk if any, else the chunk start. Used for the hover/tap source card.
- `quote_checks[i].n` — the citation number the quote is attached to (or null), so the UI can mark the quote inline.
- `follow_ups` — 0–3 short follow-up questions (same language as the user). The model ends its answer with one line
  `FOLLOWUPS: q1 | q2 | q3`; the Worker strips that line from `answer` and from the streamed `token`s
  (hold back a trailing partial line that could be the start of `FOLLOWUPS:`).
- `source_map` — `{ "nodes": [Node], "edges": [Edge] }` built from the `edges` table (never from the model), so the UI
  can draw how the cited documents relate:
  - `Node` = `{ "path", "label" (short name or title), "area", "status", "kind": "act"|"guide"|"spec"|"national"|"standard"|"other", "cited": bool, "ns": [citation numbers], "level": 0..4 }`
    where `level` orders the legal hierarchy: 0 EU directives/regulations of the framework, 1 implementing/delegated acts
    (TSIs, CSMs, 2018/545 …), 2 ERA guidance / national law & guidance, 3 specifications (ERTMS SUBSETs, TRV), 4 standards.
  - `Edge` = `{ "from": path, "to": path, "mentions": n }` meaning `from` cites `to`.
  - Contains every cited document, plus at most 4 extra in-library documents that connect two cited documents in one hop
    (cited by one, citing another). Max 14 nodes; edges only between included nodes; duplicates (`duplicate_of`) collapsed.
  - Omitted when fewer than 2 nodes.

Answer text conventions (system prompt):
- Open with a 1–3 sentence direct answer, then details under short headings or lists.
- Cite once per claim/paragraph, at the end of the sentence, never mid-sentence; group like `[c:12][c:40]`.
- Use a ```mermaid fenced block (flowchart TD/LR, sequenceDiagram or timeline only) when the question is about a process,
  sequence of steps, roles or hierarchy; only steps supported by sources; put citation numbers in node labels as `(c:12)`
  which the Worker renumbers to `(n)` like other citations; keep it ≤ 15 nodes; no styling/click directives.
