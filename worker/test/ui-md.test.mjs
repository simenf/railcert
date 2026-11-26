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
vm.runInContext(`${pure}\n${hlSrc}\nglobalThis.__t = { mdInline, mdRender, hl, quoteRe, markQuotes, sourceMapSvg, mapEdges };`, ctx);
const { mdInline, mdRender, hl, quoteRe, markQuotes, sourceMapSvg, mapEdges } = ctx.__t;

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

// ---------- answer presentation v2 ----------
const cites3 = new Map([1, 2, 3].map((n) => [n, { n, chunk_id: 10 + n, short_name: `Doc ${n}`, locator: `Art. ${n}`, page_start: n, file_url: `/files/d${n}.pdf#page=${n}`, official_url: "https://eur-lex.europa.eu/x" }]));
const quotes = (list) => list.map((q) => ({ ...q, re: quoteRe(q.quote), used: false }));

test("a citation becomes a superscript link that hugs the word before it", () => {
  const h = mdInline("the TSIs [2].", cites3);
  assertSane(h);
  assert.equal(h, 'the TSIs<sup class="cs c-2"><a class="cite" href="/files/d2.pdf#page=2" aria-label="Source 2 Doc 2, Art. 2 · p. 2">2</a></sup>.');
});

test("neighbouring citations merge into one superscript; runs of three become a range", () => {
  const a = mdInline("claim [1][2][3]", cites3);
  assertSane(a);
  assert.match(a, /<sup class="cs c-1 c-2 c-3"><a class="cite" href="\/files\/d1\.pdf#page=1" aria-label="Sources 1 Doc 1[^"]*">1–3<\/a><\/sup>$/);
  assert.equal((a.match(/<sup/g) || []).length, 1);
  assert.match(mdInline("x [1, 3] [2]", cites3), />1–3<\/a>/);
  assert.match(mdInline("x [3][1]", cites3), />1,3<\/a>/);
});

test("unknown citation numbers are marked, never linked", () => {
  const h = mdInline("x [2][9]", cites3);
  assertSane(h);
  assert.match(h, /<sup class="cs c-2"><a class="cite"[^>]*>2<\/a><span class="cite bad" title="[^"]*">,9<\/span><\/sup>/);
  assert.doesNotMatch(mdInline("y [9]", cites3), /<a /);
});

test("while streaming, numbers render as plain superscripts", () => {
  const h = mdRender("Text [1][2] and [5].", "live");
  assertSane(h);
  assert.equal(h, '<p>Text<sup class="cs pending">1,2</sup> and<sup class="cs pending">5</sup>.</p>');
});

test("mermaid fences become an escaped diagram slot; other fences stay code", () => {
  const h = mdRender('Intro\n\n```mermaid\nflowchart TD\n  A["<img src=x onerror=alert(1)> (1)"] --> B\n```\n\n```js\n<b>x</b>\n```', cites3);
  assertSane(h);
  assert.match(h, /<div class="mmd"><pre class="mmd-src"><code>flowchart TD\n  A\[&quot;&lt;img src=x onerror=alert\(1\)&gt; \(1\)&quot;\] --&gt; B<\/code><\/pre><\/div>/);
  assert.match(h, /<pre><code>&lt;b&gt;x&lt;\/b&gt;<\/code><\/pre>/);
  assert.doesNotMatch(h, /<img|<b>/);
});

test("an unclosed fence (mid-stream) renders as code to the end, never as markup", () => {
  const h = mdRender("A [1]\n\n```mermaid\nflowchart LR\n  A --> B[\"**x** [2]\"]", "live");
  assertSane(h);
  assert.match(h, /<div class="mmd"><pre class="mmd-src"><code>flowchart LR\n  A --&gt; B\[&quot;\*\*x\*\* \[2\]&quot;\]<\/code><\/pre><\/div>$/);
});

test("checked quotes are marked inline: a tick when verified, an amber span when not", () => {
  const qs = quotes([
    { quote: "shall carry out an independent assessment", ok: true, n: 1 },
    { quote: "this sentence was never in the source", ok: false, n: 2 },
    { quote: "a quote that is not in the answer at all", ok: false, n: 3 },
  ]);
  const h = mdRender("It “shall carry out an  independent-assessment” [1]. Also \"this sentence was never in the source\" [2].", cites3, { quotes: qs });
  assertSane(h);
  assert.match(h, /<span class="q ok">shall carry out an  independent-assessment”<\/span><span class="qv" title="Quote verified against source 1"><span class="sr"> \(quote verified\)<\/span><\/span><sup class="cs c-1">/);
  assert.match(h, /<span class="q bad c-2" title="[^"]*">this sentence was never in the source&quot;<span class="sr">[^<]*<\/span><\/span><sup class="cs c-2">/);
  assert.deepEqual(qs.map((q) => q.used), [true, true, false]);
});

test("quote marking cannot inject markup", () => {
  const qs = quotes([{ quote: "<script>alert(1)</script> is quoted here", ok: false, n: 1 }]);
  const h = mdRender("He said <script>alert(1)</script> is quoted here [1].", cites3, { quotes: qs });
  assertSane(h);
  assert.doesNotMatch(h, /<script/);
  assert.ok(qs[0].used);
});

test("markQuotes escapes the excerpt and highlights the quoted words", () => {
  assert.equal(markQuotes('A <b> "shall verify the file" & more', ["shall verify the file"]), 'A &lt;b&gt; &quot;<mark>shall verify the file&quot;</mark> &amp; more');
  assert.equal(markQuotes("nothing here", ["not present at all"]), "nothing here");
});

test("source map: escaped labels, encoded file paths, nothing drawn without edges", () => {
  const nodes = [
    { path: "a/Dir 2016.pdf", label: 'Dir <x onclick="1">', cited: true, ns: [1, 2], level: 0 },
    { path: "b/c.pdf", label: "CSM RA", cited: false, ns: [], level: 1 },
  ];
  assert.equal(sourceMapSvg({ nodes, edges: [] }, false, "t"), "");
  const svg = sourceMapSvg({ nodes, edges: [{ from: "b/c.pdf", to: "a/Dir 2016.pdf", mentions: 3 }] }, false, "t");
  assert.match(svg, /href="\/files\/a\/Dir%202016\.pdf"/);
  assert.match(svg, /Dir &lt;x onclick=&quot;1&quot;&gt;/);
  assert.doesNotMatch(svg, /<x /);
  assert.match(svg, /marker-end="url\(#t-ah\)"/);
});

test("source map edges are thinned to each node's strongest three", () => {
  const nodes = Array.from({ length: 8 }, (_, i) => ({ path: `p${i}`, label: `D${i}`, level: i % 4 }));
  const edges = [];
  for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) if (i !== j) edges.push({ from: `p${i}`, to: `p${j}`, mentions: i * 8 + j });
  const { edges: kept, total } = mapEdges({ nodes, edges });
  assert.equal(total, 56);
  assert.ok(kept.length <= 24 && kept.length >= 8, `kept ${kept.length}`);
  assert.ok(kept.some((e) => e.from === "p7" && e.to === "p6"), "strongest edge kept");
});
