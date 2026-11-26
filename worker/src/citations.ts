/** Citation renumbering ([c:id] → [n], and (c:id) → (n) inside mermaid blocks) and verbatim-quote checking. */
import type { Citation, Hit } from "./docs";

export type SourceInfo = Omit<Hit, "snippet" | "score">;

const GROUP_RE = /[ \t]*\[\s*c\s*:\s*\d+(?:\s*[,;]\s*(?:c\s*:\s*)?\d+)*\s*\]/gi;
/** `(c:12)` / `(c:12, c:40)`: the form the model uses inside mermaid labels (also accepted in prose). */
const PAREN_RE = /[ \t]*\(\s*c\s*:\s*\d+(?:\s*[,;]\s*(?:c\s*:\s*)?\d+)*\s*\)/gi;
// trailing whitespace and/or a possibly-incomplete "[c:12, " or "(c:12" tail
const PARTIAL_RE = /[ \t]*(?:[\[(]\s*(?:c\s*(?::[\s\d,;c:]*)?)?)?$/i;
/** A complete fence line (``` or ~~~, optional info string). */
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})[ \t]*([\w-]*)[^\n`]*\n?$/;
/** A trailing partial line that may still turn into a fence line. */
const PARTIAL_FENCE_RE = /^ {0,3}(?:`+|~+)[\w-]*[ \t]*$/;

function idsOf(group: string): number[] {
  return [...group.matchAll(/\d+/g)].map((m) => Number(m[0]));
}

type Fence = null | "mermaid" | "code";

/**
 * Assigns numbers in order of first appearance; ids not in `allowed` are dropped.
 * Works on whole texts (`render`) and on streams (`push` / `flush`). Inside ```mermaid blocks
 * citations become `(n)` (square brackets would break node labels); elsewhere `[n]`.
 */
export class Citer {
  private nums = new Map<number, number>();
  private buf = "";
  private fence: Fence = null;
  private atLineStart = true;
  constructor(private allowed: Map<number, SourceInfo>) {}

  private numbersFor(group: string): number[] {
    const out: number[] = [];
    for (const id of idsOf(group)) {
      if (!this.allowed.has(id)) continue;
      let n = this.nums.get(id);
      if (n == null) {
        n = this.nums.size + 1;
        this.nums.set(id, n);
      }
      if (!out.includes(n)) out.push(n);
    }
    return out;
  }

  private replaceIn(s: string, mermaid: boolean): string {
    const rep = (g: string) => {
      const out = this.numbersFor(g);
      if (!out.length) return "";
      const lead = /^[ \t]+/.exec(g)?.[0] ?? "";
      return lead + out.map((n) => (mermaid ? `(${n})` : `[${n}]`)).join("");
    };
    // one combined pass keeps numbering in order of appearance within the line
    return s.replace(new RegExp(`${GROUP_RE.source}|${PAREN_RE.source}`, "gi"), rep);
  }

  /** Processes text whose fence lines are complete (except possibly at the very end on flush). */
  private transform(s: string): string {
    let out = "";
    let i = 0;
    while (i < s.length) {
      const nl = s.indexOf("\n", i);
      const end = nl < 0 ? s.length : nl + 1;
      const line = s.slice(i, end);
      const lineStart = i === 0 ? this.atLineStart : true;
      const f = lineStart ? FENCE_RE.exec(line) : null;
      if (f && this.fence == null) {
        this.fence = f[2].toLowerCase() === "mermaid" ? "mermaid" : "code";
        out += line;
      } else if (f && !f[2] && /^[ \t]*(?:`{3,}|~{3,})[ \t]*\n?$/.test(line)) {
        this.fence = null;
        out += line;
      } else {
        out += this.replaceIn(line, this.fence === "mermaid");
      }
      i = end;
    }
    if (s.length) this.atLineStart = s.endsWith("\n");
    return out;
  }

  render(text: string): string {
    return this.transform(text);
  }

  /** Feed streamed text; returns what can be emitted now (a possibly-partial `[c:` tail or fence line is held back). */
  push(t: string): string {
    this.buf += t;
    let cut = this.buf.length;
    const m = PARTIAL_RE.exec(this.buf);
    if (m && this.buf.length - m.index < 80) cut = m.index;
    const nl = this.buf.lastIndexOf("\n");
    if (nl >= 0 || this.atLineStart) {
      const ls = nl + 1;
      if (PARTIAL_FENCE_RE.test(this.buf.slice(ls)) && this.buf.length > ls) cut = Math.min(cut, ls);
    }
    const out = this.transform(this.buf.slice(0, cut));
    this.buf = this.buf.slice(cut);
    return out;
  }

  flush(): string {
    const out = this.transform(this.buf);
    this.buf = "";
    return out;
  }

  /** The citation number assigned to a chunk id, if it was cited. */
  numberOf(id: number | null): number | null {
    return id == null ? null : (this.nums.get(id) ?? null);
  }

  citations(): Citation[] {
    return [...this.nums.entries()]
      .sort((a, b) => a[1] - b[1])
      .map(([id, n]) => ({ n, ...this.allowed.get(id)! }));
  }
}

/** One-shot helper: raw answer → { text, citations }. */
export function renumberCitations(raw: string, allowed: Map<number, SourceInfo>): { text: string; citations: Citation[] } {
  const c = new Citer(allowed);
  const text = c.render(raw);
  return { text, citations: c.citations() };
}

// ---------------------------------------------------------------- quotes

export function normaliseForQuote(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/­/g, "")
    .replace(/(\w)-\s*\n\s*(\w)/g, "$1$2") // hyphenation at line breaks
    .toLowerCase()
    .replace(/[‘’‚‛′`´"“”„‟«»‹›]/g, "")
    .replace(/'/g, "")
    .replace(/[‐-―−]/g, "-")
    .replace(/\s*-\s*/g, "-")
    .replace(/\s+([,.;:!?)\]])/g, "$1")
    .replace(/([(\[])\s+/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export interface QuoteCheck {
  quote: string;
  chunk_id: number | null;
  ok: boolean;
  /** Citation number the quote is attached to (set by the agent after renumbering). */
  n?: number | null;
}

const QUOTE_RE =
  /(?:“([^”]{8,1500})”|"([^"\n]{8,1500})"|«([^»]{8,1500})»|„([^“”]{8,1500})[“”])\s*[,.;:]?\s*\)?\s*((?:\[\s*c\s*:[^\]]*\]\s*)+)/g;

/** Finds quotes of ≥ 6 words that are followed by a [c:…] citation. */
/** Removes fenced ```mermaid blocks (diagram labels are not quotes). */
export function stripMermaid(raw: string): string {
  return raw.replace(/^ {0,3}(`{3,}|~{3,})[ \t]*mermaid\b[^\n]*\n[\s\S]*?(?:^ {0,3}\1[ \t]*$|(?![\s\S]))/gim, "");
}

export function extractQuotes(raw: string): { quote: string; ids: number[] }[] {
  const out: { quote: string; ids: number[] }[] = [];
  for (const m of stripMermaid(raw).matchAll(QUOTE_RE)) {
    const quote = (m[1] ?? m[2] ?? m[3] ?? m[4] ?? "").trim();
    if (quote.split(/\s+/).filter(Boolean).length < 6) continue;
    const ids = [...m[5].matchAll(/\d+/g)].map((x) => Number(x[0]));
    out.push({ quote, ids });
  }
  return out;
}

/** True when every ellipsis-separated segment of the quote occurs, in order, in the text. */
export function quoteInText(quote: string, text: string): boolean {
  const hay = normaliseForQuote(text);
  const segs = quote
    .split(/\s*(?:\.\.\.|…|\[\s*(?:\.\.\.|…)\s*\]|\(\s*(?:\.\.\.|…)\s*\))\s*/)
    .map(normaliseForQuote)
    .map((s) => s.replace(/^[,.;:]+|[,.;:]+$/g, "").trim())
    .filter((s) => s.length > 0);
  if (!segs.length) return false;
  let from = 0;
  for (const s of segs) {
    const i = hay.indexOf(s, from);
    if (i < 0) return false;
    from = i + s.length;
  }
  return true;
}

export function checkQuotes(raw: string, texts: Map<number, string>, allowed: Set<number>): QuoteCheck[] {
  const checks: QuoteCheck[] = [];
  for (const { quote, ids } of extractQuotes(raw)) {
    const cand = ids.filter((id) => allowed.has(id));
    const hit = cand.find((id) => quoteInText(quote, texts.get(id) ?? ""));
    checks.push({ quote, chunk_id: hit ?? cand[0] ?? null, ok: hit != null });
  }
  return checks.slice(0, 30);
}
