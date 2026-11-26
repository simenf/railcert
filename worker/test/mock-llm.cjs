// Fake OpenAI-compatible LLM for end-to-end testing of /api/ask without an API key.
// Round 1: asks for a `search` with the user's question. Round 2: answers, citing and
// quoting the first chunk the tool returned. Run: node worker/test/mock-llm.cjs 8799
// then `wrangler dev --var LLM_BASE_URL:http://127.0.0.1:8799 --var OPENROUTER_API_KEY:dummy --var REQUIRE_ACCESS:0`.
const http = require("http");
const port = Number(process.argv[2] || 8799);

function reply(res, msg, usage) {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ id: "mock", object: "chat.completion", model: "mock",
    choices: [{ index: 0, finish_reason: msg.tool_calls ? "tool_calls" : "stop", message: msg }],
    usage: usage || { prompt_tokens: 1000, completion_tokens: 100, cost: 0.0001 } }));
}

http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    if (!req.url.endsWith("/chat/completions")) { res.writeHead(404); return res.end(); }
    const j = JSON.parse(body || "{}");
    const msgs = j.messages || [];
    const user = [...msgs].reverse().find((m) => m.role === "user");
    const tool = [...msgs].reverse().find((m) => m.role === "tool");
    if (!tool && j.tools) {
      return reply(res, { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function",
        function: { name: "search", arguments: JSON.stringify({ query: String(user?.content || "").slice(0, 200) }) } }] });
    }
    let id = null, id2 = null, snippet = "";
    try {
      const out = JSON.parse(tool.content);
      const hits = out.hits || out.results || [];
      id = hits[0] && (hits[0].chunk_id ?? hits[0].id);
      id2 = (hits[1] && (hits[1].chunk_id ?? hits[1].id)) || id;
      snippet = (hits[0] && (hits[0].snip || hits[0].snippet || "")) || "";
    } catch (e) {}
    const words = snippet.replace(/[«»"“”\[\]…]/g, " ").split(/\s+/).filter((w) => /\w/.test(w)).slice(2, 10).join(" ");
    // Exercises answer presentation v2: summary line, cited paragraphs, a mermaid flowchart with
    // (c:id) labels, one verified and one fake quote, and the FOLLOWUPS line (stripped by the Worker).
    const text = id
      ? [
          `**Mock answer.** The library covers this in two passages, summarised here in one line [c:${id}].`,
          "",
          "## Details",
          "",
          `The most relevant passage is the first search hit, which sets out the main rule. It says “${words}” [c:${id}].`,
          "",
          `A second passage adds context for the same question [c:${id2}]. A made-up quote: “the moon is made of cheese and rails” [c:${id}].`,
          "",
          "```mermaid",
          "flowchart TD",
          `  A["Read the main rule (c:${id})"] --> B["Check the context (c:${id2})"]`,
          `  B --> C["Unknown source (c:999999999)"]`,
          "```",
          "",
          "FOLLOWUPS: What does the second passage say in full? | Which documents cite this one? | Is there a consolidated version?",
        ].join("\n")
      : "Mock answer: the library does not appear to contain this.\n\nFOLLOWUPS: Can you rephrase the question?";
    reply(res, { role: "assistant", content: text });
  });
}).listen(port, "127.0.0.1", () => console.log(`mock LLM on http://127.0.0.1:${port}`));
