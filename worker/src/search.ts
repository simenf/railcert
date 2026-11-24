/**
 * Hybrid search: FTS5 bm25 (+ alias expansion, locator/identifier lookups) and optional
 * Vectorize/bge-m3, fused with RRF, then boosted/demoted, de-duplicated and capped per document.
 */
import { type Env, vectorsEnabled } from "./env";
import { type ChunkRow, type DocIndex, type DocRow, type Hit, buildHit, getDocs } from "./docs";
import {
  type Group,
  type Term,
  aliasCandidates,
  buildMatch,
  columnMatch,
  extractIdentifiers,
  extractLocators,
  identKey,
  locatorMatch,
  parseTerms,
  tokenizeWords,
} from "./query";
import { type RankedList, makeSnippet, rrf, sortByScore } from "./rank";

export interface SearchOptions {
  q: string;
  k?: number;
  area?: string | null;
  ertms_set?: string | null;
  status?: string | null;
  include_repealed?: boolean;
  doc?: string | null;
  /** Max hits per document; default 3, ignored when `doc` is set. */
  per_doc?: number;
}

export interface SearchResult {
  query: string;
  mode: "hybrid" | "keyword";
  results: Hit[];
  /** Full text for the returned hits (used by quote checking / the agent); not sent by /api/search. */
  texts: Map<number, string>;
  /** Documents the query names (aliases / identifiers). */
  named_docs: string[];
}

const CHUNK_COLS = "c.id, c.doc_id, c.ord, c.heading, c.locator, c.inner_file, c.page_start, c.page_end, c.anchor";
const DEMOTED = new Set(["repealed", "historical"]);
const FTS_LIMIT = 80;
/** Test-case/test-plan documents (SUBSET-076-x, SUBSET-074-2, 040092 …): ~30% of all chunks, rarely the answer. */
const TEST_DOC_RE = /test[\s_-]*(cases?|plan|sequences?|specification|methodology)|subset-076|subset-074-2|040092/i;
const TEST_QUERY_RE = /\btest\w*|\bsubset-0(76|74|85)\b|040092|\btc\d|\bprøv\w*|\bverifisering\w*/i;
const testDocCache = new WeakMap<DocRow, boolean>();
function isTestDoc(d: DocRow): boolean {
  let v = testDocCache.get(d);
  if (v == null) {
    v = TEST_DOC_RE.test(`${d.filename} ${d.title ?? ""}`);
    testDocCache.set(d, v);
  }
  return v;
}

/** Queries about old versions should not demote repealed/historical texts. */
const HISTORIC_WORDS =
  /\b(repeal\w*|replac\w*|histor\w*|superseded|previous|earlier|former|old|still in force|no longer|opphev\w*|erstatt\w*|tidligere|gammel|gamle|fortsatt i kraft)\b/i;
const VEC_TOPK = 50;
const MAX_NAMED_DOCS = 40;

interface Filters {
  sql: string;
  params: (string | number)[];
  docId: number | null;
}

function buildFilters(opts: SearchOptions, docs: DocIndex): Filters {
  const parts: string[] = [];
  const params: (string | number)[] = [];
  let docId: number | null = null;
  if (opts.area) {
    parts.push("d.area = ?");
    params.push(opts.area);
  }
  if (opts.ertms_set) {
    parts.push("d.ertms_set = ?");
    params.push(opts.ertms_set);
  }
  if (opts.status) {
    const st = opts.status.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 6);
    if (st.length) {
      parts.push(`d.status IN (${st.map(() => "?").join(",")})`);
      params.push(...st);
    }
  }
  if (opts.doc) {
    const d = docs.byPath.get(opts.doc);
    docId = d ? d.id : -1;
    parts.push("c.doc_id = ?");
    params.push(docId);
  }
  return { sql: parts.length ? ` AND ${parts.join(" AND ")}` : "", params, docId };
}

function passesFilters(d: DocRow, opts: SearchOptions, f: Filters): boolean {
  if (opts.area && d.area !== opts.area) return false;
  if (opts.ertms_set && d.ertms_set !== opts.ertms_set) return false;
  if (opts.status) {
    const st = opts.status.split(",").map((s) => s.trim());
    if (!st.includes(d.status)) return false;
  }
  if (f.docId != null && d.id !== f.docId) return false;
  return true;
}

async function ftsQuery(env: Env, match: string, f: Filters, limit: number, extraSql = "", extraParams: (string | number)[] = []): Promise<ChunkRow[]> {
  if (!match) return [];
  const sql =
    `SELECT ${CHUNK_COLS} FROM chunks_fts JOIN chunks c ON c.id = chunks_fts.rowid JOIN docs d ON d.id = c.doc_id ` +
    `WHERE chunks_fts MATCH ?${f.sql}${extraSql} ORDER BY bm25(chunks_fts, 1.0, 0.5, 2.0) LIMIT ?`;
  try {
    const { results } = await env.DB.prepare(sql)
      .bind(match, ...f.params, ...extraParams, limit)
      .all<ChunkRow>();
    return results ?? [];
  } catch (e) {
    // Should not happen (all terms are quoted), but never let a bad query 500 the request.
    console.warn(`FTS query failed (${(e as Error).message}) for MATCH ${match}`);
    return [];
  }
}

interface AliasHit {
  alias: string;
  path: string;
  start: number;
  end: number;
}

async function resolveAliases(env: Env, q: string): Promise<AliasHit[]> {
  const cands = aliasCandidates(q);
  if (!cands.length) return [];
  const uniq = [...new Set(cands.map((c) => c.alias))].slice(0, 90);
  let rows: { alias: string; path: string }[] = [];
  try {
    const r = await env.DB.prepare(`SELECT alias, path FROM aliases WHERE alias IN (${uniq.map(() => "?").join(",")})`)
      .bind(...uniq)
      .all<{ alias: string; path: string }>();
    rows = r.results ?? [];
  } catch {
    return [];
  }
  const byAlias = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!byAlias.has(r.alias)) byAlias.set(r.alias, new Set());
    byAlias.get(r.alias)!.add(r.path);
  }
  // Longest non-overlapping spans first; ignore very ambiguous aliases (e.g. "tsi" → dozens of docs).
  const matched = cands
    .filter((c) => byAlias.has(c.alias) && byAlias.get(c.alias)!.size <= 8)
    .sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start);
  const used = new Set<number>();
  const out: AliasHit[] = [];
  for (const c of matched) {
    let free = true;
    for (let i = c.start; i < c.end; i++) if (used.has(i)) free = false;
    if (!free) continue;
    for (let i = c.start; i < c.end; i++) used.add(i);
    for (const p of byAlias.get(c.alias)!) out.push({ alias: c.alias, path: p, start: c.start, end: c.end });
  }
  return out;
}

async function aliasAlternatives(env: Env, paths: string[], exclude: Set<string>): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (!paths.length) return out;
  try {
    const r = await env.DB.prepare(
      `SELECT alias, path, kind FROM aliases WHERE path IN (${paths.map(() => "?").join(",")}) AND (kind IS NULL OR kind IN ('short','number','reference','lovdata'))`,
    )
      .bind(...paths)
      .all<{ alias: string; path: string; kind: string | null }>();
    for (const row of r.results ?? []) {
      if (exclude.has(row.alias) || row.alias.length < 3 || row.alias.length > 60) continue;
      if (!out.has(row.path)) out.set(row.path, []);
      out.get(row.path)!.push(row.alias);
    }
  } catch {
    /* aliases table may be empty */
  }
  return out;
}

async function embedQuery(env: Env, q: string): Promise<number[] | null> {
  if (!env.AI) return null;
  const run = env.AI.run("@cf/baai/bge-m3" as any, { text: [q] } as any) as Promise<any>;
  const timeout = new Promise<null>((r) => setTimeout(() => r(null), 6000));
  const res = await Promise.race([run, timeout]);
  const vec = res?.data?.[0];
  return Array.isArray(vec) && vec.length ? vec : null;
}

async function vectorQuery(env: Env, q: string, opts: SearchOptions, f: Filters): Promise<number[] | null> {
  if (!vectorsEnabled(env)) return null;
  try {
    const vec = await embedQuery(env, q);
    if (!vec) return null;
    const filter: Record<string, string | number> = {};
    if (opts.area) filter.area = opts.area;
    if (opts.ertms_set) filter.ertms_set = opts.ertms_set;
    if (f.docId != null) filter.doc_id = f.docId;
    let matches;
    try {
      matches = await env.VECTORS!.query(vec, { topK: VEC_TOPK, returnMetadata: "none", ...(Object.keys(filter).length ? { filter } : {}) });
    } catch (e) {
      // Metadata index missing for a filter field: query unfiltered and post-filter in SQL.
      console.warn(`Vectorize filtered query failed: ${(e as Error).message}`);
      matches = await env.VECTORS!.query(vec, { topK: VEC_TOPK, returnMetadata: "none" });
    }
    return (matches.matches ?? []).map((m) => Number(m.id)).filter((n) => Number.isFinite(n));
  } catch (e) {
    console.warn(`Semantic search unavailable: ${(e as Error).message}`);
    return null;
  }
}

async function chunksByIds(env: Env, ids: number[], withText: boolean): Promise<Map<number, ChunkRow>> {
  const out = new Map<number, ChunkRow>();
  const cols = withText ? `${CHUNK_COLS}, c.text` : CHUNK_COLS;
  for (let i = 0; i < ids.length; i += 90) {
    const part = ids.slice(i, i + 90);
    if (!part.length) continue;
    const { results } = await env.DB.prepare(`SELECT ${cols} FROM chunks c WHERE c.id IN (${part.map(() => "?").join(",")})`)
      .bind(...part)
      .all<ChunkRow>();
    for (const r of results ?? []) out.set(r.id, r);
  }
  return out;
}

function termNeedles(terms: Term[]): string[] {
  return terms.flatMap((t) => t.text.split(" ")).filter((t) => t.length >= 2);
}

export async function search(env: Env, opts: SearchOptions): Promise<SearchResult> {
  const q = (opts.q ?? "").trim();
  const k = Math.min(50, Math.max(1, opts.k ?? 20));
  const docs = await getDocs(env);
  const f = buildFilters(opts, docs);
  const terms = parseTerms(q);
  const locs = extractLocators(q);
  const locKeys = locs.map((l) => l.key);
  const idents = extractIdentifiers(q).map(identKey);
  const wantHistoric =
    !!opts.include_repealed ||
    (opts.status ?? "").split(",").some((s) => DEMOTED.has(s.trim())) ||
    HISTORIC_WORDS.test(q);
  const wantTests = TEST_QUERY_RE.test(q) || f.docId != null;
  // "Set 3", "Set2": the user asks for that ERTMS set, so do not demote it even if it is superseded.
  const askedSets = new Set([...q.matchAll(/\bset\s?([1-4])\b/gi)].map((m) => `Set${m[1]}`));

  // ---- aliases: which documents does the query name?
  const aliasHits = await resolveAliases(env, q);
  // Capped: every path/id becomes a bound parameter, and D1 allows at most 100 per statement.
  const aliasPaths = [...new Set(aliasHits.map((a) => a.path))].slice(0, MAX_NAMED_DOCS);
  const aliasWordIdx = new Set<number>();
  for (const a of aliasHits) for (let i = a.start; i < a.end; i++) aliasWordIdx.add(i);
  const alts = await aliasAlternatives(env, aliasPaths, new Set(aliasHits.map((a) => a.alias)));

  // Groups: alias spans become one group with OR alternatives; other terms are single groups.
  const groups: Group[] = [];
  const spanGroups = new Map<string, Group>();
  for (const t of terms) {
    const a = aliasHits.find((h) => t.word >= h.start && t.word < h.end);
    if (!a) {
      groups.push({ terms: [t], alts: [] });
      continue;
    }
    const key = `${a.start}:${a.end}`;
    let g = spanGroups.get(key);
    if (!g) {
      const altTerms: Term[] = [];
      const seenAlt = new Set<string>();
      for (const h of aliasHits.filter((x) => x.start === a.start && x.end === a.end)) {
        for (const alt of alts.get(h.path) ?? []) {
          const toks = tokenizeWords(alt).flat();
          if (!toks.length || toks.length > 5) continue;
          // an alias becomes one phrase, e.g. "ccs tsi" or "2023/1695"* (prefix: trailing "." in text)
          const last = toks[toks.length - 1];
          const phrase: Term = { text: toks.join(" "), prefix: /[./-]/.test(last) || last.length >= 4, word: -1 };
          if (!seenAlt.has(phrase.text)) {
            seenAlt.add(phrase.text);
            altTerms.push(phrase);
          }
        }
      }
      g = { terms: [], alts: altTerms.slice(0, 4) };
      spanGroups.set(key, g);
      groups.push(g);
    }
    g.terms.push(t);
  }

  // ---- documents named by identifiers (SUBSET-026, 2023/1695, FOR-…): cheap scan of the cached docs.
  const identDocs: DocRow[] = [];
  if (idents.length) {
    for (const d of docs.byId.values()) {
      const hay = identKey(`${d.path} ${d.title ?? ""} ${d.reference ?? ""} ${d.short_name ?? ""}`);
      if (idents.some((i) => hay.includes(i))) identDocs.push(d);
    }
  }
  const namedDocs = new Map<number, DocRow>();
  for (const p of aliasPaths) {
    const d = docs.byPath.get(p);
    if (d) namedDocs.set(d.id, d);
  }
  if (identDocs.length <= MAX_NAMED_DOCS) for (const d of identDocs) namedDocs.set(d.id, d);
  const namedIds = [...namedDocs.values()]
    .filter((d) => passesFilters(d, opts, f))
    .map((d) => d.id)
    .slice(0, MAX_NAMED_DOCS);

  const lists: RankedList[] = [];
  const rows = new Map<number, ChunkRow>();
  const addRows = (rs: ChunkRow[]) => {
    for (const r of rs) if (!rows.has(r.id)) rows.set(r.id, r);
    return rs.map((r) => r.id);
  };

  const tasks: Promise<void>[] = [];
  const mainIds = new Set<number>();

  // L1: main keyword query, AND first then OR fill.
  tasks.push(
    (async () => {
      const andMatch = buildMatch(groups, "AND");
      let res = await ftsQuery(env, andMatch, f, FTS_LIMIT);
      if (groups.length > 1 && res.length < FTS_LIMIT / 2) {
        const orRes = await ftsQuery(env, buildMatch(groups, "OR"), f, FTS_LIMIT);
        const ids = new Set(res.map((r) => r.id));
        res = res.concat(orRes.filter((r) => !ids.has(r.id)));
      }
      for (const r of res) mainIds.add(r.id);
      lists.push({ ids: addRows(res), weight: 1 });
    })(),
  );

  // L2: locator lookup (FTS on the locator column), scoped to named docs when there are any.
  if (locs.length) {
    tasks.push(
      (async () => {
        const all: ChunkRow[] = [];
        for (const l of locs) {
          // Articles: look up by the article number, then keep exact/parent/child locators only.
          const lt = parseTerms(l.raw.replace(/^art\.?\s*/i, "").replace(/\(.*$/, ""));
          if (!lt.length) continue;
          const scope = namedIds.length ? ` AND c.doc_id IN (${namedIds.map(() => "?").join(",")})` : "";
          const res = await ftsQuery(env, columnMatch("locator", lt), f, 60, scope, namedIds);
          all.push(...res.filter((r) => locatorMatch(r.locator, [l.key]) > 0));
        }
        all.sort((a, b) => locatorMatch(b.locator, locKeys) - locatorMatch(a.locator, locKeys));
        lists.push({ ids: addRows(all), weight: namedIds.length ? 1.5 : 0.5 });
      })(),
    );
  }

  // L3: the remaining (non-name) terms inside the named documents, or their opening chunks.
  if (namedIds.length) {
    tasks.push(
      (async () => {
        const identTokens = new Set(idents);
        const rest = groups
          .filter((g) => !g.alts.length && !g.terms.some((t) => aliasWordIdx.has(t.word)))
          .filter((g) => !g.terms.some((t) => identTokens.has(identKey(t.text))));
        const scope = ` AND c.doc_id IN (${namedIds.map(() => "?").join(",")})`;
        let res: ChunkRow[] = [];
        if (rest.length) {
          res = await ftsQuery(env, buildMatch(rest, "AND"), f, 40, scope, namedIds);
          if (res.length < 5 && rest.length > 1) res = res.concat(await ftsQuery(env, buildMatch(rest, "OR"), f, 40, scope, namedIds));
        } else if (!locs.length) {
          try {
            const { results } = await env.DB.prepare(
              `SELECT ${CHUNK_COLS} FROM chunks c JOIN docs d ON d.id = c.doc_id WHERE c.doc_id IN (${namedIds.map(() => "?").join(",")})${f.sql} AND c.ord < 3 ORDER BY c.ord, c.id LIMIT 30`,
            )
              .bind(...namedIds, ...f.params)
              .all<ChunkRow>();
            res = results ?? [];
          } catch (e) {
            // never let the opening-chunks lookup 500 the request; the other lists still answer
            console.warn(`opening-chunks query failed: ${(e as Error).message}`);
          }
        }
        lists.push({ ids: addRows(res), weight: 1 });
      })(),
    );
  }

  // L4: semantic.
  let semantic = false;
  tasks.push(
    (async () => {
      const ids = await vectorQuery(env, q, opts, f);
      if (!ids) return;
      semantic = true;
      const missing = ids.filter((id) => !rows.has(id));
      const got = await chunksByIds(env, missing, false);
      for (const [id, r] of got) if (!rows.has(id)) rows.set(id, r);
      lists.push({ ids: ids.filter((id) => rows.has(id)), weight: 1 });
    })(),
  );

  await Promise.all(tasks);

  // ---- fuse + boost
  const fused = rrf(lists);
  for (const [id, s] of fused) {
    const c = rows.get(id);
    const d = c && docs.byId.get(c.doc_id);
    if (!c || !d || !passesFilters(d, opts, f)) {
      fused.delete(id);
      continue;
    }
    let score = s;
    const lm = locatorMatch(c.locator, locKeys) || (c.anchor ? locatorMatch(c.anchor, locKeys) : 0);
    // Locator boosts only for chunks that are otherwise relevant (keyword hit or a named document),
    // so "Art. 15(8)" alone does not pull every act's Article 15 to the top.
    // Full strength inside documents the query names ("2016/797 Art. 15(8)"), half elsewhere.
    const named = namedDocs.has(d.id);
    const f1 = named ? 1 : 0.5;
    if (mainIds.has(id) || named) {
      if (lm === 2) score += 0.03 * f1;
      else if (lm === 1.5) score += 0.02 * f1;
      else if (lm === 1) score += 0.008 * f1;
    }
    if (namedDocs.has(d.id)) score += 0.01;
    if (!wantTests && !named && isTestDoc(d)) score *= 0.4;
    if (DEMOTED.has(d.status) && !wantHistoric && !(d.ertms_set && askedSets.has(d.ertms_set))) score *= 0.35;
    else if (d.status === "consolidated" || d.status === "in_force") score *= 1.05;
    fused.set(id, score);
  }

  // ---- collapse duplicates, cap per doc
  const perDoc = f.docId != null ? Infinity : Math.max(1, opts.per_doc ?? 3);
  const counts = new Map<number, number>();
  const picked: number[] = [];
  for (const id of sortByScore(fused)) {
    const c = rows.get(id)!;
    const d = docs.byId.get(c.doc_id)!;
    if (d.duplicate_of && docs.byPath.has(d.duplicate_of) && f.docId == null) continue;
    const n = counts.get(d.id) ?? 0;
    if (n >= perDoc) continue;
    counts.set(d.id, n + 1);
    picked.push(id);
    if (picked.length >= k) break;
  }

  const full = await chunksByIds(env, picked, true);
  const needles = termNeedles(terms);
  const texts = new Map<number, string>();
  const results: Hit[] = [];
  for (const id of picked) {
    const c = full.get(id) ?? rows.get(id)!;
    const d = docs.byId.get(c.doc_id)!;
    const text = c.text ?? "";
    texts.set(id, text);
    results.push(buildHit(d, c, makeSnippet(text, needles), Math.round((fused.get(id) ?? 0) * 10000) / 10000));
  }
  return {
    query: q,
    mode: semantic ? "hybrid" : "keyword",
    results,
    texts,
    named_docs: [...namedDocs.values()].map((d) => d.path),
  };
}
