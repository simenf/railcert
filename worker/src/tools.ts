/** The seven agent tools. Each returns compact text/JSON for the model plus a human summary. */
import type { Env } from "./env";
import { type ChunkRow, type DocIndex, type DocRow, buildHit, chunkHeader, docName, fileUrl, getDocs, pagesLabel } from "./docs";
import { identKey, locatorMatch, normLocator } from "./query";
import { search } from "./search";
import type { SourceInfo } from "./citations";

export interface ToolContext {
  env: Env;
  /** Chunk ids the model may cite, with their citation metadata. */
  seen: Map<number, SourceInfo>;
  /** Full text of chunks seen in this request (for quote checks). */
  texts: Map<number, string>;
}

export interface ToolOutput {
  result: string;
  summary: string;
}

const READ_MAX_CHARS = 12_000;
const SNIP = 220;

const str = (v: unknown, max = 300): string | undefined => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);
const num = (v: unknown): number | undefined => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
};
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

function remember(ctx: ToolContext, d: DocRow, c: ChunkRow, text?: string) {
  const { snippet: _s, score: _sc, ...info } = buildHit(d, c, "", 0);
  ctx.seen.set(c.id, info);
  if (text != null) ctx.texts.set(c.id, text);
}

function compactDoc(d: DocRow) {
  return {
    path: d.path,
    name: docName(d),
    title: d.title && d.title !== d.short_name ? clip(d.title, 160) : undefined,
    ref: d.reference || undefined,
    status: d.status,
    date: d.date_status || undefined,
    area: d.area,
    set: d.ertms_set || undefined,
    lang: d.lang || undefined,
  };
}

// ---------------------------------------------------------------- schemas

export const TOOL_SCHEMAS = [
  {
    type: "function",
    function: {
      name: "search",
      description:
        "Hybrid keyword+semantic search over all library passages. Returns chunk ids (cite as [c:<id>]), document, locator, page and a short snippet. Use precise identifiers (\"2023/1695\", \"SUBSET-026 3.5.3.7\", \"Art. 15(8)\", \"TRV-07113\", \"samtrafikkforskriften § 3-1\") or key terms; search in the documents' language (Norwegian for Norwegian law/Bane NOR).",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
          area: { type: "string", description: "Restrict to a library area (see system prompt)" },
          ertms_set: { type: "string", enum: ["Set1", "Set2", "Set3", "Set4", "informative"] },
          status: { type: "string", description: "Comma-separated statuses: in_force, consolidated, repealed, historical, draft, unknown" },
          include_repealed: { type: "boolean", description: "Do not demote repealed/historical texts" },
          doc_path: { type: "string", description: "Search only inside this document (library path)" },
          k: { type: "integer", minimum: 1, maximum: 15, description: "Number of hits (default 8)" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read",
      description:
        "Read full passage text. Give chunk_id (optionally around=1..3 neighbours), or doc_path with locator (e.g. \"Art. 15\", \"§3.5.3.7\", \"Annex II\") or pages (\"14-15\"). Max ~12k characters.",
      parameters: {
        type: "object",
        properties: {
          chunk_id: { type: "integer" },
          doc_path: { type: "string" },
          locator: { type: "string" },
          pages: { type: "string", description: "Page or range, e.g. \"14\" or \"14-16\"" },
          around: { type: "integer", minimum: 0, maximum: 3, description: "Neighbouring chunks to include on each side" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "doc_info",
      description:
        "Resolve a document by short name, reference, act number, CELEX/Lovdata id or path. Returns the catalogue row, status, official URL, related versions (base act, amendments, consolidated texts) and duplicates.",
      parameters: { type: "object", properties: { doc_or_name: { type: "string" } }, required: ["doc_or_name"] },
    },
  },
  {
    type: "function",
    function: {
      name: "citations",
      description: "Citation graph: what a document cites (direction=cites) or which library documents cite it (direction=cited_by).",
      parameters: {
        type: "object",
        properties: {
          doc_path: { type: "string", description: "Library path or a name resolvable by doc_info" },
          direction: { type: "string", enum: ["cites", "cited_by"] },
          limit: { type: "integer", minimum: 1, maximum: 60 },
        },
        required: ["doc_path", "direction"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "standard",
      description:
        "Look up an EN/IEC/ISO/CLC/UIC standard in the standards register: title, versions cited, which library documents cite it. The standards' texts are NOT in the library.",
      parameters: { type: "object", properties: { ref: { type: "string", description: "e.g. \"EN 50126-1\"" } }, required: ["ref"] },
    },
  },
  {
    type: "function",
    function: {
      name: "trv",
      description: "Bane NOR Teknisk regelverk requirement by id (e.g. \"TRV-07113\" or \"07113\"): text, section and a citable chunk id.",
      parameters: { type: "object", properties: { req_id: { type: "string" } }, required: ["req_id"] },
    },
  },
  {
    type: "function",
    function: {
      name: "list_docs",
      description: "Browse the catalogue by area, ERTMS set, status and/or words in the title/name/reference.",
      parameters: {
        type: "object",
        properties: {
          area: { type: "string" },
          ertms_set: { type: "string" },
          status: { type: "string" },
          text: { type: "string" },
        },
      },
    },
  },
] as const;

// ---------------------------------------------------------------- doc resolution

export async function resolveDoc(env: Env, docs: DocIndex, q: string): Promise<DocRow[]> {
  const raw = q.trim();
  if (!raw) return [];
  const exact = docs.byPath.get(raw);
  if (exact) return [exact];
  const lower = raw.toLowerCase().replace(/\s+/g, " ");
  const out: DocRow[] = [];
  const add = (d: DocRow | undefined) => {
    if (d && !out.includes(d)) out.push(d);
  };
  try {
    const { results } = await env.DB.prepare("SELECT path FROM aliases WHERE alias = ? LIMIT 20").bind(lower).all<{ path: string }>();
    for (const r of results ?? []) add(docs.byPath.get(r.path));
  } catch {
    /* no aliases */
  }
  const key = identKey(lower);
  const scored: { d: DocRow; s: number }[] = [];
  for (const d of docs.byId.values()) {
    const sn = (d.short_name ?? "").toLowerCase();
    const fields = [sn, (d.reference ?? "").toLowerCase(), (d.title ?? "").toLowerCase(), d.filename.toLowerCase(), d.path.toLowerCase()];
    let s = 0;
    if (sn === lower) s = 100;
    else if (sn.startsWith(lower)) s = 60;
    else if (fields.some((f) => f.includes(lower))) s = 40;
    else if (fields.some((f) => identKey(f).includes(key))) s = 30;
    if (!s) continue;
    if (d.status === "consolidated" || d.status === "in_force") s += 5;
    if (d.duplicate_of) s -= 20;
    scored.push({ d, s });
  }
  scored.sort((a, b) => b.s - a.s || a.d.path.localeCompare(b.d.path));
  for (const x of scored.slice(0, 12)) add(x.d);
  return out;
}

function baseShortName(s: string | null): string {
  return (s ?? "")
    .replace(/\s*[–—-]\s*(amendment|corrigendum|consolidated|correction|endring).*$/i, "")
    .replace(/\s*\((old|consolidated)\)\s*$/i, "")
    .trim()
    .toLowerCase();
}

function actNumber(d: DocRow): string | null {
  const m = /\b((?:19|20)\d{2}\/\d{1,4}|\d{1,4}\/(?:19|20)\d{2})\b/.exec(`${d.reference ?? ""} ${d.title ?? ""}`);
  return m ? m[1] : null;
}

// ---------------------------------------------------------------- implementations

async function toolSearch(ctx: ToolContext, a: any): Promise<ToolOutput> {
  const query = str(a.query, 400);
  if (!query) return { result: JSON.stringify({ error: "query is required" }), summary: "Search: missing query" };
  const res = await search(ctx.env, {
    q: query,
    k: Math.min(15, Math.max(1, num(a.k) ?? 8)),
    area: str(a.area, 80) ?? null,
    ertms_set: str(a.ertms_set, 20) ?? null,
    status: str(a.status, 80) ?? null,
    include_repealed: a.include_repealed === true || a.include_repealed === "true",
    doc: str(a.doc_path, 400) ?? null,
  });
  const docs = await getDocs(ctx.env);
  const hits = res.results.map((h) => {
    const d = docs.byPath.get(h.doc_path)!;
    const { snippet: _s, score: _sc, ...info } = h;
    ctx.seen.set(h.chunk_id, info);
    const t = res.texts.get(h.chunk_id);
    if (t) ctx.texts.set(h.chunk_id, t);
    return {
      id: h.chunk_id,
      doc: docName(d),
      path: h.doc_path,
      status: h.status,
      set: h.ertms_set || undefined,
      loc: h.locator || undefined,
      h: h.heading && h.heading !== h.locator ? clip(h.heading, 120) : undefined,
      p: pagesLabel(h) || undefined,
      file: h.inner_file || undefined,
      snip: clip(h.snippet, SNIP),
    };
  });
  const filt = [a.area, a.ertms_set, a.doc_path].filter((x) => typeof x === "string" && x).join(", ");
  return {
    result: JSON.stringify({ query, mode: res.mode, n: hits.length, hits }),
    summary: `Searching “${clip(query, 80)}”${filt ? ` in ${clip(filt, 60)}` : ""} — ${hits.length} hit${hits.length === 1 ? "" : "s"}`,
  };
}

const CHUNK_SELECT = "SELECT id, doc_id, ord, heading, locator, inner_file, page_start, page_end, anchor, text FROM chunks";

function renderChunks(ctx: ToolContext, docs: DocIndex, rows: ChunkRow[], note?: string): string {
  const parts: string[] = [];
  let used = 0;
  let truncated = false;
  for (const c of rows) {
    const d = docs.byId.get(c.doc_id);
    if (!d) continue;
    const header = chunkHeader(d, c);
    let body = c.text ?? "";
    const room = READ_MAX_CHARS - used - header.length - 10;
    if (room <= 200) {
      truncated = true;
      break;
    }
    if (body.length > room) {
      body = `${body.slice(0, room)} [… truncated]`;
      truncated = true;
    }
    remember(ctx, d, c, c.text ?? "");
    parts.push(`${header}\n${body}`);
    used += header.length + body.length + 8;
    if (truncated) break;
  }
  let out = parts.join("\n\n---\n\n");
  if (note) out = `${note}\n\n${out}`;
  if (truncated) out += "\n\n[Output limit reached; read further chunks by id if needed.]";
  return out || "No text found.";
}

function parsePages(s: string): [number, number] | null {
  const m = /^\s*(\d{1,5})\s*(?:[-–]\s*(\d{1,5}))?\s*$/.exec(s);
  if (!m) return null;
  const lo = Number(m[1]);
  const hi = m[2] ? Number(m[2]) : lo;
  return hi >= lo && hi - lo <= 30 ? [lo, hi] : [lo, lo + 30];
}

async function toolRead(ctx: ToolContext, a: any): Promise<ToolOutput> {
  const { env } = ctx;
  const docs = await getDocs(env);
  const around = Math.min(3, Math.max(0, num(a.around) ?? 0));
  const chunkId = num(a.chunk_id);
  if (chunkId != null) {
    const c = await env.DB.prepare(`${CHUNK_SELECT} WHERE id = ?`).bind(chunkId).first<ChunkRow>();
    if (!c) return { result: JSON.stringify({ error: `chunk ${chunkId} not found` }), summary: `Reading chunk ${chunkId} — not found` };
    let rows = [c];
    if (around) {
      const { results } = await env.DB.prepare(`${CHUNK_SELECT} WHERE doc_id = ? AND ord BETWEEN ? AND ? ORDER BY ord`)
        .bind(c.doc_id, c.ord - around, c.ord + around)
        .all<ChunkRow>();
      rows = results?.length ? results : rows;
    }
    const d = docs.byId.get(c.doc_id);
    return {
      result: renderChunks(ctx, docs, rows),
      summary: `Reading ${d ? docName(d) : "document"}${c.locator ? ` ${c.locator}` : ""}${pagesLabel(c) ? ` (${pagesLabel(c)})` : ""}`,
    };
  }
  const docPath = str(a.doc_path, 400);
  if (!docPath) return { result: JSON.stringify({ error: "give chunk_id, or doc_path with locator/pages" }), summary: "Read: missing arguments" };
  const d = docs.byPath.get(docPath) ?? (await resolveDoc(env, docs, docPath))[0];
  if (!d) return { result: JSON.stringify({ error: `document not found: ${docPath}` }), summary: `Reading ${clip(docPath, 60)} — not found` };
  const locator = str(a.locator, 80);
  const pages = str(a.pages, 20);
  if (locator) {
    const key = normLocator(locator);
    const { results } = await env.DB.prepare("SELECT id, ord, locator, anchor FROM chunks WHERE doc_id = ? ORDER BY ord")
      .bind(d.id)
      .all<{ id: number; ord: number; locator: string | null; anchor: string | null }>();
    const all = results ?? [];
    let ids = all.filter((r) => locatorMatch(r.locator, [key]) === 2 || normLocator(r.anchor) === key).map((r) => r.id);
    // children (Art. 15 → Art. 15(1) …) when there is no exact chunk, or to continue an exact one
    const children = all.filter((r) => {
      const c = normLocator(r.locator);
      return c.startsWith(key) && /^[.(\-]/.test(c.slice(key.length));
    });
    if (!ids.length) ids = all.filter((r) => locatorMatch(r.locator, [key]) === 1.5).map((r) => r.id); // inside a range
    if (!ids.length) ids = children.map((r) => r.id);
    if (!ids.length) {
      // the parent (Art. 15(8) asked, chunk is Art. 15)
      ids = all.filter((r) => locatorMatch(r.locator, [key]) === 1).map((r) => r.id);
    }
    if (!ids.length) {
      return {
        result: JSON.stringify({ error: `no chunk with locator “${locator}” in ${d.path}; try search with doc_path` }),
        summary: `Reading ${docName(d)} ${locator} — not found`,
      };
    }
    const rows: ChunkRow[] = [];
    for (let i = 0; i < ids.length && i < 90; i += 45) {
      const part = ids.slice(i, i + 45);
      const { results: r } = await env.DB.prepare(`${CHUNK_SELECT} WHERE id IN (${part.map(() => "?").join(",")}) ORDER BY ord`)
        .bind(...part)
        .all<ChunkRow>();
      rows.push(...(r ?? []));
    }
    rows.sort((x, y) => x.ord - y.ord);
    return { result: renderChunks(ctx, docs, rows), summary: `Reading ${docName(d)} ${locator}` };
  }
  if (pages) {
    const pr = parsePages(pages);
    if (!pr) return { result: JSON.stringify({ error: "pages must look like \"14\" or \"14-16\"" }), summary: "Read: bad page range" };
    const { results } = await env.DB.prepare(
      `${CHUNK_SELECT} WHERE doc_id = ? AND page_start <= ? AND COALESCE(page_end, page_start) >= ? ORDER BY ord LIMIT 40`,
    )
      .bind(d.id, pr[1], pr[0])
      .all<ChunkRow>();
    return {
      result: renderChunks(ctx, docs, results ?? [], results?.length ? undefined : "No chunks on those pages."),
      summary: `Reading ${docName(d)} p. ${pr[0]}${pr[1] !== pr[0] ? `-${pr[1]}` : ""}`,
    };
  }
  const { results } = await env.DB.prepare(`${CHUNK_SELECT} WHERE doc_id = ? ORDER BY ord LIMIT 4`).bind(d.id).all<ChunkRow>();
  return { result: renderChunks(ctx, docs, results ?? []), summary: `Reading the start of ${docName(d)}` };
}

async function toolDocInfo(ctx: ToolContext, a: any): Promise<ToolOutput> {
  const q = str(a.doc_or_name, 300);
  if (!q) return { result: JSON.stringify({ error: "doc_or_name is required" }), summary: "Document lookup: missing name" };
  const { env } = ctx;
  const docs = await getDocs(env);
  const found = await resolveDoc(env, docs, q);
  if (!found.length) return { result: JSON.stringify({ error: `no document matches “${q}”` }), summary: `Looking up “${clip(q, 60)}” — not in the library` };
  const d = found[0];
  const [cites, citedBy, nChunks] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS n FROM edges WHERE citing_path = ?").bind(d.path).first<number>("n"),
    env.DB.prepare("SELECT COUNT(*) AS n FROM edges WHERE cited_path = ?").bind(d.path).first<number>("n"),
    env.DB.prepare("SELECT COUNT(*) AS n FROM chunks WHERE doc_id = ?").bind(d.id).first<number>("n"),
  ]);
  const base = baseShortName(d.short_name);
  const number = actNumber(d);
  const family: DocRow[] = [];
  for (const o of docs.byId.values()) {
    if (o.id === d.id) continue;
    const sameBase = base && base.length >= 3 && baseShortName(o.short_name) === base;
    const mentions = number && `${o.reference ?? ""} ${o.title ?? ""} ${o.short_name ?? ""} ${o.filename}`.includes(number);
    if (sameBase || mentions) family.push(o);
  }
  family.sort((x, y) => (y.date_status ?? "").localeCompare(x.date_status ?? "") || x.path.localeCompare(y.path));
  const dups = [...docs.byId.values()].filter((o) => o.id !== d.id && (o.duplicate_of === d.path || d.duplicate_of === o.path));
  const out = {
    ...compactDoc(d),
    notes: d.notes ? clip(d.notes, 400) : undefined,
    pages: d.n_pages ?? undefined,
    chunks: nChunks ?? 0,
    official_url: d.url || undefined,
    file: fileUrl(d) || undefined,
    duplicate_of: d.duplicate_of || undefined,
    cites: cites ?? 0,
    cited_by: citedBy ?? 0,
    related_versions: family.slice(0, 15).map(compactDoc),
    duplicates: dups.slice(0, 5).map((x) => x.path),
    other_matches: found.slice(1, 8).map((x) => ({ path: x.path, name: docName(x), status: x.status })),
  };
  return { result: JSON.stringify(out), summary: `Looking up “${clip(q, 60)}” → ${docName(d)} (${d.status.replace(/_/g, " ")})` };
}

async function toolCitations(ctx: ToolContext, a: any): Promise<ToolOutput> {
  const q = str(a.doc_path, 400);
  const dir = a.direction === "cited_by" ? "cited_by" : "cites";
  const limit = Math.min(60, Math.max(1, num(a.limit) ?? 25));
  if (!q) return { result: JSON.stringify({ error: "doc_path is required" }), summary: "Citations: missing document" };
  const { env } = ctx;
  const docs = await getDocs(env);
  const d = docs.byPath.get(q) ?? (await resolveDoc(env, docs, q))[0];
  if (!d) return { result: JSON.stringify({ error: `document not found: ${q}` }), summary: `Citations of “${clip(q, 60)}” — not found` };
  if (dir === "cites") {
    const total = (await env.DB.prepare("SELECT COUNT(*) AS n FROM edges WHERE citing_path = ?").bind(d.path).first<number>("n")) ?? 0;
    const { results } = await env.DB.prepare(
      "SELECT cited_id, cited_type, cited_label, cited_short_name, cited_title, mentions, versions_cited, cited_path FROM edges WHERE citing_path = ? ORDER BY mentions DESC, cited_label LIMIT ?",
    )
      .bind(d.path, limit)
      .all<Record<string, any>>();
    const items = (results ?? []).map((r) => ({
      cited: r.cited_short_name || r.cited_label || r.cited_id,
      label: r.cited_label && r.cited_label !== r.cited_short_name ? r.cited_label : undefined,
      title: r.cited_title ? clip(r.cited_title, 120) : undefined,
      type: r.cited_type || undefined,
      mentions: r.mentions ?? undefined,
      versions: r.versions_cited || undefined,
      path: r.cited_path || undefined,
    }));
    return { result: JSON.stringify({ doc: docName(d), path: d.path, total, cites: items }), summary: `${docName(d)} cites ${total} item${total === 1 ? "" : "s"}` };
  }
  const total = (await env.DB.prepare("SELECT COUNT(*) AS n FROM edges WHERE cited_path = ?").bind(d.path).first<number>("n")) ?? 0;
  const { results } = await env.DB.prepare("SELECT citing_path, mentions, versions_cited FROM edges WHERE cited_path = ? ORDER BY mentions DESC LIMIT ?")
    .bind(d.path, limit)
    .all<{ citing_path: string; mentions: number | null; versions_cited: string | null }>();
  const items = (results ?? []).map((r) => {
    const c = docs.byPath.get(r.citing_path);
    return { path: r.citing_path, name: c ? docName(c) : undefined, status: c?.status, mentions: r.mentions ?? undefined, versions: r.versions_cited || undefined };
  });
  return { result: JSON.stringify({ doc: docName(d), path: d.path, total, cited_by: items }), summary: `${docName(d)} is cited by ${total} document${total === 1 ? "" : "s"}` };
}

async function toolStandard(ctx: ToolContext, a: any): Promise<ToolOutput> {
  const q = str(a.ref, 80);
  if (!q) return { result: JSON.stringify({ error: "ref is required" }), summary: "Standard: missing reference" };
  const ref = q.replace(/\s+/g, " ").replace(/^(EN|IEC|ISO|CLC|UIC|CEN|TS|TR)\s*(?=\d)/i, (m) => `${m.trim().toUpperCase()} `);
  const { env } = ctx;
  let rows: Record<string, any>[] = [];
  const one = await env.DB.prepare("SELECT * FROM standards WHERE standard = ? COLLATE NOCASE").bind(ref).first<Record<string, any>>();
  if (one) rows = [one];
  else {
    const { results } = await env.DB.prepare("SELECT * FROM standards WHERE standard LIKE ? ORDER BY cited_by_n_docs DESC LIMIT 6")
      .bind(`%${ref.replace(/[%_]/g, "")}%`)
      .all<Record<string, any>>();
    rows = results ?? [];
  }
  if (!rows.length) return { result: JSON.stringify({ error: `standard “${q}” is not in the standards register` }), summary: `Standard ${clip(q, 40)} — not in the register` };
  const docs = await getDocs(env);
  const out = rows.map((r) => {
    const citing = String(r.citing_documents ?? "").split(/;\s*/).filter(Boolean);
    return {
      standard: r.standard,
      title: r.title || undefined,
      type: r.type || undefined,
      availability: r.availability || undefined,
      versions_cited: r.versions_cited || undefined,
      cited_by_n_docs: r.cited_by_n_docs ?? citing.length,
      citing: citing.slice(0, 25).map((p) => {
        const d = docs.byPath.get(p);
        return d ? `${docName(d)} (${p})` : p;
      }),
      in_library: r.file_in_library || "no (paid standard; text not in the library)",
      link: r.link || undefined,
    };
  });
  return { result: JSON.stringify(out.length === 1 ? out[0] : { matches: out }), summary: `Standard ${rows[0].standard}${rows.length > 1 ? ` (+${rows.length - 1} more)` : ""} — cited by ${out[0].cited_by_n_docs} docs` };
}

async function toolTrv(ctx: ToolContext, a: any): Promise<ToolOutput> {
  const q = str(a.req_id, 40);
  const m = q && /(\d{3,6})/.exec(q);
  if (!m) return { result: JSON.stringify({ error: "req_id like TRV-07113" }), summary: "TRV: missing requirement id" };
  const digits = m[1].padStart(5, "0");
  const { env } = ctx;
  const row = await env.DB.prepare("SELECT req_id, path, anchor, section, text FROM trv WHERE req_id = ? OR req_id = ? LIMIT 1")
    .bind(`TRV:${digits}`, `TRV:${m[1]}`)
    .first<{ req_id: string; path: string; anchor: string | null; section: string | null; text: string | null }>();
  if (!row) return { result: JSON.stringify({ error: `requirement TRV:${digits} not found` }), summary: `Bane NOR requirement TRV:${digits} — not found` };
  const docs = await getDocs(env);
  const d = docs.byPath.get(row.path);
  let chunk: ChunkRow | null = null;
  if (d) {
    const anchor = row.anchor ?? `TRV-${digits}`;
    chunk = await env.DB.prepare(`${CHUNK_SELECT} WHERE doc_id = ? AND (anchor = ? OR locator = ?) ORDER BY ord LIMIT 1`)
      .bind(d.id, anchor, anchor)
      .first<ChunkRow>();
    if (!chunk) {
      chunk = await env.DB.prepare(`${CHUNK_SELECT} WHERE doc_id = ? AND instr(text, ?) > 0 ORDER BY ord LIMIT 1`).bind(d.id, anchor).first<ChunkRow>();
    }
    if (chunk) remember(ctx, d, chunk, chunk.text ?? "");
  }
  const out = {
    req_id: row.req_id,
    chunk_id: chunk?.id,
    cite_as: chunk ? `[c:${chunk.id}]` : undefined,
    doc: d ? docName(d) : row.path,
    path: row.path,
    section: row.section || undefined,
    text: clip(row.text ?? "", 1000),
    passage: chunk ? clip(chunk.text ?? "", 4000) : undefined,
    file: d ? fileUrl(d, { page_start: null, anchor: row.anchor, inner_file: null }) || undefined : undefined,
  };
  return { result: JSON.stringify(out), summary: `Bane NOR requirement ${row.req_id}${row.section ? ` (${clip(row.section, 60)})` : ""}` };
}

async function toolListDocs(ctx: ToolContext, a: any): Promise<ToolOutput> {
  const docs = await getDocs(ctx.env);
  const area = str(a.area, 80);
  const set = str(a.ertms_set, 20);
  const status = str(a.status, 80)?.split(",").map((s) => s.trim());
  const words = (str(a.text, 200) ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const matches = [...docs.byId.values()].filter((d) => {
    if (area && d.area.toLowerCase() !== area.toLowerCase()) return false;
    if (set && (d.ertms_set ?? "").toLowerCase() !== set.toLowerCase()) return false;
    if (status && !status.includes(d.status)) return false;
    if (d.duplicate_of) return false;
    if (words.length) {
      const hay = `${d.path} ${d.title ?? ""} ${d.short_name ?? ""} ${d.reference ?? ""}`.toLowerCase();
      if (!words.every((w) => hay.includes(w))) return false;
    }
    return true;
  });
  matches.sort((x, y) => x.area.localeCompare(y.area) || x.path.localeCompare(y.path));
  const shown = matches.slice(0, 40).map((d) => ({ path: d.path, name: docName(d), ref: d.reference || undefined, status: d.status, set: d.ertms_set || undefined }));
  const desc = [area, set, status?.join("/"), words.join(" ")].filter(Boolean).join(", ");
  return {
    result: JSON.stringify({ total: matches.length, shown: shown.length, docs: shown }),
    summary: `Listing documents${desc ? ` (${clip(desc, 60)})` : ""} — ${matches.length} found`,
  };
}

// A Map, not a plain object: model-supplied names such as "constructor" or "__proto__" must not resolve.
const IMPL = new Map<string, (ctx: ToolContext, a: any) => Promise<ToolOutput>>([
  ["search", toolSearch],
  ["read", toolRead],
  ["doc_info", toolDocInfo],
  ["citations", toolCitations],
  ["standard", toolStandard],
  ["trv", toolTrv],
  ["list_docs", toolListDocs],
]);

export async function runTool(ctx: ToolContext, name: string, rawArgs: string): Promise<ToolOutput & { args: Record<string, unknown> }> {
  let args: Record<string, unknown> = {};
  try {
    const parsed = rawArgs && rawArgs.trim() ? JSON.parse(rawArgs) : {};
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) args = parsed;
  } catch {
    return { args: {}, result: JSON.stringify({ error: "arguments were not valid JSON" }), summary: `${name}: invalid arguments` };
  }
  const fn = IMPL.get(name);
  if (!fn) return { args, result: JSON.stringify({ error: `unknown tool ${name}` }), summary: `Unknown tool ${name}` };
  try {
    return { args, ...(await fn(ctx, args)) };
  } catch (e) {
    console.error(`tool ${name} failed`, e);
    return { args, result: JSON.stringify({ error: `tool failed: ${(e as Error).message}` }), summary: `${name} failed` };
  }
}
