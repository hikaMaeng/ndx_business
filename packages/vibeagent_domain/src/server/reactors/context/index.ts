import type { Pool } from "pg";
import type { EventEnvelope } from "agent/common";
import type { LoopConfig } from "../../config/index.js";
import type { SessionStore } from "../../session/index.js";
import type { ViewStore } from "../../view/index.js";

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
 * A block of positions, handed out synchronously, refilled before it runs dry.
 *
 * Numbering through the database per delta would be a round trip per token.
 * The block is taken once, from a counter every worker on every machine
 * contends for, so two reactors can never be handed overlapping ranges even
 * though neither knows the other exists. Unspent positions are simply never
 * used; positions are compared, not counted.
 *
 * One block used to be all there was, and running out threw. That put a hard
 * ceiling on a single reaction — a long enough stream of reasoning, or a
 * command with enough output — and the failure landed at the worst possible
 * moment: after the inference call had been paid for, part-way through
 * delivering its answer.
 *
 * So a fresh block is requested at the halfway mark, while thousands of
 * positions remain to spend. Switching to it early skips whatever is left of
 * the old one, which does not matter: a new block begins past the end of the
 * old one, so positions still only ever increase.
 */
export class Sequencer {
  private used = 0;
  private refilling = false;

  constructor(
    private start: number,
    private readonly size: number,
    private readonly reserve?: (size: number) => Promise<number>,
  ) {}

  next(): number {
    // Reached only if a refill lost a race against half a block of emissions,
    // which is a stream long enough to be worth hearing about.
    if (this.used >= this.size) throw new Error("sequence block exhausted before its refill arrived");
    const position = this.start + this.used;
    this.used += 1;
    if (this.reserve && !this.refilling && this.used * 2 >= this.size) void this.refill();
    return position;
  }

  private async refill(): Promise<void> {
    this.refilling = true;
    try {
      const next = await this.reserve!(this.size);
      // Assigned together, and never between two `next()` calls: this runs in a
      // continuation, and nothing suspends between these two statements.
      this.start = next;
      this.used = 0;
    } catch (error) {
      console.error(JSON.stringify({ event: "vibe.sequence.refill.failed", error: error instanceof Error ? error.message : String(error) }));
    } finally {
      this.refilling = false;
    }
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
  const reserve = (size: number): Promise<number> => globals.sessions.allocateSequence(sessionKey, size);
  return new SessionContext(sessionKey, row.workspace, globals.sessions, new Sequencer(start, SEQUENCE_BLOCK, reserve));
}
