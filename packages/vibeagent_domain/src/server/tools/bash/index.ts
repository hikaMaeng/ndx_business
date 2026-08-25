import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import type { VibeToolResult } from "../../../common/index.js";

export interface BashToolOptions {
  workspace: string;
  timeoutMs: number;
  maxOutputBytes: number;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
  signal?: AbortSignal;
}

/**
 * Truncates from the tail because a shell command's useful signal (the error,
 * the last lines of a build) is at the end, and an unbounded buffer here would
 * let one `find /` exhaust the worker thread.
 */
function appendBounded(buffer: string, chunk: string, maxBytes: number): string {
  const next = buffer + chunk;
  return next.length <= maxBytes ? next : next.slice(next.length - maxBytes);
}

/**
 * The only tool this agent has.
 *
 * It runs in a **separate OS process**, never inside the worker thread: the
 * thread must stay free to answer heartbeats and abort signals while a command
 * runs. `detached` is deliberately false so the child dies with the worker
 * rather than outliving it as an orphan.
 */
export function runBash(command: string, options: BashToolOptions): Promise<VibeToolResult & { toolCallKey: string }> {
  const startedAt = Date.now();
  mkdirSync(options.workspace, { recursive: true });
  return new Promise((resolve) => {
    const child = spawn("bash", ["-lc", command], {
      cwd: options.workspace,
      env: { ...process.env, PS1: "", TERM: "dumb", CI: "1" },
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, options.timeoutMs);
    const onAbort = (): void => { child.kill("SIGKILL"); };
    options.signal?.addEventListener("abort", onAbort, { once: true });

    const finish = (exitCode: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      resolve({ toolCallKey: "", exitCode, stdout, stderr, timedOut, durationMs: Date.now() - startedAt });
    };

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout = appendBounded(stdout, chunk, options.maxOutputBytes); options.onStdout?.(chunk); });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => { stderr = appendBounded(stderr, chunk, options.maxOutputBytes); options.onStderr?.(chunk); });

    // `error` fires when the binary is missing; `close` waits for the pipes to
    // drain, which `exit` does not.
    child.on("error", (error) => { stderr = appendBounded(stderr, `${error.message}\n`, options.maxOutputBytes); finish(null); });
    child.on("close", (code) => finish(code));
  });
}

/** The tool definition handed to the model. One tool, on purpose. */
export const BASH_TOOL_SCHEMA = {
  type: "function" as const,
  function: {
    name: "bash",
    description: "Run a bash command inside the session workspace and return its stdout, stderr and exit code. This is the only tool available; use it to create directories, write files with heredocs, inspect results, and verify your work.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "The bash command to run. Use a heredoc to write file contents." },
      },
      required: ["command"],
    },
  },
};
