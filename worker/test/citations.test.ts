import { describe, expect, it } from "vitest";
import { Citer, checkQuotes, extractQuotes, normaliseForQuote, quoteInText, renumberCitations, type SourceInfo } from "../src/citations";

const src = (id: number): SourceInfo => ({
  chunk_id: id, doc_path: `d/${id}.pdf`, doc_title: "T", short_name: "S", reference: null, status: "in_force", area: "TSI",
  ertms_set: null, locator: null, heading: null, page_start: 1, page_end: 1, inner_file: null, anchor: null, file_url: null, official_url: null,
});
const allowed = new Map([10, 20, 30].map((id) => [id, src(id)]));

describe("citation renumbering", () => {
  it("numbers by first appearance and drops unseen ids", () => {
    const r = renumberCitations("A [c:20]. B [c:10][c:20]. C [c:99]. D [c:30, c:10] E [c: 10; 99].", allowed);
    expect(r.text).toBe("A [1]. B [2][1]. C. D [3][2] E [2].");
    expect(r.citations.map((c) => [c.n, c.chunk_id])).toEqual([[1, 20], [2, 10], [3, 30]]);
  });
  it("streams with partial citations split across chunks", () => {
    const c = new Citer(allowed);
    const parts = ["Fact one [", "c", ":3", "0] and two [c:1", "0][c:", "77] end", " [c:"];
    let out = parts.map((p) => c.push(p)).join("");
    out += c.flush();
    expect(out).toBe("Fact one [1] and two [2] end [c:");
    expect(c.citations().map((x) => x.chunk_id)).toEqual([30, 10]);
  });
  it("does not hold back ordinary brackets for long", () => {
    const c = new Citer(allowed);
    expect(c.push("see [Annex II] now")).toBe("see [Annex II] now");
  });
});

describe("quote checks", () => {
  const text = "The designated body (DeBo) shall be responsible for the verifi-\ncation of national rules notified in accordance with Article 14.";
  it("normalises quotes, hyphens and whitespace", () => {
    expect(normaliseForQuote("“A  b”\n– c")).toBe("a b-c");
    expect(quoteInText("shall be responsible for the verification of national rules", text)).toBe(true);
    expect(quoteInText("The designated body … notified in accordance with Article 14", text)).toBe(true);
    expect(quoteInText("shall be responsible for the approval of national rules", text)).toBe(false);
  });
  it("extracts quotes of >= 6 words followed by a citation", () => {
    const raw = 'It says “the DeBo shall be responsible for the verification” [c:10]. Short "two words" [c:10]. "Not cited quote of many words here" alone.';
    expect(extractQuotes(raw)).toEqual([{ quote: "the DeBo shall be responsible for the verification", ids: [10] }]);
  });
  it("checks against cited chunk text only", () => {
    const raw =
      'A: "shall be responsible for the verification of national rules" [c:10]. B: "shall be responsible for the verification of national rules" [c:20]. C: "made up words that never appear anywhere" [c:10]. D: «shall be responsible for the verification» [c:99].';
    const checks = checkQuotes(raw, new Map([[10, text], [20, "other"]]), new Set(allowed.keys()));
    expect(checks.map((c) => [c.chunk_id, c.ok])).toEqual([[10, true], [20, false], [10, false], [null, false]]);
  });
});
