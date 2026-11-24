import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { parseAskBody } from "../src/agent";
import { runTool, type ToolContext } from "../src/tools";
import { contentTypeFor, fileCsp } from "../src/files";
import type { Env } from "../src/env";

const msgs = [{ role: "user", content: "hi" }];

describe("model override is default-deny", () => {
  const e = (o: Partial<Env>) => ({ MODEL: "cfg/model", ...o }) as Env;
  it("uses MODEL when no model is given", () => {
    expect(parseAskBody({ messages: msgs }, e({})).model).toBe("cfg/model");
  });
  it("accepts naming the configured model", () => {
    expect(parseAskBody({ messages: msgs, model: "cfg/model" }, e({})).model).toBe("cfg/model");
  });
  it("rejects any other model when ALLOWED_MODELS is unset or empty", () => {
    for (const allowed of [undefined, "", " , "]) {
      expect(() => parseAskBody({ messages: msgs, model: "openai/o9-pro" }, e({ ALLOWED_MODELS: allowed }))).toThrow("model not allowed");
    }
  });
  it("accepts only listed models when ALLOWED_MODELS is set", () => {
    const env2 = e({ ALLOWED_MODELS: "a/one, b/two" });
    expect(parseAskBody({ messages: msgs, model: "b/two" }, env2).model).toBe("b/two");
    expect(parseAskBody({ messages: msgs, model: "cfg/model" }, env2).model).toBe("cfg/model");
    expect(() => parseAskBody({ messages: msgs, model: "c/three" }, env2)).toThrow("model not allowed");
  });
});

describe("tool dispatch", () => {
  const ctx: ToolContext = { env: env as unknown as Env, seen: new Map(), texts: new Map() };
  it("does not resolve Object.prototype names as tools", async () => {
    for (const name of ["constructor", "toString", "__proto__", "hasOwnProperty", "valueOf"]) {
      const r = await runTool(ctx, name, "{}");
      expect(JSON.parse(r.result), name).toEqual({ error: `unknown tool ${name}` });
      expect(r.summary).toBe(`Unknown tool ${name}`);
    }
  });
});

describe("/files CSP", () => {
  it("sandboxes everything except PDF", () => {
    for (const key of ["a.html", "a.svg", "a.xml", "a.txt", "a.json", "a.png", "a.csv", "a.docx", "a.zip", "a.unknown", "noext"]) {
      expect(fileCsp(contentTypeFor(key)), key).toMatch(/^sandbox /);
      expect(fileCsp(contentTypeFor(key))).not.toContain("allow-scripts");
    }
    // arbitrary uploaded content types too, incl. case/params variations
    for (const ct of ["text/html", "TEXT/HTML; charset=utf-8", "application/xhtml+xml", "text/xml", "application/octet-stream", ""]) {
      expect(fileCsp(ct), ct).toMatch(/^sandbox /);
    }
    expect(fileCsp("application/pdf")).toBeNull();
    expect(fileCsp("Application/PDF; qs=1")).toBeNull();
    expect(fileCsp(contentTypeFor("x.PDF"))).toBeNull();
  });
});
