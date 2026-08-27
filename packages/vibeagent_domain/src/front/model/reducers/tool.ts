import type { VibeToolChunk, VibeToolCompleted, VibeToolFailed, VibeToolStarted } from "../../../common/index.js";
import type { VibeSnapshot } from "../state.js";
import { patchTool, patchTurn } from "./helpers.js";

/**
 * The model asked for a command. This is the request, not its result.
 *
 * It is also where the turn's command count comes from while the turn is live.
 * A folded turn keeps that count after its bodies are gone, and a turn folded
 * during the session it ran in never passes through the read model — so the
 * tally is kept from the blocks themselves rather than read back later.
 */
export function toolStarted(snapshot: VibeSnapshot, event: VibeToolStarted): VibeSnapshot {
  return patchTurn(snapshot, event.turnKey, (turn) => {
    const patched = patchTool(turn, event.toolCallKey, event.seq, (tool) => ({ ...tool, command: event.command }));
    return { ...patched, toolCalls: patched.blocks.filter((block) => block.kind === "tool").length };
  });
}

export function toolStdout(snapshot: VibeSnapshot, event: VibeToolChunk): VibeSnapshot {
  return patchTurn(snapshot, event.turnKey, (turn) => patchTool(turn, event.toolCallKey, event.seq, (tool) => ({ ...tool, stdout: [...tool.stdout, { seq: event.seq, text: event.chunk }] })));
}

export function toolStderr(snapshot: VibeSnapshot, event: VibeToolChunk): VibeSnapshot {
  return patchTurn(snapshot, event.turnKey, (turn) => patchTool(turn, event.toolCallKey, event.seq, (tool) => ({ ...tool, stderr: [...tool.stderr, { seq: event.seq, text: event.chunk }] })));
}

export function toolCompleted(snapshot: VibeSnapshot, event: VibeToolCompleted): VibeSnapshot {
  return patchTurn(snapshot, event.turnKey, (turn) => patchTool(turn, event.toolCallKey, event.seq, (tool) => ({
    ...tool, done: true, exitCode: event.exitCode, timedOut: event.timedOut, durationMs: event.durationMs,
  })));
}

/** The call never ran — a malformed request, not a command that exited badly. */
export function toolFailed(snapshot: VibeSnapshot, event: VibeToolFailed): VibeSnapshot {
  return patchTurn(snapshot, event.turnKey, (turn) => patchTool(turn, event.toolCallKey, event.seq, (tool) => ({ ...tool, done: true, failure: event.error })));
}
