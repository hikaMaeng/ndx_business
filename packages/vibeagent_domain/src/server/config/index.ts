import type { LoopConfig } from "../loop/index.js";

function required(source: NodeJS.ProcessEnv, name: string): string {
  const value = source[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function positive(source: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = source[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number`);
  return value;
}

function ratio(source: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = source[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 2) throw new Error(`${name} must be between 0 and 2`);
  return value;
}

/**
 * Inference defaults are tuned for code generation, not chat:
 *
 * - `temperature 0.15` — code has far fewer acceptable variants than prose, and
 *   a stray token in a heredoc silently corrupts the file being written.
 * - `topP 0.9` — trims the tail without the determinism lock-in of greedy decoding,
 *   which on this model tends to loop when a command fails.
 * - `maxTokens 8192` — this is a reasoning model; it spends tokens on
 *   `reasoning_content` before emitting a tool call, so a small budget truncates
 *   mid-thought and returns nothing usable.
 */
export function readLoopConfig(source: NodeJS.ProcessEnv = process.env): LoopConfig {
  return {
    baseUrl: required(source, "VIBE_INFERENCE_BASE_URL"),
    model: required(source, "VIBE_INFERENCE_MODEL"),
    ...(source.VIBE_INFERENCE_API_KEY ? { apiKey: source.VIBE_INFERENCE_API_KEY } : {}),
    temperature: ratio(source, "VIBE_INFERENCE_TEMPERATURE", 0.15),
    topP: ratio(source, "VIBE_INFERENCE_TOP_P", 0.9),
    maxTokens: positive(source, "VIBE_INFERENCE_MAX_TOKENS", 8192),
    requestTimeoutMs: positive(source, "VIBE_INFERENCE_TIMEOUT_MS", 300_000),
    workspaceRoot: source.VIBE_WORKSPACE_ROOT ?? "/workspace",
    maxIterations: positive(source, "VIBE_MAX_ITERATIONS", 24),
    toolTimeoutMs: positive(source, "VIBE_TOOL_TIMEOUT_MS", 120_000),
    maxToolOutputBytes: positive(source, "VIBE_TOOL_MAX_OUTPUT_BYTES", 200_000),
  };
}
