/**
 * Minimal OpenAI-compatible chat client, streaming.
 *
 * Written against the deployed endpoint's actual behaviour rather than the
 * generic spec: this model is a reasoning model that returns its chain in a
 * separate `reasoning_content` field and leaves `content` empty on a tool call.
 * Treating an empty `content` as "no answer" would end every turn early.
 *
 * It streams because inference is where a turn spends most of its wall clock.
 * A non-streaming call makes the whole model response one silent block — the
 * turn loop emits bash output while a command runs, then goes quiet for the
 * far longer stretch it spends waiting on the model. Deltas close that gap.
 */

export interface ChatToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; tool_calls?: ChatToolCall[] }
  | { role: "tool"; content: string; tool_call_id: string };

export interface ChatReply {
  content: string;
  reasoning: string;
  toolCalls: ChatToolCall[];
  finishReason: string;
  /** False when the endpoint answered in one block, so the caller can emit the whole text itself. */
  streamed: boolean;
}

/** A coalesced slice of the model's output. Never a whole message. */
export interface ChatDelta {
  content?: string;
  reasoning?: string;
}

export interface LlmConfig {
  baseUrl: string;
  model: string;
  apiKey?: string;
  /** Coding wants near-deterministic output; see docs/constraints.md. */
  temperature: number;
  topP: number;
  /**
   * The rest of the sampling window.
   *
   * Optional because not every endpoint accepts them, and sending a parameter a
   * server does not know is a 400 rather than something ignored. Omitted when
   * unset, so a deployment that says nothing gets the endpoint's own defaults
   * instead of ours.
   */
  topK?: number;
  minP?: number;
  repeatPenalty?: number;
  maxTokens: number;
  requestTimeoutMs: number;
  /**
   * How long deltas accumulate before one is emitted.
   *
   * Per-token events would be the most responsive and the most expensive: every
   * one becomes a durable row and a socket frame. This buys back most of the
   * responsiveness at a fraction of the volume.
   */
  streamFlushMs: number;
}

interface StreamChoice {
  finish_reason?: string | null;
  delta?: {
    content?: string | null;
    reasoning_content?: string | null;
    tool_calls?: Array<{ index?: number; id?: string; type?: string; function?: { name?: string; arguments?: string } }> | null;
  };
  message?: { content?: string | null; reasoning_content?: string | null; tool_calls?: ChatToolCall[] | null };
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export async function chat(
  config: LlmConfig,
  messages: ChatMessage[],
  tools: unknown[],
  signal?: AbortSignal,
  onDelta?: (delta: ChatDelta) => void,
): Promise<ChatReply> {
  const timeout = AbortSignal.timeout(config.requestTimeoutMs);
  const composed = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const response = await fetch(`${config.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "text/event-stream",
      ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      ...(tools.length ? { tools, tool_choice: "auto" } : {}),
      temperature: config.temperature,
      top_p: config.topP,
      ...(config.topK === undefined ? {} : { top_k: config.topK }),
      ...(config.minP === undefined ? {} : { min_p: config.minP }),
      ...(config.repeatPenalty === undefined ? {} : { repetition_penalty: config.repeatPenalty }),
      max_tokens: config.maxTokens,
      stream: true,
    }),
    signal: composed,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`inference endpoint returned ${response.status}: ${body.slice(0, 500)}`);
  }
  if (!response.body) throw new Error("inference endpoint returned no body");

  let content = "";
  let reasoning = "";
  let finishReason = "";
  let streamed = false;
  // Tool calls arrive as fragments identified by index; arguments accumulate.
  const toolCalls = new Map<number, ChatToolCall>();

  let pendingContent = "";
  let pendingReasoning = "";
  let lastFlush = Date.now();
  const flush = (force: boolean): void => {
    if (!pendingContent && !pendingReasoning) return;
    if (!force && Date.now() - lastFlush < config.streamFlushMs) return;
    if (onDelta) {
      onDelta({
        ...(pendingContent ? { content: pendingContent } : {}),
        ...(pendingReasoning ? { reasoning: pendingReasoning } : {}),
      });
      streamed = true;
    }
    pendingContent = "";
    pendingReasoning = "";
    lastFlush = Date.now();
  };

  const applyChoice = (choice: StreamChoice): void => {
    if (choice.finish_reason) finishReason = choice.finish_reason;
    // A server that ignores `stream` answers with a whole message instead.
    if (choice.message) {
      content += textOf(choice.message.content);
      reasoning += textOf(choice.message.reasoning_content);
      if (Array.isArray(choice.message.tool_calls)) {
        choice.message.tool_calls.forEach((call, index) => toolCalls.set(index, call));
      }
      return;
    }
    const delta = choice.delta;
    if (!delta) return;
    const contentPart = textOf(delta.content);
    const reasoningPart = textOf(delta.reasoning_content);
    if (contentPart) { content += contentPart; pendingContent += contentPart; }
    if (reasoningPart) { reasoning += reasoningPart; pendingReasoning += reasoningPart; }
    for (const part of delta.tool_calls ?? []) {
      const index = typeof part.index === "number" ? part.index : 0;
      const existing = toolCalls.get(index) ?? { id: "", type: "function" as const, function: { name: "", arguments: "" } };
      toolCalls.set(index, {
        id: part.id ?? existing.id,
        type: "function",
        function: {
          name: part.function?.name ?? existing.function.name,
          arguments: existing.function.arguments + (part.function?.arguments ?? ""),
        },
      });
    }
  };

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // Each SSE `data:` line here carries one complete JSON frame, so lines are
      // a sufficient boundary; the trailing partial stays in the buffer.
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const raw of lines) {
        const line = raw.trim();
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        let frame: { choices?: StreamChoice[] };
        try { frame = JSON.parse(data) as { choices?: StreamChoice[] }; } catch { continue; }
        const choice = frame.choices?.[0];
        if (choice) applyChoice(choice);
      }
      flush(false);
    }
  } finally {
    reader.releaseLock();
  }
  flush(true);

  if (!content && !reasoning && !toolCalls.size) throw new Error("inference endpoint returned no choices");

  return {
    content,
    reasoning,
    toolCalls: [...toolCalls.entries()].sort(([left], [right]) => left - right).map(([, call]) => call),
    finishReason,
    streamed,
  };
}
