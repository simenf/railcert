import { describe, expect, it, beforeAll } from "vitest";
import { env } from "cloudflare:workers";
import { extractIdentifiers, extractLocators, locatorMatch, normLocator, parseTerms, sanitizeFtsQuery } from "../src/query";
import { loadFixture } from "./fixture";

const NASTY = [
  "",
  "   ",
  '"',
  '""""',
  "'",
  "(",
  ")",
  "((a OR b)",
  "a) OR (b",
  "2023/1695",
  "SUBSET-026",
  "SUBSET-026 3.5.3.7",
  "§ 3-1",
  "§§ 3-1 (2)",
  "3.5.3.7",
  "3.5.3.7.",
  "AND",
  "OR",
  "NOT",
  "NEAR",
  "AND OR NOT",
  "a AND",
  "NEAR(a b, 2)",
  "*",
  "**",
  "foo*",
  "^foo",
  "text:foo",
  "locator : x",
  "{text heading}: foo",
  "-foo",
  "+foo",
  "æøå",
  "Søknad om tillatelse før ibruktakelse",
  "Krav til sporveksler – ÆØÅ",
  "Art. 15(8) DeBo",
  "Article 15 (8)",
  'he said "verification of national rules',
  "C:\\path\\x",
  "a/b/c/d",
  "---",
  "...",
  "./-",
  "1",
  "the",
  "and the of",
  "x".repeat(2000),
  "😀 emoji 🚆",
  "null; DROP TABLE docs; --",
  "\u0000\u0001\u001f",
  "TRV-07113",
  "TRV:07113",
  "EN 50126-1:2017",
  "(EU) 2016/797",
  "ERA/GUI/01-2011",
];

describe("FTS query sanitising", () => {
  beforeAll(async () => {
    await loadFixture(env.DB);
  });

  it("only emits quoted terms and our operators", () => {
    for (const q of NASTY) {
      for (const op of ["AND", "OR"] as const) {
        const m = sanitizeFtsQuery(q, op);
        // strip quoted strings; what remains may only be operators, parens, `*` and spaces
        const rest = m.replace(/"[^"]*"\*?/g, "");
        expect(rest, `${q} -> ${m}`).toMatch(/^[\s()]*(?:(?:AND|OR)[\s()]*)*$/);
      }
    }
  });

  it("never makes FTS5 throw", async () => {
    for (const q of NASTY) {
      for (const op of ["AND", "OR"] as const) {
        const m = sanitizeFtsQuery(q, op);
        if (!m) continue;
        await expect(env.DB.prepare("SELECT rowid FROM chunks_fts WHERE chunks_fts MATCH ? LIMIT 1").bind(m).all(), `${q} -> ${m}`).resolves.toBeTruthy();
      }
    }
  });

  it("keeps identifiers as single (prefix) tokens", () => {
    expect(sanitizeFtsQuery("2023/1695")).toBe('"2023/1695"*');
    expect(sanitizeFtsQuery("SUBSET-026")).toBe('"subset-026"*');
    expect(sanitizeFtsQuery("3.5.3.7.")).toBe('"3.5.3.7"*');
    expect(sanitizeFtsQuery("§ 3-1")).toBe('"3-1"*');
    expect(sanitizeFtsQuery("Art. 15(8)")).toBe('"art"* AND "15 8"');
    expect(sanitizeFtsQuery("AND")).toBe('"and"*');
    expect(sanitizeFtsQuery("*")).toBe("");
    expect(sanitizeFtsQuery("")).toBe("");
    expect(sanitizeFtsQuery("æøå")).toBe('"æøå"*');
  });

  it("drops stop words but keeps a stop-word-only query", () => {
    expect(parseTerms("what are the requirements for vehicles").map((t) => t.text)).toEqual(["requirement", "vehicle"]);
    expect(parseTerms("the").map((t) => t.text)).toEqual(["the"]);
  });

  it("finds real rows for tricky inputs", async () => {
    const hit = async (q: string) =>
      (await env.DB.prepare("SELECT rowid FROM chunks_fts WHERE chunks_fts MATCH ?").bind(sanitizeFtsQuery(q)).all()).results.map((r: any) => r.rowid);
    expect(await hit("SUBSET-026")).toContain(102);
    expect(await hit("3.5.3.7")).toContain(301);
    expect(await hit("2016/796")).toContain(203);
    expect(await hit("Article 15(8)")).toContain(202);
    expect(await hit("§ 3-1")).toContain(401);
    expect(await hit("særlige krav æ ø å")).toContain(401);
    expect(await hit("TRV-07113")).toContain(501);
  });
});

describe("locators and identifiers", () => {
  it("normalises locators", () => {
    expect(normLocator("Art. 15(8)")).toBe("art15(8)");
    expect(normLocator("Article 15 (8)")).toBe("art15(8)");
    expect(normLocator("§ 3.5.3.7")).toBe("3.5.3.7");
    expect(normLocator("TRV:07113")).toBe("trv-07113");
  });
  it("extracts locators", () => {
    expect(extractLocators("Article 15(8) DeBo").map((l) => l.key)).toEqual(["art15(8)"]);
    expect(extractLocators("SUBSET-026 3.5.3.7").map((l) => l.key)).toEqual(["3.5.3.7"]);
    expect(extractLocators("samtrafikkforskriften § 3-1").map((l) => l.key)).toEqual(["3-1"]);
    expect(extractLocators("Directive 2016/797 Annex II").map((l) => l.key)).toEqual(["annexii"]);
    expect(extractLocators("TRV-07113").map((l) => l.key)).toEqual(["trv-07113"]);
    expect(extractLocators("2023/1695")).toEqual([]);
  });
  it("matches exact, parent and child locators", () => {
    expect(locatorMatch("Art. 15(8)", ["art15(8)"])).toBe(2);
    expect(locatorMatch("Art. 15", ["art15(8)"])).toBe(1);
    expect(locatorMatch("Art. 15(1)", ["art15(8)"])).toBe(0);
    expect(locatorMatch("§3.5.3.7.1", ["3.5.3.7"])).toBe(1);
    expect(locatorMatch("§3.5.3.70", ["3.5.3.7"])).toBe(0);
  });
  it("extracts identifiers", () => {
    expect(extractIdentifiers("SUBSET-026 and SS-037-2, 2023/1695, FOR-2021-09-09-2742, EN 50126-1")).toEqual([
      "subset-026",
      "subset-037-2",
      "2023/1695",
      "for-2021-09-09-2742",
      "en 50126-1",
    ]);
  });
});

describe("locator ranges", () => {
  it("parses and matches ranges", async () => {
    const { locatorRange } = await import("../src/query");
    expect(locatorRange("Art. 15(7)–(9)")).toEqual(["art15(7)", "art15(9)"]);
    expect(locatorRange("TRV-07111–07117")).toEqual(["trv-07111", "trv-07117"]);
    expect(locatorRange("§ 1-1–1-3")).toEqual(["1-1", "1-3"]);
    expect(locatorMatch("Art. 15(7)–(9)", ["art15(8)"])).toBe(1.5);
    expect(locatorMatch("Art. 15(7)–(9)", ["art15(9)"])).toBe(2);
    expect(locatorMatch("Art. 15(1)–(7)", ["art15(8)"])).toBe(0);
    expect(locatorMatch("TRV-07111–07117", ["trv-07113"])).toBe(1.5);
    expect(locatorMatch("§3.5.3.7.2–3.5.3.7.5", ["3.5.3.7"])).toBe(1);
    expect(locatorMatch("§ 1-1–1-3", ["1-2"])).toBe(1.5);
    expect(locatorMatch("Art. 16–18", ["art15"])).toBe(0);
  });
});

describe("ETSI identifiers", () => {
  it("joins spaced ETSI numbers", () => {
    expect(extractIdentifiers("ETSI EN 301 515 in Set 3")).toEqual(["en 301515"]);
  });
});
