import type { Pool, PoolClient } from "pg";
import { normaliseWorkspacePath } from "../../common/index.js";
import type { ChatMessage, ChatToolCall } from "../llm/index.js";

export interface SessionRow {
  sessionKey: string;
  workspace: string;
}

/** A message on its way into the conversation. `ordinal` is assigned by the store. */
export interface PendingMessage {
  turnKey?: string;
  iterationIndex?: number;
  role: ChatMessage["role"];
  content?: string;
  toolCalls?: ChatToolCall[];
  toolCallId?: string;
}

interface MessageRow {
  role: ChatMessage["role"];
  content: string;
  tool_calls: ChatToolCall[] | null;
  tool_call_id: string | null;
}

function toChatMessage(row: MessageRow): ChatMessage {
  if (row.role === "tool") return { role: "tool", content: row.content, tool_call_id: row.tool_call_id ?? "" };
  if (row.role === "assistant") {
    return { role: "assistant", content: row.content, ...(row.tool_calls?.length ? { tool_calls: row.tool_calls } : {}) };
  }
  return { role: row.role, content: row.content } as ChatMessage;
}

/**
 * One consistent context history per session, kept consistent by the database.
 *
 * Every operation that must not race takes the session row with `FOR UPDATE`
 * first. That is the synchronisation — not a mutex in one process, which two
 * processes would not share, but a row lock every worker on every machine
 * contends for. A handler that holds it is the only one changing this session
 * until it commits.
 */
export class SessionStore {
  constructor(private readonly pool: Pool) {}

  /**
   * Opens a session in a folder, or confirms the one it already has.
   *
   * The insert is the immutability check: a session that exists keeps the
   * folder it was created with, and a second open naming a different one is
   * refused rather than merged. `ON CONFLICT DO NOTHING` plus a read makes that
   * one atomic step instead of a check followed by a race.
   */
  async open(sessionKey: string, workspace: string): Promise<{ row: SessionRow; created: boolean }> {
    const folder = normaliseWorkspacePath(workspace);
    if (!folder) throw new Error(`workspace path is not usable: ${JSON.stringify(workspace)}`);

    const inserted = await this.pool.query<{ workspace: string }>(
      `INSERT INTO vibe_session (session_key, workspace) VALUES ($1, $2)
       ON CONFLICT (session_key) DO NOTHING
       RETURNING workspace`,
      [sessionKey, folder],
    );
    if (inserted.rowCount) return { row: { sessionKey, workspace: folder }, created: true };

    const existing = await this.pool.query<{ workspace: string }>("SELECT workspace FROM vibe_session WHERE session_key = $1", [sessionKey]);
    const held = existing.rows[0]?.workspace;
    if (!held) throw new Error(`session ${sessionKey} could not be opened`);
    if (held !== folder) throw new Error(`session ${sessionKey} already works in ${held}; a session's folder is immutable`);
    return { row: { sessionKey, workspace: held }, created: false };
  }

  async find(sessionKey: string): Promise<SessionRow | null> {
    const result = await this.pool.query<{ workspace: string }>("SELECT workspace FROM vibe_session WHERE session_key = $1", [sessionKey]);
    const workspace = result.rows[0]?.workspace;
    return workspace ? { sessionKey, workspace } : null;
  }

  /**
   * Hands out a block of positions.
   *
   * Numbering every fact through the database would be a round trip per
   * streamed token. Taking a block instead is one round trip per handler, and
   * the blocks are disjoint by construction — two workers cannot be handed the
   * same range, so their facts cannot collide even though neither knows the
   * other exists. Unused positions in a block are simply never spent; gaps are
   * fine because positions are compared, not counted.
   */
  async allocateSequence(sessionKey: string, size: number): Promise<number> {
    const result = await this.pool.query<{ start: string }>(
      `UPDATE vibe_session SET next_seq = next_seq + $2, updated_at = now()
        WHERE session_key = $1
        RETURNING (next_seq - $2)::text AS start`,
      [sessionKey, Math.max(1, size)],
    );
    const start = result.rows[0]?.start;
    if (start === undefined) throw new Error(`session ${sessionKey} is not open`);
    return Number(start);
  }

  /**
   * Appends to the conversation under the session's lock.
   *
   * The lock is what makes the history one history. Two handlers appending at
   * once — a tool result and a model reply, say — would otherwise compute the
   * same next ordinal and one would be lost.
   */
  async appendMessages(sessionKey: string, messages: readonly PendingMessage[]): Promise<void> {
    if (!messages.length) return;
    const client: PoolClient = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query("SELECT 1 FROM vibe_session WHERE session_key = $1 FOR UPDATE", [sessionKey]);
      if (!locked.rowCount) throw new Error(`session ${sessionKey} is not open`);

      const next = await client.query<{ ordinal: string }>(
        "SELECT COALESCE(max(ordinal), 0)::text AS ordinal FROM vibe_session_message WHERE session_key = $1",
        [sessionKey],
      );
      let ordinal = Number(next.rows[0]?.ordinal ?? 0);

      for (const message of messages) {
        ordinal += 1;
        // `DO NOTHING`, not an upsert: if this message is already here, a
        // previous attempt at this same step wrote it and everything
        // downstream has already read that version. The first write is the one
        // the conversation was built on, so the retry defers to it rather than
        // replacing it. Skipping leaves a gap in `ordinal`, which costs
        // nothing — ordinals are compared, not counted.
        await client.query(
          `INSERT INTO vibe_session_message (session_key, ordinal, turn_key, iteration_index, role, content, tool_calls, tool_call_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
           ON CONFLICT DO NOTHING`,
          [
            sessionKey, ordinal, message.turnKey ?? null, message.iterationIndex ?? null,
            message.role, message.content ?? "",
            message.toolCalls?.length ? JSON.stringify(message.toolCalls) : null,
            message.toolCallId ?? null,
          ],
        );
      }
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }

  /**
   * Claims the right to declare one iteration finished. True at most once.
   *
   * Every reactor that answers a tool call goes on to ask whether the iteration
   * is complete, and with parallel calls more than one of them can correctly
   * see that it is. Only the one whose insert survives may say so. The loser
   * has done its job and stops, which is the right outcome — the iteration is
   * ready exactly once no matter how many reactors noticed.
   */
  async claimIterationReady(sessionKey: string, turnKey: string, iterationIndex: number): Promise<boolean> {
    const result = await this.pool.query(
      `INSERT INTO vibe_iteration_ready (session_key, turn_key, iteration_index)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [sessionKey, turnKey, iterationIndex],
    );
    return result.rowCount === 1;
  }

  /**
   * The whole pile, in order, ready to hand to inference.
   *
   * There is nothing incremental about an inference call: it remembers nothing
   * between requests, so every call gets the entire history. This is that history.
   */
  async history(sessionKey: string): Promise<ChatMessage[]> {
    const result = await this.pool.query<MessageRow>(
      `SELECT role, content, tool_calls, tool_call_id
         FROM vibe_session_message WHERE session_key = $1 ORDER BY ordinal`,
      [sessionKey],
    );
    return result.rows.map(toChatMessage);
  }

  /**
   * The model's message for one iteration, read back rather than carried.
   *
   * The fact that says the model replied carries a count, not content. Whoever
   * has to look at what it actually said comes here, which keeps the fact small
   * and keeps the history the single copy.
   */
  async lastAssistantMessage(sessionKey: string, turnKey: string, iterationIndex: number): Promise<{ content: string; toolCalls: ChatToolCall[] } | null> {
    const result = await this.pool.query<{ content: string; tool_calls: ChatToolCall[] | null }>(
      `SELECT content, tool_calls FROM vibe_session_message
        WHERE session_key = $1 AND turn_key = $2 AND iteration_index = $3 AND role = 'assistant'
        ORDER BY ordinal DESC LIMIT 1`,
      [sessionKey, turnKey, iterationIndex],
    );
    const row = result.rows[0];
    return row ? { content: row.content, toolCalls: row.tool_calls ?? [] } : null;
  }

  /**
   * How many tool calls this iteration asked for, and how many have answered.
   *
   * The join that decides whether to call the model again reads this. One
   * assistant message can carry several tool calls, so what is counted is the
   * calls inside it, not the rows — and each answer is its own `tool` row.
   */
  async toolProgress(sessionKey: string, turnKey: string, iterationIndex: number): Promise<{ requested: number; completed: number }> {
    const result = await this.pool.query<{ requested: string; completed: string }>(
      `SELECT COALESCE(sum(jsonb_array_length(tool_calls)) FILTER (WHERE role = 'assistant' AND tool_calls IS NOT NULL), 0)::text AS requested,
              count(*) FILTER (WHERE role = 'tool')::text AS completed
         FROM vibe_session_message
        WHERE session_key = $1 AND turn_key = $2 AND iteration_index = $3`,
      [sessionKey, turnKey, iterationIndex],
    );
    return { requested: Number(result.rows[0]?.requested ?? 0), completed: Number(result.rows[0]?.completed ?? 0) };
  }
}
