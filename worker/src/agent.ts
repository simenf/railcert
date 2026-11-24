/** POST /api/ask: tool-calling agent loop streamed as SSE (events: step, token, done, error). */
import { type Env, DEFAULT_LLM_BASE_URL, DEFAULT_MODEL } from "./env";
import { getDocs } from "./docs";
import { HttpError } from "./http";
import { type ChatMessage, type Usage, LlmError, chat } from "./llm";
import { FINAL_NUDGE, systemPrompt } from "./prompt";
import { Citer, type SourceInfo, checkQuotes } from "./citations";
import { TOOL_SCHEMAS, type ToolContext, runTool } from "./tools";

export const MAX_ROUNDS = 10;
export const TOOL_CHAR_BUDGET = 120_000;
const MAX_HISTORY = 12;
const MAX_MSG_CHARS = 8_000;
const MAX_HISTORY_CHARS = 40_000;
const MAX_TOOL_CALLS_PER_ROUND = 6;
const DEADLINE_MS = 150_000;
/** Content of a round is shown live only after this many characters without a tool call. */
const LIVE_THRESHOLD = 160;

export interface AskBody {
  messages: { role: "user" | "assistant"; content: string }[];
  model?: string;
}

export function parseAskBody(raw: unknown, env: Env): { history: ChatMessage[]; model: string } {
  if (!raw || typeof raw !== "object") throw new HttpError(400, "body must be a JSON object");
  const b = raw as Record<string, unknown>;
  if (!Array.isArray(b.messages) || !b.messages.length) throw new HttpError(400, "messages must be a non-empty array");
  const msgs = b.messages
    .filter((m: any) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .map((m: any) => ({
      role: m.role as "user" | "assistant",
      // strip our own rendered citation numbers from earlier answers, they mean nothing to the model now
      content: (m.role === "assistant" ? m.content.replace(/\[\d+\]/g, "") : m.content).slice(0, MAX_MSG_CHARS),
    }));
  if (!msgs.length || msgs[msgs.length - 1].role !== "user") throw new HttpError(400, "the last message must be from the user");
  let hist = msgs.slice(-MAX_HISTORY);
  while (hist.length > 1 && hist.reduce((n, m) => n + m.content.length, 0) > MAX_HISTORY_CHARS) hist = hist.slice(1);
  while (hist.length && hist[0].role !== "user") hist = hist.slice(1);
  let model = env.MODEL || DEFAULT_MODEL;
  if (typeof b.model === "string" && b.model.trim()) {
    const m = b.model.trim();
    if (!/^[\w.\-/:@]{1,100}$/.test(m)) throw new HttpError(400, "invalid model id");
    // Default-deny: without ALLOWED_MODELS only the configured model may be named (so a client
    // cannot pick an expensive model on the owner's key); with it, only the listed ids (plus MODEL).
    const allowed = (env.ALLOWED_MODELS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    if (m !== model && !allowed.includes(m)) throw new HttpError(400, "model not allowed");
    model = m;
  }
  return { history: hist.map((m) => ({ role: m.role, content: m.content })), model };
}

type Emit = (event: string, data: unknown) => void;

function addUsage(total: Usage, u: Usage | null) {
  if (!u) return;
  total.prompt_tokens += u.prompt_tokens;
  total.completion_tokens += u.completion_tokens;
  if (u.cost_usd != null) total.cost_usd = (total.cost_usd ?? 0) + u.cost_usd;
}

export async function runAgent(env: Env, history: ChatMessage[], model: string, emit: Emit, signal?: AbortSignal): Promise<void> {
  const apiKey = env.OPENROUTER_API_KEY;
  if (!apiKey) {
    emit("error", { message: "The language model is not configured (OPENROUTER_API_KEY is missing)." });
    return;
  }
  const started = Date.now();
  const docs = await getDocs(env);
  const buildDate = await env.DB.prepare("SELECT v FROM meta WHERE k = 'build_date'").first<string>("v").catch(() => null);
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt(docs, buildDate, new Date().toISOString().slice(0, 10)) },
    ...history,
  ];
  const seen = new Map<number, SourceInfo>();
  const ctx: ToolContext = { env, seen, texts: new Map() };
  const citer = new Citer(seen);
  const usage: Usage = { prompt_tokens: 0, completion_tokens: 0 };
  let toolChars = 0;
  let steps = 0;
  let rawAnswer = "";
  let shown = "";
  const emitToken = (t: string) => {
    if (!t) return;
    shown += t;
    emit("token", { t });
  };

  for (let round = 1; ; round++) {
    const forceFinal = round > MAX_ROUNDS || toolChars >= TOOL_CHAR_BUDGET || Date.now() - started > DEADLINE_MS;
    if (forceFinal) messages.push({ role: "user", content: FINAL_NUDGE });

    let roundBuf = "";
    let live = false;
    let sawTool = false;
    const result = await chat({
      baseUrl: env.LLM_BASE_URL || DEFAULT_LLM_BASE_URL,
      apiKey,
      model,
      messages,
      tools: TOOL_SCHEMAS as unknown as unknown[],
      toolChoice: forceFinal ? "none" : "auto",
      referer: env.APP_URL,
      maxTokens: 4000,
      signal,
      onToolCall: () => {
        sawTool = true;
      },
      onContent: (d) => {
        roundBuf += d;
        if (live) emitToken(citer.push(d));
        else if (!sawTool && roundBuf.length >= LIVE_THRESHOLD) {
          live = true;
          emitToken(citer.push(roundBuf));
        }
      },
    });
    addUsage(usage, result.usage);

    const calls = forceFinal ? [] : result.tool_calls.slice(0, MAX_TOOL_CALLS_PER_ROUND);
    if (!calls.length) {
      if (!live) emitToken(citer.push(roundBuf));
      rawAnswer += roundBuf;
      break;
    }
    if (live) {
      // the model wrote visible text and then asked for tools: keep the text as part of the answer
      rawAnswer += `${roundBuf}\n\n`;
      emitToken(citer.push("\n\n"));
    }
    messages.push({ role: "assistant", content: result.content || null, tool_calls: calls });
    for (const call of calls) {
      const out = await runTool(ctx, call.function.name, call.function.arguments);
      steps++;
      let text = out.result;
      const room = TOOL_CHAR_BUDGET - toolChars;
      if (room <= 0) text = "[Tool output budget for this question is used up. Answer with what you have.]";
      else if (text.length > room) text = `${text.slice(0, room)}\n[… truncated: tool output budget for this question is used up]`;
      toolChars += text.length;
      emit("step", { n: steps, tool: call.function.name, args: out.args, summary: out.summary });
      messages.push({ role: "tool", tool_call_id: call.id, name: call.function.name, content: text });
    }
  }

  emitToken(citer.flush());
  if (!rawAnswer.trim()) {
    emit("error", { message: "The model returned an empty answer. Try rephrasing the question." });
    return;
  }
  // Quote checks need the full text of cited chunks; fetch any we only saw as snippets.
  const citations = citer.citations();
  const missing = citations.map((c) => c.chunk_id).filter((id) => !ctx.texts.has(id));
  for (let i = 0; i < missing.length; i += 90) {
    const part = missing.slice(i, i + 90);
    const { results } = await env.DB.prepare(`SELECT id, text FROM chunks WHERE id IN (${part.map(() => "?").join(",")})`)
      .bind(...part)
      .all<{ id: number; text: string }>();
    for (const r of results ?? []) ctx.texts.set(r.id, r.text);
  }
  const quote_checks = checkQuotes(rawAnswer, ctx.texts, new Set(seen.keys()));
  const u: Record<string, number> = { prompt_tokens: usage.prompt_tokens, completion_tokens: usage.completion_tokens };
  if (usage.cost_usd != null) u.cost_usd = Math.round(usage.cost_usd * 1e6) / 1e6;
  emit("done", { answer: shown.trim(), citations, quote_checks, usage: u, steps, model });
}

/** Wraps runAgent in an SSE response. */
export function askResponse(env: Env, history: ChatMessage[], model: string, ctx?: ExecutionContext): Response {
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const enc = new TextEncoder();
  const abort = new AbortController();
  let closed = false;
  const emit: Emit = (event, data) => {
    if (closed) return;
    writer.write(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)).catch(() => {
      closed = true;
      abort.abort(); // client went away: stop spending tokens
    });
  };
  const keepalive = setInterval(() => {
    if (!closed) writer.write(enc.encode(": ping\n\n")).catch(() => {});
  }, 15_000);
  const job = (async () => {
    try {
      await runAgent(env, history, model, emit, abort.signal);
    } catch (e) {
      const msg = e instanceof LlmError ? e.message : `Internal error: ${(e as Error).message}`;
      if (!(e instanceof LlmError)) console.error("ask failed", e);
      emit("error", { message: msg });
    } finally {
      clearInterval(keepalive);
      closed = true;
      writer.close().catch(() => {});
    }
  })();
  ctx?.waitUntil(job);
  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
