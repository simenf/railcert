import { beforeAll, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import type { Env } from "../src/env";
import { type Citation, _resetDocCache, getDocs } from "../src/docs";
import { MAX_BRIDGES, MAX_NODES, buildSourceMap, classifyDoc, nodeLabel } from "../src/sourcemap";
import { DOCS, loadFixture } from "./fixture";

const E = env as unknown as Env;
const P = Object.fromEntries(DOCS.map((d) => [d[0], d[1]])) as Record<number, string>;
const cite = (n: number, doc_path: string) => ({ n, chunk_id: n, doc_path }) as unknown as Citation;
const guide = (i: number) => `06_ERA_Guides/Extra/guide_${String(i).padStart(2, "0")}.pdf`;
const bridge = (i: number) => `09_Referenced_Documents/EU_Acts/Dec_2000-${i}.pdf`;

beforeAll(async () => {
  await loadFixture(E.DB);
  const ins: D1PreparedStatement[] = [];
  const doc = (id: number, path: string, area: string, title: string, ref: string | null, short: string | null, status = "in_force") =>
    E.DB.prepare(
      "INSERT INTO docs (id, path, folder, filename, title, reference, short_name, status, area) VALUES (?,?,?,?,?,?,?,?,?)",
    ).bind(id, path, path.split("/").slice(0, -1).join("/"), path.split("/").pop(), title, ref, short, status, area);
  for (let i = 0; i < 20; i++) ins.push(doc(100 + i, guide(i), "ERA_Guides", `ERA guide ${i}`, null, `Guide ${i}`));
  for (let i = 0; i < 6; i++) ins.push(doc(200 + i, bridge(i), "Referenced_Documents", `2000/${i}/EC: Commission Decision of 1 May 2000 on things`, "CELEX 3200D000" + i, null));
  const edge = (from: string, to: string, m: number) =>
    E.DB.prepare("INSERT INTO edges (citing_path, cited_id, mentions, cited_path) VALUES (?,?,?,?)").bind(from, `id:${to}`, m, to);
  // samtrafikkforskriften → CCS TSI → SUBSET-026: CCS TSI bridges two cited docs
  ins.push(edge(P[4], P[1], 3), edge(P[1], P[3], 20));
  // the repealed CCS TSI bridges the same pair but ranks lower
  ins.push(edge(P[4], P[6], 1), edge(P[6], P[3], 5));
  // a duplicate copy of the Directive: collapses onto the canonical path (two rows add up)
  ins.push(edge(P[4], P[7], 2), edge(P[4], P[2], 1));
  // guides 0..5 each bridge guide 10 → guide 11; guide 0 → guide 1 is a bridge-to-bridge edge
  for (let i = 0; i < 6; i++) ins.push(edge(guide(10), bridge(i), 1 + i), edge(bridge(i), guide(11), 1 + i));
  ins.push(edge(bridge(0), bridge(1), 4));
  // two versions of one act, linked only through a hub: no bridge for them
  ins.push(doc(300, "01_EU_Framework/Dir_X.pdf", "EU_Framework", "Directive X", "Directive (EU) 2099/1", "Dir X"));
  ins.push(doc(301, "01_EU_Framework/Dir_X_consolidated.pdf", "EU_Framework", "Directive X - consolidated text", "Directive (EU) 2099/1 (consolidated)", "Dir X (consolidated)", "consolidated"));
  ins.push(edge("01_EU_Framework/Dir_X_consolidated.pdf", guide(15), 9), edge(guide(15), "01_EU_Framework/Dir_X.pdf", 9));
  // an edge to something outside the map
  ins.push(edge(P[2], guide(19), 1));
  await E.DB.batch(ins);
  _resetDocCache();
});

describe("classification", () => {
  it("puts documents on the legal hierarchy", async () => {
    const docs = await getDocs(E);
    const c = (p: string) => classifyDoc(docs.byPath.get(p)!);
    expect(c(P[2])).toEqual({ kind: "act", level: 0 });
    expect(c(P[1])).toEqual({ kind: "act", level: 1 });
    expect(c(guide(0))).toEqual({ kind: "guide", level: 2 });
    expect(c(P[4])).toEqual({ kind: "national", level: 2 });
    expect(c(P[3])).toEqual({ kind: "spec", level: 3 });
    expect(c(P[5])).toEqual({ kind: "national", level: 3 });
    expect(c(bridge(0))).toEqual({ kind: "act", level: 1 });
    expect(nodeLabel(docs.byPath.get(bridge(3))!)).toBe("2000/3/EC");
    expect(nodeLabel(docs.byPath.get(P[1])!)).toBe("CCS TSI");
  });
});

describe("source_map", () => {
  it("links cited documents with bridges, collapses duplicates and keeps edges inside the map", async () => {
    const docs = await getDocs(E);
    const map = (await buildSourceMap(E, docs, [cite(1, P[4]), cite(2, P[3]), cite(3, P[7]), cite(4, P[4])]))!;
    expect(map.nodes.map((n) => [n.path, n.cited, n.ns])).toEqual([
      [P[4], true, [1, 4]],
      [P[3], true, [2]],
      [P[2], true, [3]], // the duplicate copy is shown as the canonical Directive
      [P[1], false, []],
      [P[6], false, []],
    ]);
    expect(map.nodes[0]).toMatchObject({ label: "Samtrafikkforskriften", area: "Norway", status: "in_force", kind: "national", level: 2 });
    expect(map.nodes[2]).toMatchObject({ label: "Interoperability Directive", kind: "act", level: 0 });
    const edges = map.edges.map((e) => `${e.from}>${e.to}:${e.mentions}`).sort();
    expect(edges).toEqual(
      [`${P[1]}>${P[3]}:20`, `${P[1]}>${P[2]}:12`, `${P[4]}>${P[1]}:3`, `${P[4]}>${P[2]}:3`, `${P[4]}>${P[6]}:1`, `${P[6]}>${P[3]}:5`].sort(),
    );
    const paths = new Set(map.nodes.map((n) => n.path));
    for (const e of map.edges) expect(paths.has(e.from) && paths.has(e.to)).toBe(true);
  });

  it("adds at most 4 bridges, including bridge-to-bridge edges", async () => {
    const docs = await getDocs(E);
    const map = (await buildSourceMap(E, docs, [cite(1, guide(10)), cite(2, guide(11))]))!;
    const bridges = map.nodes.filter((n) => !n.cited);
    expect(bridges).toHaveLength(MAX_BRIDGES);
    // strongest first (mentions from guide 10 grow with i)
    expect(bridges.map((n) => n.path)).toEqual([bridge(5), bridge(4), bridge(3), bridge(2)]);
    expect(map.edges.every((e) => e.from !== bridge(0) && e.to !== bridge(0))).toBe(true);
    const m2 = (await buildSourceMap(E, docs, [cite(1, guide(10)), cite(2, guide(11)), cite(3, bridge(0))]))!;
    expect(m2.edges.some((e) => e.from === bridge(0) && e.to === bridge(1) && e.mentions === 4)).toBe(true);
  });

  it("does not bridge two versions of the same act", async () => {
    const docs = await getDocs(E);
    const map = (await buildSourceMap(E, docs, [cite(1, "01_EU_Framework/Dir_X.pdf"), cite(2, "01_EU_Framework/Dir_X_consolidated.pdf")]))!;
    expect(map.nodes.map((n) => n.label)).toEqual(["Dir X", "Dir X (consolidated)"]);
    expect(map.edges).toEqual([]);
  });

  it("caps the map at 14 nodes", async () => {
    const docs = await getDocs(E);
    const many = Array.from({ length: 18 }, (_, i) => cite(i + 1, guide(i)));
    const map = (await buildSourceMap(E, docs, many))!;
    expect(map.nodes).toHaveLength(MAX_NODES);
    expect(map.nodes.every((n) => n.cited)).toBe(true);
    expect(map.nodes.map((n) => n.ns[0])).toEqual(Array.from({ length: 14 }, (_, i) => i + 1));
  });

  it("is omitted with fewer than 2 nodes", async () => {
    const docs = await getDocs(E);
    expect(await buildSourceMap(E, docs, [cite(1, P[2]), cite(2, P[7])])).toBeUndefined();
    expect(await buildSourceMap(E, docs, [])).toBeUndefined();
  });
});
