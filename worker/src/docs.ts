/** In-isolate cache of the (small, ~2k rows) docs table, plus Hit/URL building. */
import type { Env } from "./env";

export interface DocRow {
  id: number;
  path: string;
  folder: string;
  filename: string;
  title: string | null;
  reference: string | null;
  short_name: string | null;
  date_status: string | null;
  status: string;
  area: string;
  ertms_set: string | null;
  lang: string | null;
  url: string | null;
  notes: string | null;
  n_pages: number | null;
  r2_key: string | null;
  duplicate_of: string | null;
}

export interface ChunkRow {
  id: number;
  doc_id: number;
  ord: number;
  heading: string | null;
  locator: string | null;
  inner_file: string | null;
  page_start: number | null;
  page_end: number | null;
  anchor: string | null;
  text?: string;
  tokens?: number | null;
}

export interface Hit {
  chunk_id: number;
  doc_path: string;
  doc_title: string | null;
  short_name: string | null;
  reference: string | null;
  status: string;
  area: string;
  ertms_set: string | null;
  locator: string | null;
  heading: string | null;
  page_start: number | null;
  page_end: number | null;
  inner_file: string | null;
  anchor: string | null;
  snippet: string;
  score: number;
  file_url: string | null;
  official_url: string | null;
}

export type Citation = Omit<Hit, "snippet" | "score"> & {
  n: number;
  /** Up to ~700 chars of the chunk text for the source card (set once the answer is complete). */
  excerpt?: string;
};

export interface DocIndex {
  byId: Map<number, DocRow>;
  byPath: Map<string, DocRow>;
  r2Keys: Set<string>;
  loadedAt: number;
}

const TTL_MS = 5 * 60 * 1000;
let cache: DocIndex | null = null;
let loading: Promise<DocIndex> | null = null;

export function _resetDocCache(): void {
  cache = null;
  loading = null;
}

export async function getDocs(env: Env): Promise<DocIndex> {
  if (cache && Date.now() - cache.loadedAt < TTL_MS) return cache;
  if (!loading) {
    loading = (async () => {
      const { results } = await env.DB.prepare(
        "SELECT id, path, folder, filename, title, reference, short_name, date_status, status, area, ertms_set, lang, url, notes, n_pages, r2_key, duplicate_of FROM docs",
      ).all<DocRow>();
      const idx: DocIndex = { byId: new Map(), byPath: new Map(), r2Keys: new Set(), loadedAt: Date.now() };
      for (const d of results ?? []) {
        idx.byId.set(d.id, d);
        idx.byPath.set(d.path, d);
        if (d.r2_key) idx.r2Keys.add(d.r2_key);
      }
      cache = idx;
      return idx;
    })().finally(() => {
      loading = null;
    });
  }
  return loading;
}

export function docName(d: DocRow): string {
  return d.short_name || d.title || d.filename;
}

export function encodePath(p: string): string {
  return p.split("/").map(encodeURIComponent).join("/");
}

function ext(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name);
  return m ? m[1].toLowerCase() : "";
}

export function fileUrl(d: DocRow, c?: Pick<ChunkRow, "page_start" | "anchor" | "inner_file"> | null): string | null {
  if (!d.r2_key) return null;
  const base = `/files/${encodePath(d.r2_key)}`;
  const e = ext(d.r2_key);
  if (!c) return base;
  if (e === "pdf" && c.page_start) return `${base}#page=${c.page_start}`;
  if ((e === "html" || e === "htm") && c.anchor) return `${base}#${encodeURIComponent(c.anchor)}`;
  return base; // zips (link the archive), docx, txt …
}

export function buildHit(d: DocRow, c: ChunkRow, snippet: string, score: number): Hit {
  return {
    chunk_id: c.id,
    doc_path: d.path,
    doc_title: d.title,
    short_name: d.short_name,
    reference: d.reference,
    status: d.status,
    area: d.area,
    ertms_set: d.ertms_set,
    locator: c.locator,
    heading: c.heading,
    page_start: c.page_start,
    page_end: c.page_end,
    inner_file: c.inner_file,
    anchor: c.anchor,
    snippet,
    score,
    file_url: fileUrl(d, c),
    official_url: d.url,
  };
}

export function pagesLabel(c: Pick<ChunkRow, "page_start" | "page_end">): string {
  if (!c.page_start) return "";
  if (c.page_end && c.page_end !== c.page_start) return `p. ${c.page_start}-${c.page_end}`;
  return `p. ${c.page_start}`;
}

/** `[c:123] CCS TSI — Annex A §4.2 (p. 14-15)` */
export function chunkHeader(d: DocRow, c: ChunkRow): string {
  const where = [c.locator, c.heading && c.heading !== c.locator ? c.heading : null].filter(Boolean).join(" · ");
  const pages = pagesLabel(c);
  const inner = c.inner_file ? ` [${c.inner_file}]` : "";
  return `[c:${c.id}] ${docName(d)}${where ? ` — ${where}` : ""}${inner}${pages ? ` (${pages})` : ""}`;
}
