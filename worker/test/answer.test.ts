import { describe, expect, it } from "vitest";
import { FollowupFilter, makeExcerpt, parseFollowups, splitInlineFollowups } from "../src/answer";

function streamThrough(raw: string, size: number) {
  const f = new FollowupFilter();
  let out = "";
  for (let i = 0; i < raw.length; i += size) out += f.push(raw.slice(i, i + size));
  out += f.flush();
  return { out, lines: f.lines };
}

describe("FOLLOWUPS line", () => {
  const raw = "Direct answer.\n\n- Fine point\n\nFollow the rule.\n\nFOLLOWUPS: What about wagons? | Hva med kjøretøy? | Which TSI applies?";
  it("strips the line from streamed text at every split, keeping everything else", () => {
    for (const size of [1, 2, 3, 4, 7, 9, 13, 1000]) {
      const { out, lines } = streamThrough(raw, size);
      expect(out, `chunk size ${size}`).toBe("Direct answer.\n\n- Fine point\n\nFollow the rule.\n\n");
      expect(lines).toHaveLength(1);
      expect(parseFollowups(lines)).toEqual(["What about wagons?", "Hva med kjøretøy?", "Which TSI applies?"]);
    }
  });
  it("handles markdown decoration, a trailing newline and more than 3 questions", () => {
    const { out, lines } = streamThrough("Answer [c:1].\n**Follow-ups:** 1. One question? | - Two question? | “Three question?” | Four? [c:2]\n", 5);
    expect(out).toBe("Answer [c:1].\n");
    expect(parseFollowups(lines)).toEqual(["One question?", "Two question?", "Three question?"]);
  });
  it("does not hold back or drop lines that only start like the marker", () => {
    const f = new FollowupFilter();
    expect(f.push("Follow the procedure")).toBe("Follow the procedure");
    expect(f.push("\nFol")).toBe("\n");
    expect(f.push("lowing that")).toBe("Following that");
    expect(f.flush()).toBe("");
    expect(f.lines).toEqual([]);
  });
  it("cuts an inline FOLLOWUPS tail from the final answer", () => {
    expect(splitInlineFollowups("Answer here. FOLLOWUPS: a? | b?")).toEqual({ text: "Answer here.", line: "FOLLOWUPS: a? | b?" });
    expect(splitInlineFollowups("No marker")).toEqual({ text: "No marker", line: null });
  });
});

describe("excerpt", () => {
  const filler = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");
  const text = `${filler(150)}\n\n  The designated body (DeBo) shall be responsible for the verifi-\ncation of national rules.   ${filler(150)}`;
  it("collapses whitespace and returns short texts whole", () => {
    expect(makeExcerpt("  a \n\n b\tc  ")).toBe("a b c");
  });
  it("starts at the chunk start without a quote", () => {
    const e = makeExcerpt(text);
    expect(e.startsWith("word0 word1")).toBe(true);
    expect(e.endsWith("…")).toBe(true);
    expect(e.length).toBeLessThanOrEqual(701);
  });
  it("centres on the verified quote, across hyphenation", () => {
    const e = makeExcerpt(text, "shall be responsible for the verification of national rules");
    expect(e.startsWith("…")).toBe(true);
    expect(e.endsWith("…")).toBe(true);
    expect(e).toContain("shall be responsible for the verifi- cation of national rules");
    const at = e.indexOf("shall be");
    expect(at).toBeGreaterThan(200);
    expect(at).toBeLessThan(450);
    expect(e.length).toBeLessThanOrEqual(702);
  });
  it("falls back to the start when the quote is not found", () => {
    expect(makeExcerpt(text, "nothing like this appears").startsWith("word0")).toBe(true);
  });
});
