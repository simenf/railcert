import { type Env, DEFAULT_MODEL, modelChoices, vectorsEnabled } from "./env";
import { type ChunkRow, buildHit, fileUrl, getDocs } from "./docs";
import { HttpError, boolParam, intParam, json } from "./http";
import { search } from "./search";

async function meta(env: Env): Promise<Record<string, string>> {
  try {
    const { results } = await env.DB.prepare("SELECT k, v FROM meta").all<{ k: string; v: string }>();
    return Object.fromEntries((results ?? []).map((r) => [r.k, r.v]));
  } catch {
    return {};
  }
}

export async function handleHealth(env: Env): Promise<Response> {
  const m = await meta(env);
  let docs = Number(m.n_docs);
  let chunks = Number(m.n_chunks);
  try {
    if (!Number.isFinite(docs) || !m.n_docs) docs = (await env.DB.prepare("SELECT COUNT(*) AS n FROM docs").first<number>("n")) ?? 0;
    if (!Number.isFinite(chunks) || !m.n_chunks) chunks = (await env.DB.prepare("SELECT COUNT(*) AS n FROM chunks").first<number>("n")) ?? 0;
  } catch (e) {
    return json({ ok: false, error: "database not loaded", detail: (e as Error).message }, 503);
  }
  return json({
    ok: true,
    docs,
    chunks,
    vectors: vectorsEnabled(env),
    model: env.MODEL || DEFAULT_MODEL,
    models: modelChoices(env),
    build_date: m.build_date ?? null,
    llm: !!env.OPENROUTER_API_KEY,
  });
}

export async function handleSearch(env: Env, url: URL): Promise<Response> {
  const p = url.searchParams;
  const q = (p.get("q") ?? "").trim();
  if (!q) throw new HttpError(400, "q is required");
  if (q.length > 500) throw new HttpError(400, "q is too long (max 500 characters)");
  const res = await search(env, {
    q,
    k: intParam(p.get("k"), 20, 1, 50),
    area: p.get("area") || null,
    ertms_set: p.get("ertms_set") || null,
    status: p.get("status") || null,
    include_repealed: boolParam(p.get("include_repealed")),
    doc: p.get("doc") || null,
  });
  return json({ query: res.query, mode: res.mode, results: res.results });
}

export async function docInfo(env: Env, path: string) {
  const docs = await getDocs(env);
  const d = docs.byPath.get(path);
  if (!d) return null;
  const [cites, citedBy, nChunks] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS n FROM edges WHERE citing_path = ?").bind(path).first<number>("n"),
    env.DB.prepare("SELECT COUNT(*) AS n FROM edges WHERE cited_path = ?").bind(path).first<number>("n"),
    env.DB.prepare("SELECT COUNT(*) AS n FROM chunks WHERE doc_id = ?").bind(d.id).first<number>("n"),
  ]);
  return { ...d, file_url: fileUrl(d), official_url: d.url, n_chunks: nChunks ?? 0, cites: cites ?? 0, cited_by: citedBy ?? 0 };
}

export async function handleDoc(env: Env, url: URL): Promise<Response> {
  const path = url.searchParams.get("path");
  if (!path) throw new HttpError(400, "path is required");
  const info = await docInfo(env, path);
  if (!info) throw new HttpError(404, "document not found");
  return json(info);
}

export async function handleChunk(env: Env, url: URL): Promise<Response> {
  const id = Number.parseInt(url.searchParams.get("id") ?? "", 10);
  if (!Number.isFinite(id)) throw new HttpError(400, "id is required");
  const c = await env.DB.prepare(
    "SELECT id, doc_id, ord, heading, locator, inner_file, page_start, page_end, anchor, text, tokens FROM chunks WHERE id = ?",
  )
    .bind(id)
    .first<ChunkRow>();
  if (!c) throw new HttpError(404, "chunk not found");
  const docs = await getDocs(env);
  const d = docs.byId.get(c.doc_id);
  if (!d) throw new HttpError(404, "document not found");
  const { snippet: _s, score: _sc, ...hit } = buildHit(d, c, "", 0);
  return json({ ...hit, ord: c.ord, text: c.text, tokens: c.tokens ?? null, doc: { ...d, file_url: fileUrl(d), official_url: d.url } });
}
