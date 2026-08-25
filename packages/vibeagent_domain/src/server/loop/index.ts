import path from "node:path";
import { VIBE_PROGRESS_ACTIONS, type VibeTurnOutcome, type VibeTurnRequest } from "../../common/index.js";
import { chat, type ChatMessage, type LlmConfig } from "../llm/index.js";
import { BASH_TOOL_SCHEMA, runBash } from "../tools/bash/index.js";

export interface LoopConfig extends LlmConfig {
  workspaceRoot: string;
  maxIterations: number;
  toolTimeoutMs: number;
  maxToolOutputBytes: number;
}

export type Emit = (payload: Record<string, unknown>) => void;

const SYSTEM_PROMPT = [
  "You are a coding agent working inside a Linux workspace.",
  "",
  "You have exactly one tool: `bash`. Every action — creating directories, writing files,",
  "reading them back, running checks — happens through a bash command. There is no file-write",
  "tool; write files with a quoted heredoc, for example:",
  "",
  "  cat > index.html <<'EOF'",
  "  ...contents...",
  "  EOF",
  "",
  "Rules:",
  "- The working directory is already the session workspace. Use relative paths.",
  "- Quote the heredoc delimiter ('EOF') so the shell does not expand $ or backticks in the file.",
  "- After writing a file, read it back with `cat` to verify it landed correctly.",
  "- Keep each command small and check its output before the next one.",
  "- When the task is done and verified, reply with a short plain-text summary and no tool call.",
].join("\n");

/** Keeps a tool result readable for the model without letting one command flood the context. */
function summariseForModel(result: { exitCode: number | null; stdout: string; stderr: string; timedOut: boolean }): string {
  const head = `exit_code=${result.exitCode ?? "null"}${result.timedOut ? " (timed out)" : ""}`;
  const cap = (label: string, text: string): string => (text.trim() ? `\n${label}:\n${text.length > 6000 ? `${text.slice(text.length - 6000)}\n[truncated]` : text}` : "");
  return `${head}${cap("stdout", result.stdout)}${cap("stderr", result.stderr)}` || head;
}

/**
 * One Turn: iterate model → bash → model until the model answers without a tool
 * call, or the iteration budget runs out.
 *
 * Every observation is emitted as a durable broker event, so a client that
 * reconnects mid-turn replays the whole transcript instead of seeing a gap.
 */
export async function runTurn(request: VibeTurnRequest, config: LoopConfig, emit: Emit, signal: AbortSignal): Promise<VibeTurnOutcome> {
  // One directory per session so consecutive turns build on each other, and a
  // session can never reach another session's files.
  const workspace = path.join(config.workspaceRoot, request.sessionKey);

  emit({ action: VIBE_PROGRESS_ACTIONS.turnStarted, sessionKey: request.sessionKey, turnKey: request.turnKey, workspace, prompt: request.prompt });

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: request.prompt },
  ];

  let toolCalls = 0;
  let iteration = 0;

  for (; iteration < config.maxIterations; iteration += 1) {
    if (signal.aborted) throw new Error("turn aborted");
    emit({ action: VIBE_PROGRESS_ACTIONS.iterationStarted, turnKey: request.turnKey, iterationIndex: iteration });

    const reply = await chat(config, messages, [BASH_TOOL_SCHEMA], signal);

    if (reply.reasoning.trim()) {
      emit({ action: VIBE_PROGRESS_ACTIONS.iterationReasoning, turnKey: request.turnKey, iterationIndex: iteration, reasoning: reply.reasoning });
    }
    if (reply.content.trim()) {
      emit({ action: VIBE_PROGRESS_ACTIONS.iterationMessage, turnKey: request.turnKey, iterationIndex: iteration, message: reply.content });
    }

    // No tool call means the model is answering, which is the only clean exit.
    if (!reply.toolCalls.length) {
      const answer = reply.content.trim() || reply.reasoning.trim();
      emit({ action: VIBE_PROGRESS_ACTIONS.turnFinal, turnKey: request.turnKey, answer });
      return { sessionKey: request.sessionKey, turnKey: request.turnKey, iterations: iteration + 1, toolCalls, answer, stoppedBy: "final" };
    }

    messages.push({ role: "assistant", content: reply.content, tool_calls: reply.toolCalls });

    for (const call of reply.toolCalls) {
      toolCalls += 1;
      // Deterministic so a replayed turn addresses the same logical call.
      const toolCallKey = `${request.turnKey}:${iteration}:${toolCalls}`;
      let command = "";
      try {
        const parsed = JSON.parse(call.function.arguments || "{}") as { command?: unknown };
        command = typeof parsed.command === "string" ? parsed.command : "";
      } catch { command = ""; }

      if (!command) {
        emit({ action: VIBE_PROGRESS_ACTIONS.toolFailed, turnKey: request.turnKey, toolCallKey, error: "tool call had no command" });
        messages.push({ role: "tool", tool_call_id: call.id, content: "error: the bash tool requires a non-empty `command` string." });
        continue;
      }

      emit({ action: VIBE_PROGRESS_ACTIONS.toolStarted, turnKey: request.turnKey, toolCallKey, command });

      const result = await runBash(command, {
        workspace,
        timeoutMs: config.toolTimeoutMs,
        maxOutputBytes: config.maxToolOutputBytes,
        signal,
        onStdout: (chunk) => emit({ action: VIBE_PROGRESS_ACTIONS.toolStdout, turnKey: request.turnKey, toolCallKey, chunk }),
        onStderr: (chunk) => emit({ action: VIBE_PROGRESS_ACTIONS.toolStderr, turnKey: request.turnKey, toolCallKey, chunk }),
      });

      emit({
        action: VIBE_PROGRESS_ACTIONS.toolCompleted, turnKey: request.turnKey, toolCallKey,
        exitCode: result.exitCode, timedOut: result.timedOut, durationMs: result.durationMs,
      });

      messages.push({ role: "tool", tool_call_id: call.id, content: summariseForModel(result) });
    }
  }

  const answer = "Stopped: reached the iteration budget before the model produced a final answer.";
  emit({ action: VIBE_PROGRESS_ACTIONS.turnFinal, turnKey: request.turnKey, answer, stoppedBy: "iteration_budget" });
  return { sessionKey: request.sessionKey, turnKey: request.turnKey, iterations: iteration, toolCalls, answer, stoppedBy: "iteration_budget" };
}
