/** GET/HEAD /files/<library path>: stream originals from the private R2 bucket (Range supported). */
import type { Env } from "./env";
import { getDocs } from "./docs";
import { errorResponse } from "./http";

const TYPES: Record<string, string> = {
  pdf: "application/pdf",
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  zip: "application/zip",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  csv: "text/csv; charset=utf-8",
  json: "application/json",
  xml: "application/xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  css: "text/css; charset=utf-8",
};

export function contentTypeFor(key: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(key);
  return (m && TYPES[m[1].toLowerCase()]) || "application/octet-stream";
}

/**
 * Every served file gets a script-free sandbox CSP, so nothing from the library (HTML, SVG, XML with
 * xml-stylesheet, mis-typed uploads, ...) can run script on our origin. The one exception is PDF:
 * a sandbox CSP breaks Chrome's built-in viewer, and PDFs are rendered by the browser's viewer, not as a document.
 */
export function fileCsp(ct: string): string | null {
  if (ct.toLowerCase().split(";")[0].trim() === "application/pdf") return null;
  return "sandbox allow-popups allow-popups-to-escape-sandbox; default-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; frame-ancestors 'self'";
}

function keyFromPath(pathname: string): string | null {
  const raw = pathname.replace(/^\/files\//, "");
  if (!raw) return null;
  try {
    const key = raw.split("/").map(decodeURIComponent).join("/");
    if (key.split("/").some((seg) => seg === ".." || seg === ".")) return null;
    return key;
  } catch {
    return null;
  }
}

function parseRange(h: string | null, size: number): { offset: number; length: number } | "invalid" | null {
  if (!h) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(h.trim());
  if (!m || (m[1] === "" && m[2] === "")) return "invalid"; // multi-range not supported
  let start: number;
  let end: number;
  if (m[1] === "") {
    const suffix = Number(m[2]);
    if (suffix === 0) return "invalid";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start >= size || end < start) return "invalid";
  return { offset: start, length: end - start + 1 };
}

export async function handleFile(request: Request, env: Env, url: URL): Promise<Response> {
  const key = keyFromPath(url.pathname);
  if (!key) return errorResponse(404, "not found");
  const docs = await getDocs(env);
  if (!docs.r2Keys.has(key)) return errorResponse(404, "not found");

  const head = await env.FILES.head(key);
  if (!head) return errorResponse(404, "not found");
  const size = head.size;
  const ct = head.httpMetadata?.contentType || contentTypeFor(key);
  const headers = new Headers();
  headers.set("Content-Type", ct);
  headers.set("Accept-Ranges", "bytes");
  headers.set("ETag", head.httpEtag);
  headers.set("Last-Modified", head.uploaded.toUTCString());
  headers.set("Cache-Control", "private, max-age=3600");
  const fname = key.split("/").pop() ?? "file";
  headers.set("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(fname)}`);
  const csp = fileCsp(ct);
  if (csp) headers.set("Content-Security-Policy", csp);

  const inm = request.headers.get("If-None-Match");
  if (inm && inm.split(",").map((s) => s.trim()).includes(head.httpEtag)) {
    return new Response(null, { status: 304, headers });
  }

  let range = parseRange(request.headers.get("Range"), size);
  const ifRange = request.headers.get("If-Range");
  if (range && ifRange && ifRange !== head.httpEtag) range = null; // stale validator → full body
  if (range === "invalid") {
    headers.set("Content-Range", `bytes */${size}`);
    return new Response(null, { status: 416, headers });
  }

  if (request.method === "HEAD") {
    if (range) {
      headers.set("Content-Range", `bytes ${range.offset}-${range.offset + range.length - 1}/${size}`);
      headers.set("Content-Length", String(range.length));
      return new Response(null, { status: 206, headers });
    }
    headers.set("Content-Length", String(size));
    return new Response(null, { status: 200, headers });
  }

  const obj = await env.FILES.get(key, range ? { range } : undefined);
  if (!obj) return errorResponse(404, "not found");
  if (range) {
    headers.set("Content-Range", `bytes ${range.offset}-${range.offset + range.length - 1}/${size}`);
    headers.set("Content-Length", String(range.length));
    return new Response(obj.body, { status: 206, headers });
  }
  headers.set("Content-Length", String(size));
  return new Response(obj.body, { status: 200, headers });
}
