/** `source_map` for the done event: how the cited documents relate, from the D1 `edges` table (never from the model). */
import type { Env } from "./env";
import type { Citation, DocIndex, DocRow } from "./docs";

export type NodeKind = "act" | "guide" | "spec" | "national" | "standard" | "other";

export interface SourceNode {
  path: string;
  label: string;
  area: string;
  status: string;
  kind: NodeKind;
  cited: boolean;
  ns: number[];
  level: number;
}

export interface SourceEdge {
  from: string;
  to: string;
  mentions: number;
}

export interface SourceMap {
  nodes: SourceNode[];
  edges: SourceEdge[];
}

export const MAX_NODES = 14;
export const MAX_BRIDGES = 4;
const MAX_PARAMS = 90;

const STANDARD_RE = /^(?:EN|prEN|IEC|ISO|CLC|CEN|CENELEC|UIC|ETSI|NS|IEEE)\b/i;

/** EU directives and regulations of the Parliament and Council (level 0) vs Commission/implementing/delegated acts (level 1). */
function isFrameworkAct(d: DocRow): boolean {
  const ref = d.reference ?? "";
  const title = (d.title ?? "").replace(/^\d{4}\/\d+\/E[CU]+:\s*/, "");
  if (/\b(?:Implementing|Delegated)\b/i.test(ref) || /^(?:Commission|Council Decision)\b/i.test(title)) return false;
  if (/European Parliament and (?:of )?the Council/i.test(title.slice(0, 200))) return true;
  if (/^(?:Decision|Dec_)/i.test(ref) || /^Dec_/i.test(d.filename)) return false;
  return /^(?:Directive|Regulation)\b/i.test(ref) || /^(?:Directive|Regulation)\b/i.test(title) || /^(?:Dir|Reg)_/i.test(d.filename);
}

/** kind + level (0 EU framework, 1 implementing/delegated acts, 2 guidance & national law, 3 specifications, 4 standards). */
export function classifyDoc(d: DocRow): { kind: NodeKind; level: number } {
  const f = d.folder;
  const name = `${d.reference ?? ""} ${d.short_name ?? ""} ${d.filename}`;
  if (/Referenced_Documents\/ETSI/i.test(f) || STANDARD_RE.test(d.reference ?? "") || STANDARD_RE.test(d.filename))
    return { kind: "standard", level: 4 };
  switch (d.area) {
    case "EU_Framework":
    case "Cybersecurity_CRA":
      if (/\b(?:guidance|guide|faq)\b/i.test(name) || /^C\(\d{4}\)/.test(d.reference ?? "")) return { kind: "guide", level: 2 };
      return { kind: "act", level: isFrameworkAct(d) ? 0 : 1 };
    case "TSI":
    case "CSM_Safety":
    case "Conformity_Assessment":
    case "Vehicle_Authorisation_Registers":
      return { kind: "act", level: 1 };
    case "ERA_Guides":
      return { kind: "guide", level: 2 };
    case "ERTMS_Specifications":
      return { kind: "spec", level: 3 };
    case "Norway":
      if (/Teknisk_regelverk|ATC2_STM/i.test(f)) return { kind: /ATC2_STM/i.test(f) ? "spec" : "national", level: 3 };
      return { kind: "national", level: 2 };
    case "Referenced_Documents":
      if (/EU_Acts/i.test(f)) return { kind: "act", level: isFrameworkAct(d) ? 0 : 1 };
      if (/ERA_Documents/i.test(f)) return { kind: "guide", level: 2 };
      return { kind: "other", level: 2 };
    default:
      return { kind: "other", level: 2 };
  }
}

/** Short node label: short name, else a usable reference, else the act number from the title, else the filename. */
export function nodeLabel(d: DocRow): string {
  if (d.short_name?.trim()) return d.short_name.trim();
  const ref = d.reference?.trim();
  if (ref && ref !== "-" && !/^CELEX\b/i.test(ref) && ref.length <= 60) return ref;
  const t = d.title?.trim();
  if (t) {
    const m = /^(.{0,60}?\b(?:No\s)?\d{1,4}\/\d{1,4}(?:\/E[CU]+)?)\b/.exec(t);
    if (m) return m[1];
    return t.length > 60 ? `${t.slice(0, 59)}…` : t;
  }
  return d.filename.replace(/\.[a-z0-9]+$/i, "").replace(/_/g, " ");
}

/** Act family: the reference without version suffixes, so a consolidated text and its original count as one act. */
function family(d: DocRow): string {
  const ref = (d.reference ?? "").replace(/\s*\((?:consolidated|corrigendum)[^)]*\)\s*$/i, "").trim().toLowerCase();
  return ref && ref !== "-" ? ref : d.path;
}

/** Path of the canonical copy (follows `duplicate_of` chains). */
function canonical(docs: DocIndex, path: string): string {
  let p = path;
  for (let i = 0; i < 5; i++) {
    const d = docs.byPath.get(p);
    if (!d?.duplicate_of || !docs.byPath.has(d.duplicate_of)) break;
    p = d.duplicate_of;
  }
  return p;
}

/** All library paths that collapse onto the given canonical paths (the paths themselves plus their duplicates). */
function aliasesOf(docs: DocIndex, canon: Set<string>): string[] {
  const out = new Set(canon);
  for (const d of docs.byPath.values()) if (d.duplicate_of && canon.has(canonical(docs, d.path))) out.add(d.path);
  return [...out];
}

interface EdgeRow {
  citing_path: string;
  cited_path: string;
  m: number | null;
}

async function edgeRows(env: Env, sql: string, groups: string[][]): Promise<EdgeRow[]> {
  const stmt = groups.flat();
  const { results } = await env.DB.prepare(sql).bind(...stmt).all<EdgeRow>();
  return results ?? [];
}

const placeholders = (n: number) => Array.from({ length: n }, () => "?").join(",");

export async function buildSourceMap(env: Env, docs: DocIndex, citations: Citation[]): Promise<SourceMap | undefined> {
  // cited documents, collapsed onto their canonical copy, in order of first citation
  const ns = new Map<string, number[]>();
  for (const c of [...citations].sort((a, b) => a.n - b.n)) {
    const p = canonical(docs, c.doc_path);
    if (!docs.byPath.has(p)) continue;
    const list = ns.get(p) ?? [];
    if (!list.includes(c.n)) list.push(c.n);
    ns.set(p, list);
  }
  const cited = [...ns.keys()].slice(0, MAX_NODES);
  if (cited.length < 2) return undefined;
  const citedSet = new Set(cited);
  const citedPaths = aliasesOf(docs, citedSet).slice(0, MAX_PARAMS);
  const ph = placeholders(citedPaths.length);

  // one hop out of and into the cited documents (two queries, one round trip)
  const [outRes, inRes] = await env.DB.batch<EdgeRow>([
    env.DB.prepare(
      `SELECT citing_path, cited_path, SUM(COALESCE(mentions, 1)) AS m FROM edges WHERE citing_path IN (${ph}) AND cited_path IS NOT NULL GROUP BY citing_path, cited_path`,
    ).bind(...citedPaths),
    env.DB.prepare(`SELECT citing_path, cited_path, SUM(COALESCE(mentions, 1)) AS m FROM edges WHERE cited_path IN (${ph}) GROUP BY citing_path, cited_path`).bind(
      ...citedPaths,
    ),
  ]);
  const edges = new Map<string, number>(); // "from\u0000to" → mentions, canonical paths
  const rowsSeen = new Set<string>(); // a cited→cited row comes back from both queries
  const addEdge = (r: EdgeRow) => {
    const rk = `${r.citing_path}\u0000${r.cited_path}`;
    if (rowsSeen.has(rk)) return;
    rowsSeen.add(rk);
    const from = canonical(docs, r.citing_path);
    const to = canonical(docs, r.cited_path);
    if (from === to || !docs.byPath.has(from) || !docs.byPath.has(to)) return;
    const k = `${from}\u0000${to}`;
    edges.set(k, (edges.get(k) ?? 0) + (Number(r.m) || 1));
  };
  for (const r of outRes.results ?? []) addEdge(r);
  for (const r of inRes.results ?? []) addEdge(r);

  // bridges: x not cited, some cited c1 cites x and x cites another cited c2
  const citedBy = new Map<string, Map<string, number>>(); // x → cited docs citing x
  const cites = new Map<string, Map<string, number>>(); // x → cited docs cited by x
  for (const [k, m] of edges) {
    const [from, to] = k.split("\u0000");
    if (citedSet.has(from) && !citedSet.has(to)) {
      const s = citedBy.get(to) ?? new Map();
      s.set(from, m);
      citedBy.set(to, s);
    } else if (!citedSet.has(from) && citedSet.has(to)) {
      const s = cites.get(from) ?? new Map();
      s.set(to, m);
      cites.set(from, s);
    }
  }
  const candidates: { path: string; pairs: number; weight: number; demoted: boolean }[] = [];
  for (const [x, ins] of citedBy) {
    const outs = cites.get(x);
    if (!outs) continue;
    let pairs = 0;
    let weight = 0;
    for (const [c1, m1] of ins)
      for (const [c2, m2] of outs)
        // a link between two versions of the same act is not worth a detour through a third document
        if (c1 !== c2 && family(docs.byPath.get(c1)!) !== family(docs.byPath.get(c2)!)) {
          pairs++;
          weight += Math.min(m1, m2);
        }
    if (!pairs) continue;
    const st = docs.byPath.get(x)!.status;
    candidates.push({ path: x, pairs, weight, demoted: st === "repealed" || st === "historical" });
  }
  candidates.sort((a, b) => Number(a.demoted) - Number(b.demoted) || b.pairs - a.pairs || b.weight - a.weight || a.path.localeCompare(b.path));
  const bridges = candidates.slice(0, Math.min(MAX_BRIDGES, MAX_NODES - cited.length)).map((c) => c.path);

  // edges between bridges are not covered by the two queries above
  if (bridges.length >= 2) {
    const bp = aliasesOf(docs, new Set(bridges)).slice(0, MAX_PARAMS / 2);
    const q = placeholders(bp.length);
    for (const r of await edgeRows(
      env,
      `SELECT citing_path, cited_path, SUM(COALESCE(mentions, 1)) AS m FROM edges WHERE citing_path IN (${q}) AND cited_path IN (${q}) GROUP BY citing_path, cited_path`,
      [bp, bp],
    ))
      addEdge(r);
  }

  const included = [...cited, ...bridges];
  const inc = new Set(included);
  const nodes: SourceNode[] = included.map((p) => {
    const d = docs.byPath.get(p)!;
    const { kind, level } = classifyDoc(d);
    return { path: p, label: nodeLabel(d), area: d.area, status: d.status, kind, cited: citedSet.has(p), ns: ns.get(p) ?? [], level };
  });
  const outEdges: SourceEdge[] = [];
  for (const [k, mentions] of edges) {
    const [from, to] = k.split("\u0000");
    if (inc.has(from) && inc.has(to)) outEdges.push({ from, to, mentions });
  }
  outEdges.sort((a, b) => b.mentions - a.mentions || a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
  return { nodes, edges: outEdges };
}
