import type { LlmConfig } from "../llm/index.js";

/**
 * Everything a reactor needs from configuration.
 *
 * One object, because reactors are handed their state rather than reaching for
 * it, and this is the half of that state every session shares.
 */
export interface LoopConfig extends LlmConfig {
  workspaceRoot: string;
  maxIterations: number;
  toolTimeoutMs: number;
  maxToolOutputBytes: number;
  systemPrompt: string;
}

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

/** Written once per session, when its history is still empty. */
const SYSTEM_PROMPT = [
  "You are a coding agent working inside a Linux workspace.",
  "",
  "You have exactly one tool: bash. Every action — creating directories, writing files,",
  "reading them back, running checks — happens through a bash command. There is no",
  "file-write tool; write files with a quoted heredoc, for example:",
  "",
  "  cat > index.html <<QUOTED_EOF",
  "  ...contents...",
  "  QUOTED_EOF",
  "",
  "using a real quoted delimiter such as single-quoted EOF.",
  "",
  "Rules:",
  "- The working directory is already the session workspace. Use relative paths.",
  "- Quote the heredoc delimiter so the shell does not expand $ or backticks in the file.",
  "- After writing a file, read it back with cat to verify it landed correctly.",
  "- Keep each command small and check its output before the next one.",
  "- When the task is done and verified, reply with a short plain-text summary and no tool call.",
].join("\n");

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
 * - `streamFlushMs 120` — deltas are coalesced before they become events. Per
 *   token would be the most responsive and the most expensive, since every one
 *   becomes a durable row and a socket frame.
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
    streamFlushMs: positive(source, "VIBE_INFERENCE_STREAM_FLUSH_MS", 120),
    workspaceRoot: source.VIBE_WORKSPACE_ROOT ?? "/workspace",
    maxIterations: positive(source, "VIBE_MAX_ITERATIONS", 24),
    toolTimeoutMs: positive(source, "VIBE_TOOL_TIMEOUT_MS", 120_000),
    maxToolOutputBytes: positive(source, "VIBE_TOOL_MAX_OUTPUT_BYTES", 200_000),
    systemPrompt: source.VIBE_SYSTEM_PROMPT ?? SYSTEM_PROMPT,
  };
}
