import path from "node:path";
import type { EventEnvelope } from "agent/common";
import type { WorkerEmit } from "agent/broker/worker";
import { VIBE_ACTIONS, parseIterationScope } from "../../common/index.js";
import { runBash } from "../tools/bash/index.js";
import { resolveWorkspaceDirectory } from "../workspace/index.js";
import type { ReactorGlobals, SessionContext } from "./context.js";

/** Keeps a tool result readable for the model without letting one command flood the context. */
function summariseForModel(result: { exitCode: number | null; stdout: string; stderr: string; timedOut: boolean }): string {
  const head = `exit_code=${result.exitCode ?? "null"}${result.timedOut ? " (timed out)" : ""}`;
  const cap = (label: string, text: string): string => (text.trim() ? `\n${label}:\n${text.length > 6000 ? `${text.slice(text.length - 6000)}\n[truncated]` : text}` : "");
  return `${head}${cap("stdout", result.stdout)}${cap("stderr", result.stderr)}` || head;
}

/**
 * One command, start to exit.
 *
 * It relays the process's output as facts while the process is still running,
 * and when the result has settled it writes that result into the session's
 * history and records that this one call is finished. Nothing else.
 *
 * It waits for the child, and that is correct — the child is its single task.
 * What it does not do is look at whether any other call is still running, or
 * decide what happens once they all are.
 */
export async function runTool(
  globals: ReactorGlobals,
  session: SessionContext,
  event: EventEnvelope,
  emit: WorkerEmit,
  signal: AbortSignal,
): Promise<{ toolCallKey: string; exitCode: number | null }> {
  const scope = parseIterationScope(event.payload);
  const payload = event.payload as Record<string, unknown>;
  const toolCallKey = typeof payload.toolCallKey === "string" ? payload.toolCallKey : "";
  const toolCallId = typeof payload.toolCallId === "string" ? payload.toolCallId : "";
  const command = typeof payload.command === "string" ? payload.command : "";
  if (!scope || !toolCallKey || !toolCallId) throw new Error(`${VIBE_ACTIONS.toolRequested} requires turnKey, iterationIndex, toolCallKey and toolCallId`);

  const common = { turnKey: scope.turnKey, iterationIndex: scope.iterationIndex, toolCallKey };

  if (!command) {
    const message = "the bash tool requires a non-empty `command` string.";
    emit({ action: VIBE_ACTIONS.toolFailed, seq: session.sequence.next(), ...common, error: message });
    // A refused call still has to answer, or the join would wait for ever.
    await session.store.appendMessages(session.sessionKey, [{
      turnKey: scope.turnKey, iterationIndex: scope.iterationIndex,
      role: "tool", content: `error: ${message}`, toolCallId,
    }]);
    emit({ action: VIBE_ACTIONS.toolCompleted, seq: session.sequence.next(), ...common, exitCode: null, timedOut: false, durationMs: 0 });
    return { toolCallKey, exitCode: null };
  }

  emit({ action: VIBE_ACTIONS.toolStarted, seq: session.sequence.next(), turnKey: scope.turnKey, toolCallKey, command });

  const directory = path.resolve(resolveWorkspaceDirectory(globals.config.workspaceRoot, session.workspace));
  const result = await runBash(command, {
    workspace: directory,
    timeoutMs: globals.config.toolTimeoutMs,
    maxOutputBytes: globals.config.maxToolOutputBytes,
    signal,
    onStdout: (chunk) => emit({ action: VIBE_ACTIONS.toolStdout, seq: session.sequence.next(), turnKey: scope.turnKey, toolCallKey, chunk }),
    onStderr: (chunk) => emit({ action: VIBE_ACTIONS.toolStderr, seq: session.sequence.next(), turnKey: scope.turnKey, toolCallKey, chunk }),
  });

  // The answer goes into the history first. `tool.completed` claims the result
  // is recorded, so it must be true by the time anyone reads that claim.
  await session.store.appendMessages(session.sessionKey, [{
    turnKey: scope.turnKey, iterationIndex: scope.iterationIndex,
    role: "tool", content: summariseForModel(result), toolCallId,
  }]);

  emit({
    action: VIBE_ACTIONS.toolCompleted, seq: session.sequence.next(), ...common,
    exitCode: result.exitCode, timedOut: result.timedOut, durationMs: result.durationMs,
  });

  return { toolCallKey, exitCode: result.exitCode };
}
