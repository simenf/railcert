/** Answer post-processing: the FOLLOWUPS line (stream filter + parser) and source-card excerpts. */
import { normaliseForQuote } from "./citations";

const MAX_FOLLOW_UPS = 3;
const MARKER = "followups:";

/** Lower-cased line content without markdown decoration, spaces or hyphens ("**Follow-ups:**" → "followups:"). */
function squash(line: string): string {
  return line.replace(/[\s*_#>`-]/g, "").toLowerCase();
}

/** True when a complete or partial line is (or could still become) the FOLLOWUPS line. */
function mayBeMarker(partial: string): boolean {
  const c = squash(partial);
  return MARKER.startsWith(c) || c.startsWith(MARKER);
}

function isMarker(line: string): boolean {
  return squash(line).startsWith(MARKER);
}

/**
 * Streams text through, removing the `FOLLOWUPS: q1 | q2 | q3` line. A trailing partial line that
 * could still be the start of that line is held back until it is complete or clearly something else.
 */
export class FollowupFilter {
  private buf = "";
  private atLineStart = true;
  /** Raw FOLLOWUPS lines that were removed (normally one). */
  readonly lines: string[] = [];

  push(t: string): string {
    this.buf += t;
    let out = "";
    for (;;) {
      const nl = this.buf.indexOf("\n");
      if (nl < 0) break;
      const line = this.buf.slice(0, nl + 1);
      this.buf = this.buf.slice(nl + 1);
      if (this.atLineStart && isMarker(line)) this.lines.push(line.trim());
      else out += line;
      this.atLineStart = true;
    }
    if (this.buf && !(this.atLineStart && mayBeMarker(this.buf))) {
      out += this.buf;
      this.buf = "";
      this.atLineStart = false;
    }
    return out;
  }

  flush(): string {
    const rest = this.buf;
    this.buf = "";
    if (rest && this.atLineStart && isMarker(rest)) {
      this.lines.push(rest.trim());
      return "";
    }
    return rest;
  }
}

/** Parses `FOLLOWUPS: a | b | c` (also tolerates markdown decoration) into at most 3 questions. */
export function parseFollowups(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    const i = line.indexOf(":");
    if (i < 0) continue;
    for (let q of line.slice(i + 1).split("|")) {
      q = q
        .replace(/[[(]\s*c\s*:[^\])]*[\])]/gi, "")
        .replace(/[*_`]+/g, "")
        .trim()
        .replace(/^(?:\d+[.)]|[-•])\s*/, "")
        .replace(/^["“«']+|["”»']+$/g, "")
        .replace(/\s+/g, " ")
        .trim();
      if (q.length >= 4 && q.length <= 200 && !out.includes(q)) out.push(q);
      if (out.length >= MAX_FOLLOW_UPS) return out;
    }
  }
  return out;
}

/**
 * Fallback for a model that put `FOLLOWUPS:` at the end of a paragraph instead of on its own line:
 * cuts a trailing `FOLLOWUPS: …` from the text.
 */
export function splitInlineFollowups(text: string): { text: string; line: string | null } {
  const m = /(?:\*\*|__)?\bFOLLOW-?UPS(?:\*\*|__)?\s*:[^\n]*$/i.exec(text);
  if (!m) return { text, line: null };
  return { text: text.slice(0, m.index).trimEnd(), line: m[0] };
}

// ---------------------------------------------------------------- excerpts

export const EXCERPT_CHARS = 700;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Finds where a quote (or its first ellipsis segment) starts in whitespace-collapsed text, tolerating punctuation and hyphenation differences. */
function locateQuote(text: string, quote: string): { at: number; len: number } | null {
  const seg = quote.split(/\s*(?:\.\.\.|…)\s*/).find((s) => s.trim()) ?? quote;
  const words = normaliseForQuote(seg)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  if (words.length < 2) return null;
  // allow any non-letter run (spaces, quotes, "- " from line-break hyphenation) between and inside words
  const loose = (w: string) => [...w].map(escapeRe).join("(?:-\\s?)?");
  for (const n of [words.length, Math.min(words.length, 6)]) {
    const re = new RegExp(words.slice(0, n).map(loose).join("[^\\p{L}\\p{N}]+"), "iu");
    const m = re.exec(text);
    if (m) return { at: m.index, len: n === words.length ? m[0].length : Math.max(m[0].length, seg.length) };
  }
  return null;
}

/** Up to ~700 chars of the chunk text (whitespace-collapsed), centred on `quote` when it is found, else from the start. */
export function makeExcerpt(raw: string, quote?: string | null, max = EXCERPT_CHARS): string {
  const text = raw.replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  let start = 0;
  const hit = quote ? locateQuote(text, quote) : null;
  if (hit) {
    start = Math.max(0, hit.at - Math.max(0, Math.floor((max - hit.len) / 2)));
    start = Math.min(start, text.length - max);
  }
  let end = Math.min(text.length, start + max);
  // snap to word boundaries
  if (start > 0) {
    const sp = text.indexOf(" ", start);
    if (sp >= 0 && sp - start < 40 && (!hit || sp < hit.at)) start = sp + 1;
  }
  if (end < text.length) {
    const sp = text.lastIndexOf(" ", end);
    if (sp > start && end - sp < 40 && (!hit || sp >= hit.at + hit.len)) end = sp;
  }
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}
