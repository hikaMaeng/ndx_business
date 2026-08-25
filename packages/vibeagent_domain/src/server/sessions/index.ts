import type { Pool } from "pg";
import { VIBE_ACTIONS, VIBE_TURN_ACTION } from "../../common/index.js";

export interface VibeSessionSummary {
  sessionId: string;
  title: string;
  turns: number;
  toolCalls: number;
  startedAt: string;
  lastActivityAt: string;
}

/**
 * A read model over the event store.
 *
 * Sessions are not a table — nothing writes a "session" row. A session is just
 * the events that share a stream, so listing them is a query, not a record to
 * keep in step. That also means the list cannot drift from what actually
 * happened.
 *
 * This is domain work: the broker moves envelopes and has no idea what a turn
 * or a tool call is.
 */
export async function listVibeSessions(pool: Pool, userId: string, limit = 50): Promise<VibeSessionSummary[]> {
  const result = await pool.query<{
    session_id: string; title: string | null; turns: string; tool_calls: string; started_at: Date; last_at: Date;
  }>(
    `SELECT session_id,
            -- The first prompt names the session; nothing else describes it.
            (ARRAY_AGG(payload->>'prompt' ORDER BY sequence) FILTER (WHERE action = $2))[1] AS title,
            count(*) FILTER (WHERE action = $2)::text AS turns,
            count(*) FILTER (WHERE action = $3)::text AS tool_calls,
            min(stored_at) AS started_at,
            max(stored_at) AS last_at
       FROM event_store
      WHERE session_id LIKE $1 AND action LIKE 'vibe.%'
      GROUP BY session_id
      ORDER BY max(stored_at) DESC
      LIMIT $4`,
    // Ownership is carried by the session id itself, so the filter is the same
    // rule the socket guard applies at the envelope.
    [`${userId}-%`, VIBE_TURN_ACTION, VIBE_ACTIONS.toolStarted, limit],
  );

  return result.rows.map((row) => ({
    sessionId: row.session_id,
    title: (row.title ?? "").trim().split("\n")[0]?.slice(0, 120) || "(제목 없는 세션)",
    turns: Number(row.turns),
    toolCalls: Number(row.tool_calls),
    startedAt: new Date(row.started_at).toISOString(),
    lastActivityAt: new Date(row.last_at).toISOString(),
  }));
}

/** The one rule the broker needs to police a replay request. */
export function ownsVibeChannel(channel: string, userId: string): boolean {
  return channel.startsWith(`vibe.${userId}-`);
}
