import type { Pool } from "pg";
import type { EventEnvelope } from "agent/common";
import type { LoopConfig } from "../config/index.js";
import type { SessionStore } from "../session/index.js";
import type { ViewStore } from "../view/index.js";

/**
 * What a reactor is given.
 *
 * A reactor causes side effects only on what it was handed. `globals` is what
 * every session shares; `session` is this session's state. Neither is a lock and
 * neither is occupied — the session's real state lives in the database, and this
 * is a handle to it.
 */
export interface ReactorGlobals {
  pool: Pool;
  config: LoopConfig;
  sessions: SessionStore;
  /** The read model. Only the projection touches it; everyone else ignores it. */
  view: ViewStore;
}

/** How many positions a reactor reserves before it starts emitting. */
const SEQUENCE_BLOCK = 8192;

/**
 * A block of positions, handed out synchronously.
 *
 * Numbering through the database per delta would be a round trip per token.
 * The block is taken once, from a counter every worker on every machine
 * contends for, so two reactors can never be handed overlapping ranges even
 * though neither knows the other exists. Unspent positions are simply never
 * used; positions are compared, not counted.
 */
export class Sequencer {
  private used = 0;
  constructor(private readonly start: number, private readonly size: number) {}

  next(): number {
    if (this.used >= this.size) throw new Error("sequence block exhausted");
    const position = this.start + this.used;
    this.used += 1;
    return position;
  }
}

/**
 * One session's handle, for the length of one reaction.
 *
 * It is built per event and thrown away after. Nothing is cached across
 * reactions on purpose: the truth is the table, and a reactor that trusted a
 * warm copy would be trusting a copy some other worker may already have moved on.
 */
export class SessionContext {
  constructor(
    readonly sessionKey: string,
    readonly workspace: string,
    readonly store: SessionStore,
    readonly sequence: Sequencer,
  ) {}
}

/** The session id an event belongs to, from the envelope first and the payload only as a fallback. */
export function sessionKeyOf(event: EventEnvelope): string {
  const payload = event.payload as Record<string, unknown>;
  const fromPayload = typeof payload.sessionKey === "string" ? payload.sessionKey : "";
  return event.sessionId ?? fromPayload;
}

/**
 * Builds the handle for an event's session.
 *
 * Returns null when the session has no folder yet, which is the one thing a
 * reactor may not proceed without — a session that was never opened has nowhere
 * to work.
 */
export async function loadSession(globals: ReactorGlobals, sessionKey: string): Promise<SessionContext | null> {
  if (!sessionKey) return null;
  const row = await globals.sessions.find(sessionKey);
  if (!row) return null;
  const start = await globals.sessions.allocateSequence(sessionKey, SEQUENCE_BLOCK);
  return new SessionContext(sessionKey, row.workspace, globals.sessions, new Sequencer(start, SEQUENCE_BLOCK));
}
