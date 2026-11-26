import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import worker from "../src/index";
import type { Env } from "../src/env";
import { loadFixture } from "./fixture";
import { _resetDocCache } from "../src/docs";

const baseEnv = (extra: Partial<Env> = {}): Env => ({ ...(env as unknown as Env), ...extra });

async function call(path: string, init?: RequestInit, extra?: Partial<Env>) {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(`https://ask.test${path}`, init), baseEnv(extra), ctx);
  return { res, ctx };
}

function parseSse(text: string) {
  return text
    .split("\n\n")
    .filter((b) => b.includes("event:"))
    .map((b) => {
      const ev = /event: (.*)/.exec(b)![1];
      const data = JSON.parse(/data: (.*)/.exec(b)![1]);
      return { ev, data };
    });
}

beforeAll(async () => {
  await loadFixture(env.DB);
  await env.FILES.put("02_TSI/CCS/CCS_TSI_2023_1695_consolidated.pdf", "%PDF-1.7 0123456789abcdef", { httpMetadata: { contentType: "application/pdf" } });
  await env.FILES.put("08_Norway/Lovdata/samtrafikkforskriften.html", "<html><script>alert(1)</script></html>");
  await env.FILES.put("secret/not-in-docs.pdf", "secret");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("/api/health, /api/doc, /api/chunk", () => {
  it("health", async () => {
    const { res } = await call("/api/health");
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Content-Security-Policy")).toContain("default-src 'self'");
    expect(await res.json()).toMatchObject({ ok: true, docs: 7, chunks: 12, vectors: false, model: "test/model", build_date: "2026-11-23" });
  });
  it("doc + chunk", async () => {
    const d = await (await call(`/api/doc?path=${encodeURIComponent("01_EU_Framework/Directive_2016_797.pdf")}`)).res.json<any>();
    expect(d).toMatchObject({ short_name: "Interoperability Directive", cited_by: 1, cites: 0, n_chunks: 3 });
    const c = await (await call("/api/chunk?id=202")).res.json<any>();
    expect(c).toMatchObject({ chunk_id: 202, locator: "Art. 15(8)", file_url: "/files/01_EU_Framework/Directive_2016_797.pdf#page=20" });
    expect((await call("/api/chunk?id=9999")).res.status).toBe(404);
    expect((await call("/api/doc")).res.status).toBe(400);
  });
});

describe("/api/search", () => {
  const search = async (q: string, params = "") => (await (await call(`/api/search?q=${encodeURIComponent(q)}${params}`)).res.json<any>());

  it("finds an article by locator and boosts the exact chunk", async () => {
    const r = await search("Article 15(8) DeBo");
    expect(r.mode).toBe("keyword");
    expect(r.results[0].chunk_id).toBe(202);
    expect(r.results[0].file_url).toBe("/files/01_EU_Framework/Directive_2016_797.pdf#page=20");
    expect(r.results[0].official_url).toBe("https://eur-lex.europa.eu/eli/dir/2016/797/oj");
    // duplicate copy (doc 7) is collapsed
    expect(r.results.some((h: any) => h.chunk_id === 701)).toBe(false);
  });
  it("SUBSET-026 clause", async () => {
    const r = await search("SUBSET-026 3.5.3.7");
    expect(r.results[0].chunk_id).toBe(301);
    expect(r.results[0].file_url).toBe("/files/07_ERTMS_Specifications/Set3/SUBSET-026.zip");
    expect(r.results[0].inner_file).toBe("SUBSET-026-3 v360.pdf");
  });
  it("alias-only query returns the named document", async () => {
    const r = await search("samtrafikkforskriften");
    expect(r.results[0].doc_path).toBe("08_Norway/Lovdata/samtrafikkforskriften.html");
    expect(r.results[0].file_url).toBe("/files/08_Norway/Lovdata/samtrafikkforskriften.html#%C2%A73-1");
  });
  it("TRV id", async () => {
    expect((await search("TRV-07113")).results[0].chunk_id).toBe(501);
  });
  it("alias expansion: CCS TSI ↔ 2023/1695", async () => {
    const r = await search("CCS TSI level transitions");
    expect(r.results[0].chunk_id).toBe(102);
  });
  it("demotes repealed texts unless asked", async () => {
    const a = await search("SUBSET-026 level transitions");
    const ids = a.results.map((h: any) => h.chunk_id);
    expect(ids.indexOf(102)).toBeLessThan(ids.indexOf(601));
    const b = await search("SUBSET-026 level transitions", "&status=repealed");
    expect(b.results.map((h: any) => h.chunk_id)).toEqual([601]);
  });
  it("filters and per-doc cap", async () => {
    const r = await search("shall", "&area=TSI");
    expect(r.results.every((h: any) => h.area === "TSI")).toBe(true);
    const counts = new Map<string, number>();
    for (const h of (await search("shall")).results) counts.set(h.doc_path, (counts.get(h.doc_path) ?? 0) + 1);
    expect(Math.max(...counts.values())).toBeLessThanOrEqual(3);
    const d = await search("shall", `&doc=${encodeURIComponent("02_TSI/CCS/CCS_TSI_2023_1695_consolidated.pdf")}`);
    expect(d.results.every((h: any) => h.doc_path.startsWith("02_TSI/CCS/CCS_TSI_2023"))).toBe(true);
  });
  it("survives nasty queries", async () => {
    for (const q of ['"', "((", "AND OR NOT", "*", "§", "æøå", "NEAR(a b)", "a:b", "x".repeat(400)]) {
      const { res } = await call(`/api/search?q=${encodeURIComponent(q)}`);
      expect(res.status, q).toBe(200);
    }
    expect((await call("/api/search?q=")).res.status).toBe(400);
  });
  it("a query naming hundreds of documents stays under D1's 100 bound-parameter limit", async () => {
    // 20 aliases × 8 docs each: without the cap, namedIds/aliasPaths go far over 100 parameters.
    const ins: D1PreparedStatement[] = [];
    const words: string[] = [];
    for (let a = 0; a < 20; a++) {
      const alias = `zq${String(a).padStart(2, "0")}`;
      words.push(alias);
      for (let j = 0; j < 8; j++) {
        const id = 1000 + a * 8 + j;
        const path = `99_Bulk/doc_${id}.pdf`;
        ins.push(
          env.DB.prepare("INSERT INTO docs (id, path, folder, filename, title, status, area, lang, r2_key) VALUES (?,?,?,?,?,?,?,?,?)").bind(id, path, "99_Bulk", `doc_${id}.pdf`, `Bulk doc ${id}`, "in_force", "Bulk", "en", path),
          env.DB.prepare("INSERT INTO aliases (alias, path, kind) VALUES (?,?,?)").bind(alias, path, "short"),
          env.DB.prepare("INSERT INTO chunks (id, doc_id, ord, heading, locator, text, tokens) VALUES (?,?,?,?,?,?,?)").bind(100000 + id, id, 0, "Intro", null, `Bulk document ${id} opening text.`, 5),
        );
      }
    }
    await env.DB.batch(ins);
    _resetDocCache();
    try {
      for (const q of [words.join(" "), [...words, ...words, ...words].join(" "), `${words.join(" ")} 2023/1695 SUBSET-026 Art. 15`]) {
        const { res } = await call(`/api/search?q=${encodeURIComponent(q)}`);
        expect(res.status, q.slice(0, 40)).toBe(200);
        const j = await res.json<any>();
        expect(Array.isArray(j.results)).toBe(true);
      }
      const r = await search(words.join(" "));
      expect(r.results.length).toBeGreaterThan(0);
      expect(r.results.every((h: any) => h.doc_path.startsWith("99_Bulk/"))).toBe(true);
    } finally {
      await env.DB.batch([
        env.DB.prepare("DELETE FROM chunks WHERE doc_id >= 1000"),
        env.DB.prepare("DELETE FROM aliases WHERE path LIKE '99_Bulk/%'"),
        env.DB.prepare("DELETE FROM docs WHERE id >= 1000"),
        env.DB.prepare("INSERT INTO chunks_fts(chunks_fts) VALUES('rebuild')"),
      ]);
      _resetDocCache();
    }
  });
});

describe("/files", () => {
  const f = "/files/02_TSI/CCS/CCS_TSI_2023_1695_consolidated.pdf";
  it("serves listed keys with range and HEAD", async () => {
    const full = (await call(f)).res;
    expect(full.status).toBe(200);
    expect(full.headers.get("Content-Type")).toBe("application/pdf");
    expect(full.headers.get("Content-Disposition")).toContain("inline");
    expect(await full.text()).toBe("%PDF-1.7 0123456789abcdef");
    const part = (await call(f, { headers: { Range: "bytes=9-12" } })).res;
    expect(part.status).toBe(206);
    expect(part.headers.get("Content-Range")).toBe("bytes 9-12/25");
    expect(await part.text()).toBe("0123");
    const suffix = (await call(f, { headers: { Range: "bytes=-3" } })).res;
    expect(await suffix.text()).toBe("def");
    const head = (await call(f, { method: "HEAD" })).res;
    expect(head.status).toBe(200);
    expect(head.headers.get("Content-Length")).toBe("25");
    expect((await call(f, { headers: { Range: "bytes=100-" } })).res.status).toBe(416);
    // PDFs are the one type served without the sandbox CSP (it breaks Chrome's viewer)
    expect(full.headers.get("Content-Security-Policy") ?? "").not.toMatch(/sandbox/);
  });
  it("sandboxes HTML and refuses unlisted keys", async () => {
    const h = (await call("/files/08_Norway/Lovdata/samtrafikkforskriften.html")).res;
    expect(h.headers.get("Content-Security-Policy")).toMatch(/^sandbox/);
    await h.arrayBuffer();
    expect((await call("/files/secret/not-in-docs.pdf")).res.status).toBe(404);
    expect((await call("/files/02_TSI/CCS/../../secret/not-in-docs.pdf")).res.status).toBe(404);
    expect((await call("/files/%2e%2e/secret/not-in-docs.pdf")).res.status).toBe(404);
  });
});

describe("/api/ask", () => {
  function sseResponse(chunks: unknown[]) {
    const body = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n";
    return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
  }

  it("runs a tool round then streams a cited answer", async () => {
    const requests: any[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://llm.test/v1/chat/completions");
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer test-key");
      const body = JSON.parse(String(init?.body));
      requests.push(body);
      if (requests.length === 1) {
        return Response.json({
          choices: [{ message: { role: "assistant", content: "", tool_calls: [{ id: "t1", type: "function", function: { name: "search", arguments: '{"query":"Article 15(8) DeBo"}' } }] }, finish_reason: "tool_calls" }],
          usage: { prompt_tokens: 100, completion_tokens: 10, cost: 0.0001 },
        });
      }
      const answer =
        'The applicant designates a DeBo for national rules: "shall designate one or more bodies responsible for the verification procedure" [c:202]. Invented: "this sentence is not in the source text at all" [c:202]. Unknown source [c:999].\n\n```mermaid\nflowchart LR\n  A["Applicant (c:202)"] --> B["DeBo (c:999)"]\n```\n\nFOLLOWUPS: What is a NoBo? | Which national rules apply?';
      const parts = answer.match(/.{1,7}/gs)!;
      return sseResponse([
        ...parts.map((p) => ({ choices: [{ delta: { content: p } }] })),
        { choices: [{ delta: {}, finish_reason: "stop" }] },
        { choices: [], usage: { prompt_tokens: 300, completion_tokens: 50, cost: 0.0002 } },
      ]);
    });
    const { res, ctx } = await call(
      "/api/ask",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: [{ role: "user", content: "What does a DeBo do?" }] }) },
      { OPENROUTER_API_KEY: "test-key" },
    );
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");
    const events = parseSse(await res.text());
    await waitOnExecutionContext(ctx);
    const step = events.find((e) => e.ev === "step")!;
    expect(step.data).toMatchObject({ n: 1, tool: "search", args: { query: "Article 15(8) DeBo" } });
    expect(step.data.summary).toMatch(/^Searching “Article 15\(8\) DeBo” — \d+ hits?$/);
    const streamed = events.filter((e) => e.ev === "token").map((e) => e.data.t).join("");
    const done = events.find((e) => e.ev === "done")!.data;
    expect(streamed.trim()).toBe(done.answer);
    expect(done.answer).toContain("verification procedure\" [1]");
    expect(done.answer).not.toContain("[c:");
    expect(done.answer).toContain("Unknown source.");
    expect(done.citations).toHaveLength(1);
    expect(done.citations[0]).toMatchObject({ n: 1, chunk_id: 202, locator: "Art. 15(8)", doc_path: "01_EU_Framework/Directive_2016_797.pdf" });
    expect(done.citations[0].snippet).toBeUndefined();
    expect(done.quote_checks.map((q: any) => [q.ok, q.n])).toEqual([[true, 1], [false, 1]]);
    expect(done.citations[0].excerpt).toContain("shall designate one or more bodies");
    expect(done.answer).toContain('A["Applicant (1)"] --> B["DeBo"]');
    expect(done.answer).not.toContain("FOLLOWUPS");
    expect(streamed).not.toContain("FOLLOWUPS");
    expect(done.follow_ups).toEqual(["What is a NoBo?", "Which national rules apply?"]);
    expect(done.source_map).toBeUndefined(); // one cited document only
    expect(done.usage).toEqual({ prompt_tokens: 400, completion_tokens: 60, cost_usd: 0.0003 });
    expect(done.steps).toBe(1);
    // the tool result went back to the model, with tools offered in round 1
    expect(requests[0].tools.map((t: any) => t.function.name).sort()).toEqual(["citations", "doc_info", "list_docs", "read", "search", "standard", "trv"]);
    const toolMsg = requests[1].messages.find((m: any) => m.role === "tool");
    expect(JSON.parse(toolMsg.content).hits.some((h: any) => h.id === 202)).toBe(true);
  });

  it("forces a final answer after max rounds", async () => {
    let n = 0;
    vi.stubGlobal("fetch", async (_i: RequestInfo | URL, init?: RequestInit) => {
      n++;
      const body = JSON.parse(String(init?.body));
      if (body.tool_choice === "none") return Response.json({ choices: [{ message: { content: "Final from [c:401]." } }] });
      return Response.json({ choices: [{ message: { content: null, tool_calls: [{ id: `t${n}`, type: "function", function: { name: "read", arguments: '{"chunk_id":401}' } }] } }] });
    });
    const { res } = await call(
      "/api/ask",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: [{ role: "user", content: "Hva sier § 3-1?" }] }) },
      { OPENROUTER_API_KEY: "k" },
    );
    const events = parseSse(await res.text());
    const done = events.find((e) => e.ev === "done")!.data;
    expect(events.filter((e) => e.ev === "step")).toHaveLength(10);
    expect(events.find((e) => e.ev === "step")!.data.summary).toBe("Reading Samtrafikkforskriften § 3-1");
    expect(done.answer).toBe("Final from [1].");
    expect(n).toBe(11);
  });

  it("re-asks once when the model returns an empty answer", async () => {
    const bodies: any[] = [];
    vi.stubGlobal("fetch", async (_i: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      bodies.push(body);
      if (bodies.length === 1) return Response.json({ choices: [{ message: { content: null, tool_calls: [{ id: "t1", type: "function", function: { name: "read", arguments: '{"chunk_id":401}' } }] } }] });
      if (bodies.length === 2) return Response.json({ choices: [{ message: { content: "\nFOLLOWUPS: a | b" } }] });
      return Response.json({ choices: [{ message: { content: "Second try from [c:401]." } }] });
    });
    const { res } = await call(
      "/api/ask",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: [{ role: "user", content: "Hva sier § 3-1?" }] }) },
      { OPENROUTER_API_KEY: "k" },
    );
    const events = parseSse(await res.text());
    expect(events.some((e) => e.ev === "error")).toBe(false);
    expect(events.filter((e) => e.ev === "step").map((e) => e.data.tool)).toEqual(["read", "retry"]);
    expect(events.find((e) => e.ev === "done")!.data.answer).toBe("Second try from [1].");
    expect(bodies).toHaveLength(3);
    expect(bodies[2].tool_choice).toBe("none");
    expect(bodies[2].max_tokens).toBe(16000);
    expect(bodies[1].max_tokens).toBe(4000);
    expect(bodies[2].messages.at(-1).content).toMatch(/last message was empty/);
  });

  it("gives up with an error after one empty retry", async () => {
    let n = 0;
    vi.stubGlobal("fetch", async () => {
      n++;
      return Response.json({ choices: [{ message: { content: "  " } }] });
    });
    const { res } = await call(
      "/api/ask",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }) },
      { OPENROUTER_API_KEY: "k" },
    );
    const ev = parseSse(await res.text());
    expect(ev.at(-1)).toMatchObject({ ev: "error", data: { message: expect.stringContaining("empty answer") } });
    expect(n).toBe(2);
  });

  it("reports provider errors and validates input", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ error: { message: "rate limited" } }, { status: 429 }));
    const { res } = await call(
      "/api/ask",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }) },
      { OPENROUTER_API_KEY: "k" },
    );
    const ev = parseSse(await res.text());
    expect(ev.at(-1)).toMatchObject({ ev: "error", data: { message: expect.stringContaining("rate limited") } });
    const bad = await call("/api/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: [{ role: "assistant", content: "x" }] }) });
    expect(bad.res.status).toBe(400);
    expect((await call("/api/ask")).res.status).toBe(405);
  });

  it("requires Access when configured (all routes)", async () => {
    for (const p of ["/api/health", "/files/02_TSI/CCS/CCS_TSI_2023_1695_consolidated.pdf", "/"]) {
      const { res } = await call(p, undefined, { ACCESS_TEAM_DOMAIN: "t.cloudflareaccess.com", ACCESS_AUD: "x" });
      expect(res.status, p).toBe(403);
    }
  });
});
