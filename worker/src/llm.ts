/** Minimal OpenAI-compatible /chat/completions client with SSE streaming and tool-call accumulation. */

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  cost_usd?: number;
}

export interface LlmResult {
  content: string;
  tool_calls: ToolCall[];
  finish_reason: string | null;
  usage: Usage | null;
}

export interface LlmRequest {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  tools?: unknown[];
  toolChoice?: "auto" | "none";
  referer?: string;
  maxTokens?: number;
  /** Abort if no bytes arrive for this long (ms). */
  idleTimeoutMs?: number;
  signal?: AbortSignal;
  onContent?: (delta: string) => void;
  onToolCall?: () => void;
}

export class LlmError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
  }
}

function parseUsage(u: any): Usage | null {
  if (!u || typeof u !== "object") return null;
  const out: Usage = { prompt_tokens: Number(u.prompt_tokens) || 0, completion_tokens: Number(u.completion_tokens) || 0 };
  const cost = u.cost ?? u.total_cost;
  if (cost != null && Number.isFinite(Number(cost))) out.cost_usd = Number(cost);
  return out;
}

function errMessage(body: any, status: number): string {
  const m = body?.error?.message ?? body?.message ?? (typeof body?.error === "string" ? body.error : null);
  return `LLM provider error (HTTP ${status})${m ? `: ${String(m).slice(0, 300)}` : ""}`;
}

export async function chat(req: LlmRequest): Promise<LlmResult> {
  const ctl = new AbortController();
  const idle = req.idleTimeoutMs ?? 60_000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const arm = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timedOut = true;
      ctl.abort();
    }, idle);
  };
  const onOuterAbort = () => ctl.abort();
  req.signal?.addEventListener("abort", onOuterAbort);
  arm();
  try {
    const body: Record<string, unknown> = {
      model: req.model,
      messages: req.messages,
      stream: true,
      stream_options: { include_usage: true },
      usage: { include: true },
      temperature: 0.2,
    };
    if (req.maxTokens) body.max_tokens = req.maxTokens;
    if (req.tools?.length) {
      body.tools = req.tools;
      body.tool_choice = req.toolChoice ?? "auto";
    }
    let res: Response;
    try {
      res = await fetch(`${req.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream, application/json",
          Authorization: `Bearer ${req.apiKey}`,
          "HTTP-Referer": req.referer ?? "https://railcert-ask.local",
          "X-Title": "Railcert Ask",
        },
        body: JSON.stringify(body),
        signal: ctl.signal,
      });
    } catch (e) {
      if (timedOut) throw new LlmError("The language model did not respond in time");
      throw new LlmError(`Could not reach the language model: ${(e as Error).message}`);
    }
    arm();
    if (!res.ok) {
      const b = await res.json().catch(() => null);
      throw new LlmError(errMessage(b, res.status), res.status);
    }
    const ct = res.headers.get("Content-Type") ?? "";
    if (!ct.includes("text/event-stream")) {
      // Provider ignored stream:true (or a mock): plain JSON completion.
      const b: any = await res.json();
      if (b?.error) throw new LlmError(errMessage(b, res.status));
      const msg = b?.choices?.[0]?.message ?? {};
      const content = typeof msg.content === "string" ? msg.content : "";
      const tool_calls: ToolCall[] = (msg.tool_calls ?? []).map((t: any, i: number) => ({
        id: t.id || `call_${i}`,
        type: "function",
        function: { name: t.function?.name ?? "", arguments: t.function?.arguments ?? "{}" },
      }));
      if (tool_calls.length) req.onToolCall?.();
      if (content) req.onContent?.(content);
      return { content, tool_calls, finish_reason: b?.choices?.[0]?.finish_reason ?? null, usage: parseUsage(b?.usage) };
    }
    return await readStream(res, req, arm, () => timedOut);
  } finally {
    if (timer) clearTimeout(timer);
    req.signal?.removeEventListener("abort", onOuterAbort);
  }
}

async function readStream(res: Response, req: LlmRequest, arm: () => void, timedOut: () => boolean): Promise<LlmResult> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let content = "";
  let finish: string | null = null;
  let usage: Usage | null = null;
  const calls = new Map<number, ToolCall>();
  let done = false;

  const handle = (data: string) => {
    if (data === "[DONE]") {
      done = true;
      return;
    }
    let j: any;
    try {
      j = JSON.parse(data);
    } catch {
      return;
    }
    if (j.error) throw new LlmError(errMessage(j, Number(j.error?.code) || 502));
    if (j.usage) usage = parseUsage(j.usage) ?? usage;
    const ch = j.choices?.[0];
    if (!ch) return;
    if (ch.finish_reason) finish = ch.finish_reason;
    const d = ch.delta ?? ch.message ?? {};
    for (const tc of d.tool_calls ?? []) {
      const idx = typeof tc.index === "number" ? tc.index : calls.size;
      let c = calls.get(idx);
      if (!c) {
        c = { id: tc.id || `call_${idx}`, type: "function", function: { name: "", arguments: "" } };
        calls.set(idx, c);
        req.onToolCall?.();
      }
      if (tc.id) c.id = tc.id;
      if (tc.function?.name) c.function.name += tc.function.name;
      if (tc.function?.arguments) c.function.arguments += tc.function.arguments;
    }
    if (typeof d.content === "string" && d.content) {
      content += d.content;
      req.onContent?.(d.content);
    }
  };

  try {
    while (!done) {
      const { value, done: eof } = await reader.read();
      if (eof) break;
      arm();
      buf += dec.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, "");
        buf = buf.slice(nl + 1);
        if (line.startsWith("data:")) handle(line.slice(5).trim());
        if (done) break;
      }
    }
    if (!done && buf.startsWith("data:")) handle(buf.slice(5).trim());
  } catch (e) {
    if (e instanceof LlmError) throw e;
    if (timedOut()) throw new LlmError("The language model stopped responding (timeout)");
    throw new LlmError(`Stream from the language model failed: ${(e as Error).message}`);
  } finally {
    reader.cancel().catch(() => {});
  }
  const tool_calls = [...calls.entries()].sort((a, b) => a[0] - b[0]).map(([, c]) => c).filter((c) => c.function.name);
  return { content, tool_calls, finish_reason: finish, usage };
}
