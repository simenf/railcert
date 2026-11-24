/** Citation renumbering ([c:id] → [n]) and verbatim-quote checking. */
import type { Citation, Hit } from "./docs";

export type SourceInfo = Omit<Hit, "snippet" | "score">;

const GROUP_RE = /[ \t]*\[\s*c\s*:\s*\d+(?:\s*[,;]\s*(?:c\s*:\s*)?\d+)*\s*\]/gi;
// trailing whitespace and/or a possibly-incomplete "[c:12, " tail
const PARTIAL_RE = /[ \t]*(?:\[\s*(?:c\s*(?::[\s\d,;c:]*)?)?)?$/i;

function idsOf(group: string): number[] {
  return [...group.matchAll(/\d+/g)].map((m) => Number(m[0]));
}

/**
 * Assigns numbers in order of first appearance; ids not in `allowed` are dropped.
 * Works on whole texts (`render`) and on streams (`push` / `flush`).
 */
export class Citer {
  private nums = new Map<number, number>();
  private buf = "";
  constructor(private allowed: Map<number, SourceInfo>) {}

  private replaceGroups(s: string): string {
    return s.replace(GROUP_RE, (g) => {
      const out: number[] = [];
      for (const id of idsOf(g)) {
        if (!this.allowed.has(id)) continue;
        let n = this.nums.get(id);
        if (n == null) {
          n = this.nums.size + 1;
          this.nums.set(id, n);
        }
        if (!out.includes(n)) out.push(n);
      }
      if (!out.length) return "";
      const lead = /^[ \t]+/.exec(g)?.[0] ?? "";
      return lead + out.map((n) => `[${n}]`).join("");
    });
  }

  render(text: string): string {
    return this.replaceGroups(text);
  }

  /** Feed streamed text; returns what can be emitted now (a possibly-partial `[c:` tail is held back). */
  push(t: string): string {
    this.buf += t;
    const m = PARTIAL_RE.exec(this.buf);
    let hold = "";
    if (m && this.buf.length - m.index < 80) {
      hold = this.buf.slice(m.index);
      this.buf = this.buf.slice(0, m.index);
    }
    const out = this.replaceGroups(this.buf);
    this.buf = hold;
    return out;
  }

  flush(): string {
    const out = this.replaceGroups(this.buf);
    this.buf = "";
    return out;
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
}

const QUOTE_RE =
  /(?:“([^”]{8,1500})”|"([^"\n]{8,1500})"|«([^»]{8,1500})»|„([^“”]{8,1500})[“”])\s*[,.;:]?\s*\)?\s*((?:\[\s*c\s*:[^\]]*\]\s*)+)/g;

/** Finds quotes of ≥ 6 words that are followed by a [c:…] citation. */
export function extractQuotes(raw: string): { quote: string; ids: number[] }[] {
  const out: { quote: string; ids: number[] }[] = [];
  for (const m of raw.matchAll(QUOTE_RE)) {
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
