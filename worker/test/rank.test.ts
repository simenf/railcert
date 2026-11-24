import { describe, expect, it } from "vitest";
import { makeSnippet, rrf, sortByScore } from "../src/rank";

describe("RRF", () => {
  it("sums 1/(k+rank) over lists", () => {
    const s = rrf([{ ids: [1, 2, 3] }, { ids: [3, 1] }]);
    expect(s.get(1)).toBeCloseTo(1 / 61 + 1 / 62);
    expect(s.get(3)).toBeCloseTo(1 / 63 + 1 / 61);
    expect(s.get(2)).toBeCloseTo(1 / 62);
    expect(sortByScore(s)).toEqual([1, 3, 2]);
  });
  it("applies weights and ignores repeated ids within a list", () => {
    const s = rrf([{ ids: [5, 5, 6], weight: 2 }]);
    expect(s.get(5)).toBeCloseTo(2 / 61);
    expect(s.get(6)).toBeCloseTo(2 / 62);
  });
  it("empty input", () => {
    expect(rrf([]).size).toBe(0);
  });
});

describe("snippets", () => {
  it("windows around matches", () => {
    const text = `${"lorem ipsum ".repeat(60)}the DeBo shall verify national rules ${"dolor sit ".repeat(60)}`;
    const s = makeSnippet(text, ["debo", "national"], 120);
    expect(s).toContain("DeBo");
    expect(s.startsWith("…")).toBe(true);
    expect(s.length).toBeLessThan(130);
  });
  it("returns short texts unchanged", () => {
    expect(makeSnippet("short  text", ["x"])).toBe("short text");
  });
});
