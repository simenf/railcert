// Node test for the pure rendering helpers in public/app.js (markdown, citation chips, search highlighting).
// Run: node --test test/ui-md.test.mjs   (also part of `npm test`)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const src = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
// The pure part of the file ends before the DOM-bound state section; hl() lives further down.
const pure = src.slice(0, src.indexOf("/* ---------- state ---------- */"));
const hlStart = src.indexOf("function hl(");
const hlSrc = src.slice(hlStart, src.indexOf("\nfunction ", hlStart + 1));
assert.ok(pure.includes("function mdInline(") && hlSrc.startsWith("function hl("), "could not locate the helpers in app.js");
const ctx = vm.createContext({ URL });
vm.runInContext(`${pure}\n${hlSrc}\nglobalThis.__t = { mdInline, mdRender, hl };`, ctx);
const { mdInline, mdRender, hl } = ctx.__t;

const cites = new Map([
  [1, { n: 1, short_name: "CCS TSI", doc_title: 'Reg "2023/1695"', locator: "Art. 1", file_url: "/files/a.pdf#page=1", official_url: "https://eur-lex.europa.eu/eli/reg_impl/2023/1695/oj" }],
]);

/** Parse-free structural checks: no <a> inside an <a>, and no quote/angle/NUL inside any href value. */
function assertSane(html) {
  let depth = 0;
  for (const m of html.matchAll(/<(\/?)a\b[^>]*>/g)) {
    depth += m[1] ? -1 : 1;
    assert.ok(depth <= 1 && depth >= 0, `nested or unbalanced <a> in: ${html}`);
  }
  assert.equal(depth, 0, `unbalanced <a> in: ${html}`);
  for (const m of html.matchAll(/href="([^"]*)"/g)) assert.doesNotMatch(m[1], /[<>\u0000]|&quot;/, `suspicious href ${m[1]}`);
  assert.doesNotMatch(html, /\u0000/, "placeholder leaked");
  // every attribute in every tag must be one of the attributes we emit (no injected style=, onclick=, ...)
  for (const tag of html.matchAll(/<[a-z]+\b([^>]*)>/g)) {
    const rest = tag[1].replace(/\s(href|target|rel|title|class|aria-label)="[^"]*"/g, "");
    assert.equal(rest.trim(), "", `unexpected attribute(s) "${rest}" in ${tag[0]}`);
  }
}

test("bare URL followed by a citation chip does not nest links", () => {
  const h = mdInline("See https://eur-lex.europa.eu/eli/reg/2023/1695[1] for details.", cites);
  assertSane(h);
  assert.match(h, /<a href="https:\/\/eur-lex\.europa\.eu\/eli\/reg\/2023\/1695" target="_blank"/);
  assert.match(h, /<a class="cite" href="\/files\/a\.pdf#page=1"/);
});

test("bare URL swallowing a markdown link cannot inject attributes", () => {
  const evil = "https://evil.example/[x](https://y//style=position:fixed;top:0;left:0;width:100%;height:100%)";
  const h = mdInline(evil, cites);
  assertSane(h);
  assert.doesNotMatch(h, /<[^>]*\sstyle=/);
});

test("markdown link with a code span in its text", () => {
  const h = mdInline("[`EN 50126`](https://example.org/en50126) and `x`", null);
  assertSane(h);
  assert.equal(h, '<a href="https://example.org/en50126" target="_blank" rel="noopener noreferrer"><code>EN 50126</code></a> <span class="host">(example.org)</span> and <code>x</code>');
});

test("forged placeholders in the input are inert", () => {
  const h = mdInline("a\u00000\u0000b https://x.example/\u00000\u0000 `c`", null);
  assertSane(h);
  assert.ok(!h.includes("undefined"));
});

test("external links show their host; internal and self-describing links do not", () => {
  assert.match(mdInline("[the act](https://evil.example/eurlex)", null), /<\/a> <span class="host">\(evil\.example\)<\/span>/);
  assert.doesNotMatch(mdInline("[eur-lex.europa.eu](https://eur-lex.europa.eu/x)", null), /class="host"/);
  assert.doesNotMatch(mdInline("[file](/files/a.pdf)", null), /class="host"/);
  assert.equal(mdInline("[x](javascript:void0)", null), "x");
});

test("full render of a typical answer stays sane", () => {
  const h = mdRender("# T\n\n- see https://eur-lex.europa.eu/eli/reg/2023/1695[1]\n- **bold** [link](https://a.example/b) [1, 2]\n\n| a | b |\n|---|---|\n| https://q.example/[1] | `c` |", cites);
  assertSane(h);
});

test("hl highlights each term once and never inside an inserted <mark>", () => {
  assert.equal(hl("The mark of a marker", "mark marker"), "The <mark>mark</mark> of a <mark>marker</mark>");
  // "mar" would match inside "<mark>" if terms were applied one after another
  assert.equal(hl("mark it", "mark mar ark"), "<mark>mark</mark> it");
  assert.doesNotMatch(hl("level transitions", "level transitions mark"), /<mark>[^<]*<mark>|<<mark>/);
  assert.equal(hl("a & b", "amp"), "a &amp; b");
  assert.equal(hl('x "q"', "quot"), "x &quot;q&quot;");
  assert.equal(hl("Set 3 SUBSET-026", "subset-026"), "Set 3 <mark>SUBSET-026</mark>");
  assert.equal(hl("<b>", ""), "&lt;b&gt;");
});
