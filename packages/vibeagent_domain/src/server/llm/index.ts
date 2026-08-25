/**
 * Minimal OpenAI-compatible chat client.
 *
 * Written against the deployed endpoint's actual behaviour rather than the
 * generic spec: this model is a reasoning model that returns its chain in a
 * separate `reasoning_content` field and leaves `content` empty on a tool call.
 * Treating an empty `content` as "no answer" would end every turn early.
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
}

export interface LlmConfig {
  baseUrl: string;
  model: string;
  apiKey?: string;
  /** Coding wants near-deterministic output; see docs/constraints.md. */
  temperature: number;
  topP: number;
  maxTokens: number;
  requestTimeoutMs: number;
}

interface RawChoice {
  finish_reason?: string;
  message?: { content?: string | null; reasoning_content?: string | null; tool_calls?: ChatToolCall[] | null };
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export async function chat(config: LlmConfig, messages: ChatMessage[], tools: unknown[], signal?: AbortSignal): Promise<ChatReply> {
  const timeout = AbortSignal.timeout(config.requestTimeoutMs);
  const composed = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const response = await fetch(`${config.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      ...(tools.length ? { tools, tool_choice: "auto" } : {}),
      temperature: config.temperature,
      top_p: config.topP,
      max_tokens: config.maxTokens,
      stream: false,
    }),
    signal: composed,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`inference endpoint returned ${response.status}: ${body.slice(0, 500)}`);
  }

  const payload = await response.json() as { choices?: RawChoice[] };
  const choice = payload.choices?.[0];
  if (!choice) throw new Error("inference endpoint returned no choices");

  return {
    content: textOf(choice.message?.content),
    reasoning: textOf(choice.message?.reasoning_content),
    toolCalls: Array.isArray(choice.message?.tool_calls) ? choice.message!.tool_calls! : [],
    finishReason: textOf(choice.finish_reason),
  };
}
