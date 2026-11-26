import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { _resetJwksCache, checkAccess, verifyAccessJwt } from "../src/auth";
import type { Env } from "../src/env";

const TEAM = "myteam.cloudflareaccess.com";
const AUD = "aud-tag-123";
let priv: CryptoKey;
let otherPriv: CryptoKey;
let jwks: { keys: JsonWebKey[] };
let fetchCount = 0;

const b64url = (b: ArrayBuffer | Uint8Array | string) => {
  const bytes = typeof b === "string" ? new TextEncoder().encode(b) : new Uint8Array(b as ArrayBuffer);
  let s = "";
  for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

async function sign(claims: Record<string, unknown>, opts: { kid?: string; alg?: string; key?: CryptoKey } = {}) {
  const header = b64url(JSON.stringify({ alg: opts.alg ?? "RS256", kid: opts.kid ?? "k1", typ: "JWT" }));
  const payload = b64url(JSON.stringify(claims));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", opts.key ?? priv, new TextEncoder().encode(`${header}.${payload}`));
  return `${header}.${payload}.${b64url(sig)}`;
}

const now = () => Math.floor(Date.now() / 1000);
const good = () => ({ aud: [AUD], iss: `https://${TEAM}`, exp: now() + 600, iat: now(), email: "a@b.c" });

const fakeFetch = async (input: RequestInfo | URL) => {
  fetchCount++;
  expect(String(input)).toBe(`https://${TEAM}/cdn-cgi/access/certs`);
  return new Response(JSON.stringify(jwks), { headers: { "Content-Type": "application/json" } });
};

beforeAll(async () => {
  const gen = () =>
    crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]) as Promise<CryptoKeyPair>;
  const kp = await gen();
  const kp2 = await gen();
  priv = kp.privateKey;
  otherPriv = kp2.privateKey;
  const pub = (await crypto.subtle.exportKey("jwk", kp.publicKey)) as JsonWebKey;
  jwks = { keys: [{ ...pub, kid: "k1", alg: "RS256", use: "sig" } as JsonWebKey] };
});

beforeEach(() => {
  _resetJwksCache();
  fetchCount = 0;
});

describe("Access JWT", () => {
  it("accepts a valid token and caches the JWKS", async () => {
    const t = await sign(good());
    await expect(verifyAccessJwt(t, TEAM, AUD, fakeFetch)).resolves.toMatchObject({ email: "a@b.c" });
    await verifyAccessJwt(t, `https://${TEAM}/`, AUD, fakeFetch);
    expect(fetchCount).toBe(1);
  });
  it("accepts a string aud", async () => {
    await expect(verifyAccessJwt(await sign({ ...good(), aud: AUD }), TEAM, AUD, fakeFetch)).resolves.toBeTruthy();
  });
  it.each([
    ["wrong aud", { aud: ["other"] }, "bad aud"],
    ["wrong iss", { iss: "https://evil.cloudflareaccess.com" }, "bad iss"],
    ["expired", { exp: Math.floor(Date.now() / 1000) - 3600 }, "expired"],
    ["no exp", { exp: undefined }, "expired"],
    ["not yet valid", { nbf: Math.floor(Date.now() / 1000) + 3600 }, "not yet valid"],
  ])("rejects %s", async (_n, patch, msg) => {
    await expect(verifyAccessJwt(await sign({ ...good(), ...patch }), TEAM, AUD, fakeFetch)).rejects.toThrow(msg);
  });
  it("rejects a bad signature, unknown kid, alg none and garbage", async () => {
    await expect(verifyAccessJwt(await sign(good(), { key: otherPriv }), TEAM, AUD, fakeFetch)).rejects.toThrow("bad signature");
    await expect(verifyAccessJwt(await sign(good(), { kid: "nope" }), TEAM, AUD, fakeFetch)).rejects.toThrow("unknown kid");
    const none = `${b64url(JSON.stringify({ alg: "none", kid: "k1" }))}.${b64url(JSON.stringify(good()))}.`;
    await expect(verifyAccessJwt(none, TEAM, AUD, fakeFetch)).rejects.toThrow("unsupported alg");
    await expect(verifyAccessJwt("a.b", TEAM, AUD, fakeFetch)).rejects.toThrow("malformed");
    await expect(verifyAccessJwt("!!.??.##", TEAM, AUD, fakeFetch)).rejects.toThrow("malformed");
    // tampered payload
    const t = await sign(good());
    const [h, , s] = t.split(".");
    await expect(verifyAccessJwt(`${h}.${b64url(JSON.stringify({ ...good(), email: "x@y" }))}.${s}`, TEAM, AUD, fakeFetch)).rejects.toThrow("bad signature");
  });
});

describe("checkAccess", () => {
  const env = (o: Partial<Env>) => o as Env;
  it("allows everything when not configured and REQUIRE_ACCESS=0 (dev)", async () => {
    expect(await checkAccess(new Request("https://x/"), env({ REQUIRE_ACCESS: "0" }))).toBeNull();
  });
  it("fails closed when REQUIRE_ACCESS=1 and unconfigured", async () => {
    expect((await checkAccess(new Request("https://x/"), env({ REQUIRE_ACCESS: "1" })))?.status).toBe(403);
  });
  it("treats a missing, empty or unexpected REQUIRE_ACCESS as 1 (fail closed)", async () => {
    for (const v of [undefined, "", " ", "false", "no", "00"]) {
      expect((await checkAccess(new Request("https://x/"), env({ REQUIRE_ACCESS: v })))?.status, `REQUIRE_ACCESS=${v}`).toBe(403);
    }
  });
  it("still verifies the token when configured, even with REQUIRE_ACCESS=0", async () => {
    const e = env({ ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, REQUIRE_ACCESS: "0" });
    expect((await checkAccess(new Request("https://x/"), e, fakeFetch))?.status).toBe(403);
  });
  it("requires a valid header when configured", async () => {
    const e = env({ ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD });
    expect((await checkAccess(new Request("https://x/files/a.pdf"), e, fakeFetch))?.status).toBe(403);
    expect((await checkAccess(new Request("https://x/", { headers: { "Cf-Access-Jwt-Assertion": "junk" } }), e, fakeFetch))?.status).toBe(403);
    const t = await sign(good());
    expect(await checkAccess(new Request("https://x/", { headers: { "Cf-Access-Jwt-Assertion": t } }), e, fakeFetch)).toBeNull();
  });
});
