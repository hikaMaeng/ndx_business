import type { Pool } from "pg";
import { VIBE_ACTIONS } from "../../common/index.js";

/** A turn as it appears while collapsed: enough to decide whether to open it. */
export interface TurnSummary {
  turnKey: string;
  seq: number;
  prompt: string;
  phase: string;
  answer: string;
  error: string;
  iterations: number;
  toolCalls: number;
  startedAt: string;
  endedAt: string;
}

/** A folded block, as stored. One row is one thing the agent did. */
export interface BlockRow {
  seq: number;
  kind: "reasoning" | "message" | "tool";
  iterationIndex: number;
  toolCallKey: string;
  command: string;
  body: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
}

interface PayloadRow { action: string; payload: Record<string, unknown> }

const asText = (value: unknown): string => (typeof value === "string" ? value : "");
const asNumber = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);

/**
 * Joins streamed deltas in the order their emitter gave them.
 *
 * Never in arrival order. A burst of deltas is not a causal chain — nothing was
 * received and handled to produce the next one — so the only thing that can
 * order them is the position the emitter put in each payload. The rows arrive
 * sorted by that; this concatenates them.
 */
function fold(rows: readonly PayloadRow[], field: string): string {
  return rows.map((row) => asText(row.payload[field])).join("");
}

/**
 * Writes and reads the folded transcript.
 *
 * Every write here is idempotent. The projection is fed by an at-least-once
 * queue, so the same fact can arrive twice, and folding it twice has to produce
 * the same row rather than a duplicate or a doubled body. That is why nothing
 * here appends: every statement is an upsert keyed on what the fact identifies,
 * and every count is recomputed rather than incremented.
 */
export class ViewStore {
  constructor(private readonly pool: Pool) {}

  /** Opens a turn's row. The prompt is known now; the rest fills in later. */
  async startTurn(sessionKey: string, turnKey: string, seq: number, prompt: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO vibe_turn_view (session_key, turn_key, seq, prompt, phase)
       VALUES ($1, $2, $3, $4, 'running')
       ON CONFLICT (session_key, turn_key) DO UPDATE
         SET prompt = EXCLUDED.prompt, seq = EXCLUDED.seq`,
      [sessionKey, turnKey, seq, prompt],
    );
  }

  /** Closes a turn's row. `phase` is `done` or `failed`; both are terminal. */
  async finishTurn(sessionKey: string, turnKey: string, phase: string, answer: string, error: string): Promise<void> {
    await this.pool.query(
      `UPDATE vibe_turn_view
          SET phase = $3, answer = $4, error = $5, ended_at = now()
        WHERE session_key = $1 AND turn_key = $2`,
      [sessionKey, turnKey, phase, answer, error],
    );
  }

  private async putBlock(sessionKey: string, turnKey: string, block: BlockRow): Promise<void> {
    await this.pool.query(
      `INSERT INTO vibe_block_view
         (session_key, turn_key, seq, kind, iteration_index, tool_call_key, command, body, exit_code, timed_out, duration_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (session_key, turn_key, seq) DO UPDATE
         SET body = EXCLUDED.body, command = EXCLUDED.command, exit_code = EXCLUDED.exit_code,
             timed_out = EXCLUDED.timed_out, duration_ms = EXCLUDED.duration_ms`,
      [
        sessionKey, turnKey, block.seq, block.kind, block.iterationIndex, block.toolCallKey,
        block.command, block.body, block.exitCode, block.timedOut, block.durationMs,
      ],
    );
  }

  /**
   * Reads one iteration's deltas back out of the log.
   *
   * This is the whole point of the projection. A thousand delta facts collapse
   * to a single body here, once, instead of on every reader's screen for ever.
   */
  private async foldText(sessionKey: string, turnKey: string, iterationIndex: number): Promise<{
    reasoning: string; message: string; reasoningSeq: number; messageSeq: number;
  }> {
    const result = await this.pool.query<PayloadRow>(
      `SELECT action, payload FROM event_store
        WHERE session_id = $1
          AND payload->>'turnKey' = $2
          AND (payload->>'iterationIndex')::int = $3
          AND action = ANY($4::text[])
        ORDER BY (payload->>'seq')::bigint`,
      [sessionKey, turnKey, iterationIndex, [VIBE_ACTIONS.iterationReasoning, VIBE_ACTIONS.iterationMessage]],
    );
    const reasoning = result.rows.filter((row) => row.action === VIBE_ACTIONS.iterationReasoning);
    const message = result.rows.filter((row) => row.action === VIBE_ACTIONS.iterationMessage);
    return {
      reasoning: fold(reasoning, "reasoning"),
      message: fold(message, "message"),
      // A folded block keeps the position of its first delta, so blocks sort
      // among each other exactly as the live ones did.
      reasoningSeq: asNumber(reasoning[0]?.payload.seq),
      messageSeq: asNumber(message[0]?.payload.seq),
    };
  }

  /** Folds one iteration's thinking and speech, and counts the iteration. */
  async projectIteration(sessionKey: string, turnKey: string, iterationIndex: number): Promise<void> {
    const folded = await this.foldText(sessionKey, turnKey, iterationIndex);

    if (folded.reasoning) {
      await this.putBlock(sessionKey, turnKey, {
        seq: folded.reasoningSeq, kind: "reasoning", iterationIndex, toolCallKey: "",
        command: "", body: folded.reasoning, exitCode: null, timedOut: false, durationMs: 0,
      });
    }
    if (folded.message) {
      await this.putBlock(sessionKey, turnKey, {
        seq: folded.messageSeq, kind: "message", iterationIndex, toolCallKey: "",
        command: "", body: folded.message, exitCode: null, timedOut: false, durationMs: 0,
      });
    }

    // `greatest` rather than `+ 1`: a redelivered fact must not count twice.
    await this.pool.query(
      "UPDATE vibe_turn_view SET iterations = greatest(iterations, $3) WHERE session_key = $1 AND turn_key = $2",
      [sessionKey, turnKey, iterationIndex + 1],
    );
  }

  /** Folds one command: what was asked for, what the machine said, how it ended. */
  async projectTool(
    sessionKey: string,
    turnKey: string,
    iterationIndex: number,
    toolCallKey: string,
    outcome: { exitCode: number | null; timedOut: boolean; durationMs: number },
  ): Promise<void> {
    const result = await this.pool.query<PayloadRow>(
      `SELECT action, payload FROM event_store
        WHERE session_id = $1
          AND payload->>'turnKey' = $2
          AND payload->>'toolCallKey' = $3
          AND action = ANY($4::text[])
        ORDER BY (payload->>'seq')::bigint`,
      [sessionKey, turnKey, toolCallKey, [VIBE_ACTIONS.toolStarted, VIBE_ACTIONS.toolStdout, VIBE_ACTIONS.toolStderr]],
    );

    const started = result.rows.find((row) => row.action === VIBE_ACTIONS.toolStarted);
    const out = fold(result.rows.filter((row) => row.action === VIBE_ACTIONS.toolStdout), "chunk");
    const err = fold(result.rows.filter((row) => row.action === VIBE_ACTIONS.toolStderr), "chunk");

    await this.putBlock(sessionKey, turnKey, {
      seq: asNumber(started?.payload.seq) || asNumber(result.rows[0]?.payload.seq),
      kind: "tool", iterationIndex, toolCallKey,
      command: asText(started?.payload.command),
      body: [out, err].filter((part) => part.trim()).join("\n"),
      exitCode: outcome.exitCode, timedOut: outcome.timedOut, durationMs: outcome.durationMs,
    });

    // Counted by asking the table, so a redelivery cannot inflate it.
    await this.pool.query(
      `UPDATE vibe_turn_view SET tool_calls =
         (SELECT count(*) FROM vibe_block_view WHERE session_key = $1 AND turn_key = $2 AND kind = 'tool')
        WHERE session_key = $1 AND turn_key = $2`,
      [sessionKey, turnKey],
    );
  }

  /**
   * How many turns the log says this session has.
   *
   * The projection is compared against this before it is trusted. "Is it
   * empty?" is the wrong question — a session half-projected by a dispatcher
   * that restarted mid-turn is not empty, and it would otherwise show a
   * transcript that simply stops, with nothing to indicate anything is missing.
   *
   * Counted from `turn.started` because that is the fact that says a turn
   * exists at all. `kind = 'progress'` excludes the dispatcher's copies, which
   * are the same fact addressed to a queue and would double every count.
   */
  async loggedTurnCount(sessionKey: string): Promise<number> {
    const result = await this.pool.query<{ turns: string }>(
      `SELECT count(DISTINCT payload->>'turnKey')::text AS turns
         FROM event_store
        WHERE session_id = $1 AND action = $2 AND kind = 'progress'`,
      [sessionKey, VIBE_ACTIONS.turnStarted],
    );
    return Number(result.rows[0]?.turns ?? 0);
  }

  /**
   * Folds a whole session out of the log.
   *
   * The schema calls these tables disposable; this is the method that makes
   * that true rather than merely claimed. It applies the same folds the live
   * projection applies, to the same facts, read back in order — so a session
   * that predates the projection, or one whose facts were stranded by a
   * dispatcher restart, becomes readable without anything being replayed to a
   * browser.
   *
   * Every write it performs is an upsert, so rebuilding a session that is
   * already projected changes nothing and rebuilding one twice at once is safe.
   */
  async rebuild(sessionKey: string): Promise<number> {
    const result = await this.pool.query<PayloadRow>(
      `SELECT action, payload FROM event_store
        WHERE session_id = $1 AND kind <> 'command' AND action = ANY($2::text[])
        ORDER BY (payload->>'seq')::bigint`,
      [sessionKey, [VIBE_ACTIONS.turnStarted, VIBE_ACTIONS.modelReplied, VIBE_ACTIONS.toolCompleted, VIBE_ACTIONS.turnFinal]],
    );

    for (const row of result.rows) {
      const payload = row.payload;
      const turnKey = asText(payload.turnKey);
      if (!turnKey) continue;
      const iterationIndex = asNumber(payload.iterationIndex);

      if (row.action === VIBE_ACTIONS.turnStarted) {
        await this.startTurn(sessionKey, turnKey, asNumber(payload.seq), asText(payload.prompt));
      } else if (row.action === VIBE_ACTIONS.modelReplied) {
        await this.projectIteration(sessionKey, turnKey, iterationIndex);
      } else if (row.action === VIBE_ACTIONS.toolCompleted) {
        await this.projectTool(sessionKey, turnKey, iterationIndex, asText(payload.toolCallKey), {
          exitCode: typeof payload.exitCode === "number" ? payload.exitCode : null,
          timedOut: payload.timedOut === true,
          durationMs: asNumber(payload.durationMs),
        });
      } else {
        const stoppedBy = asText(payload.stoppedBy);
        const failed = stoppedBy !== "" && stoppedBy !== "final";
        await this.finishTurn(sessionKey, turnKey, failed ? "failed" : "done", asText(payload.answer), failed ? `stopped by ${stoppedBy}` : "");
      }
    }
    return result.rowCount ?? 0;
  }

  /** A session's turns, oldest first. This is what a reopened session renders from. */
  async turns(sessionKey: string): Promise<TurnSummary[]> {
    // `seq::text AS seq_text`, not `seq::text`. An output column called `seq`
    // would shadow the real one in ORDER BY, and the sort would be the string
    // sort — putting turn 180225 ahead of turn 90113 and shuffling the
    // conversation. The cast exists because bigint does not survive JSON; the
    // ordering has to keep using the number.
    const result = await this.pool.query<{
      turn_key: string; seq_text: string; prompt: string; phase: string; answer: string; error: string;
      iterations: number; tool_calls: number; started_at: Date; ended_at: Date | null;
    }>(
      `SELECT turn_key, seq::text AS seq_text, prompt, phase, answer, error, iterations, tool_calls, started_at, ended_at
         FROM vibe_turn_view WHERE session_key = $1 ORDER BY seq, started_at`,
      [sessionKey],
    );
    return result.rows.map((row) => ({
      turnKey: row.turn_key, seq: Number(row.seq_text), prompt: row.prompt, phase: row.phase,
      answer: row.answer, error: row.error, iterations: row.iterations, toolCalls: row.tool_calls,
      startedAt: row.started_at.toISOString(), endedAt: row.ended_at?.toISOString() ?? "",
    }));
  }

  /** One turn's bodies, fetched when somebody opens it and dropped when they close it. */
  async blocks(sessionKey: string, turnKey: string): Promise<BlockRow[]> {
    // Aliased for the same reason as above: ordering must be numeric, and an
    // output column named `seq` would quietly make it lexicographic.
    const result = await this.pool.query<{
      seq_text: string; kind: BlockRow["kind"]; iteration_index: number; tool_call_key: string;
      command: string; body: string; exit_code: number | null; timed_out: boolean; duration_ms: number;
    }>(
      `SELECT seq::text AS seq_text, kind, iteration_index, tool_call_key, command, body, exit_code, timed_out, duration_ms
         FROM vibe_block_view WHERE session_key = $1 AND turn_key = $2 ORDER BY seq`,
      [sessionKey, turnKey],
    );
    return result.rows.map((row) => ({
      seq: Number(row.seq_text), kind: row.kind, iterationIndex: row.iteration_index,
      toolCallKey: row.tool_call_key, command: row.command, body: row.body,
      exitCode: row.exit_code, timedOut: row.timed_out, durationMs: row.duration_ms,
    }));
  }
}
