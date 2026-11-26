/** railcert-ask Worker: auth → router (API, files, assets). */
import type { Env } from "./env";
import { checkAccess } from "./auth";
import { HttpError, errorResponse, withSecurityHeaders } from "./http";
import { handleChunk, handleDoc, handleHealth, handleSearch } from "./api";
import { handleFile } from "./files";
import { askResponse, parseAskBody } from "./agent";

async function route(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  if (path.startsWith("/api/")) {
    if (path === "/api/ask") {
      if (method !== "POST") return errorResponse(405, "use POST");
      const ct = request.headers.get("Content-Type") ?? "";
      if (!ct.includes("application/json")) return errorResponse(415, "Content-Type must be application/json");
      const len = Number(request.headers.get("Content-Length") ?? 0);
      if (len > 200_000) return errorResponse(413, "request too large");
      const text = await request.text();
      if (text.length > 200_000) return errorResponse(413, "request too large");
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        return errorResponse(400, "invalid JSON");
      }
      const { history, model } = parseAskBody(body, env);
      return askResponse(env, history, model, ctx);
    }
    if (method !== "GET" && method !== "HEAD") return errorResponse(405, "method not allowed");
    switch (path) {
      case "/api/health":
        return handleHealth(env);
      case "/api/search":
        return handleSearch(env, url);
      case "/api/doc":
        return handleDoc(env, url);
      case "/api/chunk":
        return handleChunk(env, url);
      default:
        return errorResponse(404, "not found");
    }
  }

  if (path.startsWith("/files/")) {
    if (method !== "GET" && method !== "HEAD") return errorResponse(405, "method not allowed");
    return handleFile(request, env, url);
  }

  if (env.ASSETS) return env.ASSETS.fetch(request);
  return errorResponse(404, "not found");
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const denied = await checkAccess(request, env);
    if (denied) return withSecurityHeaders(denied);
    try {
      return withSecurityHeaders(await route(request, env, ctx));
    } catch (e) {
      if (e instanceof HttpError) return withSecurityHeaders(errorResponse(e.status, e.message));
      console.error("unhandled error", e);
      return withSecurityHeaders(errorResponse(500, "internal error"));
    }
  },
} satisfies ExportedHandler<Env>;
