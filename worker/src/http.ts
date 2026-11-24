export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function json(data: unknown, status = 200, extra?: HeadersInit): Response {
  const h = new Headers(extra);
  h.set("Content-Type", "application/json; charset=utf-8");
  if (!h.has("Cache-Control")) h.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(data), { status, headers: h });
}

export function errorResponse(status: number, message: string): Response {
  return json({ error: message }, status);
}

const APP_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "frame-src 'self'",
  "object-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join("; ");

/** Adds security headers. Library files keep their own CSP (set in files.ts). */
export function withSecurityHeaders(res: Response): Response {
  const out = new Response(res.body, res);
  const h = out.headers;
  h.set("X-Content-Type-Options", "nosniff");
  h.set("Referrer-Policy", "same-origin");
  h.set("X-Frame-Options", "SAMEORIGIN");
  h.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  h.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  h.set("Cross-Origin-Opener-Policy", "same-origin");
  h.set("Cross-Origin-Resource-Policy", "same-origin");
  if (!h.has("Content-Security-Policy")) h.set("Content-Security-Policy", APP_CSP);
  return out;
}

export function intParam(v: string | null | undefined, def: number, min: number, max: number): number {
  if (v == null || v === "") return def;
  const n = Number.parseInt(String(v), 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

export function boolParam(v: unknown): boolean {
  return v === true || v === 1 || v === "1" || v === "true" || v === "yes";
}
