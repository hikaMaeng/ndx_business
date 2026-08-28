import type { EventEnvelope } from "agent/common";
import { VIBE_ACTIONS, parseIterationScope } from "../../../common/index.js";
import type { ViewStore } from "../../view/index.js";
import { sessionKeyOf } from "../context/index.js";

const asText = (value: unknown): string => (typeof value === "string" ? value : "");
const asNumber = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);

/**
 * Writes the transcript down in the shape a screen wants it.
 *
 * It reacts to the same facts as everyone else and tells nobody anything. The
 * model reactor and this one are handed the same `model.replied`, on two
 * different queues, and neither knows the other exists — which is the only
 * reason a projection can be added at all without touching the agent.
 *
 * It emits nothing, so it is handed no sequence block and no folder. It reads
 * the log and writes two tables that could be dropped and rebuilt.
 *
 * Doing this here rather than in the reactors that produce the facts is
 * deliberate. A projection is slow work — it reads back a thousand deltas — and
 * putting it in the inference path would make answering the user wait on
 * bookkeeping nobody is watching yet.
 */
export async function projectView(view: ViewStore, event: EventEnvelope): Promise<{ projected: string }> {
  const sessionKey = sessionKeyOf(event);
  const payload = event.payload as Record<string, unknown>;
  if (!sessionKey) throw new Error(`${event.action} has no session to project`);

  switch (event.action) {
    case VIBE_ACTIONS.turnStarted: {
      const turnKey = asText(payload.turnKey);
      if (!turnKey) throw new Error(`${event.action} requires turnKey`);
      await view.startTurn(sessionKey, turnKey, asNumber(payload.seq), asText(payload.prompt));
      return { projected: "turn" };
    }

    case VIBE_ACTIONS.modelReplied: {
      const scope = parseIterationScope(payload);
      if (!scope) throw new Error(`${event.action} requires turnKey and iterationIndex`);
      await view.projectIteration(sessionKey, scope.turnKey, scope.iterationIndex);
      return { projected: "iteration" };
    }

    case VIBE_ACTIONS.toolCompleted: {
      const scope = parseIterationScope(payload);
      const toolCallKey = asText(payload.toolCallKey);
      if (!scope || !toolCallKey) throw new Error(`${event.action} requires turnKey, iterationIndex and toolCallKey`);
      await view.projectTool(sessionKey, scope.turnKey, scope.iterationIndex, toolCallKey, {
        exitCode: typeof payload.exitCode === "number" ? payload.exitCode : null,
        timedOut: payload.timedOut === true,
        durationMs: asNumber(payload.durationMs),
      });
      return { projected: "tool" };
    }

    case VIBE_ACTIONS.turnFinal: {
      const turnKey = asText(payload.turnKey);
      if (!turnKey) throw new Error(`${event.action} requires turnKey`);
      const stoppedBy = asText(payload.stoppedBy);
      // A turn that ran out of budget ended, but it did not answer. Saying so
      // in the view is the difference between a transcript and a lie.
      const failed = stoppedBy !== "" && stoppedBy !== "final";
      await view.finishTurn(
        sessionKey, turnKey,
        failed ? "failed" : "done",
        asText(payload.answer),
        failed ? `stopped by ${stoppedBy}` : "",
      );
      return { projected: "final" };
    }

    default:
      throw new Error(`the projection has nothing to do with ${event.action}`);
  }
}
