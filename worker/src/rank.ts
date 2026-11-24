/** Pure ranking helpers: reciprocal rank fusion, snippets. */

export const RRF_K = 60;

export interface RankedList {
  ids: number[];
  weight?: number;
}

/** score(d) = Σ weight / (k + rank), rank 1-based; first occurrence in a list counts. */
export function rrf(lists: RankedList[], k = RRF_K): Map<number, number> {
  const scores = new Map<number, number>();
  for (const list of lists) {
    const w = list.weight ?? 1;
    const seen = new Set<number>();
    let rank = 0;
    for (const id of list.ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      rank++;
      scores.set(id, (scores.get(id) ?? 0) + w / (k + rank));
    }
  }
  return scores;
}

export function sortByScore(scores: Map<number, number>): number[] {
  return [...scores.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([id]) => id);
}

function fold(s: string): string {
  // Lower-case and strip combining marks so "forskrift" matches "Forskrift" and "é" matches "e".
  // Keeps string length mostly aligned for ASCII; we search on the folded copy and cut from the original.
  return s.toLowerCase();
}

/** A ~maxLen-char window around the densest cluster of query tokens. */
export function makeSnippet(text: string, needles: string[], maxLen = 240): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= maxLen) return clean;
  const hay = fold(clean);
  const toks = [...new Set(needles.map((n) => fold(n)).filter((n) => n.length >= 2))].slice(0, 12);
  const positions: { pos: number; tok: number }[] = [];
  toks.forEach((t, i) => {
    let from = 0;
    for (let n = 0; n < 20; n++) {
      const p = hay.indexOf(t, from);
      if (p < 0) break;
      positions.push({ pos: p, tok: i });
      from = p + t.length;
    }
  });
  let start = 0;
  if (positions.length) {
    let best = -1;
    for (const { pos } of positions) {
      const lo = pos - 60;
      const hi = lo + maxLen;
      const distinct = new Set(positions.filter((p) => p.pos >= lo && p.pos < hi).map((p) => p.tok)).size;
      if (distinct > best) {
        best = distinct;
        start = Math.max(0, lo);
      }
    }
  }
  if (start + maxLen > clean.length) start = Math.max(0, clean.length - maxLen);
  // snap to word boundaries
  if (start > 0) {
    const sp = clean.indexOf(" ", start);
    if (sp > 0 && sp - start < 20) start = sp + 1;
  }
  let end = Math.min(clean.length, start + maxLen);
  if (end < clean.length) {
    const sp = clean.lastIndexOf(" ", end);
    if (sp > start + maxLen * 0.6) end = sp;
  }
  return (start > 0 ? "…" : "") + clean.slice(start, end) + (end < clean.length ? "…" : "");
}
