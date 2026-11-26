/**
 * Query parsing and FTS5 MATCH-expression building.
 *
 * The FTS table uses `unicode61 remove_diacritics 2 tokenchars './-'`, so `2023/1695`, `SUBSET-026`,
 * `3.5.3.7` and `art.` are single tokens, while `(`, `)`, `§`, `,` and quotes are separators.
 * Every term we emit is a double-quoted FTS5 string (so user input can never inject FTS5 syntax:
 * AND/OR/NOT/NEAR, `*`, `^`, `:`, `{}`, parentheses); the only operators in the output are ours.
 */

export interface Term {
  /** Space-separated tokens; one token = word, several = phrase. Never contains `"`. */
  text: string;
  prefix: boolean;
  /** Index of the whitespace-separated word this term came from. */
  word: number;
}

export interface Group {
  /** Terms that must all match (AND) ... */
  terms: Term[];
  /** ... or any of these alternative phrases (alias expansion). */
  alts: Term[];
}

const MAX_QUERY_CHARS = 500;
const MAX_TERMS = 14;

// Small English + Norwegian stop list. FTS operator words are covered too (and, or, not, near).
const STOP = new Set(
  (
    "a an and are as at be been but by can could did do does for from had has have how i if in into is it its " +
    "may me must my near no nor not of on or our shall should so such than that the their them then there these " +
    "they this those to under upon us was we were what when where which who whom why will with within would you your " +
    "about any all also between each other per via whether " +
    "og i på er en et av for til med som det den de at om eller ikke skal kan må har ved fra hva hvordan hvilke hvilken " +
    "hvem hvor når etter under over seg sin sitt sine vi jeg du dere denne dette disse noe noen også mellom"
  ).split(/\s+/),
);

/** Letters, digits and marks, with internal `.`, `/`, `-` (the FTS tokenchars) kept. */
const TOKEN_RE = /[\p{L}\p{N}\p{M}]+(?:[./-]+[\p{L}\p{N}\p{M}]+)*/gu;

export function normaliseQueryText(q: string): string {
  return (q ?? "")
    .normalize("NFKC")
    .slice(0, MAX_QUERY_CHARS)
    .replace(/[‐-―−]/g, "-") // unicode dashes
    .replace(/­/g, "") // soft hyphen
    .replace(/[\u0000-\u001f\u007f]/g, " ");
}

/** Whitespace-separated words, each split into FTS tokens. */
export function tokenizeWords(q: string): string[][] {
  const words = normaliseQueryText(q).split(/\s+/).filter(Boolean);
  return words.map((w) => (w.toLowerCase().match(TOKEN_RE) ?? []).map((t) => t));
}

function isDigits(t: string): boolean {
  return /^\p{N}+$/u.test(t);
}

function hasPunct(t: string): boolean {
  return /[./-]/.test(t);
}

/** Light English plural folding so `requirements` also finds `requirement` (and, via prefix, both). */
function stem(t: string): string {
  if (t.length > 4 && /[a-z]s$/.test(t) && !/(ss|us|is)$/.test(t)) return t.slice(0, -1);
  return t;
}

function termFromTokens(tokens: string[], word: number): Term | null {
  const toks = tokens.map((t) => t.replace(/"/g, "")).filter(Boolean);
  if (!toks.length) return null;
  if (toks.length === 1) {
    const t = toks[0];
    if (isDigits(t)) return { text: t, prefix: false, word };
    if (hasPunct(t)) return { text: t, prefix: true, word }; // `2023/1695.`, `3.5.3.7.1`, `subset-026-1`
    if (t.length >= 3) return { text: stem(t), prefix: true, word };
    return { text: t, prefix: false, word };
  }
  // Phrase from one word like `15(8)` -> "15 8". Prefix on the last token only when it is wordy.
  const last = toks[toks.length - 1];
  return { text: toks.join(" "), prefix: !isDigits(last) && last.length >= 3, word };
}

/** Query -> list of terms (stop words dropped; if *only* stop words, keep them). */
export function parseTerms(q: string): Term[] {
  const words = tokenizeWords(q);
  const out: Term[] = [];
  const all: Term[] = [];
  words.forEach((toks, i) => {
    if (!toks.length) return;
    const t = termFromTokens(toks, i);
    if (!t) return;
    all.push(t);
    if (toks.length === 1 && STOP.has(toks[0])) return;
    out.push(t);
  });
  const res = out.length ? out : all;
  // de-duplicate
  const seen = new Set<string>();
  return res
    .filter((t) => {
      const k = t.text + (t.prefix ? "*" : "");
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, MAX_TERMS);
}

export function renderTerm(t: Term): string {
  const text = t.text.replace(/"/g, "");
  if (t.prefix) return `"${text}"*`;
  // `.` is a token character, so a word at the end of a sentence is indexed as "word." — match both.
  if (!text.includes(" ") && !/[./-]$/.test(text)) return `("${text}" OR "${text}.")`;
  return `"${text}"`;
}

function renderGroup(g: Group): string {
  const main = g.terms.map(renderTerm);
  const mainExpr = main.length > 1 ? `(${main.join(" AND ")})` : main[0];
  if (!g.alts.length) return mainExpr ?? "";
  const parts = [mainExpr, ...g.alts.map(renderTerm)].filter(Boolean);
  return parts.length > 1 ? `(${parts.join(" OR ")})` : parts[0];
}

/** Build a MATCH expression. `op` joins the groups. Returns "" when nothing is searchable. */
export function buildMatch(groups: Group[], op: "AND" | "OR"): string {
  const parts = groups.map(renderGroup).filter((s) => s.length > 0);
  if (!parts.length) return "";
  return parts.join(` ${op} `);
}

/** Convenience: plain query -> MATCH (no alias expansion). */
export function sanitizeFtsQuery(q: string, op: "AND" | "OR" = "AND"): string {
  return buildMatch(
    parseTerms(q).map((t) => ({ terms: [t], alts: [] })),
    op,
  );
}

/** Terms -> FTS MATCH restricted to one column, e.g. `locator : ("3.5.3.7"*)`. */
export function columnMatch(column: "text" | "heading" | "locator", terms: Term[]): string {
  if (!terms.length) return "";
  return `${column} : (${terms.map(renderTerm).join(" AND ")})`;
}

/** Candidate alias strings: lower-cased 1..5-word n-grams with outer punctuation trimmed. */
export function aliasCandidates(q: string): { alias: string; start: number; end: number }[] {
  const words = normaliseQueryText(q)
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/^[\s"'“”‘’«»(\[{,;:!?]+|[\s"'“”‘’«»)\]},;:!?.]+$/g, ""));
  const out: { alias: string; start: number; end: number }[] = [];
  for (let i = 0; i < words.length; i++) {
    for (let n = 1; n <= 5 && i + n <= words.length; n++) {
      const slice = words.slice(i, i + n);
      if (slice.some((w) => !w)) break;
      const a = slice.join(" ");
      if (a.length < 2 || a.length > 120) continue;
      if (n === 1 && STOP.has(a)) continue;
      out.push({ alias: a, start: i, end: i + n });
    }
  }
  return out.slice(0, 80);
}

// ---------------------------------------------------------------- locators and identifiers

/** Canonical comparison key for locators: "Art. 15(8)" -> "art15(8)", "§ 3.5.3.7" -> "3.5.3.7". */
export function normLocator(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‐-―−]/g, "-")
    .replace(/^\s*(article|artikkel|artikel|art)\.?\s*/, "art")
    .replace(/^\s*(vedlegg)\s*/, "annex")
    .replace(/^\s*(trv)[\s:_-]*/, "trv-")
    .replace(/[§\s]/g, "")
    .replace(/[.,;:]+$/, "");
}

/** Locators mentioned in a query (normalised keys + the raw text for FTS). */
export function extractLocators(q: string): { key: string; raw: string }[] {
  const s = normaliseQueryText(q);
  const out: { key: string; raw: string }[] = [];
  const push = (raw: string) => {
    const key = normLocator(raw);
    if (key && !out.some((o) => o.key === key)) out.push({ key, raw });
  };
  for (const m of s.matchAll(/\b(?:art(?:icle|ikkel|ikel)?|art\.)\s*\.?\s*(\d+[a-z]?)((?:\s?\((?:\d+[a-z]?|[a-z]{1,4})\))*)/gi)) {
    push(`Art. ${m[1]}${m[2].replace(/\s+/g, "")}`);
  }
  for (const m of s.matchAll(/§\s*(\d+(?:[-.]\d+)*[a-z]?)/gi)) push(`§${m[1]}`);
  for (const m of s.matchAll(/\bTRV[\s:_-]?(\d{4,6})\b/gi)) push(`TRV-${m[1]}`);
  for (const m of s.matchAll(/\b(?:annex|vedlegg)\s+([IVXLC]+|[A-Z]|\d+)\b(?![./-]\d)/gi)) push(`Annex ${m[1]}`);
  for (const m of s.matchAll(/\bappendix\s+([A-Z]|\d+|[IVX]+)\b/gi)) push(`Appendix ${m[1]}`);
  // Bare clause numbers like 3.5.3.7 or 4.2.2.5 (not dates, not act numbers like 2016/797).
  for (const m of s.matchAll(/(?<![\w./-])(\d{1,2}(?:\.\d{1,3}){1,7})(?![\w/-]|\.\d)/g)) {
    if (!/§\s*$/.test(s.slice(0, m.index))) push(m[1]);
  }
  return out.slice(0, 6);
}

type Seq = (string | number)[];

function seq(key: string): Seq {
  return (key.match(/[a-z]+|\d+/g) ?? []).map((p) => (/^\d+$/.test(p) ? Number(p) : p));
}

function cmpSeq(a: Seq, b: Seq): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] === b[i]) continue;
    if (typeof a[i] === "number" && typeof b[i] === "number") return (a[i] as number) - (b[i] as number);
    return String(a[i]) < String(b[i]) ? -1 : 1;
  }
  return a.length - b.length;
}

/** "Art. 15(7)–(9)" → ["art15(7)", "art15(9)"]; "§ 1-1–1-3" → ["1-1", "1-3"]; "TRV-07111–07117" → ["trv-07111", "trv-07117"]. */
export function locatorRange(raw: string | null | undefined): [string, string] | null {
  if (!raw) return null;
  const parts = raw.split(/\s*[–—]\s*/);
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const k1 = normLocator(parts[0]);
  let second = parts[1].trim();
  if (second.startsWith("(")) second = k1.replace(/\(.*$/, "") + second;
  let k2 = normLocator(second);
  const lead = /^[a-z]+-?/.exec(k1)?.[0];
  if (lead && /^\d/.test(k2)) k2 = lead + k2;
  return k1 && k2 ? [k1, k2] : null;
}

/**
 * How well a chunk locator matches the query locators: 2 = exact, 1.5 = inside a range
 * ("Art. 15(7)–(9)" contains Art. 15(8)), 1 = parent/child, 0 = none.
 */
export function locatorMatch(chunkLocator: string | null | undefined, keys: string[]): number {
  if (!chunkLocator || !keys.length) return 0;
  const range = locatorRange(chunkLocator);
  const ends = range ?? [normLocator(chunkLocator)];
  let best = 0;
  const boundary = (longer: string, shorter: string) => longer.startsWith(shorter) && /^[.(\-]/.test(longer.slice(shorter.length));
  for (const k of keys) {
    for (const c of ends) {
      if (!c) continue;
      if (c === k) return 2;
      if (boundary(c, k) || boundary(k, c)) best = Math.max(best, 1);
    }
    if (range) {
      const [a, b] = range.map(seq);
      const ks = seq(k);
      let common = 0;
      while (common < Math.min(a.length, b.length) && a[common] === b[common]) common++;
      const sameFamily = common > 0 && ks.slice(0, common).every((x, i) => x === a[i]);
      if (sameFamily && cmpSeq(a, ks) <= 0 && cmpSeq(ks, b) <= 0) best = Math.max(best, 1.5);
    }
  }
  return best;
}

/** Document identifiers in a query: SUBSET-026, 2023/1695, FOR-2021-09-09-2742, EN 50126-1, ERA/GUI/… */
export function extractIdentifiers(q: string): string[] {
  const s = normaliseQueryText(q);
  const out = new Set<string>();
  for (const m of s.matchAll(/\b(?:SUBSET|SS)[\s-]?(\d{3})((?:-\d+)*)\b/gi)) out.add(`subset-${m[1]}${m[2]}`.toLowerCase());
  for (const m of s.matchAll(/\b((?:19|20)\d{2})\/(\d{1,4})\b/g)) out.add(`${m[1]}/${m[2]}`);
  for (const m of s.matchAll(/\b(\d{1,4})\/((?:19|20)\d{2})\b/g)) out.add(`${m[1]}/${m[2]}`);
  for (const m of s.matchAll(/\b(\d{2})\/(\d{1,4})\/(EC|EEC|EU|EF)\b/gi)) out.add(`${m[1]}/${m[2]}`);
  for (const m of s.matchAll(/\b((?:FOR|LOV)-\d{4}-\d{2}-\d{2}-\d+)\b/gi)) out.add(m[1].toLowerCase());
  // ETSI numbers are written "EN 301 515" / "TS 124 008" but file names use "301515"
  const etsi = new Set<string>();
  for (const m of s.matchAll(/\b(EN|ES|TS|TR)\s(\d{3})\s(\d{3})\b/g)) {
    etsi.add(m[0]);
    out.add(`${m[1].toLowerCase()} ${m[2]}${m[3]}`);
  }
  for (const m of s.matchAll(/\b((?:EN|IEC|ISO|CLC\/TS|CLC\/TR|CLC|TS|TR)\s?\d{3,6}(?:-\d+)*)\b/g)) {
    if (![...etsi].some((e) => e.startsWith(m[1]))) out.add(m[1].toLowerCase());
  }
  for (const m of s.matchAll(/\b(ERA[\/_-][A-Z0-9][A-Z0-9\/_.-]{2,40})\b/gi)) out.add(m[1].toLowerCase());
  for (const m of s.matchAll(/\bTRV[\s:_-]?(\d{4,6})\b/gi)) out.add(`trv-${m[1]}`);
  return [...out].slice(0, 8);
}

/** Identifier text compare key: lower-case, unify separators. */
export function identKey(s: string): string {
  return s.toLowerCase().replace(/[\s_]+/g, "-");
}
