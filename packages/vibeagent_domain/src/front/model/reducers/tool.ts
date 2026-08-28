import type { VibeToolChunk, VibeToolCompleted, VibeToolFailed, VibeToolStarted } from "../../../common/index.js";
import type { VibeSessionModel } from "../VibeSessionModel.js";

/**
 * The model asked for a command. This is the request, not its result.
 *
 * It is also where the turn's command count comes from while the turn is live.
 * A folded turn keeps that count after its bodies are gone, and a turn folded
 * during the session it ran in never passes through the read model — so the
 * tally is kept from the blocks themselves rather than read back later.
 */
export function toolStarted(model: VibeSessionModel, event: VibeToolStarted): void {
  const turn = model.ensureTurn(event.turnKey);
  turn.patchTool(event.toolCallKey, event.seq, (tool) => { tool.command = event.command; });
  turn.change((current) => { current.toolCalls = current.blocks.filter((block) => block.kind === "tool").length; });
}

export function toolStdout(model: VibeSessionModel, event: VibeToolChunk): void {
  model.ensureTurn(event.turnKey).patchTool(event.toolCallKey, event.seq, (tool) => {
    tool.stdout.push({ seq: event.seq, text: event.chunk });
  });
}

export function toolStderr(model: VibeSessionModel, event: VibeToolChunk): void {
  model.ensureTurn(event.turnKey).patchTool(event.toolCallKey, event.seq, (tool) => {
    tool.stderr.push({ seq: event.seq, text: event.chunk });
  });
}

export function toolCompleted(model: VibeSessionModel, event: VibeToolCompleted): void {
  model.ensureTurn(event.turnKey).patchTool(event.toolCallKey, event.seq, (tool) => {
    tool.done = true;
    tool.exitCode = event.exitCode;
    tool.timedOut = event.timedOut;
    tool.durationMs = event.durationMs;
  });
}

/** The call never ran — a malformed request, not a command that exited badly. */
export function toolFailed(model: VibeSessionModel, event: VibeToolFailed): void {
  model.ensureTurn(event.turnKey).patchTool(event.toolCallKey, event.seq, (tool) => {
    tool.done = true;
    tool.failure = event.error;
  });
}
