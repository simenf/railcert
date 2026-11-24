/**
 * Cloudflare Access JWT verification (RS256 against https://<team>/cdn-cgi/access/certs).
 * When ACCESS_TEAM_DOMAIN and ACCESS_AUD are both set, every request must carry a valid
 * `Cf-Access-Jwt-Assertion`. When they are not set, every request is refused (fail closed) unless
 * REQUIRE_ACCESS is exactly "0" (local dev only: `.dev.vars` or `wrangler dev --var REQUIRE_ACCESS:0`),
 * in which case requests are allowed and a warning is logged once. A missing or empty REQUIRE_ACCESS
 * counts as "1".
 */
import type { Env } from "./env";

export interface AccessClaims {
  aud?: string | string[];
  iss?: string;
  exp?: number;
  nbf?: number;
  iat?: number;
  sub?: string;
  email?: string;
  [k: string]: unknown;
}

interface Jwk extends JsonWebKey {
  kid?: string;
}

type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const JWKS_TTL_MS = 60 * 60 * 1000;
const JWKS_MIN_REFRESH_MS = 30 * 1000;
const CLOCK_SKEW_S = 60;

interface JwksCacheEntry {
  keys: Map<string, CryptoKey>;
  fetchedAt: number;
}
const jwksCache = new Map<string, JwksCacheEntry>();

export function _resetJwksCache(): void {
  jwksCache.clear();
}

export function teamOrigin(teamDomain: string): string {
  const d = teamDomain.trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  return `https://${d}`;
}

function b64urlToBytes(s: string): Uint8Array {
  let b = s.replace(/-/g, "+").replace(/_/g, "/");
  while (b.length % 4) b += "=";
  const bin = atob(b);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64urlJson(s: string): any {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));
}

async function loadJwks(origin: string, fetchImpl: Fetch, force: boolean): Promise<JwksCacheEntry> {
  const now = Date.now();
  const cached = jwksCache.get(origin);
  if (cached && !force && now - cached.fetchedAt < JWKS_TTL_MS) return cached;
  if (cached && force && now - cached.fetchedAt < JWKS_MIN_REFRESH_MS) return cached;
  const res = await fetchImpl(`${origin}/cdn-cgi/access/certs`, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    if (cached) return cached;
    throw new Error(`JWKS fetch failed: HTTP ${res.status}`);
  }
  const body = (await res.json()) as { keys?: Jwk[] };
  const keys = new Map<string, CryptoKey>();
  for (const jwk of body.keys ?? []) {
    if (jwk.kty !== "RSA" || !jwk.kid) continue;
    try {
      const key = await crypto.subtle.importKey(
        "jwk",
        { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["verify"],
      );
      keys.set(jwk.kid, key);
    } catch {
      /* skip malformed key */
    }
  }
  const entry = { keys, fetchedAt: now };
  jwksCache.set(origin, entry);
  return entry;
}

/** Verifies a Cloudflare Access JWT. Throws with a short reason on failure. */
export async function verifyAccessJwt(
  token: string,
  teamDomain: string,
  aud: string,
  fetchImpl: Fetch = fetch,
  nowS: number = Math.floor(Date.now() / 1000),
): Promise<AccessClaims> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("malformed token");
  let header: { alg?: string; kid?: string; typ?: string };
  let claims: AccessClaims;
  try {
    header = b64urlJson(parts[0]);
    claims = b64urlJson(parts[1]);
  } catch {
    throw new Error("malformed token");
  }
  if (header.alg !== "RS256") throw new Error("unsupported alg");
  if (!header.kid) throw new Error("missing kid");
  const origin = teamOrigin(teamDomain);
  let jwks = await loadJwks(origin, fetchImpl, false);
  let key = jwks.keys.get(header.kid);
  if (!key) {
    jwks = await loadJwks(origin, fetchImpl, true); // key rotation
    key = jwks.keys.get(header.kid);
  }
  if (!key) throw new Error("unknown kid");
  const data = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const sig = b64urlToBytes(parts[2]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, sig, data);
  if (!ok) throw new Error("bad signature");
  const auds = Array.isArray(claims.aud) ? claims.aud : claims.aud ? [claims.aud] : [];
  if (!auds.includes(aud)) throw new Error("bad aud");
  if (claims.iss !== origin) throw new Error("bad iss");
  if (typeof claims.exp !== "number" || claims.exp + CLOCK_SKEW_S < nowS) throw new Error("expired");
  if (typeof claims.nbf === "number" && claims.nbf - CLOCK_SKEW_S > nowS) throw new Error("not yet valid");
  return claims;
}

let warnedOpen = false;

/** Only an explicit REQUIRE_ACCESS="0" turns the Access requirement off; anything else (incl. unset/empty) keeps it on. */
export function accessOptional(env: Env): boolean {
  return (env.REQUIRE_ACCESS ?? "").trim() === "0";
}

/** Returns null when the request may proceed, or a 403/500 response. */
export async function checkAccess(request: Request, env: Env, fetchImpl: Fetch = fetch): Promise<Response | null> {
  const team = (env.ACCESS_TEAM_DOMAIN ?? "").trim();
  const aud = (env.ACCESS_AUD ?? "").trim();
  if (!team || !aud) {
    if (!accessOptional(env)) {
      console.error("Access is required (REQUIRE_ACCESS is not \"0\") but ACCESS_TEAM_DOMAIN/ACCESS_AUD are not set: refusing all requests");
      return forbidden("Access is not configured");
    }
    if (!warnedOpen) {
      warnedOpen = true;
      console.warn("ACCESS_TEAM_DOMAIN/ACCESS_AUD not set: Access JWT verification is OFF (local dev only)");
    }
    return null;
  }
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) return forbidden("Missing Access token");
  try {
    await verifyAccessJwt(token, team, aud, fetchImpl);
    return null;
  } catch (e) {
    console.warn(`Access JWT rejected: ${(e as Error).message}`);
    return forbidden("Invalid Access token");
  }
}

function forbidden(msg: string): Response {
  return new Response(JSON.stringify({ error: msg }), {
    status: 403,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}
